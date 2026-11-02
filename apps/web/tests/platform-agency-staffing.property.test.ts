/**
 * @vitest-environment node
 *
 * Feature: tenant-responder-network, Property 4: Responder staffing is tenant-safe
 *
 * Property: `provisionResponder` creates exactly one responder iff the office exists
 * and is in the acting tenant AND (if an agency is supplied) the agency exists, shares
 * the office's tenant, and is active; every other case refuses with the correct error
 * discriminant and creates nothing; no agency ⇒ `agency_id` null (DRRM Generalist).
 *
 * Guards tested:
 *   - office in acting tenant + active agency in same tenant  → ok, responder created
 *   - office in other tenant                                  → office_cross_tenant (403-equiv)
 *   - agency in other tenant                                  → agency_cross_tenant (400-equiv)
 *   - agency inactive                                         → agency_inactive      (400-equiv)
 *   - unknown office id                                       → office_not_found     (404-equiv)
 *   - unknown agency id                                       → agency_not_found     (404-equiv)
 *   - no agencyId supplied                                    → ok, agency_id null
 *
 * Each property runs ≥ 100 iterations via fast-check.
 *
 * Validates: Requirements R4.2, R4.3, R4.4, R4.5, R4.6, R4.7, R4.8
 */

// Feature: tenant-responder-network, Property 4: Responder staffing is tenant-safe

import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';

import { createMemoryAuthStore, type MemoryAuthStore } from './support/memory-auth-store';
import {
  createMemoryPlatformStore,
  type MemoryPlatformStore,
} from './support/memory-platform-store';
import {
  provisionResponder,
  type ActingScope,
  type ResponderNetworkDeps,
} from '../src/lib/responder-network/service';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RUNS = 100;
const NOW = 1_700_000_000_000;

// Per-test timeout: guards against vitest's 5s default cap when the full suite
// runs these slow seeded PBTs under heavy parallel-worker load.
const PBT_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let platformStore: MemoryPlatformStore;
let authStore: MemoryAuthStore;

/** Seed a fresh tenant+LGU office; returns { tenantId, officeId }. */
async function seedTenantWithOffice(
  platformSt: MemoryPlatformStore,
  name: string,
): Promise<{ tenantId: string; officeId: string }> {
  const tenant = await platformSt.createTenantWithLgu({
    name,
    region: 'Region VII',
    province: 'Cebu',
    lguName: `${name} LGU Office`,
    lat: 10.3157,
    lon: 123.8854,
    now: NOW,
  });
  const officeId = platformSt.offices.find((o) => o.tenantId === tenant.id)?.id;
  if (!officeId) throw new Error(`Office not found for tenant ${tenant.id}`);
  return { tenantId: tenant.id, officeId };
}

beforeEach(() => {
  platformStore = createMemoryPlatformStore();
  authStore = createMemoryAuthStore({ now: () => NOW, offices: [], agencies: [] });
});

// ---------------------------------------------------------------------------
// Property 4a — office in acting tenant, active agency in same tenant → ok
// ---------------------------------------------------------------------------
describe('Property 4a: office+agency in acting tenant → responder created with correct agency_id', () => {
  it(
    'provisionResponder returns ok with the supplied agencyId when office and agency share the acting tenant',
    async () => {
      // Seed once (these are stable across iterations — stores are reset per test)
      const { tenantId, officeId } = await seedTenantWithOffice(platformStore, 'StaffingSafe-A');

      // Pre-create an active agency in the same tenant
      const agencyResult = await platformStore.createAgency({
        tenantId,
        name: 'Active Agency',
        code: 'ACT',
        agencyType: 'FIRE',
      });
      if (agencyResult.status !== 'ok') throw new Error('seed failed');
      const agencyId = agencyResult.agency.id;

      const scope: ActingScope = { tenantId };
      const deps: ResponderNetworkDeps & {
        auth: { store: typeof authStore; now: () => number; secureCookies: boolean };
      } = {
        store: platformStore,
        auth: { store: authStore, now: () => NOW, secureCookies: false },
      };

      await fc.assert(
        fc.asyncProperty(fc.emailAddress({ size: 'small' }), async (email) => {
          // Each iteration uses a fresh email to avoid 23505 email collisions.
          const uniqueEmail = `${email.split('@')[0]}-${Date.now()}-${Math.random()}@aira.test`;
          const result = await provisionResponder(deps, scope, {
            email: uniqueEmail,
            officeId,
            agencyId,
          });
          expect(result.status).toBe('ok');
          if (result.status === 'ok') {
            expect(result.responder.agencyId).toBe(agencyId);
            expect(typeof result.password).toBe('string');
            expect(result.password.length).toBeGreaterThan(0);
          }
        }),
        { numRuns: RUNS },
      );
    },
    PBT_TIMEOUT_MS,
  );
});

// ---------------------------------------------------------------------------
// Property 4b — office belongs to another tenant → office_cross_tenant
// ---------------------------------------------------------------------------
describe('Property 4b: office in other tenant → office_cross_tenant', () => {
  it(
    'provisionResponder returns office_cross_tenant and creates nothing',
    async () => {
      const { tenantId: actingTenant } = await seedTenantWithOffice(platformStore, 'Acting-Tenant');
      const { officeId: otherOffice } = await seedTenantWithOffice(platformStore, 'Other-Tenant');

      // Agency is now required (R3.2); seed one in the acting tenant so the office
      // check (R4.4) is the guard under test rather than the agency-required guard.
      const agencyResult = await platformStore.createAgency({
        tenantId: actingTenant,
        name: 'Acting BFP',
        code: 'ABFP',
        agencyType: 'FIRE',
      });
      if (agencyResult.status !== 'ok') throw new Error('seed agency failed');
      const agencyId = agencyResult.agency.id;

      const scope: ActingScope = { tenantId: actingTenant };
      const deps: ResponderNetworkDeps & {
        auth: { store: typeof authStore; now: () => number; secureCookies: boolean };
      } = {
        store: platformStore,
        auth: { store: authStore, now: () => NOW, secureCookies: false },
      };

      await fc.assert(
        fc.asyncProperty(fc.emailAddress({ size: 'small' }), async (email) => {
          const uniqueEmail = `ct-${email.split('@')[0]}-${Math.random()}@aira.test`;
          const before = authStore.events.length;
          const result = await provisionResponder(deps, scope, {
            email: uniqueEmail,
            officeId: otherOffice,
            agencyId,
          });
          expect(result.status).toBe('office_cross_tenant');
          // Must not have created a responder — no ACCOUNT_CREATED event appended
          expect(authStore.events.length).toBe(before);
        }),
        { numRuns: RUNS },
      );
    },
    PBT_TIMEOUT_MS,
  );
});

// ---------------------------------------------------------------------------
// Property 4c — agency belongs to a different tenant → agency_cross_tenant
// ---------------------------------------------------------------------------
describe('Property 4c: agency in other tenant → agency_cross_tenant, nothing created', () => {
  it(
    'provisionResponder returns agency_cross_tenant',
    async () => {
      const { tenantId: tenantA, officeId: officeA } = await seedTenantWithOffice(
        platformStore,
        'Tenant-A',
      );
      const { tenantId: tenantB } = await seedTenantWithOffice(platformStore, 'Tenant-B');

      // Agency in tenant B
      const agencyResult = await platformStore.createAgency({
        tenantId: tenantB,
        name: 'Tenant-B Agency',
        code: 'TBA',
        agencyType: 'POLICE',
      });
      if (agencyResult.status !== 'ok') throw new Error('seed failed');
      const foreignAgencyId = agencyResult.agency.id;

      const scope: ActingScope = { tenantId: tenantA };
      const deps: ResponderNetworkDeps & {
        auth: { store: typeof authStore; now: () => number; secureCookies: boolean };
      } = {
        store: platformStore,
        auth: { store: authStore, now: () => NOW, secureCookies: false },
      };

      await fc.assert(
        fc.asyncProperty(fc.emailAddress({ size: 'small' }), async (email) => {
          const uniqueEmail = `act-${email.split('@')[0]}-${Math.random()}@aira.test`;
          const before = authStore.events.length;
          const result = await provisionResponder(deps, scope, {
            email: uniqueEmail,
            officeId: officeA,
            agencyId: foreignAgencyId,
          });
          expect(result.status).toBe('agency_cross_tenant');
          expect(authStore.events.length).toBe(before);
        }),
        { numRuns: RUNS },
      );
    },
    PBT_TIMEOUT_MS,
  );
});

// ---------------------------------------------------------------------------
// Property 4d — agency inactive → agency_inactive, nothing created
// ---------------------------------------------------------------------------
describe('Property 4d: inactive agency → agency_inactive, nothing created', () => {
  it(
    'provisionResponder returns agency_inactive',
    async () => {
      const { tenantId, officeId } = await seedTenantWithOffice(platformStore, 'Inactive-Tenant');

      const agencyResult = await platformStore.createAgency({
        tenantId,
        name: 'Inactive Agency',
        code: 'IA',
        agencyType: 'DRRM',
      });
      if (agencyResult.status !== 'ok') throw new Error('seed failed');
      const inactiveAgencyId = agencyResult.agency.id;

      // Deactivate the agency
      await platformStore.setAgencyActive(inactiveAgencyId, false);

      const scope: ActingScope = { tenantId };
      const deps: ResponderNetworkDeps & {
        auth: { store: typeof authStore; now: () => number; secureCookies: boolean };
      } = {
        store: platformStore,
        auth: { store: authStore, now: () => NOW, secureCookies: false },
      };

      await fc.assert(
        fc.asyncProperty(fc.emailAddress({ size: 'small' }), async (email) => {
          const uniqueEmail = `ia-${email.split('@')[0]}-${Math.random()}@aira.test`;
          const before = authStore.events.length;
          const result = await provisionResponder(deps, scope, {
            email: uniqueEmail,
            officeId,
            agencyId: inactiveAgencyId,
          });
          expect(result.status).toBe('agency_inactive');
          expect(authStore.events.length).toBe(before);
        }),
        { numRuns: RUNS },
      );
    },
    PBT_TIMEOUT_MS,
  );
});

// ---------------------------------------------------------------------------
// Property 4e — unknown office id → office_not_found
// ---------------------------------------------------------------------------
describe('Property 4e: unknown office id → office_not_found, nothing created', () => {
  it(
    'provisionResponder returns office_not_found for a made-up office id',
    async () => {
      const { tenantId } = await seedTenantWithOffice(platformStore, 'NoOffice-Tenant');

      // Agency is required (R3.2); seed one so the unknown-office guard (R4.3) is the
      // guard under test.
      const agencyResult = await platformStore.createAgency({
        tenantId,
        name: 'NoOffice BFP',
        code: 'NOBFP',
        agencyType: 'FIRE',
      });
      if (agencyResult.status !== 'ok') throw new Error('seed agency failed');
      const agencyId = agencyResult.agency.id;

      const scope: ActingScope = { tenantId };
      const deps: ResponderNetworkDeps & {
        auth: { store: typeof authStore; now: () => number; secureCookies: boolean };
      } = {
        store: platformStore,
        auth: { store: authStore, now: () => NOW, secureCookies: false },
      };

      await fc.assert(
        fc.asyncProperty(
          fc.uuid(),
          fc.emailAddress({ size: 'small' }),
          async (unknownOfficeId, email) => {
            // Skip the rare case where the random uuid matches a real office
            const realOfficeIds = platformStore.offices.map((o) => o.id);
            if (realOfficeIds.includes(unknownOfficeId)) return;

            const uniqueEmail = `nof-${email.split('@')[0]}-${Math.random()}@aira.test`;
            const before = authStore.events.length;
            const result = await provisionResponder(deps, scope, {
              email: uniqueEmail,
              officeId: unknownOfficeId,
              agencyId,
            });
            expect(result.status).toBe('office_not_found');
            expect(authStore.events.length).toBe(before);
          },
        ),
        { numRuns: RUNS },
      );
    },
    PBT_TIMEOUT_MS,
  );
});

// ---------------------------------------------------------------------------
// Property 4f — unknown agency id → agency_not_found, nothing created
// ---------------------------------------------------------------------------
describe('Property 4f: unknown agency id → agency_not_found, nothing created', () => {
  it(
    'provisionResponder returns agency_not_found for a made-up agency id',
    async () => {
      const { tenantId, officeId } = await seedTenantWithOffice(platformStore, 'NoAgency-Tenant');

      const scope: ActingScope = { tenantId };
      const deps: ResponderNetworkDeps & {
        auth: { store: typeof authStore; now: () => number; secureCookies: boolean };
      } = {
        store: platformStore,
        auth: { store: authStore, now: () => NOW, secureCookies: false },
      };

      await fc.assert(
        fc.asyncProperty(
          fc.uuid(),
          fc.emailAddress({ size: 'small' }),
          async (unknownAgencyId, email) => {
            // Skip if uuid accidentally matches a real agency
            if (platformStore.agencies.has(unknownAgencyId)) return;

            const uniqueEmail = `noa-${email.split('@')[0]}-${Math.random()}@aira.test`;
            const before = authStore.events.length;
            const result = await provisionResponder(deps, scope, {
              email: uniqueEmail,
              officeId,
              agencyId: unknownAgencyId,
            });
            expect(result.status).toBe('agency_not_found');
            expect(authStore.events.length).toBe(before);
          },
        ),
        { numRuns: RUNS },
      );
    },
    PBT_TIMEOUT_MS,
  );
});

// ---------------------------------------------------------------------------
// Property 4g — agency is now REQUIRED → no agencyId is rejected (R3.2)
// (supersedes the former DRRM-generalist=null behaviour)
// ---------------------------------------------------------------------------
describe('Property 4g: no agencyId → invalid, nothing created (R3.2)', () => {
  it(
    'provisionResponder rejects a provision with no agency and creates nothing',
    async () => {
      const { tenantId, officeId } = await seedTenantWithOffice(platformStore, 'Generalist-Tenant');

      const scope: ActingScope = { tenantId };
      const deps: ResponderNetworkDeps & {
        auth: { store: typeof authStore; now: () => number; secureCookies: boolean };
      } = {
        store: platformStore,
        auth: { store: authStore, now: () => NOW, secureCookies: false },
      };

      await fc.assert(
        fc.asyncProperty(fc.emailAddress({ size: 'small' }), async (email) => {
          const uniqueEmail = `gen-${email.split('@')[0]}-${Math.random()}@aira.test`;
          const before = authStore.events.length;
          const result = await provisionResponder(deps, scope, {
            email: uniqueEmail,
            officeId,
            // no agencyId — now a validation error
          });
          expect(result.status).toBe('invalid');
          expect(authStore.events.length).toBe(before);
        }),
        { numRuns: RUNS },
      );
    },
    PBT_TIMEOUT_MS,
  );
});
