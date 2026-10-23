/**
 * @vitest-environment node
 *
 * Citizen account service (SECURITY.md §7): email + device-key identity, lockout,
 * sessions, and the hard rule that a citizen principal carries no responder access.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  authenticateWithDeviceKey,
  CITIZEN_MAX_FAILURES,
  hashDeviceKey,
  isValidDeviceKey,
  isValidEmail,
  loginWithEmail,
  logoutCitizen,
  normalizeEmail,
  registerWithEmail,
  resolveCitizenSession,
  type CitizenServiceDeps,
} from '../src/lib/citizen/service';
import { createTestClock } from './support/harness';
import { createMemoryCitizenStore, type MemoryCitizenStore } from './support/memory-citizen-store';

const PASSWORD = 'correct horse battery staple';
const DEVICE_KEY = 'a'.repeat(43); // matches the base64url 43-char shape

let clock: ReturnType<typeof createTestClock>;
let store: MemoryCitizenStore;
let deps: CitizenServiceDeps;

beforeEach(() => {
  clock = createTestClock();
  store = createMemoryCitizenStore({ now: clock.now });
  deps = { store, now: clock.now, secureCookies: false };
});

describe('validation helpers', () => {
  it('normalizes and validates emails', () => {
    expect(normalizeEmail('  Juan@Example.COM ')).toBe('juan@example.com');
    expect(isValidEmail('juan@example.com')).toBe(true);
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
  });

  it('validates the device-key shape', () => {
    expect(isValidDeviceKey(DEVICE_KEY)).toBe(true);
    expect(isValidDeviceKey('too-short')).toBe(false);
  });
});

describe('registerWithEmail', () => {
  it('creates an account and issues a session', async () => {
    const result = await registerWithEmail(deps, { email: 'juan@example.com', password: PASSWORD });

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.principal.email).toBe('juan@example.com');
      expect(result.principal.emailVerified).toBe(false); // mocked verification
      expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
    expect(store.citizens).toHaveLength(1);
    // The stored record holds a hash, never the plaintext password.
    expect(store.citizens[0]?.passwordHash).not.toBe(PASSWORD);
  });

  it('rejects an invalid email and a weak password', async () => {
    expect((await registerWithEmail(deps, { email: 'nope', password: PASSWORD })).status).toBe(
      'invalid_email',
    );
    expect((await registerWithEmail(deps, { email: 'a@b.com', password: 'short' })).status).toBe(
      'weak',
    );
  });

  it('reports a conflict generically on a duplicate email', async () => {
    await registerWithEmail(deps, { email: 'dup@example.com', password: PASSWORD });
    const again = await registerWithEmail(deps, { email: 'dup@example.com', password: PASSWORD });
    expect(again.status).toBe('conflict');
  });
});

describe('loginWithEmail', () => {
  beforeEach(async () => {
    await registerWithEmail(deps, { email: 'juan@example.com', password: PASSWORD });
  });

  it('signs in with the right password', async () => {
    const result = await loginWithEmail(deps, { email: 'JUAN@example.com', password: PASSWORD });
    expect(result.status).toBe('ok');
  });

  it('returns a generic invalid for a wrong password and an unknown email', async () => {
    expect(
      (await loginWithEmail(deps, { email: 'juan@example.com', password: 'wrong-password-xx' }))
        .status,
    ).toBe('invalid');
    expect(
      (await loginWithEmail(deps, { email: 'ghost@example.com', password: PASSWORD })).status,
    ).toBe('invalid');
  });

  it('locks the account after too many failures', async () => {
    for (let i = 0; i < CITIZEN_MAX_FAILURES; i += 1) {
      await loginWithEmail(deps, { email: 'juan@example.com', password: 'wrong-password-xx' });
    }
    const locked = await loginWithEmail(deps, { email: 'juan@example.com', password: PASSWORD });
    expect(locked.status).toBe('locked');
    if (locked.status === 'locked') {
      expect(locked.retryAfterSeconds).toBeGreaterThan(0);
    }
  });
});

describe('authenticateWithDeviceKey', () => {
  it('provisions a new passwordless account on first use, then signs the same device in', async () => {
    const first = await authenticateWithDeviceKey(deps, DEVICE_KEY);
    expect(first.status).toBe('ok');
    expect(store.citizens).toHaveLength(1);
    expect(store.citizens[0]?.email).toBeNull();
    expect(store.citizens[0]?.deviceKeyHash).toBe(hashDeviceKey(DEVICE_KEY));

    const second = await authenticateWithDeviceKey(deps, DEVICE_KEY);
    expect(second.status).toBe('ok');
    expect(store.citizens).toHaveLength(1); // same account reused
  });

  it('rejects a malformed device key', async () => {
    expect((await authenticateWithDeviceKey(deps, 'short')).status).toBe('invalid_device_key');
  });
});

describe('sessions', () => {
  it('resolves a valid session token to a principal', async () => {
    const registered = await registerWithEmail(deps, {
      email: 'juan@example.com',
      password: PASSWORD,
    });
    if (registered.status !== 'ok') {
      throw new Error('setup_failed');
    }

    const principal = await resolveCitizenSession(deps, registered.token);
    expect(principal?.citizenId).toBe(registered.principal.citizenId);
  });

  it('stops resolving after logout', async () => {
    const registered = await registerWithEmail(deps, {
      email: 'juan@example.com',
      password: PASSWORD,
    });
    if (registered.status !== 'ok') {
      throw new Error('setup_failed');
    }

    await logoutCitizen(deps, registered.principal);
    expect(await resolveCitizenSession(deps, registered.token)).toBeNull();
  });

  it('rejects a garbage token without touching the store', async () => {
    expect(await resolveCitizenSession(deps, 'not-a-token')).toBeNull();
    expect(await resolveCitizenSession(deps, null)).toBeNull();
  });

  it('a citizen principal carries no role or responder permission field', async () => {
    const registered = await registerWithEmail(deps, {
      email: 'juan@example.com',
      password: PASSWORD,
    });
    if (registered.status !== 'ok') {
      throw new Error('setup_failed');
    }
    // Structurally disjoint from AuthenticatedPrincipal: no `role`, no `callsign`.
    expect(registered.principal).not.toHaveProperty('role');
    expect(registered.principal).not.toHaveProperty('callsign');
    expect(registered.principal).not.toHaveProperty('officeId');
  });
});
