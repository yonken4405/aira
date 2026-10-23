import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { MEDICAL_BOUNDS, BLOOD_TYPES, AGE_BANDS } from './medicalBounds';

// Server source of truth for the bounds and the closed enums (SECURITY.md §8). The client in
// `@aira/ui` mirrors these; importing the real module here means the two sides can never drift.
import {
  MEDICAL_BOUNDS as SERVER_MEDICAL_BOUNDS,
  BLOOD_TYPES as SERVER_BLOOD_TYPES,
  AGE_BANDS as SERVER_AGE_BANDS,
} from '../../../../apps/web/src/lib/medical/profile';

// Feature: mobile-citizen-account, Property 11: Client bounds never exceed server bounds
//
// Validates: Requirements 7.7, 8.5
//
// The client (`@aira/ui`) mirror of the medical bounds MUST equal the server's source of truth
// for every bound, and can never exceed it. This is a property over the whole key space: rather
// than asserting a fixed list, we sample an arbitrary bound key from the server's own
// `Object.keys` and assert the client value equals — and is <= — the server value. Because the
// generator ranges over every key with ≥100 runs, the property exercises each bound. The same
// key-space idea extends to the closed BLOOD_TYPES / AGE_BANDS enums: any sampled index must
// agree between client and server, and the two sets must be the same length.
describe('Property 11: client medical bounds never exceed server bounds (R7.7, R8.5)', () => {
  const serverBoundKeys = Object.keys(SERVER_MEDICAL_BOUNDS) as (keyof typeof SERVER_MEDICAL_BOUNDS)[];

  it('every bound sampled from the server key space equals, and never exceeds, the client bound', () => {
    fc.assert(
      fc.property(fc.constantFrom(...serverBoundKeys), (key) => {
        const clientValue = MEDICAL_BOUNDS[key as keyof typeof MEDICAL_BOUNDS];
        const serverValue = SERVER_MEDICAL_BOUNDS[key];

        // The client mirrors the server exactly...
        expect(clientValue).toBe(serverValue);
        // ...and therefore never exceeds it (Property 11 non-exceedance).
        expect(clientValue).toBeLessThanOrEqual(serverValue);
      }),
      { numRuns: 100 },
    );
  });

  it('every blood type / age band sampled from the closed enum key space agrees with the server', () => {
    expect(BLOOD_TYPES).toHaveLength(SERVER_BLOOD_TYPES.length);
    expect(AGE_BANDS).toHaveLength(SERVER_AGE_BANDS.length);

    fc.assert(
      fc.property(
        fc.nat({ max: Math.max(SERVER_BLOOD_TYPES.length, SERVER_AGE_BANDS.length) - 1 }),
        (index) => {
          if (index < SERVER_BLOOD_TYPES.length) {
            expect(BLOOD_TYPES[index]).toBe(SERVER_BLOOD_TYPES[index]);
          }
          if (index < SERVER_AGE_BANDS.length) {
            expect(AGE_BANDS[index]).toBe(SERVER_AGE_BANDS[index]);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
