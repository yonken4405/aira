/**
 * Server-side wiring for the medical service. The AES key is read from
 * `MEDICAL_ENCRYPTION_KEY` (SECURITY.md §8.2); a missing/invalid key fails closed.
 */

import { loadKeyFromEnv } from '../crypto/secretbox';
import { isDatabaseConfigured } from '../db';
import { createPostgresMedicalStore } from './postgres-store';
import type { MedicalServiceDeps } from './service';
import type { MedicalStore } from './store';

let store: MedicalStore | null = null;
let key: Buffer | null = null;

export function getMedicalDeps(): MedicalServiceDeps {
  if (!isDatabaseConfigured()) {
    throw new Error('database_not_configured');
  }
  if (!store) {
    store = createPostgresMedicalStore();
  }
  if (!key) {
    key = loadKeyFromEnv(process.env.MEDICAL_ENCRYPTION_KEY);
  }
  return { store, key };
}
