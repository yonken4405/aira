/**
 * @vitest-environment node
 *
 * Feature: tenant-responder-network, Property 7: Capability update validation
 *
 * Property: an update via `setCapabilityForCategory` is accepted iff the category
 * is in the frozen set {SUNOG, MEDIKAL, KRIMEN, BAHA} AND every submitted type is
 * in the taxonomy {FIRE, POLICE, MEDICAL, DRRM, OTHER}; otherwise the result is
 * `invalid` and the stored config is unchanged.
 *
 * Sub-properties:
 *   7a — valid (category, types) → accepted (status 'ok')
 *   7b — invalid category → rejected (status 'invalid'), stored config unchanged
 *   7c — any invalid agency type in the list → rejected (status 'invalid'), stored config unchanged
 *   7d — combined: arbitrary strings for category+types → accepted iff both valid
 *
 * Each property runs ≥ 100 iterations via fast-check.
 *
 * Validates: Requirements R5.7
 */

// Feature: tenant-responder-network, Property 7: Capability update validation

import type { AgencyType, EmergencyCategoryId } from '@aira/ui';
import { AGENCY_TYPES } from '@aira/ui';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { CapabilityConfig } from '../src/lib/platform/types';
import { createMemoryPlatformStore } from './support/memory-platform-store';
import {
  readCapabilityConfig,
  setCapabilityForCategory,
  type ActingScope,
  type ResponderNetworkDeps,
} from '../src/lib/responder-network/service';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RUNS = 100;
const NOW = 1_700_000_000_000;

const FROZEN_CATEGORIES: readonly EmergencyCategoryId[] = [
  'SUNOG',
  'MEDIKAL',
  'KRIMEN',
  'BAHA',
] as const;

const FROZEN_CATEGORY_SET = new Set<string>(FROZEN_CATEGORIES);
const AGENCY_TYPE_SET = new Set<string>(AGENCY_TYPES);

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** A valid frozen Emergency_Category. */
const validCategoryArb: fc.Arbitrary<EmergencyCategoryId> = fc.constantFrom(...FROZEN_CATEGORIES);

/** A valid AgencyType. */
const validAgencyTypeArb: fc.Arbitrary<AgencyType> = fc.constantFrom(
  ...(AGENCY_TYPES as readonly AgencyType[]),
);

/** An array of valid AgencyTypes (may have duplicates). */
const validTypesArb: fc.Arbitrary<readonly AgencyType[]> = fc.array(validAgencyTypeArb, {
  minLength: 0,
  maxLength: 8,
});

/** An ASCII string that is guaranteed NOT to be a valid frozen category. */
const invalidCategoryArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter((s) => !FROZEN_CATEGORY_SET.has(s));

/** An ASCII string that is guaranteed NOT to be a valid AgencyType. */
const invalidAgencyTypeArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter((s) => !AGENCY_TYPE_SET.has(s));

/**
 * An array of strings that contains at least one invalid AgencyType.
 * Built by mixing valid types with one guaranteed-invalid element.
 */
const typesWithOneInvalidArb: fc.Arbitrary<readonly string[]> = fc
  .tuple(
    fc.array(validAgencyTypeArb, { minLength: 0, maxLength: 4 }),
    invalidAgencyTypeArb,
    fc.array(validAgencyTypeArb, { minLength: 0, maxLength: 4 }),
  )
  .map(([prefix, bad, suffix]) => [...prefix, bad, ...suffix]);

// ---------------------------------------------------------------------------
// Helper: build a fresh tenant and store/deps pair
// ---------------------------------------------------------------------------

async function makeFreshTenant(name: string): Promise<{
  deps: ResponderNetworkDeps;
  scope: ActingScope;
}> {
  const store = createMemoryPlatformStore();
  const tenant = await store.createTenantWithLgu({
    name,
    region: 'Region VII',
    province: 'Cebu',
    lguName: `${name} LGU`,
    lat: 10.3157,
    lon: 123.8854,
    now: NOW,
  });
  return { deps: { store }, scope: { tenantId: tenant.id } };
}

// ---------------------------------------------------------------------------
// Property 7a — valid (category, types) → accepted
// ---------------------------------------------------------------------------
describe('Property 7a: valid category + valid types → setCapabilityForCategory returns ok', () => {
  it('every (valid category, valid types array) combination is accepted', async () => {
    await fc.assert(
      fc.asyncProperty(validCategoryArb, validTypesArb, async (category, types) => {
        const { deps, scope } = await makeFreshTenant('Valid-Accept-Iter');
        const result = await setCapabilityForCategory(deps, scope, category, types);
        expect(result.status).toBe('ok');
      }),
      { numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7b — invalid category → rejected, stored config unchanged
// ---------------------------------------------------------------------------
describe('Property 7b: invalid category → setCapabilityForCategory returns invalid, config unchanged', () => {
  it('an out-of-frozen-set category is always rejected and the stored config is not altered', async () => {
    await fc.assert(
      fc.asyncProperty(invalidCategoryArb, validTypesArb, async (badCategory, types) => {
        const { deps, scope } = await makeFreshTenant('Invalid-Cat-Iter');

        // Capture the config before the bad call
        const before: CapabilityConfig = await readCapabilityConfig(deps, scope);

        const result = await setCapabilityForCategory(deps, scope, badCategory, types);
        expect(result.status).toBe('invalid');

        // Config must be unchanged
        const after: CapabilityConfig = await readCapabilityConfig(deps, scope);
        for (const cat of FROZEN_CATEGORIES) {
          const beforeSet = [...before[cat]].sort().join(',');
          const afterSet = [...after[cat]].sort().join(',');
          expect(afterSet).toBe(beforeSet);
        }
      }),
      { numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7c — any invalid type in the list → rejected, stored config unchanged
// ---------------------------------------------------------------------------
describe('Property 7c: any invalid AgencyType in the list → invalid, stored config unchanged', () => {
  it('a list containing even one out-of-taxonomy type is always rejected', async () => {
    await fc.assert(
      fc.asyncProperty(validCategoryArb, typesWithOneInvalidArb, async (category, typesWithBad) => {
        const { deps, scope } = await makeFreshTenant('Invalid-Type-Iter');

        const before: CapabilityConfig = await readCapabilityConfig(deps, scope);

        const result = await setCapabilityForCategory(deps, scope, category, typesWithBad);
        expect(result.status).toBe('invalid');

        const after: CapabilityConfig = await readCapabilityConfig(deps, scope);
        for (const cat of FROZEN_CATEGORIES) {
          const beforeSet = [...before[cat]].sort().join(',');
          const afterSet = [...after[cat]].sort().join(',');
          expect(afterSet).toBe(beforeSet);
        }
      }),
      { numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7d — combined: accepted iff both category and all types are valid
// ---------------------------------------------------------------------------
describe('Property 7d: accepted iff category ∈ frozen set AND every type ∈ taxonomy', () => {
  it('status is ok iff category is valid AND all types are valid; invalid otherwise', async () => {
    // Use two separate generators so we can reason about the expected outcome cleanly
    await fc.assert(
      fc.asyncProperty(
        // category: sometimes valid, sometimes not
        fc.oneof(validCategoryArb as fc.Arbitrary<string>, invalidCategoryArb),
        // types: array of strings that may or may not be valid agency types
        fc.array(fc.oneof(validAgencyTypeArb as fc.Arbitrary<string>, invalidAgencyTypeArb), {
          minLength: 0,
          maxLength: 5,
        }),
        async (category, types) => {
          const { deps, scope } = await makeFreshTenant('Combined-Val-Iter');

          const categoryIsValid = FROZEN_CATEGORY_SET.has(category);
          const typesAllValid = types.every((t) => AGENCY_TYPE_SET.has(t));

          const expectedStatus = categoryIsValid && typesAllValid ? 'ok' : 'invalid';

          const result = await setCapabilityForCategory(deps, scope, category, types);
          expect(result.status).toBe(expectedStatus);
        },
      ),
      { numRuns: RUNS },
    );
  });
});
