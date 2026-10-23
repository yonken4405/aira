/**
 * In-memory `MedicalStore` for tests (TESTING.md §4.3). Holds ciphertext only.
 */

import type { MedicalProfileRow, MedicalStore } from '../../src/lib/medical/store';

export interface MemoryMedicalStore extends MedicalStore {
  readonly rows: Map<string, MedicalProfileRow>;
}

export function createMemoryMedicalStore(now: () => number = () => Date.now()): MemoryMedicalStore {
  const rows = new Map<string, MedicalProfileRow>();

  return {
    rows,

    async find(citizenId) {
      return rows.get(citizenId) ?? null;
    },

    async upsert(input) {
      const existing = rows.get(input.citizenId);
      const row: MedicalProfileRow = {
        citizenId: input.citizenId,
        ciphertext: input.ciphertext,
        version: existing ? existing.version + 1 : 1,
        updatedAt: now(),
      };
      rows.set(input.citizenId, row);
      return row;
    },

    async remove(citizenId) {
      rows.delete(citizenId);
    },
  };
}
