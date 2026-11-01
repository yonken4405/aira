/**
 * @vitest-environment node
 *
 * Feature: tenant-responder-network, Property 8: Capability determination
 *
 * Property-based tests for `isCapable` from `apps/web/src/lib/routing.ts`.
 * Encodes four invariants that must hold for ALL valid inputs:
 *
 *   P1 — null agencyType (DRRM generalist) is capable of EVERY Emergency_Category,
 *        regardless of the CapabilityConfig (R6.2).
 *   P2 — Under `DEFAULT_CAPABILITY_CONFIG`, `isCapable` equals the legacy hardcoded
 *        map `{SUNOG:['FIRE'],MEDIKAL:['MEDICAL'],KRIMEN:['POLICE'],BAHA:[]}` for
 *        every (category, type | null) pair (R6.3/R9.6).
 *   P3 — A non-null type absent from `config[category]` (empty set or a type not in
 *        the set) ⇒ `isCapable` returns false and never throws (R6.6).
 *   P4 — With an arbitrary CapabilityConfig, `isCapable(cat, type, config) === true`
 *        iff type is null OR `config[cat].includes(type)`.
 *
 * Each property runs ≥ 100 iterations via fast-check.
 *
 * Validates: Requirements R5.9, R6.2, R6.3, R6.6, R9.6
 */

// Feature: tenant-responder-network, Property 8: Capability determination

import type { AgencyType, EmergencyCategoryId } from '@aira/ui';
import { AGENCY_TYPES } from '@aira/ui';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { CapabilityConfig } from '../src/lib/platform/types';
import { DEFAULT_CAPABILITY_CONFIG, isCapable } from '../src/lib/routing';

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

/**
 * Arbitrary CapabilityConfig: for each of the four frozen categories, pick a
 * random subset of AGENCY_TYPES (possibly empty).
 */
const capabilityConfigArb: fc.Arbitrary<CapabilityConfig> = fc.record({
  SUNOG: fc.subarray([...AGENCY_TYPES]),
  MEDIKAL: fc.subarray([...AGENCY_TYPES]),
  KRIMEN: fc.subarray([...AGENCY_TYPES]),
  BAHA: fc.subarray([...AGENCY_TYPES]),
}) as fc.Arbitrary<CapabilityConfig>;

// ---------------------------------------------------------------------------
// P1 — Null type ⇒ capable of every category, regardless of config (R6.2)
// Validates: Requirements R6.2, R9.6
// ---------------------------------------------------------------------------
describe('Property P1: null agencyType (DRRM generalist) is capable of every category', () => {
  it('isCapable returns true for null agencyType regardless of category and config', () => {
    fc.assert(
      fc.property(categoryArb, capabilityConfigArb, (category, config) => {
        expect(isCapable(category, null, config)).toBe(true);
      }),
      { numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// P2 — Under DEFAULT_CAPABILITY_CONFIG, result equals the legacy hardcoded map
//       for every (category, type | null) pair (R6.3/R9.6)
// Validates: Requirements R6.3, R9.6
// ---------------------------------------------------------------------------
describe('Property P2: under DEFAULT_CAPABILITY_CONFIG, isCapable equals the legacy hardcoded map', () => {
  it('isCapable matches the legacy decision for every (category, agencyType|null) pair', () => {
    fc.assert(
      fc.property(categoryArb, agencyTypeOrNullArb, (category, agencyType) => {
        const result = isCapable(category, agencyType, DEFAULT_CAPABILITY_CONFIG);
        const legacy = legacyIsCapable(category, agencyType);
        expect(result).toBe(legacy);
      }),
      { numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// P3 — Non-null type absent from config[category] ⇒ false, never throws (R6.6)
// Validates: Requirements R6.6, R5.9
// ---------------------------------------------------------------------------
describe('Property P3: non-null type absent from config[category] returns false and never throws', () => {
  it('returns false for any type not present in the category set of an arbitrary config', () => {
    fc.assert(
      fc.property(
        categoryArb,
        agencyTypeArb,
        capabilityConfigArb,
        (category, agencyType, config) => {
          // Construct a config where the type is definitely absent for the category.
          const configWithoutType: CapabilityConfig = {
            ...config,
            [category]: (config[category] as readonly AgencyType[]).filter((t) => t !== agencyType),
          };

          // Must not throw, and must return false.
          let result: boolean | undefined;
          expect(() => {
            result = isCapable(category, agencyType, configWithoutType);
          }).not.toThrow();
          expect(result).toBe(false);
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('returns false for any type when the category set is empty, never throws', () => {
    fc.assert(
      fc.property(categoryArb, agencyTypeArb, (category, agencyType) => {
        const emptyConfig: CapabilityConfig = {
          SUNOG: [],
          MEDIKAL: [],
          KRIMEN: [],
          BAHA: [],
        };

        let result: boolean | undefined;
        expect(() => {
          result = isCapable(category, agencyType, emptyConfig);
        }).not.toThrow();
        expect(result).toBe(false);
      }),
      { numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// P4 — With arbitrary config, isCapable === (type is null OR config[cat].includes(type))
// Validates: Requirements R6.2, R6.6
// ---------------------------------------------------------------------------
describe('Property P4: isCapable equals (type === null || config[category].includes(type))', () => {
  it('isCapable produces the correct boolean for every arbitrary (category, type, config) triple', () => {
    fc.assert(
      fc.property(
        categoryArb,
        agencyTypeOrNullArb,
        capabilityConfigArb,
        (category, agencyType, config) => {
          const result = isCapable(category, agencyType, config);
          const expected =
            agencyType === null || (config[category] as readonly string[]).includes(agencyType);
          expect(result).toBe(expected);
        },
      ),
      { numRuns: RUNS },
    );
  });
});
