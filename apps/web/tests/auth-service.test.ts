/**
 * @vitest-environment node
 *
 * Authentication and session lifecycle rules (SECURITY.md §4), exercised against the
 * in-memory store with a controllable clock. Login is by EMAIL; callsign is an optional
 * display label.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { DUMMY_PASSWORD_HASH } from '../src/lib/auth/password';
import {
  changePassword,
  createResponder,
  login,
  logout,
  resolveSession,
  revokeResponderSessions,
  updateResponder,
  type AuthServiceDeps,
} from '../src/lib/auth/service';
import { SESSION_ABSOLUTE_MS, SESSION_IDLE_MS, hashSessionToken } from '../src/lib/auth/session';
import { createTestClock, createTestHarness } from './support/harness';
import { OFFICE_ID, TEST_PASSWORD } from './support/fixtures';

// seedResponder derives the login email from the callsign: K9-01 -> k9-01@aira.test.
const FIELD_EMAIL = 'k9-01@aira.test';
const ADMIN_EMAIL = 'admin-1@aira.test';

function setup() {
  const clock = createTestClock();
  const harness = createTestHarness({ clock });
  const deps: AuthServiceDeps = harness.deps.auth;

  const responder = harness.authStore.seedResponder({
    id: 'responder-field',
    callsign: 'K9-01',
    role: 'RESPONDER',
  });
  const dispatcher = harness.authStore.seedResponder({
    id: 'responder-dispatcher',
    callsign: 'OPCEN-01',
    role: 'DISPATCHER',
  });
  const admin = harness.authStore.seedResponder({
    id: 'responder-admin',
    callsign: 'ADMIN-1',
    role: 'ADMIN',
  });

  return { clock, harness, deps, responder, dispatcher, admin };
}

let world: ReturnType<typeof setup>;

beforeEach(() => {
  world = setup();
});

interface SignedIn {
  readonly token: string;
  readonly sessionId: string;
  readonly email: string;
}

async function signIn(email: string): Promise<SignedIn> {
  const result = await login(world.deps, { email, password: TEST_PASSWORD });
  if (result.status !== 'ok') {
    throw new Error(`login_failed:${result.status}`);
  }
  return {
    token: result.token,
    sessionId: result.principal.sessionId,
    email: result.principal.email,
  };
}

describe('login', () => {
  it('issues an opaque token and never returns the password hash', async () => {
    const result = await login(world.deps, { email: FIELD_EMAIL, password: TEST_PASSWORD });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.principal).toMatchObject({
      email: FIELD_EMAIL,
      callsign: 'K9-01',
      role: 'RESPONDER',
    });
    expect(JSON.stringify(result)).not.toContain(DUMMY_PASSWORD_HASH);

    const stored = await world.deps.store.findSessionByTokenHash(hashSessionToken(result.token));
    expect(stored).not.toBeNull();
    expect(stored?.tokenHash).not.toBe(result.token);
  });

  it('normalises the email so sign-in is case-insensitive', async () => {
    const result = await login(world.deps, {
      email: '  K9-01@AIRA.test  ',
      password: TEST_PASSWORD,
    });
    expect(result.status).toBe('ok');
  });

  it('rejects a wrong password and an unknown email identically', async () => {
    const wrong = await login(world.deps, { email: FIELD_EMAIL, password: 'wrong-password' });
    const unknown = await login(world.deps, {
      email: 'nobody@aira.test',
      password: 'wrong-password',
    });

    expect(wrong).toEqual({ status: 'invalid' });
    expect(unknown).toEqual({ status: 'invalid' });
  });

  it('locks the account for 15 minutes after five failures', async () => {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const result = await login(world.deps, { email: FIELD_EMAIL, password: 'wrong-password' });
      expect(result.status).toBe('invalid');
    }

    const fifth = await login(world.deps, { email: FIELD_EMAIL, password: 'wrong-password' });
    expect(fifth.status).toBe('locked');

    // Even the correct password is refused while the lock holds.
    const duringLock = await login(world.deps, { email: FIELD_EMAIL, password: TEST_PASSWORD });
    expect(duringLock.status).toBe('locked');

    world.clock.advance(15 * 60 * 1000 + 1);

    const afterLock = await login(world.deps, { email: FIELD_EMAIL, password: TEST_PASSWORD });
    expect(afterLock.status).toBe('ok');
  });

  it('refuses inactive accounts with the generic reason', async () => {
    await updateResponder(world.deps, world.responder.id, { active: false });

    const result = await login(world.deps, { email: FIELD_EMAIL, password: TEST_PASSWORD });
    expect(result).toEqual({ status: 'invalid' });
  });

  it('writes an audit event for successes and failures', async () => {
    await login(world.deps, { email: FIELD_EMAIL, password: TEST_PASSWORD });
    await login(world.deps, { email: FIELD_EMAIL, password: 'nope' });

    const events = world.harness.authStore.events;
    expect(events.map((event) => event.event)).toEqual(['LOGIN_SUCCESS', 'LOGIN_FAILURE']);
    expect(JSON.stringify(events)).not.toContain(TEST_PASSWORD);
  });
});

describe('session resolution', () => {
  it('slides the idle window at most once a minute', async () => {
    const session = await signIn(FIELD_EMAIL);
    const createdAt = world.clock.now();

    world.clock.advance(5_000);
    const early = await resolveSession(world.deps, session.token);
    expect(early?.email).toBe(FIELD_EMAIL);

    const untouched = await world.deps.store.findSessionByTokenHash(
      hashSessionToken(session.token),
    );
    expect(untouched?.lastSeenAt).toBe(createdAt);

    world.clock.advance(60_000);
    await resolveSession(world.deps, session.token);

    const touched = await world.deps.store.findSessionByTokenHash(hashSessionToken(session.token));
    expect(touched?.lastSeenAt).toBe(world.clock.now());
    expect(touched?.expiresAt).toBe(world.clock.now() + SESSION_IDLE_MS);
  });

  it('ends the session after 30 minutes of inactivity and revokes the row', async () => {
    const session = await signIn(FIELD_EMAIL);

    world.clock.advance(SESSION_IDLE_MS + 1);

    expect(await resolveSession(world.deps, session.token)).toBeNull();

    const stored = await world.deps.store.findSessionByTokenHash(hashSessionToken(session.token));
    expect(stored?.revokedAt).not.toBeNull();
  });

  it('enforces the 24 hour absolute cap regardless of activity', async () => {
    const session = await signIn(FIELD_EMAIL);

    for (let step = 0; step < 71; step += 1) {
      world.clock.advance(20 * 60 * 1000);
      expect(await resolveSession(world.deps, session.token)).not.toBeNull();
    }

    world.clock.advance(SESSION_ABSOLUTE_MS);
    expect(await resolveSession(world.deps, session.token)).toBeNull();
  });

  it('rejects malformed tokens without touching the store', async () => {
    expect(await resolveSession(world.deps, 'short')).toBeNull();
    expect(await resolveSession(world.deps, null)).toBeNull();
    expect(await resolveSession(world.deps, 'a'.repeat(43))).toBeNull();
  });

  it('revokes sessions when the account is disabled mid-session', async () => {
    const session = await signIn(FIELD_EMAIL);

    await updateResponder(world.deps, world.responder.id, { active: false });

    expect(await resolveSession(world.deps, session.token)).toBeNull();
  });
});

describe('logout', () => {
  it('revokes the current session and audits it', async () => {
    const session = await signIn(FIELD_EMAIL);

    const principal = await resolveSession(world.deps, session.token);
    if (!principal) {
      throw new Error('expected_session');
    }

    await logout(world.deps, principal);

    expect(await resolveSession(world.deps, session.token)).toBeNull();
    expect(world.harness.authStore.events.some((event) => event.event === 'LOGOUT')).toBe(true);
    expect(world.harness.authStore.sessions.get(session.sessionId)?.revokedAt).not.toBeNull();
  });
});

describe('changePassword', () => {
  it('rejects a wrong current password', async () => {
    const session = await signIn(FIELD_EMAIL);
    const principal = await resolveSession(world.deps, session.token);
    if (!principal) {
      throw new Error('expected_session');
    }

    const result = await changePassword(
      world.deps,
      principal,
      'nope',
      'correct horse battery staple',
    );
    expect(result.status).toBe('invalid_current');
  });

  it('rejects a weak new password', async () => {
    const session = await signIn(FIELD_EMAIL);
    const principal = await resolveSession(world.deps, session.token);
    if (!principal) {
      throw new Error('expected_session');
    }

    const result = await changePassword(world.deps, principal, TEST_PASSWORD, 'short');
    expect(result).toEqual({ status: 'weak', problem: 'too_short' });
  });

  it('updates the hash, clears the flag and keeps only the current session', async () => {
    const first = await signIn(FIELD_EMAIL);
    const second = await signIn(FIELD_EMAIL);

    expect(second.sessionId).not.toBe(first.sessionId);

    const principal = await resolveSession(world.deps, first.token);
    if (!principal) {
      throw new Error('expected_session');
    }

    const result = await changePassword(
      world.deps,
      principal,
      TEST_PASSWORD,
      'correct horse battery staple',
    );
    expect(result.status).toBe('ok');

    const stored = await world.harness.authStore.findResponderById(world.responder.id);
    expect(stored?.passwordHash).not.toBe(DUMMY_PASSWORD_HASH);
    expect(stored?.mustChangePassword).toBe(false);

    expect(world.harness.authStore.sessions.get(first.sessionId)?.revokedAt).toBeNull();
    expect(world.harness.authStore.sessions.get(second.sessionId)?.revokedAt).not.toBeNull();

    const relogin = await login(world.deps, {
      email: FIELD_EMAIL,
      password: 'correct horse battery staple',
    });
    expect(relogin.status).toBe('ok');
  });
});

describe('account administration', () => {
  it('creates accounts with a hashed password, email login and optional callsign', async () => {
    const result = await createResponder(world.deps, {
      email: ' New.Unit@cebu.gov.ph ',
      callsign: 'UNIT-7',
      role: 'RESPONDER',
      officeId: OFFICE_ID,
      agencyId: null,
      password: 'correct horse battery staple',
      mustChangePassword: true,
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.responder.email).toBe('new.unit@cebu.gov.ph');
    expect(result.responder.callsign).toBe('UNIT-7');
    expect(result.responder.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(result.responder.mustChangePassword).toBe(true);
  });

  it('allows a responder with no callsign (display falls back to the email)', async () => {
    const result = await createResponder(world.deps, {
      email: 'no.callsign@cebu.gov.ph',
      callsign: null,
      role: 'RESPONDER',
      officeId: OFFICE_ID,
      agencyId: null,
      password: 'correct horse battery staple',
      mustChangePassword: true,
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }
    expect(result.responder.callsign).toBeNull();
  });

  it('rejects an invalid email', async () => {
    const result = await createResponder(world.deps, {
      email: 'not-an-email',
      callsign: 'X-1',
      role: 'RESPONDER',
      officeId: OFFICE_ID,
      agencyId: null,
      password: 'correct horse battery staple',
      mustChangePassword: true,
    });
    expect(result.status).toBe('invalid_email');
  });

  it('refuses duplicate emails case-insensitively', async () => {
    const result = await createResponder(world.deps, {
      email: 'K9-01@AIRA.test',
      callsign: null,
      role: 'RESPONDER',
      officeId: OFFICE_ID,
      agencyId: null,
      password: 'correct horse battery staple',
      mustChangePassword: true,
    });

    expect(result.status).toBe('conflict');
  });

  it('revokes live sessions on a role change', async () => {
    const session = await signIn(FIELD_EMAIL);

    await updateResponder(world.deps, world.responder.id, { role: 'DISPATCHER' });

    expect(world.harness.authStore.sessions.get(session.sessionId)?.revokedAt).not.toBeNull();
    expect(world.harness.authStore.events.some((event) => event.event === 'ROLE_CHANGED')).toBe(
      true,
    );
  });

  it('revokes every session for an account on demand', async () => {
    const first = await signIn(FIELD_EMAIL);
    const second = await signIn(FIELD_EMAIL);
    const adminSession = await signIn(ADMIN_EMAIL);

    const admin = await resolveSession(world.deps, adminSession.token);
    if (!admin) {
      throw new Error('expected_session');
    }

    const revoked = await revokeResponderSessions(world.deps, world.responder.id, admin);
    expect(revoked).toBe(2);

    expect(world.harness.authStore.sessions.get(first.sessionId)?.revokedAt).not.toBeNull();
    expect(world.harness.authStore.sessions.get(second.sessionId)?.revokedAt).not.toBeNull();
    expect(world.harness.authStore.events.some((event) => event.event === 'SESSION_REVOKED')).toBe(
      true,
    );
  });
});
