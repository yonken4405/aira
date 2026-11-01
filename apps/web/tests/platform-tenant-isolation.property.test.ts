/**
 * @vitest-environment node
 *
 * Feature: tenant-responder-network, Property 11: Tenant isolation on every management action
 *
 * Property 11: an operator scope may act on any tenant's resource; a DRRM_Admin
 * scope may act only on resources in its own tenant. A reference to a resource known
 * to belong to another tenant is refused (`cross_tenant` at the service level, which
 * the DRRM_Admin handler maps to 403); in that refusal no resource is read or modified.
 *
 * Tested at the SERVICE level (not the handler) via `renameAgency` / `setAgencyActive`
 * with an explicit `ActingScope`, over the in-memory PlatformStore.
 *
 * Sub-properties:
 *   11a — DRRM_Admin cross-tenant rename: scope {A} acting on an agency in B (B≠A)
 *         returns `cross_tenant` and leaves the agency row byte-for-byte unchanged.
 *   11b — DRRM_Admin cross-tenant activate: same, via setAgencyActive.
 *   11c — DRRM_Admin own-tenant: scope {A} acting on an existing agency in A succeeds.
 *   11d — Operator-equivalent: the operator handler resolves scope from the agency's
 *         own tenant, so scope === agency's tenant always; rename/activate then always
 *         succeed regardless of which tenant it is (no cross-tenant rejection).
 *
 * Each property runs ≥ 100 iterations via fast-check.
 *
 * Validates: Requirements R7.4, R7.5, R7.7
 */

// Feature: tenant-responder-network, Property 11: Tenant isolation on every management action

import type { AgencyType } from '@aira/ui';
import { AGENCY_TYPES } from '@aira/ui';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { AgencyRecord } from '../src/lib/platform/types';
import { createMemoryPlatformStore } from './support/memory-platform-store';
import {
  createAgency,
  renameAgency,
  setAgencyActive,
  type ActingScope,
  type ResponderNetworkDeps,
} from '../src/lib/responder-network/service';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RUNS = 100;
const NOW = 1_700_000_000_000;

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** A valid AgencyType from the closed taxonomy. */
const agencyTypeArb: fc.Arbitrary<AgencyType> = fc.constantFrom(
  ...(AGENCY_TYPES as readonly AgencyType[]),
);

/** A valid trimmed agency name (2..64 chars, no leading/trailing space). */
const nameArb: fc.Arbitrary<string> = fc
  .string({ minLength: 2, maxLength: 64 })
  .map((s) => s.replace(/\s/g, 'x'))
  .filter((s) => s.length >= 2 && s.length <= 64);

/** A valid trimmed agency code (2..12 chars, no whitespace). */
const codeArb: fc.Arbitrary<string> = fc
  .string({ minLength: 2, maxLength: 12 })
  .map((s) => s.replace(/\s/g, 'x'))
  .filter((s) => s.length >= 2 && s.length <= 12);

interface AgencySpec {
  readonly name: string;
  readonly code: string;
  readonly agencyType: AgencyType;
}

const agencySpecArb: fc.Arbitrary<AgencySpec> = fc.record({
  name: nameArb,
  code: codeArb,
  agencyType: agencyTypeArb,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tenantSeq = 0;

/** Seed a fresh tenant and return its id. Names are unique per call. */
async function seedTenant(store: ReturnType<typeof createMemoryPlatformStore>): Promise<string> {
  tenantSeq += 1;
  const name = `Tenant-${tenantSeq}`;
  const tenant = await store.createTenantWithLgu({
    name,
    region: 'Region VII',
    province: 'Cebu',
    lguName: `${name} LGU`,
    lat: 10.3157,
    lon: 123.8854,
    now: NOW,
  });
  return tenant.id;
}

/** Seed an agency in a tenant via the service; asserts success. */
async function seedAgency(
  deps: ResponderNetworkDeps,
  tenantId: string,
  spec: AgencySpec,
): Promise<AgencyRecord> {
  const scope: ActingScope = { tenantId };
  const result = await createAgency(deps, scope, {
    name: spec.name,
    code: spec.code,
    agencyType: spec.agencyType,
  });
  if (result.status !== 'ok') {
    throw new Error(`seedAgency failed: ${result.status}`);
  }
  return result.agency;
}

/** A stable, order-independent snapshot of an agency row for byte-for-byte comparison. */
function snapshot(agency: AgencyRecord): string {
  return JSON.stringify({
    id: agency.id,
    tenantId: agency.tenantId,
    name: agency.name,
    code: agency.code,
    agencyType: agency.agencyType,
    active: agency.active,
  });
}

// ---------------------------------------------------------------------------
// Property 11a — DRRM_Admin cross-tenant rename is refused, row unchanged
// ---------------------------------------------------------------------------
describe('Property 11a: DRRM_Admin cross-tenant rename → cross_tenant, row unchanged', () => {
  it('scope {A} renaming an agency owned by tenant B (B≠A) is refused and never mutates it', async () => {
    await fc.assert(
      fc.asyncProperty(agencySpecArb, nameArb, codeArb, async (specB, newName, newCode) => {
        const store = createMemoryPlatformStore();
        const deps: ResponderNetworkDeps = { store };

        const tenantA = await seedTenant(store);
        const tenantB = await seedTenant(store);
        // A and B are distinct by construction (unique names → distinct ids).
        expect(tenantA).not.toBe(tenantB);

        const agencyB = await seedAgency(deps, tenantB, specB);
        const before = snapshot(agencyB);

        const adminScopeA: ActingScope = { tenantId: tenantA };
        const result = await renameAgency(deps, adminScopeA, agencyB.id, {
          name: newName,
          code: newCode,
        });

        expect(result.status).toBe('cross_tenant');

        // The agency row must be byte-for-byte unchanged (no read/write mutation).
        const reread = await store.findAgencyById(agencyB.id);
        expect(reread).not.toBeNull();
        expect(snapshot(reread as AgencyRecord)).toBe(before);
      }),
      { numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 11b — DRRM_Admin cross-tenant activate is refused, row unchanged
// ---------------------------------------------------------------------------
describe('Property 11b: DRRM_Admin cross-tenant activate → cross_tenant, row unchanged', () => {
  it('scope {A} flipping active on an agency owned by tenant B (B≠A) is refused and never mutates it', async () => {
    await fc.assert(
      fc.asyncProperty(agencySpecArb, fc.boolean(), async (specB, nextActive) => {
        const store = createMemoryPlatformStore();
        const deps: ResponderNetworkDeps = { store };

        const tenantA = await seedTenant(store);
        const tenantB = await seedTenant(store);
        expect(tenantA).not.toBe(tenantB);

        const agencyB = await seedAgency(deps, tenantB, specB);
        const before = snapshot(agencyB);

        const adminScopeA: ActingScope = { tenantId: tenantA };
        const result = await setAgencyActive(deps, adminScopeA, agencyB.id, nextActive);

        expect(result.status).toBe('cross_tenant');

        const reread = await store.findAgencyById(agencyB.id);
        expect(reread).not.toBeNull();
        expect(snapshot(reread as AgencyRecord)).toBe(before);
      }),
      { numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 11c — DRRM_Admin own-tenant action is actionable
// ---------------------------------------------------------------------------
describe('Property 11c: DRRM_Admin own-tenant agency is actionable', () => {
  it('scope {A} renaming + activating an existing agency in A succeeds', async () => {
    await fc.assert(
      fc.asyncProperty(
        agencySpecArb,
        nameArb,
        codeArb,
        fc.boolean(),
        async (specA, newName, newCode, nextActive) => {
          const store = createMemoryPlatformStore();
          const deps: ResponderNetworkDeps = { store };

          const tenantA = await seedTenant(store);
          const agencyA = await seedAgency(deps, tenantA, specA);

          const adminScopeA: ActingScope = { tenantId: tenantA };

          const renamed = await renameAgency(deps, adminScopeA, agencyA.id, {
            name: newName,
            code: newCode,
          });
          expect(renamed.status).toBe('ok');
          if (renamed.status === 'ok') {
            expect(renamed.agency.name).toBe(newName.trim());
            expect(renamed.agency.code).toBe(newCode.trim());
            expect(renamed.agency.tenantId).toBe(tenantA);
          }

          const activated = await setAgencyActive(deps, adminScopeA, agencyA.id, nextActive);
          expect(activated.status).toBe('ok');
          if (activated.status === 'ok') {
            expect(activated.agency.active).toBe(nextActive);
          }
        },
      ),
      { numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 11d — Operator scope always matches target → always actionable
// ---------------------------------------------------------------------------
describe('Property 11d: operator scope == agency tenant → rename/activate always succeed', () => {
  it('renaming/activating with scope = the agency own tenant succeeds for any tenant', async () => {
    await fc.assert(
      fc.asyncProperty(
        agencySpecArb,
        nameArb,
        codeArb,
        fc.boolean(),
        async (spec, newName, newCode, nextActive) => {
          const store = createMemoryPlatformStore();
          const deps: ResponderNetworkDeps = { store };

          // Seed several tenants so the acted-on tenant is "any" tenant, not the first.
          await seedTenant(store);
          await seedTenant(store);
          const tenant = await seedTenant(store);

          const agency = await seedAgency(deps, tenant, spec);

          // The operator handler resolves scope from the agency's own tenant, so
          // scope.tenantId === agency.tenantId always holds for operator actions.
          const operatorScope: ActingScope = { tenantId: agency.tenantId };

          const renamed = await renameAgency(deps, operatorScope, agency.id, {
            name: newName,
            code: newCode,
          });
          expect(renamed.status).toBe('ok');

          const activated = await setAgencyActive(deps, operatorScope, agency.id, nextActive);
          expect(activated.status).toBe('ok');
          if (activated.status === 'ok') {
            expect(activated.agency.active).toBe(nextActive);
          }
        },
      ),
      { numRuns: RUNS },
    );
  });
});
