/**
 * @vitest-environment node
 *
 * Feature: tenant-responder-network, Property 5: Capability update is a de-duplicated full replace (idempotent)
 *
 * Property: after `setCapabilityForCategory` the stored set equals the set of
 * distinct submitted types exactly (replace, not merge), the other three categories
 * are unchanged, read-after-write matches, and a repeated identical update leaves
 * the config unchanged.
 *
 * Sub-properties:
 *   5a — stored[category] equals distinct(submitted) exactly (de-dup + full-replace)
 *   5b — the other three categories are untouched by a single-category update
 *   5c — read-after-write: readCapabilityConfig returns the same value as the
 *        result of setCapabilityForCategory
 *   5d — idempotent: a repeated identical update leaves the config unchanged
 *
 * Each property runs ≥ 100 iterations via fast-check.
 *
 * Validates: Requirements R5.2, R5.4, R5.5
 */

// Feature: tenant-responder-network, Property 5: Capability update is a de-duplicated full replace (idempotent)

import type { AgencyType, EmergencyCategoryId } from '@aira/ui';
import { AGENCY_TYPES } from '@aira/ui';
import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createMemoryPlatformStore,
  type MemoryPlatformStore,
} from './support/memory-platform-store';
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

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** A single frozen Emergency_Category. */
const categoryArb: fc.Arbitrary<EmergencyCategoryId> = fc.constantFrom(...FROZEN_CATEGORIES);

/** An array of AgencyType values — may contain duplicates (tests dedup behavior). */
const agencyTypesArb: fc.Arbitrary<readonly AgencyType[]> = fc.array(
  fc.constantFrom(...(AGENCY_TYPES as readonly AgencyType[])),
  { minLength: 0, maxLength: 10 },
);

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let platformStore: MemoryPlatformStore;
let deps: ResponderNetworkDeps;
let scope: ActingScope;

beforeEach(async () => {
  platformStore = createMemoryPlatformStore();

  // Seed a tenant for every test
  const tenant = await platformStore.createTenantWithLgu({
    name: 'Capability-Replace-Test',
    region: 'Region VII',
    province: 'Cebu',
    lguName: 'Capability-Replace LGU Office',
    lat: 10.3157,
    lon: 123.8854,
    now: NOW,
  });

  scope = { tenantId: tenant.id };
  deps = { store: platformStore };
});

// ---------------------------------------------------------------------------
// Property 5a — stored[category] = distinct(submitted) (full-replace + de-dup)
//
// Note: the service applies toTotalConfig which substitutes DEFAULT_CAPABILITY_CONFIG
// for any category whose submitted (or stored) value is an empty array. This matches
// R5.3 behavior: an empty submission is treated as "no capability stored" and the
// default falls through. The property therefore uses non-empty submissions only so
// the de-dup + full-replace invariant can be asserted cleanly without fighting the
// default-fallback logic.
// ---------------------------------------------------------------------------
describe('Property 5a: setCapabilityForCategory stores exactly the distinct submitted types', () => {
  it('stored set equals Set(submitted) for every valid (category, non-empty types) pair', async () => {
    // Use non-empty arrays only so toTotalConfig does not substitute the default
    const nonEmptyTypesArb = fc.array(fc.constantFrom(...(AGENCY_TYPES as readonly AgencyType[])), {
      minLength: 1,
      maxLength: 10,
    });

    await fc.assert(
      fc.asyncProperty(categoryArb, nonEmptyTypesArb, async (category, submitted) => {
        const result = await setCapabilityForCategory(deps, scope, category, submitted);
        expect(result.status).toBe('ok');
        if (result.status !== 'ok') return;

        const expected = [...new Set(submitted)].sort();
        const actual = [...result.capability[category]].sort();
        expect(actual).toEqual(expected);
      }),
      { numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 5b — other three categories are untouched
// ---------------------------------------------------------------------------
describe('Property 5b: updating one category leaves the other three categories unchanged', () => {
  it('the three categories not updated keep their values after a single-category update', async () => {
    await fc.assert(
      fc.asyncProperty(
        categoryArb,
        agencyTypesArb,
        agencyTypesArb,
        async (targetCategory, priorTypes, newTypes) => {
          // Use a fresh store for each iteration to avoid cross-run contamination
          const localStore = createMemoryPlatformStore();
          const tenant = await localStore.createTenantWithLgu({
            name: 'Cap-Replace-Iter',
            region: 'R7',
            province: 'Cebu',
            lguName: 'Cap-Replace-Iter LGU',
            lat: 10.3,
            lon: 123.8,
            now: NOW,
          });
          const localScope: ActingScope = { tenantId: tenant.id };
          const localDeps: ResponderNetworkDeps = { store: localStore };

          // Set every category to a known prior state
          for (const cat of FROZEN_CATEGORIES) {
            const r = await setCapabilityForCategory(localDeps, localScope, cat, priorTypes);
            expect(r.status).toBe('ok');
          }

          // Capture the prior state for non-target categories
          const priorConfig = await readCapabilityConfig(localDeps, localScope);

          // Update only the target category
          const updateResult = await setCapabilityForCategory(
            localDeps,
            localScope,
            targetCategory,
            newTypes,
          );
          expect(updateResult.status).toBe('ok');
          if (updateResult.status !== 'ok') return;

          const afterConfig = updateResult.capability;

          // All other categories must remain exactly as before
          for (const cat of FROZEN_CATEGORIES) {
            if (cat === targetCategory) continue;
            const priorSet = [...priorConfig[cat]].sort().join(',');
            const afterSet = [...afterConfig[cat]].sort().join(',');
            expect(afterSet).toBe(priorSet);
          }
        },
      ),
      { numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 5c — read-after-write: readCapabilityConfig matches set result
// ---------------------------------------------------------------------------
describe('Property 5c: readCapabilityConfig after setCapabilityForCategory returns the same config', () => {
  it('read-after-write is consistent for every (category, types) pair', async () => {
    await fc.assert(
      fc.asyncProperty(categoryArb, agencyTypesArb, async (category, submitted) => {
        // Use a fresh store per iteration
        const localStore = createMemoryPlatformStore();
        const tenant = await localStore.createTenantWithLgu({
          name: 'Cap-RAW-Iter',
          region: 'R7',
          province: 'Cebu',
          lguName: 'Cap-RAW LGU',
          lat: 10.3,
          lon: 123.8,
          now: NOW,
        });
        const localScope: ActingScope = { tenantId: tenant.id };
        const localDeps: ResponderNetworkDeps = { store: localStore };

        const setResult = await setCapabilityForCategory(
          localDeps,
          localScope,
          category,
          submitted,
        );
        expect(setResult.status).toBe('ok');
        if (setResult.status !== 'ok') return;

        const readResult = await readCapabilityConfig(localDeps, localScope);

        // The full config from set and from read must match for every category
        for (const cat of FROZEN_CATEGORIES) {
          const fromSet = [...setResult.capability[cat]].sort().join(',');
          const fromRead = [...readResult[cat]].sort().join(',');
          expect(fromRead).toBe(fromSet);
        }
      }),
      { numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 5d — idempotent: repeated identical update leaves config unchanged
// ---------------------------------------------------------------------------
describe('Property 5d: a repeated identical update leaves the Capability_Config unchanged (R5.5)', () => {
  it('calling setCapabilityForCategory twice with the same (category, types) produces identical configs', async () => {
    await fc.assert(
      fc.asyncProperty(categoryArb, agencyTypesArb, async (category, submitted) => {
        // Fresh store per iteration
        const localStore = createMemoryPlatformStore();
        const tenant = await localStore.createTenantWithLgu({
          name: 'Cap-Idem-Iter',
          region: 'R7',
          province: 'Cebu',
          lguName: 'Cap-Idem LGU',
          lat: 10.3,
          lon: 123.8,
          now: NOW,
        });
        const localScope: ActingScope = { tenantId: tenant.id };
        const localDeps: ResponderNetworkDeps = { store: localStore };

        const first = await setCapabilityForCategory(localDeps, localScope, category, submitted);
        const second = await setCapabilityForCategory(localDeps, localScope, category, submitted);

        expect(first.status).toBe('ok');
        expect(second.status).toBe('ok');
        if (first.status !== 'ok' || second.status !== 'ok') return;

        // Every category must match between first and second result
        for (const cat of FROZEN_CATEGORIES) {
          const firstSet = [...first.capability[cat]].sort().join(',');
          const secondSet = [...second.capability[cat]].sort().join(',');
          expect(secondSet).toBe(firstSet);
        }
      }),
      { numRuns: RUNS },
    );
  });
});
