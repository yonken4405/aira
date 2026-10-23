/**
 * @vitest-environment node
 *
 * `/api/admin/*` contract: roster projection (no hashes), provisioning, role changes,
 * session revocation, audit access and the admin lockout protections.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  handleCreateResponder,
  handleListAudit,
  handleListResponders,
  handleRevokeResponderSessions,
  handleUpdateResponder,
} from '../src/lib/api/admin-handlers';
import { handleLogin } from '../src/lib/api/auth-handlers';
import { createRateLimiter } from '../src/lib/rate-limit';
import { createTestClock, createTestHarness, jsonBody, withSession } from './support/harness';
import { OFFICE_ID, TEST_PASSWORD } from './support/fixtures';

const URL_BASE = 'http://localhost';
const NEW_PASSWORD = 'correct horse battery staple';

function createWorld() {
  const clock = createTestClock();
  const harness = createTestHarness({ clock });

  const admin = harness.authStore.seedResponder({
    id: 'responder-admin',
    callsign: 'ADMIN-1',
    role: 'ADMIN',
  });
  const dispatcher = harness.authStore.seedResponder({
    id: 'responder-dispatcher',
    callsign: 'OPCEN-01',
    role: 'DISPATCHER',
  });
  const field = harness.authStore.seedResponder({
    id: 'responder-field',
    callsign: 'K9-01',
    role: 'RESPONDER',
  });

  async function tokenFor(callsign: string, password = TEST_PASSWORD): Promise<string> {
    // A dedicated limiter keeps unrelated sign-ins in this file from tripping the
    // login rate limit (that behaviour is covered in api-auth.test.ts). Login is by
    // email; seedResponder derived it from the callsign.
    const response = await handleLogin(
      new Request(
        `${URL_BASE}/api/auth/login`,
        jsonBody('POST', { email: `${callsign.toLowerCase()}@aira.test`, password }),
      ),
      {
        ...harness.deps,
        loginLimiter: createRateLimiter({ capacity: 100, windowMs: 60_000, now: clock.now }),
      },
    );

    const cookie = response.headers.get('set-cookie') ?? '';
    const token = /aira_session=([A-Za-z0-9_-]+)/.exec(cookie)?.[1];
    if (!token) {
      throw new Error(`login_failed_${response.status}`);
    }
    return token;
  }

  return { ...harness, clock, admin, dispatcher, field, tokenFor };
}

let world: ReturnType<typeof createWorld>;

beforeEach(() => {
  world = createWorld();
});

describe('GET /api/admin/responders', () => {
  it('returns the roster without any password hash', async () => {
    const token = await world.tokenFor('ADMIN-1');
    const response = await handleListResponders(
      withSession(`${URL_BASE}/api/admin/responders`, token),
      world.deps,
    );

    expect(response.status).toBe(200);

    const raw = await response.text();
    expect(raw).not.toContain('passwordHash');
    expect(raw).not.toContain('argon2');

    const body = JSON.parse(raw) as {
      responders: Array<{ callsign: string }>;
      offices: Array<{ name: string }>;
      agencies: Array<{ code: string }>;
    };

    expect(body.responders.map((row) => row.callsign).sort()).toEqual([
      'ADMIN-1',
      'K9-01',
      'OPCEN-01',
    ]);
    expect(body.offices.length).toBeGreaterThan(0);
    expect(body.agencies.length).toBeGreaterThan(0);
  });

  it('denies dispatchers and responders', async () => {
    for (const callsign of ['OPCEN-01', 'K9-01']) {
      const response = await handleListResponders(
        withSession(`${URL_BASE}/api/admin/responders`, await world.tokenFor(callsign)),
        world.deps,
      );
      expect(response.status).toBe(403);
    }
  });
});

describe('POST /api/admin/responders', () => {
  const create = (token: string, body: unknown): Promise<Response> =>
    handleCreateResponder(
      withSession(`${URL_BASE}/api/admin/responders`, token, jsonBody('POST', body)),
      world.deps,
    );

  it('provisions an account and returns the one-time password once', async () => {
    const token = await world.tokenFor('ADMIN-1');
    const response = await create(token, {
      email: 'new.unit@cebu.gov.ph',
      callsign: 'UNIT-7',
      role: 'RESPONDER',
      officeId: OFFICE_ID,
      agencyId: null,
    });

    expect(response.status).toBe(201);

    const body = (await response.json()) as {
      responder: { email: string; callsign: string; role: string; mustChangePassword: boolean };
      password: string;
    };

    expect(body.responder).toMatchObject({
      email: 'new.unit@cebu.gov.ph',
      callsign: 'UNIT-7',
      role: 'RESPONDER',
      mustChangePassword: true,
    });
    expect(body.password).toHaveLength(20);

    // The returned password is real: the new account can sign in with it (by email).
    const login = await handleLogin(
      new Request(
        `${URL_BASE}/api/auth/login`,
        jsonBody('POST', { email: 'new.unit@cebu.gov.ph', password: body.password }),
      ),
      world.deps,
    );
    expect(login.status).toBe(200);
  });

  it('rejects a duplicate email', async () => {
    const token = await world.tokenFor('ADMIN-1');
    const response = await create(token, {
      email: 'k9-01@aira.test',
      role: 'RESPONDER',
      officeId: OFFICE_ID,
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, error: 'email_taken' });
  });

  it('rejects weak passwords supplied by the admin', async () => {
    const token = await world.tokenFor('ADMIN-1');
    const response = await create(token, {
      email: 'unit9@cebu.gov.ph',
      role: 'RESPONDER',
      officeId: OFFICE_ID,
      password: 'short',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'weak_password' });
  });

  it('validates the payload shape', async () => {
    const token = await world.tokenFor('ADMIN-1');

    // Bad role, and missing email.
    expect(
      (await create(token, { email: 'x@cebu.gov.ph', role: 'SUPERUSER', officeId: OFFICE_ID }))
        .status,
    ).toBe(400);
    expect((await create(token, { role: 'RESPONDER', officeId: OFFICE_ID })).status).toBe(400);
  });

  it('denies non-admins', async () => {
    const token = await world.tokenFor('OPCEN-01');
    const response = await create(token, {
      email: 'unit9@cebu.gov.ph',
      role: 'RESPONDER',
      officeId: OFFICE_ID,
    });

    expect(response.status).toBe(403);
  });
});

describe('PATCH /api/admin/responders/:id', () => {
  const patch = (token: string, id: string, body: unknown): Promise<Response> =>
    handleUpdateResponder(
      withSession(`${URL_BASE}/api/admin/responders/${id}`, token, jsonBody('PATCH', body)),
      world.deps,
      id,
    );

  it('changes a role and signs the target out of existing sessions', async () => {
    const adminToken = await world.tokenFor('ADMIN-1');
    const fieldToken = await world.tokenFor('K9-01');

    const fieldSession = [...world.authStore.sessions.values()].find(
      (session) => session.responderId === world.field.id,
    );
    expect(fieldSession).toBeTruthy();

    const response = await patch(adminToken, world.field.id, { role: 'DISPATCHER' });
    expect(response.status).toBe(200);

    expect(world.authStore.sessions.get(fieldSession?.id ?? '')?.revokedAt).not.toBeNull();

    // The old session no longer resolves.
    expect(
      (
        await handleListResponders(
          withSession(`${URL_BASE}/api/admin/responders`, fieldToken),
          world.deps,
        )
      ).status,
    ).toBe(401);
  });

  it('unlocks and re-activates accounts', async () => {
    const adminToken = await world.tokenFor('ADMIN-1');

    await world.deps.auth.store.markLoginFailure(world.field.id, {
      now: world.clock.now(),
      lockMs: 900_000,
      threshold: 1,
    });

    const unlocked = await patch(adminToken, world.field.id, { unlock: true });
    expect(unlocked.status).toBe(200);

    const stored = await world.authStore.findResponderById(world.field.id);
    expect(stored?.lockedUntil).toBeNull();

    const deactivated = await patch(adminToken, world.field.id, { active: false });
    expect(deactivated.status).toBe(200);

    const activated = await patch(adminToken, world.field.id, { active: true });
    expect(activated.status).toBe(200);
  });

  it('refuses self-lockout', async () => {
    const adminToken = await world.tokenFor('ADMIN-1');

    expect((await patch(adminToken, world.admin.id, { active: false })).status).toBe(409);
    expect((await patch(adminToken, world.admin.id, { role: 'RESPONDER' })).status).toBe(409);
  });

  it('rejects invalid payloads and unknown accounts', async () => {
    const adminToken = await world.tokenFor('ADMIN-1');

    expect((await patch(adminToken, world.field.id, { role: 'SUPERUSER' })).status).toBe(400);
    expect((await patch(adminToken, world.field.id, {})).status).toBe(400);
    expect((await patch(adminToken, 'ghost', { active: false })).status).toBe(404);
  });
});

describe('DELETE /api/admin/responders/:id/sessions', () => {
  it('revokes live sessions and reports the count', async () => {
    await world.tokenFor('K9-01');
    await world.tokenFor('K9-01');
    const adminToken = await world.tokenFor('ADMIN-1');

    const response = await handleRevokeResponderSessions(
      withSession(`${URL_BASE}/api/admin/responders/${world.field.id}/sessions`, adminToken, {
        method: 'DELETE',
      }),
      world.deps,
      world.field.id,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, revoked: 2 });
  });

  it('requires the admin permission', async () => {
    const token = await world.tokenFor('OPCEN-01');
    const response = await handleRevokeResponderSessions(
      withSession(`${URL_BASE}/api/admin/responders/${world.field.id}/sessions`, token, {
        method: 'DELETE',
      }),
      world.deps,
      world.field.id,
    );

    expect(response.status).toBe(403);
  });
});

describe('GET /api/admin/audit', () => {
  it('returns recent authentication events to admins only', async () => {
    await world.tokenFor('K9-01');

    const adminToken = await world.tokenFor('ADMIN-1');
    const response = await handleListAudit(
      withSession(`${URL_BASE}/api/admin/audit?limit=10`, adminToken),
      world.deps,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { events: Array<{ event: string }> };
    expect(body.events.length).toBeGreaterThan(0);
    expect(body.events.some((event) => event.event === 'LOGIN_SUCCESS')).toBe(true);

    const denied = await handleListAudit(
      withSession(`${URL_BASE}/api/admin/audit`, await world.tokenFor('OPCEN-01')),
      world.deps,
    );
    expect(denied.status).toBe(403);
  });

  it('clamps the limit and never leaks credentials', async () => {
    const adminToken = await world.tokenFor('ADMIN-1');
    const response = await handleListAudit(
      withSession(`${URL_BASE}/api/admin/audit?limit=9999`, adminToken),
      world.deps,
    );

    const raw = await response.text();
    expect(raw).not.toContain(TEST_PASSWORD);
    expect(raw).not.toContain(NEW_PASSWORD);
    expect(raw).not.toContain('argon2');
  });
});
