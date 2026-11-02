/**
 * @vitest-environment node
 *
 * Platform (break-glass superadmin) auth: login/session plus the hard cross-tier
 * isolation (a platform session never authenticates a responder/citizen route, and
 * vice versa). single-lgu-agency-network (R2) removed the operator CONSOLE and its
 * tenant/office/agency management routes; only the login/session plumbing remains.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { hashPassword } from '../src/lib/auth/password';
import { handlePlatformLogin, handlePlatformSession } from '../src/lib/api/platform-handlers';
import { handleListIncidents } from '../src/lib/api/incidents-handlers';
import { PLATFORM_SESSION_COOKIE } from '../src/lib/platform/session';
import { SESSION_COOKIE } from '../src/lib/auth/session';
import { createTestHarness, jsonBody } from './support/harness';

const PASSWORD = 'correct horse battery staple';

let world: ReturnType<typeof createTestHarness>;

beforeEach(async () => {
  world = createTestHarness();
  world.platformStore.seedAdmin({
    id: 'ops-1',
    email: 'ops@aira.ph',
    passwordHash: await hashPassword(PASSWORD),
  });
});

async function opsToken(): Promise<string> {
  const response = await handlePlatformLogin(
    new Request(
      'http://localhost/api/platform/login',
      jsonBody('POST', { email: 'ops@aira.ph', password: PASSWORD }),
    ),
    world.deps,
  );
  const cookie = response.headers.get('set-cookie') ?? '';
  const token = new RegExp(`${PLATFORM_SESSION_COOKIE}=([A-Za-z0-9_-]+)`).exec(cookie)?.[1];
  if (!token) {
    throw new Error(`platform_login_failed_${response.status}`);
  }
  return token;
}

describe('POST /api/platform/login (break-glass superadmin)', () => {
  it('signs in an operator and sets a platform cookie', async () => {
    const response = await handlePlatformLogin(
      new Request(
        'http://localhost/api/platform/login',
        jsonBody('POST', { email: 'ops@aira.ph', password: PASSWORD }),
      ),
      world.deps,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain(PLATFORM_SESSION_COOKIE);
  });

  it('rejects bad credentials', async () => {
    const response = await handlePlatformLogin(
      new Request(
        'http://localhost/api/platform/login',
        jsonBody('POST', { email: 'ops@aira.ph', password: 'nope-nope-nope' }),
      ),
      world.deps,
    );
    expect(response.status).toBe(401);
  });
});

describe('cross-tier isolation', () => {
  it('a platform session never authenticates a responder route', async () => {
    const token = await opsToken();

    // Present the platform token under both the responder and platform cookie names.
    const asResponder = await handleListIncidents(
      new Request('http://localhost/api/incidents', {
        headers: { cookie: `${SESSION_COOKIE}=${token}` },
      }),
      world.deps,
    );
    expect(asResponder.status).toBe(401);

    const asPlatform = await handleListIncidents(
      new Request('http://localhost/api/incidents', {
        headers: { cookie: `${PLATFORM_SESSION_COOKIE}=${token}` },
      }),
      world.deps,
    );
    expect(asPlatform.status).toBe(401);
  });

  it('a responder session (or a fabricated cookie) never authenticates a platform route', async () => {
    world.authStore.seedResponder({ id: 'responder-admin', callsign: 'ADMIN-1', role: 'ADMIN' });
    const { login } = await import('../src/lib/auth/service');
    const signIn = await login(world.deps.auth, { email: 'admin-1@aira.test', password: PASSWORD });
    const fabricated = signIn.status === 'ok' ? signIn.token : 'a'.repeat(43);

    const response = await handlePlatformSession(
      new Request('http://localhost/api/platform/session', {
        headers: { cookie: `${PLATFORM_SESSION_COOKIE}=${fabricated}` },
      }),
      world.deps,
    );
    expect(response.status).toBe(401);
  });
});
