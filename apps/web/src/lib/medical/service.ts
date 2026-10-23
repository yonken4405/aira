/**
 * Medical profile service (SECURITY.md §8).
 *
 * Encrypts on write, decrypts on read, and is the ONLY place plaintext profiles exist
 * in the process. The owning citizen reads/writes the full profile; the on-incident
 * responder snapshot is derived here too (used by Task 8's grant check). The encryption
 * key is injected so the whole thing is testable with an ephemeral key.
 */

import { decryptJson, encryptJson } from '../crypto/secretbox';
import {
  EMPTY_PROFILE,
  parseProfile,
  sanitizeProfile,
  toSnapshot,
  type MedicalProfile,
  type MedicalSnapshot,
} from './profile';
import type { MedicalStore } from './store';

export interface MedicalServiceDeps {
  readonly store: MedicalStore;
  /** 32-byte AES key (loaded from env in production, random in tests). */
  readonly key: Buffer;
}

/** Reads the owner's full profile, or the empty profile when none is stored. */
export async function readOwnProfile(
  deps: MedicalServiceDeps,
  citizenId: string,
): Promise<MedicalProfile> {
  const row = await deps.store.find(citizenId);
  if (!row) {
    return EMPTY_PROFILE;
  }
  const decrypted = decryptJson(row.ciphertext, deps.key);
  // A row that will not decrypt (rotated key, tamper) degrades to empty rather than
  // leaking an error with any profile detail.
  return parseProfile(decrypted);
}

/** True when the citizen has a stored (non-empty intent) profile row. */
export async function hasProfile(deps: MedicalServiceDeps, citizenId: string): Promise<boolean> {
  return (await deps.store.find(citizenId)) !== null;
}

/** Sanitises, encrypts and stores the owner's profile. Returns the canonical result. */
export async function saveOwnProfile(
  deps: MedicalServiceDeps,
  citizenId: string,
  rawBody: unknown,
): Promise<MedicalProfile> {
  const profile = sanitizeProfile(rawBody);
  const ciphertext = encryptJson(profile, deps.key);
  await deps.store.upsert({ citizenId, ciphertext });
  return profile;
}

export async function deleteOwnProfile(deps: MedicalServiceDeps, citizenId: string): Promise<void> {
  await deps.store.remove(citizenId);
}

/**
 * Decrypts a citizen's profile into the minimised responder snapshot. Used by the
 * on-incident, need-to-know reveal (Task 8) - the caller is responsible for the grant
 * check; this function only does the decrypt + minimise.
 */
export async function readSnapshotFor(
  deps: MedicalServiceDeps,
  citizenId: string,
): Promise<MedicalSnapshot | null> {
  const row = await deps.store.find(citizenId);
  if (!row) {
    return null;
  }
  const profile = parseProfile(decryptJson(row.ciphertext, deps.key));
  return toSnapshot(profile);
}
