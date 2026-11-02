/**
 * @vitest-environment node
 *
 * Feature: single-lgu-agency-network, routing capability determination.
 *
 * Property-based tests for `isCapable` from `apps/web/src/lib/routing.ts`.
 * The editable per-tenant capability config has been removed (Requirement 9);
 * `isCapable(category, agencyType)` now reads the fixed built-in
 * `CATEGORY_AGENCY_DEFAULT` map. Three invariants must hold for ALL valid inputs:
 *
 *   P1 — null agencyType (DRRM generalist) is capable of EVERY Emergency_Category (R6.2).
 *   P2 — `isCapable` equals the legacy hardcoded map
 *        `{SUNOG:['FIRE'],MEDIKAL:['MEDICAL'],KRIMEN:['POLICE'],BAHA:[]}` for every
 *        (category, type | null) pair (R6.2/R9.3).
 *   P3 — A non-null type absent from the category's set (incl. empty BAHA) ⇒ false,
 *        and `isCapable` never throws (R6.7).
 *
 * Each property runs ≥ 100 iterations via fast-check.
 *
 * Validates: Requirements R6.2, R6.7, R9.3
 */

import type { AgencyType, EmergencyCategoryId } from '@aira/ui';
import { AGENCY_TYPES } from '@aira/ui';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { isCapable } from '../src/lib/routing';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RUNS = 100;

const FROZEN_CATEGORIES: readonly EmergencyCategoryId[] = [
  'SUNOG',
  'MEDIKAL',
  'KRIMEN',
  'BAHA',
] as const;

/**
 * The legacy hardcoded capability map (inline, independent of the module under
 * test) used for the default-equals-legacy property (P2).
 */
const LEGACY_CAPABILITY: Readonly<Record<EmergencyCategoryId, readonly AgencyType[]>> = {
  SUNOG: ['FIRE'],
  MEDIKAL: ['MEDICAL'],
  KRIMEN: ['POLICE'],
  BAHA: [],
};

function legacyIsCapable(category: EmergencyCategoryId, type: AgencyType | null): boolean {
  if (type === null) return true;
  return (LEGACY_CAPABILITY[category] as readonly string[]).includes(type);
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Arbitrary Emergency_Category from the frozen set. */
const categoryArb: fc.Arbitrary<EmergencyCategoryId> = fc.constantFrom(...FROZEN_CATEGORIES);

/** Arbitrary AgencyType (non-null). */
const agencyTypeArb: fc.Arbitrary<AgencyType> = fc.constantFrom(
  ...(AGENCY_TYPES as readonly AgencyType[]),
);

/** Arbitrary AgencyType or null (null = DRRM generalist). */
const agencyTypeOrNullArb: fc.Arbitrary<AgencyType | null> = fc.oneof(
  agencyTypeArb,
  fc.constant(null),
);

// ---------------------------------------------------------------------------
// P1 — Null type ⇒ capable of every category (R6.2)
// ---------------------------------------------------------------------------
describe('Property P1: null agencyType (DRRM generalist) is capable of every category', () => {
  it('isCapable returns true for null agencyType regardless of category', () => {
    fc.assert(
      fc.property(categoryArb, (category) => {
        expect(isCapable(category, null)).toBe(true);
      }),
      { numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// P2 — isCapable equals the legacy hardcoded map for every pair (R6.2/R9.3)
// ---------------------------------------------------------------------------
describe('Property P2: isCapable equals the legacy hardcoded map', () => {
  it('isCapable matches the legacy decision for every (category, agencyType|null) pair', () => {
    fc.assert(
      fc.property(categoryArb, agencyTypeOrNullArb, (category, agencyType) => {
        expect(isCapable(category, agencyType)).toBe(legacyIsCapable(category, agencyType));
      }),
      { numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// P3 — Non-null type absent from the category set ⇒ false, never throws (R6.7)
// ---------------------------------------------------------------------------
describe('Property P3: a non-null type absent from the category set returns false and never throws', () => {
  it('returns false for any (category, type) where the fixed map omits the type', () => {
    fc.assert(
      fc.property(categoryArb, agencyTypeArb, (category, agencyType) => {
        let result: boolean | undefined;
        expect(() => {
          result = isCapable(category, agencyType);
        }).not.toThrow();
        expect(result).toBe(LEGACY_CAPABILITY[category].includes(agencyType));
      }),
      { numRuns: RUNS },
    );
  });

  it('returns false for every non-null type under BAHA (empty capability set)', () => {
    fc.assert(
      fc.property(agencyTypeArb, (agencyType) => {
        expect(isCapable('BAHA', agencyType)).toBe(false);
      }),
      { numRuns: RUNS },
    );
  });
});
