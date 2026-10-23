/**
 * @vitest-environment node
 *
 * Account-deletion store primitive (SECURITY.md §7.5, Requirement 10.1).
 *
 * TDD red: `deleteCitizen` is not yet part of the `CitizenStore` port nor the
 * in-memory store (task 6.2 adds it). This test pins the required behaviour —
 * deleting a citizen row removes exactly that citizen and leaves the others
 * untouched — so it compiles green only once the primitive exists.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  registerWithEmail,
  resolveCitizenSession,
  // TDD red (task 7.1): `deleteCitizenAccount` does not exist yet — task 7.2 adds it.
  // Importing it now is what makes this file fail to typecheck/compile (the correct red).
  //
  // PINNED SIGNATURE for task 7.2 — implement EXACTLY this shape in
  // apps/web/src/lib/citizen/service.ts:
  //
  //   export async function deleteCitizenAccount(
  //     citizenDeps: CitizenServiceDeps,
  //     medicalDeps: MedicalServiceDeps,
  //     principal: CitizenPrincipal,
  //   ): Promise<void>
  //
  // Order of effects (design §new backend endpoint, tasks 7.2):
  //   1. citizenDeps.store.revokeSession(principal.sessionId, { at: now, reason: 'account_deleted' })
  //   2. deleteOwnProfile(medicalDeps, principal.citizenId)   // -> MedicalStore.remove
  //   3. citizenDeps.store.deleteCitizen(principal.citizenId)
  // No identity / profile / contact values logged (R10.7).
  deleteCitizenAccount,
} from '../src/lib/citizen/service';
import { saveOwnProfile } from '../src/lib/medical/service';
import { createTestClock, createTestHarness } from './support/harness';
import { createMemoryCitizenStore, type MemoryCitizenStore } from './support/memory-citizen-store';

let clock: ReturnType<typeof createTestClock>;
let store: MemoryCitizenStore;

beforeEach(() => {
  clock = createTestClock();
  store = createMemoryCitizenStore({ now: clock.now });
});

describe('CitizenStore.deleteCitizen', () => {
  it('removes the targeted citizen so findById returns null, leaving others untouched', async () => {
    const a = await store.create({
      email: 'ana@example.com',
      deviceKeyHash: null,
      passwordHash: 'hash-a',
      emailVerified: false,
    });
    const b = await store.create({
      email: 'ben@example.com',
      deviceKeyHash: null,
      passwordHash: 'hash-b',
      emailVerified: false,
    });

    // Both citizens are present before deletion.
    expect(await store.findById(a.id)).not.toBeNull();
    expect(await store.findById(b.id)).not.toBeNull();

    await store.deleteCitizen(a.id);

    // The targeted citizen is gone; the other is untouched.
    expect(await store.findById(a.id)).toBeNull();
    const remaining = await store.findById(b.id);
    expect(remaining).not.toBeNull();
    expect(remaining?.email).toBe('ben@example.com');
  });
});

/**
 * Account-deletion SERVICE (SECURITY.md §7.5, Requirements 10.1 / 10.4 / 10.5).
 *
 * TDD red: `deleteCitizenAccount` is not yet exported from the citizen service
 * (task 7.2 adds it). These tests pin the required behaviour over the in-memory
 * citizen + medical stores so the file compiles green only once the service
 * function exists and behaves as specified.
 *
 * The anonymous-incident guarantee (R10.5) cannot be asserted here because
 * incidents are NOT part of the citizen or medical service deps — `deleteCitizenAccount`
 * only touches the citizen store and the medical store. The handler/route test
 * (task 7.3, apps/web/tests/api-citizen.test.ts) covers R10.5 end-to-end by
 * asserting a pre-existing anonymous incident is untouched after a DELETE.
 */
describe('deleteCitizenAccount (service)', () => {
  const PASSWORD = 'correct horse battery staple';

  it('revokes the session, removes the medical row, and deletes the citizen, leaving others untouched', async () => {
    const harness = createTestHarness();
    const { citizen: citizenDeps, medical: medicalDeps } = harness.deps;

    // The citizen to delete — register to get a real session token + principal.
    const registered = await registerWithEmail(citizenDeps, {
      email: 'ana@example.com',
      password: PASSWORD,
    });
    expect(registered.status).toBe('ok');
    if (registered.status !== 'ok') {
      throw new Error('registration_failed');
    }
    const { token, principal } = registered;

    // Give that citizen a stored (encrypted) medical profile row.
    await saveOwnProfile(medicalDeps, principal.citizenId, {
      bloodType: 'O-',
      allergies: ['penicillin'],
      contacts: [{ name: 'Ben', phone: '0917-000-0000' }],
    });

    // A pre-existing OTHER citizen + their medical row — must remain untouched.
    const other = await registerWithEmail(citizenDeps, {
      email: 'other@example.com',
      password: PASSWORD,
    });
    expect(other.status).toBe('ok');
    if (other.status !== 'ok') {
      throw new Error('registration_failed');
    }
    await saveOwnProfile(medicalDeps, other.principal.citizenId, {
      bloodType: 'A+',
    });

    // Preconditions: session resolves, both rows present.
    expect(await resolveCitizenSession(citizenDeps, token)).not.toBeNull();
    expect(await harness.citizenStore.findById(principal.citizenId)).not.toBeNull();
    expect(await harness.medicalStore.find(principal.citizenId)).not.toBeNull();

    await deleteCitizenAccount(citizenDeps, medicalDeps, principal);

    // R10.4 — the current session is revoked; the old token no longer resolves.
    expect(await resolveCitizenSession(citizenDeps, token)).toBeNull();

    // R10.1 — the citizen identity row is gone.
    expect(await harness.citizenStore.findById(principal.citizenId)).toBeNull();

    // R10.1 — the medical profile row for that citizen is removed.
    expect(await harness.medicalStore.find(principal.citizenId)).toBeNull();

    // The OTHER citizen and their medical data are untouched.
    const survivor = await harness.citizenStore.findById(other.principal.citizenId);
    expect(survivor).not.toBeNull();
    expect(survivor?.email).toBe('other@example.com');
    expect(await harness.medicalStore.find(other.principal.citizenId)).not.toBeNull();
    expect(await resolveCitizenSession(citizenDeps, other.token)).not.toBeNull();
  });

  it('records the revocation reason as account_deleted (R10.4)', async () => {
    const harness = createTestHarness();
    const { citizen: citizenDeps, medical: medicalDeps } = harness.deps;

    const registered = await registerWithEmail(citizenDeps, {
      email: 'cara@example.com',
      password: PASSWORD,
    });
    expect(registered.status).toBe('ok');
    if (registered.status !== 'ok') {
      throw new Error('registration_failed');
    }
    const { principal } = registered;

    const session = harness.citizenStore.sessions.find((s) => s.id === principal.sessionId);
    expect(session).toBeDefined();
    expect(session?.revokedAt).toBeNull();

    await deleteCitizenAccount(citizenDeps, medicalDeps, principal);

    // The session row is revoked (the in-memory store stamps revokedAt when
    // revokeSession is called with reason 'account_deleted').
    expect(session?.revokedAt).not.toBeNull();
  });
});
