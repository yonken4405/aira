/**
 * SQL adapter for the encrypted medical profile (SECURITY.md §8). Handles ciphertext
 * only; plaintext never reaches this module.
 */

import { query, queryOne } from '../db';
import type { MedicalProfileRow, MedicalStore } from './store';

interface Row {
  citizenId: string;
  ciphertext: string;
  version: number;
  updatedAt: Date;
}

const map = (row: Row): MedicalProfileRow => ({
  citizenId: row.citizenId,
  ciphertext: row.ciphertext,
  version: row.version,
  updatedAt: row.updatedAt.getTime(),
});

const COLUMNS = `
  citizen_id as "citizenId",
  ciphertext,
  version,
  updated_at as "updatedAt"
`;

export function createPostgresMedicalStore(): MedicalStore {
  return {
    async find(citizenId) {
      const row = await queryOne<Row>(
        `select ${COLUMNS} from public.citizen_medical_profiles where citizen_id = $1 limit 1`,
        [citizenId],
      );
      return row ? map(row) : null;
    },

    async upsert(input) {
      const row = await queryOne<Row>(
        `insert into public.citizen_medical_profiles (citizen_id, ciphertext)
         values ($1, $2)
         on conflict (citizen_id)
         do update set ciphertext = excluded.ciphertext,
                       version = public.citizen_medical_profiles.version + 1
         returning ${COLUMNS}`,
        [input.citizenId, input.ciphertext],
      );
      if (!row) {
        throw new Error('medical_upsert_failed');
      }
      return map(row);
    },

    async remove(citizenId) {
      await query(`delete from public.citizen_medical_profiles where citizen_id = $1`, [citizenId]);
    },
  };
}
