/**
 * @vitest-environment node
 *
 * Feature: tenant-responder-network, Property 6: Capability read is total with default fallback
 *
 * Property: `readCapabilityConfig` always returns a total map keyed exactly by the
 * four frozen Emergency_Categories `{SUNOG, MEDIKAL, KRIMEN, BAHA}` with no extra
 * or missing keys; a tenant with no stored config reads back exactly
 * `DEFAULT_CAPABILITY_CONFIG`.
 *
 * Sub-properties:
 *   6a — returned map is keyed exactly by the four frozen categories (no extras, no omissions)
 *   6b — a fresh tenant (no stored config) reads back DEFAULT_CAPABILITY_CONFIG
 *   6c — after storing a subset of categories, the unset categories still resolve
 *        to their DEFAULT_CAPABILITY_CONFIG values and set categories resolve to
 *        their stored values; the total key-set remains {SUNOG,MEDIKAL,KRIMEN,BAHA}
 *
 * Each property runs ≥ 100 iterations via fast-check.
 *
 * Validates: Requirements R5.1, R5.3, R9.7
 */

// Feature: tenant-responder-network, Property 6: Capability read is total with default fallback

import type { AgencyType, EmergencyCategoryId } from '@aira/ui';
import { AGENCY_TYPES } from '@aira/ui';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { CapabilityConfig } from '../src/lib/platform/types';
import { DEFAULT_CAPABILITY_CONFIG } from '../src/lib/routing';
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

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** A subset of the four frozen categories (possibly empty). */
const categorySubsetArb: fc.Arbitrary<readonly EmergencyCategoryId[]> = fc.subarray([
  ...FROZEN_CATEGORIES,
]);

/** An array of AgencyTypes (valid taxonomy only). */
const agencyTypesArb: fc.Arbitrary<readonly AgencyType[]> = fc.array(
  fc.constantFrom(...(AGENCY_TYPES as readonly AgencyType[])),
  { minLength: 0, maxLength: 5 },
);

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
// Property 6a — result is keyed exactly by the four frozen categories
// ---------------------------------------------------------------------------
describe('Property 6a: readCapabilityConfig keys exactly the four frozen Emergency_Categories', () => {
  it('returned object has exactly {SUNOG, MEDIKAL, KRIMEN, BAHA} as keys regardless of stored state', async () => {
    await fc.assert(
      fc.asyncProperty(categorySubsetArb, agencyTypesArb, async (categoriesToSet, typesToStore) => {
        const { deps, scope } = await makeFreshTenant('TotalKeys-Iter');

        // Optionally store some categories
        for (const cat of categoriesToSet) {
          await setCapabilityForCategory(deps, scope, cat, typesToStore);
        }

        const config: CapabilityConfig = await readCapabilityConfig(deps, scope);
        const keys = Object.keys(config);

        // Exactly four keys
        expect(keys).toHaveLength(4);

        // Must contain each frozen category
        for (const cat of FROZEN_CATEGORIES) {
          expect(FROZEN_CATEGORY_SET.has(cat)).toBe(true);
          expect(config).toHaveProperty(cat);
        }

        // Must not contain any extra keys
        for (const key of keys) {
          expect(FROZEN_CATEGORY_SET.has(key)).toBe(true);
        }
      }),
      { numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 6b — fresh tenant (no stored config) reads DEFAULT_CAPABILITY_CONFIG
// ---------------------------------------------------------------------------
describe('Property 6b: a tenant with no stored config reads back DEFAULT_CAPABILITY_CONFIG exactly', () => {
  it('readCapabilityConfig equals DEFAULT_CAPABILITY_CONFIG for every fresh tenant', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1, maxLength: 20 }), async (suffix) => {
        // Each fresh store has an independent tenant with no stored capability
        const { deps, scope } = await makeFreshTenant(`Default-${suffix}`);

        const config = await readCapabilityConfig(deps, scope);

        for (const cat of FROZEN_CATEGORIES) {
          const expected = [...DEFAULT_CAPABILITY_CONFIG[cat]].sort().join(',');
          const actual = [...config[cat]].sort().join(',');
          expect(actual).toBe(expected);
        }
      }),
      { numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 6c — partial storage: unset categories fall back to default; set ones
//               reflect stored values; total key-set is always the frozen four
// ---------------------------------------------------------------------------
describe('Property 6c: partial storage — unset categories fall back to default; set ones use stored values', () => {
  it('readCapabilityConfig is total and mixes stored + default values correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Which categories to explicitly store
        fc.subarray([...FROZEN_CATEGORIES], { minLength: 1, maxLength: 3 }),
        // What to store for those categories (non-empty so the store records them)
        fc.array(fc.constantFrom(...(AGENCY_TYPES as readonly AgencyType[])), {
          minLength: 1,
          maxLength: 5,
        }),
        async (categoriesToSet, typesToStore) => {
          const { deps, scope } = await makeFreshTenant('PartialStore-Iter');

          const storedValues: Partial<Record<EmergencyCategoryId, readonly AgencyType[]>> = {};

          for (const cat of categoriesToSet) {
            const r = await setCapabilityForCategory(deps, scope, cat, typesToStore);
            expect(r.status).toBe('ok');
            if (r.status === 'ok') {
              storedValues[cat] = r.capability[cat];
            }
          }

          const config = await readCapabilityConfig(deps, scope);

          // Total key-set must be the four frozen categories
          expect(Object.keys(config)).toHaveLength(4);

          for (const cat of FROZEN_CATEGORIES) {
            if (categoriesToSet.includes(cat)) {
              // Must match what was stored (de-duped)
              const expected = [...(storedValues[cat] ?? [])].sort().join(',');
              const actual = [...config[cat]].sort().join(',');
              expect(actual).toBe(expected);
            } else {
              // Must fall back to DEFAULT_CAPABILITY_CONFIG
              const expected = [...DEFAULT_CAPABILITY_CONFIG[cat]].sort().join(',');
              const actual = [...config[cat]].sort().join(',');
              expect(actual).toBe(expected);
            }
          }
        },
      ),
      { numRuns: RUNS },
    );
  });
});
