/**
 * @vitest-environment node
 *
 * Citizen API (SECURITY.md §7): register/login/device/session/logout, plus the hard
 * isolation rule - a citizen session is rejected by a responder route and vice versa.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  handleCitizenDeviceAuth,
  handleCitizenLogin,
  handleCitizenLogout,
  handleCitizenRegister,
  handleCitizenSession,
} from '../src/lib/api/citizen-handlers';
import { handleListIncidents } from '../src/lib/api/incidents-handlers';
import { CITIZEN_SESSION_COOKIE } from '../src/lib/citizen/session';
import { SESSION_COOKIE } from '../src/lib/auth/session';
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
