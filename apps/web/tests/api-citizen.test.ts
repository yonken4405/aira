/**
 * @vitest-environment node
 *
 * Citizen API (SECURITY.md §7): register/login/device/session/logout, plus the hard
 * isolation rule - a citizen session is rejected by a responder route and vice versa.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  // TDD red (task 7.3): `handleCitizenAccountDelete` is not implemented yet — task 7.4
  // adds it to citizen-handlers.ts. Importing it now is what makes this file fail to
  // typecheck/compile (the correct red), and the DELETE-account describe block below
  // pins the required behaviour mirroring `handleCitizenLogout`.
  //
  // PINNED SIGNATURE for task 7.4 — implement EXACTLY this shape in
  // apps/web/src/lib/api/citizen-handlers.ts:
  //
  //   export async function handleCitizenAccountDelete(
  //     request: Request,
  //     deps: AppDeps,
  //   ): Promise<Response>
  //
  // Shape (design §new backend endpoint; mirror handleCitizenLogout):
  //   - !isSameOrigin(request)          -> errorResponse(403, 'forbidden_origin')
  //   - authenticateCitizen() === null  -> errorResponse(401, 'unauthenticated')
  //   - otherwise: deleteCitizenAccount(deps.citizen, deps.medical, principal), then
  //     204 with NO_STORE_HEADERS + serializeClearedCitizenSessionCookie(...).
  //   No identity / profile / contact values logged (R10.7).
  handleCitizenAccountDelete,
  handleCitizenDeviceAuth,
  handleCitizenLogin,
  handleCitizenLogout,
  handleCitizenRegister,
  handleCitizenSession,
} from '../src/lib/api/citizen-handlers';
import { handleIntake, handleListIncidents } from '../src/lib/api/incidents-handlers';
import { CITIZEN_SESSION_COOKIE } from '../src/lib/citizen/session';
import { SESSION_COOKIE } from '../src/lib/auth/session';
import { saveOwnProfile } from '../src/lib/medical/service';
import { createTestHarness, jsonBody } from './support/harness';

const PASSWORD = 'correct horse battery staple';

let world: ReturnType<typeof createTestHarness>;

beforeEach(() => {
  world = createTestHarness();
});

function post(
  handler: typeof handleCitizenRegister,
  url: string,
  body: unknown,
): Promise<Response> {
  return handler(new Request(`http://localhost${url}`, jsonBody('POST', body)), world.deps);
}

function tokenFrom(response: Response): string {
  const cookie = response.headers.get('set-cookie') ?? '';
  const token = new RegExp(`${CITIZEN_SESSION_COOKIE}=([A-Za-z0-9_-]+)`).exec(cookie)?.[1];
  if (!token) {
    throw new Error('no_citizen_cookie');
  }
  return token;
}

describe('POST /api/citizen/register', () => {
  it('creates an account and sets a citizen session cookie', async () => {
    const response = await post(handleCitizenRegister, '/api/citizen/register', {
      email: 'juan@example.com',
      password: PASSWORD,
    });

    expect(response.status).toBe(201);
    const payload = (await response.json()) as { ok: boolean; citizen: { email: string } };
    expect(payload.citizen.email).toBe('juan@example.com');
    expect(response.headers.get('set-cookie')).toContain(CITIZEN_SESSION_COOKIE);
  });

  it('rejects a bad email and a weak password', async () => {
    expect(
      (
        await post(handleCitizenRegister, '/api/citizen/register', {
          email: 'x',
          password: PASSWORD,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post(handleCitizenRegister, '/api/citizen/register', {
          email: 'a@b.com',
          password: 'short',
        })
      ).status,
    ).toBe(400);
  });

  it('rejects malformed JSON', async () => {
    const response = await handleCitizenRegister(
      new Request('http://localhost/api/citizen/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{bad',
      }),
      world.deps,
    );
    expect(response.status).toBe(400);
  });
});

describe('POST /api/citizen/login', () => {
  beforeEach(async () => {
    await post(handleCitizenRegister, '/api/citizen/register', {
      email: 'juan@example.com',
      password: PASSWORD,
    });
  });

  it('signs in with the right password', async () => {
    const response = await post(handleCitizenLogin, '/api/citizen/login', {
      email: 'juan@example.com',
      password: PASSWORD,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain(CITIZEN_SESSION_COOKIE);
  });

  it('returns 401 on a wrong password', async () => {
    const response = await post(handleCitizenLogin, '/api/citizen/login', {
      email: 'juan@example.com',
      password: 'wrong-password-xx',
    });
    expect(response.status).toBe(401);
  });
});

describe('POST /api/citizen/device', () => {
  it('provisions and signs in a device-key account', async () => {
    const response = await post(handleCitizenDeviceAuth, '/api/citizen/device', {
      deviceKey: 'a'.repeat(43),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain(CITIZEN_SESSION_COOKIE);
  });

  it('rejects a malformed device key', async () => {
    expect(
      (await post(handleCitizenDeviceAuth, '/api/citizen/device', { deviceKey: 'short' })).status,
    ).toBe(400);
  });
});

describe('GET /api/citizen/session + logout', () => {
  it('returns the signed-in citizen, then 401 after logout', async () => {
    const registered = await post(handleCitizenRegister, '/api/citizen/register', {
      email: 'juan@example.com',
      password: PASSWORD,
    });
    const token = tokenFrom(registered);
    const cookie = `${CITIZEN_SESSION_COOKIE}=${token}`;

    const session = await handleCitizenSession(
      new Request('http://localhost/api/citizen/session', { headers: { cookie } }),
      world.deps,
    );
    expect(session.status).toBe(200);

    await handleCitizenLogout(
      new Request('http://localhost/api/citizen/session', {
        method: 'DELETE',
        headers: { cookie },
      }),
      world.deps,
    );

    const after = await handleCitizenSession(
      new Request('http://localhost/api/citizen/session', { headers: { cookie } }),
      world.deps,
    );
    expect(after.status).toBe(401);
  });

  it('returns 401 without a session', async () => {
    const response = await handleCitizenSession(
      new Request('http://localhost/api/citizen/session'),
      world.deps,
    );
    expect(response.status).toBe(401);
  });
});

describe('cross-tier isolation (SECURITY.md §7.2)', () => {
  it('a citizen session cookie does not authenticate a responder route', async () => {
    const registered = await post(handleCitizenRegister, '/api/citizen/register', {
      email: 'juan@example.com',
      password: PASSWORD,
    });
    const token = tokenFrom(registered);

    // Present the citizen token under BOTH cookie names against the responder queue.
    const asResponderCookie = await handleListIncidents(
      new Request('http://localhost/api/incidents', {
        headers: { cookie: `${SESSION_COOKIE}=${token}` },
      }),
      world.deps,
    );
    expect(asResponderCookie.status).toBe(401);

    const asCitizenCookie = await handleListIncidents(
      new Request('http://localhost/api/incidents', {
        headers: { cookie: `${CITIZEN_SESSION_COOKIE}=${token}` },
      }),
      world.deps,
    );
    expect(asCitizenCookie.status).toBe(401);
  });
});

describe('DELETE /api/citizen/account', () => {
  const EMAIL = 'ana@example.com';
  const ALLERGY = 'penicillin-secret-marker';
  const CONTACT_NAME = 'Benedicto Secret Marker';
  const CONTACT_PHONE = '0917-123-7788';

  /** Register a citizen and return its session token (as a browser would hold it). */
  async function registerCitizen(): Promise<string> {
    const registered = await post(handleCitizenRegister, '/api/citizen/register', {
      email: EMAIL,
      password: PASSWORD,
    });
    expect(registered.status).toBe(201);
    return tokenFrom(registered);
  }

  function deleteAccount(init: RequestInit = {}): Promise<Response> {
    return handleCitizenAccountDelete(
      new Request('http://localhost/api/citizen/account', { method: 'DELETE', ...init }),
      world.deps,
    );
  }

  it('returns 401 unauthenticated without a session', async () => {
    const response = await deleteAccount();
    expect(response.status).toBe(401);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toBe('unauthenticated');
  });

  it('returns 403 forbidden_origin for a cross-site request', async () => {
    const token = await registerCitizen();
    const response = await deleteAccount({
      headers: {
        cookie: `${CITIZEN_SESSION_COOKIE}=${token}`,
        'sec-fetch-site': 'cross-site',
      },
    });
    expect(response.status).toBe(403);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toBe('forbidden_origin');
  });

  it('returns 204, clears the citizen cookie, and revokes the session', async () => {
    const token = await registerCitizen();
    const cookie = `${CITIZEN_SESSION_COOKIE}=${token}`;

    // The session resolves before deletion.
    const before = await handleCitizenSession(
      new Request('http://localhost/api/citizen/session', { headers: { cookie } }),
      world.deps,
    );
    expect(before.status).toBe(200);

    const response = await deleteAccount({ headers: { cookie } });

    // 204 No Content, no body.
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');

    // The Set-Cookie clears the citizen session cookie (Max-Age=0, empty value).
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${CITIZEN_SESSION_COOKIE}=`);
    expect(setCookie).toContain('Max-Age=0');
    // No live token value is re-issued in the clearing cookie.
    expect(setCookie).not.toContain(`${CITIZEN_SESSION_COOKIE}=${token}`);

    // Mutation response is never shared-cached.
    expect(response.headers.get('cache-control')).toBe('no-store');

    // The old token no longer resolves (session revoked + citizen row deleted).
    const after = await handleCitizenSession(
      new Request('http://localhost/api/citizen/session', { headers: { cookie } }),
      world.deps,
    );
    expect(after.status).toBe(401);

    // The citizen identity row is gone (R10.1).
    expect(world.citizenStore.citizens).toHaveLength(0);
  });

  it('leaves a pre-existing anonymous incident untouched (R10.5)', async () => {
    // Seed an anonymous mesh incident (no citizen link) via the public intake.
    const intake = await handleIntake(
      new Request('http://localhost/api/incidents', jsonBody('POST', ['SUNOG', 10.3157, 123.8854])),
      world.deps,
    );
    expect(intake.status).toBe(201);
    const seeded = (await intake.json()) as { incident: { id: string } };
    const incidentId = seeded.incident.id;

    // The seeded incident is anonymous (carries no reporter link).
    const beforeRow = world.incidents.incidents.find((i) => i.id === incidentId);
    expect(beforeRow).toBeDefined();
    expect(beforeRow?.reporterCitizenId).toBeNull();
    const incidentsBefore = world.incidents.incidents.length;

    // A separate citizen deletes their account.
    const token = await registerCitizen();
    const response = await deleteAccount({
      headers: { cookie: `${CITIZEN_SESSION_COOKIE}=${token}` },
    });
    expect(response.status).toBe(204);

    // The anonymous incident is still present and unchanged.
    expect(world.incidents.incidents).toHaveLength(incidentsBefore);
    const afterRow = world.incidents.incidents.find((i) => i.id === incidentId);
    expect(afterRow).toBeDefined();
    expect(afterRow).toEqual(beforeRow);
    expect(afterRow?.reporterCitizenId).toBeNull();
  });

  it('logs no identity / profile / contact value during deletion (R10.7)', async () => {
    const token = await registerCitizen();
    const cookie = `${CITIZEN_SESSION_COOKIE}=${token}`;

    // Resolve the principal's citizen id so we can seed an encrypted medical row with
    // marker values that must never surface in a log.
    const citizenId = world.citizenStore.citizens[0]?.id;
    expect(citizenId).toBeDefined();
    await saveOwnProfile(world.deps.medical, citizenId as string, {
      bloodType: 'O-',
      allergies: [ALLERGY],
      contacts: [{ name: CONTACT_NAME, phone: CONTACT_PHONE }],
    });

    const spies = [
      vi.spyOn(console, 'log').mockImplementation(() => undefined),
      vi.spyOn(console, 'info').mockImplementation(() => undefined),
      vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      vi.spyOn(console, 'error').mockImplementation(() => undefined),
      vi.spyOn(console, 'debug').mockImplementation(() => undefined),
    ];

    const response = await deleteAccount({ headers: { cookie } });
    expect(response.status).toBe(204);

    const logged = spies
      .flatMap((spy) => spy.mock.calls)
      .flat()
      .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
      .join('\n');

    for (const secret of [EMAIL, ALLERGY, CONTACT_NAME, CONTACT_PHONE]) {
      expect(logged).not.toContain(secret);
    }

    for (const spy of spies) {
      spy.mockRestore();
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
