import { describe, expect, it } from 'vitest';

// TDD red (task 2.1): this module does not exist yet. Task 2.2 creates
// `packages/ui/src/citizen/medicalBounds.ts` exporting `MEDICAL_BOUNDS`, `BLOOD_TYPES`,
// and `AGE_BANDS`. Until then this import fails to resolve and the whole suite is red —
// which is the intended failure for this task.
import { MEDICAL_BOUNDS, BLOOD_TYPES, AGE_BANDS } from './medicalBounds';

// Server source of truth (data minimisation + bounds live with the domain, SECURITY.md §8).
// `BLOOD_TYPES` / `AGE_BANDS` are already exported from the server module today, so this
// import resolves now and lets the client↔server enums be cross-checked immediately.
import {
  MEDICAL_BOUNDS as SERVER_MEDICAL_BOUNDS,
  BLOOD_TYPES as SERVER_BLOOD_TYPES,
  AGE_BANDS as SERVER_AGE_BANDS,
} from '../../../../apps/web/src/lib/medical/profile';

/**
 * The client in `@aira/ui` MUST mirror the server's medical bounds exactly (R7.7) and the
 * closed blood-type / age-band sets (R8.5), and can never exceed the server (Property 11:
 * "Client bounds never exceed server bounds", validates R7.7, R8.5). These are the canonical
 * expected values, copied from `apps/web/src/lib/medical/profile.ts`.
 */
const EXPECTED_BOUNDS = {
  MAX_ITEMS: 20,
  MAX_ITEM_LEN: 80,
  MAX_NOTES_LEN: 1000,
  MAX_CONTACTS: 5,
  MAX_NAME_LEN: 80,
  MAX_PHONE_LEN: 32,
  MAX_RELATION_LEN: 40,
} as const;

const EXPECTED_BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
const EXPECTED_AGE_BANDS = ['0-12', '13-17', '18-39', '40-64', '65+'] as const;

describe('MEDICAL_BOUNDS mirror (R7.7, R8.5)', () => {
  it('mirrors the server bounds exactly', () => {
    expect(MEDICAL_BOUNDS).toEqual(EXPECTED_BOUNDS);
  });

  it('re-exports the closed BLOOD_TYPES set in server order', () => {
    expect(BLOOD_TYPES).toEqual(EXPECTED_BLOOD_TYPES);
  });

  it('re-exports the closed AGE_BANDS set in server order', () => {
    expect(AGE_BANDS).toEqual(EXPECTED_AGE_BANDS);
  });
});

describe('client ↔ server cross-check (so the two can never drift, R7.7/R8.5, Property 11)', () => {
  it('the @aira/ui BLOOD_TYPES equal the server BLOOD_TYPES', () => {
    expect(BLOOD_TYPES).toEqual(SERVER_BLOOD_TYPES);
  });

  it('the @aira/ui AGE_BANDS equal the server AGE_BANDS', () => {
    expect(AGE_BANDS).toEqual(SERVER_AGE_BANDS);
  });

  // Task 2.2 promoted the previously module-private numeric bounds in
  // `apps/web/src/lib/medical/profile.ts` to an exported `MEDICAL_BOUNDS`, so this cross-check
  // now imports the REAL server values and asserts — for every bound — that the client value
  // equals the server value and never exceeds it (Property 11). The two sides can no longer drift.
  it('the @aira/ui MEDICAL_BOUNDS deep-equals the server MEDICAL_BOUNDS', () => {
    expect(MEDICAL_BOUNDS).toEqual(SERVER_MEDICAL_BOUNDS);
  });

  it('every client bound equals, and never exceeds, the real server bound (Property 11)', () => {
    for (const key of Object.keys(SERVER_MEDICAL_BOUNDS) as (keyof typeof SERVER_MEDICAL_BOUNDS)[]) {
      expect(MEDICAL_BOUNDS[key]).toBe(SERVER_MEDICAL_BOUNDS[key]);
      expect(MEDICAL_BOUNDS[key]).toBeLessThanOrEqual(SERVER_MEDICAL_BOUNDS[key]);
    }
  });
});
