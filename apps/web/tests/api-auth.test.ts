/**
 * @vitest-environment node
 *
 * `/api/auth/*` contract: cookie flags, generic failures, lockout, CSRF and the
 * session lifecycle as the browser observes it.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  handleChangePassword,
  handleLogin,
  handleLogout,
  handleSession,
} from '../src/lib/api/auth-handlers';
import { createTestClock, createTestHarness, jsonBody, withSession } from './support/harness';
import { TEST_PASSWORD } from './support/fixtures';

const LOGIN_URL = 'http://localhost/api/auth/login';

function createWorld() {
  const clock = createTestClock();
  const harness = createTestHarness({ clock });

  harness.authStore.seedResponder({ id: 'responder-field', callsign: 'K9-01', role: 'RESPONDER' });
  harness.authStore.seedResponder({
    id: 'responder-admin',
    callsign: 'ADMIN-1',
    role: 'ADMIN',
  });

  async function signIn(
    email = 'k9-01@aira.test',
    password = TEST_PASSWORD,
  ): Promise<{ token: string; response: Response }> {
    const response = await handleLogin(
      new Request(LOGIN_URL, jsonBody('POST', { email, password })),
      harness.deps,
    );

    const cookie = response.headers.get('set-cookie') ?? '';
    const token = /aira_session=([A-Za-z0-9_-]+)/.exec(cookie)?.[1];

    if (!token) {
      throw new Error(`login_failed_${response.status}`);
    }

    return { token, response };
  }

  return { ...harness, clock, signIn };
}

let world: ReturnType<typeof createWorld>;

beforeEach(() => {
  world = createWorld();
});

describe('POST /api/auth/login', () => {
  it('issues an HttpOnly, SameSite=Lax session cookie', async () => {
    const { response } = await world.signIn();

    expect(response.status).toBe(200);

    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('aira_session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=86400');
    expect(cookie).not.toContain('Secure');

    const body = (await response.json()) as { viewer: Record<string, unknown> };
    expect(body.viewer).toMatchObject({ callsign: 'K9-01', role: 'RESPONDER' });
    expect(JSON.stringify(body)).not.toContain('argon2');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('returns one generic failure for bad credentials', async () => {
    const response = await handleLogin(
      new Request(LOGIN_URL, jsonBody('POST', { email: 'k9-01@aira.test', password: 'wrong' })),
      world.deps,
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: 'invalid_credentials' });
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('answers 423 with a retry hint once the account is locked', async () => {
    let last: Response | null = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      last = await handleLogin(
        new Request(LOGIN_URL, jsonBody('POST', { email: 'k9-01@aira.test', password: 'wrong' })),
        world.deps,
      );
    }

    expect(last?.status).toBe(423);
    expect(Number(last?.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await last?.json()).toMatchObject({ error: 'account_locked' });
  });

  it('rejects a cross-site origin before touching credentials', async () => {
    const response = await handleLogin(
      new Request(LOGIN_URL, {
        ...jsonBody('POST', { email: 'k9-01@aira.test', password: TEST_PASSWORD }),
        headers: {
          'content-type': 'application/json',
          origin: 'https://evil.example',
          'sec-fetch-site': 'cross-site',
        },
      }),
      world.deps,
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, error: 'forbidden_origin' });
  });

  it('rate-limits repeated attempts from one address', async () => {
    let last: Response | null = null;
    for (let attempt = 0; attempt < 21; attempt += 1) {
      last = await handleLogin(
        new Request(LOGIN_URL, jsonBody('POST', { email: 'k9-01@aira.test', password: 'wrong' })),
        world.deps,
      );
    }

    expect(last?.status).toBe(429);
    expect(last?.headers.get('retry-after')).toBeTruthy();
  });
});

describe('GET /api/auth/session', () => {
  it('returns the viewer for a live session', async () => {
    const { token } = await world.signIn();
    const response = await handleSession(
      withSession('http://localhost/api/auth/session', token),
      world.deps,
    );

    expect(response.status).toBe(200);
    expect((await response.json()) as unknown).toMatchObject({
      ok: true,
      viewer: { callsign: 'K9-01', role: 'RESPONDER' },
    });
  });

  it('rejects a missing or expired session', async () => {
    expect(
      (await handleSession(new Request('http://localhost/api/auth/session'), world.deps)).status,
    ).toBe(401);

    const { token } = await world.signIn();
    world.clock.advance(31 * 60 * 1000);

    const expired = await handleSession(
      withSession('http://localhost/api/auth/session', token),
      world.deps,
    );
    expect(expired.status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('clears the cookie and revokes the session server-side', async () => {
    const { token } = await world.signIn();

    const response = await handleLogout(
      withSession('http://localhost/api/auth/logout', token, { method: 'POST' }),
      world.deps,
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');

    const after = await handleSession(
      withSession('http://localhost/api/auth/session', token),
      world.deps,
    );
    expect(after.status).toBe(401);
  });
});

describe('POST /api/auth/password', () => {
  const change = (token: string, body: unknown): Promise<Response> =>
    handleChangePassword(
      withSession('http://localhost/api/auth/password', token, jsonBody('POST', body)),
      world.deps,
    );

  it('rejects a wrong current password', async () => {
    const { token } = await world.signIn();
    const response = await change(token, {
      currentPassword: 'nope',
      newPassword: 'correct horse battery staple',
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: 'invalid_current_password' });
  });

  it('rejects a password that is too short', async () => {
    const { token } = await world.signIn();
    const response = await change(token, { currentPassword: TEST_PASSWORD, newPassword: 'short' });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      error: 'weak_password',
      problem: 'too_short',
    });
  });

  it('updates the password and keeps the caller signed in', async () => {
    const { token } = await world.signIn();

    const response = await change(token, {
      currentPassword: TEST_PASSWORD,
      newPassword: 'correct horse battery staple',
    });

    expect(response.status).toBe(204);

    const session = await handleSession(
      withSession('http://localhost/api/auth/session', token),
      world.deps,
    );
    expect(session.status).toBe(200);
  });

  it('requires a session', async () => {
    const response = await handleChangePassword(
      new Request('http://localhost/api/auth/password', jsonBody('POST', {})),
      world.deps,
    );

    expect(response.status).toBe(401);
  });
});
