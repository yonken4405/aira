/**
 * @vitest-environment node
 *
 * Feature: tenant-responder-network, Property 2: Per-tenant case-insensitive name/code uniqueness
 *
 * Property-based tests for per-tenant agency name/code uniqueness enforced by the
 * responder-network service (`createAgency`, `renameAgency`) over the in-memory
 * PlatformStore.
 *
 * Two properties are checked over ≥ 100 iterations each:
 *
 *   Property A (cross-tenant — succeeds for both):
 *     Two distinct tenants may each hold an agency whose name or code is
 *     case-insensitively equal. Both creates succeed and both rows persist.
 *
 *   Property B (within-tenant — conflict, no row changed):
 *     A create or rename within ONE tenant that produces a case-insensitive
 *     duplicate name or code must return `{ status: 'conflict' }`. The
 *     pre-existing agency row must be left byte-for-byte intact.
 *
 * Generators:
 *   - Tenant names: non-whitespace strings 2..40 chars
 *   - Agency names: trimmed 2..64 chars
 *   - Agency codes: trimmed 2..12 chars
 *   - Agency types: one of {FIRE, POLICE, MEDICAL, DRRM, OTHER}
 *
 * Validates: Requirements R1.7, R1.8, R1.9, R1.10, R3.4
 */

// Feature: tenant-responder-network, Property 2: Per-tenant case-insensitive name/code uniqueness

import type { AgencyType } from '@aira/ui';
import { AGENCY_TYPES } from '@aira/ui';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { createAgency, renameAgency, type ActingScope } from '../src/lib/responder-network/service';
import { createMemoryPlatformStore } from './support/memory-platform-store';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const RUNS = 100;

/** Seed epoch shared across all store instances in this file. */
const NOW = 1_700_000_000_000;

// ─────────────────────────────────────────────────────────────────────────────
// Arbitraries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A tenant name: non-empty after trimming, 2..40 chars.
 * We filter to avoid purely-whitespace strings so `createTenantWithLgu` succeeds.
 */
const tenantNameArb: fc.Arbitrary<string> = fc
  .string({ minLength: 2, maxLength: 40 })
  .filter((s) => s.trim().length >= 2);

/**
 * A pair of distinct tenant names (to guarantee two separate tenants can be seeded
 * without colliding on case-insensitive uniqueness).
 */
const distinctTenantNamesArb: fc.Arbitrary<[string, string]> = fc
  .tuple(tenantNameArb, tenantNameArb)
  .filter(([a, b]) => a.toLowerCase() !== b.toLowerCase());

/**
 * A valid agency name: trimmed length 2..64.
 * We generate strings that don't start/end with only spaces so trimming is stable.
 */
const agencyNameArb: fc.Arbitrary<string> = fc
  .string({ minLength: 2, maxLength: 64 })
  .filter((s) => s.trim().length >= 2 && s.trim().length <= 64);

/**
 * A valid agency code: trimmed length 2..12.
 */
const agencyCodeArb: fc.Arbitrary<string> = fc
  .string({ minLength: 2, maxLength: 12 })
  .filter((s) => s.trim().length >= 2 && s.trim().length <= 12);

/** One of the five valid agency types. */
const agencyTypeArb: fc.Arbitrary<AgencyType> = fc.constantFrom<AgencyType>(...AGENCY_TYPES);

/**
 * A pair of agency names where the second is a case-variant of the first — guaranteed
 * to collide on case-insensitive comparison.
 *
 * Strategy: generate a base name (all lower-case after trimming, to keep it
 * within length bounds), then produce an upper-cased variant as the collider.
 */
const caseVariantNamePairArb: fc.Arbitrary<[string, string]> = agencyNameArb
  .filter((s) => s.trim().length >= 2)
  .map((s): [string, string] => {
    const base = s.trim();
    const first = base[0] ?? '';
    // Produce the collision variant by toggling case of the first character.
    const variant =
      first === first.toUpperCase()
        ? first.toLowerCase() + base.slice(1)
        : first.toUpperCase() + base.slice(1);
    return [base, variant];
  });

/**
 * A pair of agency codes where the second is a case-variant of the first.
 */
const caseVariantCodePairArb: fc.Arbitrary<[string, string]> = agencyCodeArb
  .filter((s) => s.trim().length >= 2)
  .map((s): [string, string] => {
    const base = s.trim();
    const first = base[0] ?? '';
    const variant =
      first === first.toUpperCase()
        ? first.toLowerCase() + base.slice(1)
        : first.toUpperCase() + base.slice(1);
    return [base, variant];
  });

// ─────────────────────────────────────────────────────────────────────────────
// Helper: seed one tenant in the store, return its id
// ─────────────────────────────────────────────────────────────────────────────

async function seedTenant(
  store: ReturnType<typeof createMemoryPlatformStore>,
  name: string,
): Promise<string> {
  const tenant = await store.createTenantWithLgu({
    name,
    region: 'Region VII',
    province: 'Cebu',
    lguName: `${name} LGU Office`,
    lat: null,
    lon: null,
    now: NOW,
  });
  return tenant.id;
}

// ─────────────────────────────────────────────────────────────────────────────
// Property A — cross-tenant: same name or code succeeds for both tenants
// ─────────────────────────────────────────────────────────────────────────────

describe('Property A: two distinct tenants may each hold an agency with a case-equal name or code', () => {
  /**
   * A.1 — same name, different code, different tenants → both creates succeed.
   *
   * Validates: Requirements R1.7
   */
  it('A.1: cross-tenant duplicate name succeeds for both tenants (R1.7)', async () => {
    await fc.assert(
      fc.asyncProperty(
        distinctTenantNamesArb,
        agencyNameArb, // shared name (may have any case)
        agencyCodeArb, // code for tenant A
        agencyCodeArb, // code for tenant B (may collide with A's code — different tenant)
        agencyTypeArb,
        agencyTypeArb,
        async ([tenantNameA, tenantNameB], sharedName, codeA, codeB, typeA, typeB) => {
          const store = createMemoryPlatformStore();
          const tenantIdA = await seedTenant(store, tenantNameA);
          const tenantIdB = await seedTenant(store, tenantNameB);

          const deps = { store };
          const scopeA: ActingScope = { tenantId: tenantIdA };
          const scopeB: ActingScope = { tenantId: tenantIdB };

          // Both creates use the exact same sharedName, potentially same case.
          const resultA = await createAgency(deps, scopeA, {
            name: sharedName,
            code: codeA,
            agencyType: typeA,
          });

          const resultB = await createAgency(deps, scopeB, {
            name: sharedName,
            code: codeB,
            agencyType: typeB,
          });

          // Both must succeed — cross-tenant allows the same name.
          expect(resultA.status).toBe('ok');
          expect(resultB.status).toBe('ok');

          // Both rows must persist with the correct tenant bindings.
          if (resultA.status === 'ok' && resultB.status === 'ok') {
            expect(resultA.agency.tenantId).toBe(tenantIdA);
            expect(resultB.agency.tenantId).toBe(tenantIdB);
            expect(resultA.agency.name).toBe(sharedName.trim());
            expect(resultB.agency.name).toBe(sharedName.trim());
          }
        },
      ),
      { numRuns: RUNS },
    );
  });

  /**
   * A.2 — same code (case-variant), different names, different tenants → both succeed.
   *
   * Validates: Requirements R1.9
   */
  it('A.2: cross-tenant duplicate code succeeds for both tenants (R1.9)', async () => {
    await fc.assert(
      fc.asyncProperty(
        distinctTenantNamesArb,
        caseVariantCodePairArb, // [codeA, codeB] — case-equal codes
        agencyNameArb, // name for tenant A
        agencyNameArb, // name for tenant B (may collide — different tenant; uniqueness still cross-tenant ok)
        agencyTypeArb,
        agencyTypeArb,
        async ([tenantNameA, tenantNameB], [codeA, codeB], nameA, nameB, typeA, typeB) => {
          const store = createMemoryPlatformStore();
          const tenantIdA = await seedTenant(store, tenantNameA);
          const tenantIdB = await seedTenant(store, tenantNameB);

          const deps = { store };
          const scopeA: ActingScope = { tenantId: tenantIdA };
          const scopeB: ActingScope = { tenantId: tenantIdB };

          const resultA = await createAgency(deps, scopeA, {
            name: nameA,
            code: codeA,
            agencyType: typeA,
          });

          const resultB = await createAgency(deps, scopeB, {
            name: nameB,
            code: codeB,
            agencyType: typeB,
          });

          // Both must succeed — cross-tenant allows the same code.
          expect(resultA.status).toBe('ok');
          expect(resultB.status).toBe('ok');

          if (resultA.status === 'ok' && resultB.status === 'ok') {
            expect(resultA.agency.tenantId).toBe(tenantIdA);
            expect(resultB.agency.tenantId).toBe(tenantIdB);
            // Codes are case-insensitively equal — confirm both persisted
            expect(resultA.agency.code.toLowerCase()).toBe(codeA.trim().toLowerCase());
            expect(resultB.agency.code.toLowerCase()).toBe(codeB.trim().toLowerCase());
          }
        },
      ),
      { numRuns: RUNS },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property B — within-tenant: case-insensitive duplicate → conflict, row intact
// ─────────────────────────────────────────────────────────────────────────────

describe('Property B: within-tenant case-insensitive duplicate → conflict, pre-existing row intact', () => {
  /**
   * B.1 — create collision on name (same tenant).
   *
   * Seed one agency with `name`, attempt to create another with a case-variant
   * of the same name but a different code. Must return `conflict`. The original
   * row must be unchanged.
   *
   * Validates: Requirements R1.8, R3.4
   */
  it('B.1: create with duplicate name (case-insensitive) → conflict, original row unchanged (R1.8, R3.4)', async () => {
    await fc.assert(
      fc.asyncProperty(
        tenantNameArb,
        caseVariantNamePairArb, // [originalName, colliderName] — case-insensitively equal
        agencyCodeArb, // code for the original agency
        agencyCodeArb, // distinct code for the collider (to isolate name collision)
        agencyTypeArb,
        agencyTypeArb,
        async (
          tenantName,
          [originalName, colliderName],
          originalCode,
          colliderCode,
          typeA,
          typeB,
        ) => {
          // Skip if codes collide too — we want to test name collision in isolation.
          if (originalCode.trim().toLowerCase() === colliderCode.trim().toLowerCase()) {
            return;
          }

          const store = createMemoryPlatformStore();
          const tenantId = await seedTenant(store, tenantName);
          const deps = { store };
          const scope: ActingScope = { tenantId };

          // Create the original agency.
          const firstResult = await createAgency(deps, scope, {
            name: originalName,
            code: originalCode,
            agencyType: typeA,
          });

          // If the first create itself fails (shouldn't happen in isolation), skip.
          if (firstResult.status !== 'ok') return;

          const originalAgency = firstResult.agency;

          // Attempt to create a second agency with a case-variant of the same name.
          const secondResult = await createAgency(deps, scope, {
            name: colliderName,
            code: colliderCode,
            agencyType: typeB,
          });

          // Must be a conflict.
          expect(secondResult.status).toBe('conflict');

          // The pre-existing row must be byte-for-byte intact.
          const foundAgency = await store.findAgencyById(originalAgency.id);
          expect(foundAgency).not.toBeNull();
          if (foundAgency !== null) {
            expect(foundAgency.id).toBe(originalAgency.id);
            expect(foundAgency.name).toBe(originalAgency.name);
            expect(foundAgency.code).toBe(originalAgency.code);
            expect(foundAgency.agencyType).toBe(originalAgency.agencyType);
            expect(foundAgency.active).toBe(originalAgency.active);
            expect(foundAgency.tenantId).toBe(originalAgency.tenantId);
          }

          // No spurious second agency must have been persisted.
          const allAgencies = await store.listAgenciesForTenant(tenantId);
          expect(allAgencies).toHaveLength(1);
        },
      ),
      { numRuns: RUNS },
    );
  });

  /**
   * B.2 — create collision on code (same tenant).
   *
   * Seed one agency, attempt to create another with a different name but a
   * case-variant of the same code. Must return `conflict`. Pre-existing row intact.
   *
   * Validates: Requirements R1.10, R3.4
   */
  it('B.2: create with duplicate code (case-insensitive) → conflict, original row unchanged (R1.10, R3.4)', async () => {
    await fc.assert(
      fc.asyncProperty(
        tenantNameArb,
        agencyNameArb, // name for the original
        agencyNameArb, // distinct name for the collider
        caseVariantCodePairArb, // [originalCode, colliderCode] — case-insensitively equal
        agencyTypeArb,
        agencyTypeArb,
        async (
          tenantName,
          originalName,
          colliderName,
          [originalCode, colliderCode],
          typeA,
          typeB,
        ) => {
          // Skip if names collide too — we want to test code collision in isolation.
          if (originalName.trim().toLowerCase() === colliderName.trim().toLowerCase()) {
            return;
          }

          const store = createMemoryPlatformStore();
          const tenantId = await seedTenant(store, tenantName);
          const deps = { store };
          const scope: ActingScope = { tenantId };

          const firstResult = await createAgency(deps, scope, {
            name: originalName,
            code: originalCode,
            agencyType: typeA,
          });

          if (firstResult.status !== 'ok') return;
          const originalAgency = firstResult.agency;

          const secondResult = await createAgency(deps, scope, {
            name: colliderName,
            code: colliderCode,
            agencyType: typeB,
          });

          // Must be a conflict.
          expect(secondResult.status).toBe('conflict');

          // Pre-existing row must be intact.
          const foundAgency = await store.findAgencyById(originalAgency.id);
          expect(foundAgency).not.toBeNull();
          if (foundAgency !== null) {
            expect(foundAgency.id).toBe(originalAgency.id);
            expect(foundAgency.name).toBe(originalAgency.name);
            expect(foundAgency.code).toBe(originalAgency.code);
            expect(foundAgency.agencyType).toBe(originalAgency.agencyType);
            expect(foundAgency.active).toBe(originalAgency.active);
            expect(foundAgency.tenantId).toBe(originalAgency.tenantId);
          }

          const allAgencies = await store.listAgenciesForTenant(tenantId);
          expect(allAgencies).toHaveLength(1);
        },
      ),
      { numRuns: RUNS },
    );
  });

  /**
   * B.3 — rename collision on name (same tenant).
   *
   * Seed two agencies A and B in the same tenant. Attempt to rename B to a
   * case-variant of A's name. Must return `conflict`. A and B must both be
   * byte-for-byte unchanged after the failed rename.
   *
   * Validates: Requirements R1.8, R3.4
   */
  it('B.3: rename to duplicate name (case-insensitive) → conflict, both rows unchanged (R1.8, R3.4)', async () => {
    await fc.assert(
      fc.asyncProperty(
        tenantNameArb,
        caseVariantNamePairArb, // [nameA, colliderName] — case-insensitively equal
        agencyCodeArb, // code for agency A
        agencyCodeArb, // code for agency B
        agencyCodeArb, // code for the rename attempt (new code for B, different from A/B)
        agencyTypeArb,
        async (tenantName, [nameA, colliderName], codeA, codeB, _newCode, agencyType) => {
          // Codes A and B must be distinct to seed both agencies successfully.
          if (codeA.trim().toLowerCase() === codeB.trim().toLowerCase()) return;
          // Name for B must differ from A for the initial create to succeed.
          // We use a deterministic distinct name for B.
          const nameB = nameA.trim() + '-B';
          if (nameB.length > 64) return;

          const store = createMemoryPlatformStore();
          const tenantId = await seedTenant(store, tenantName);
          const deps = { store };
          const scope: ActingScope = { tenantId };

          // Create agency A.
          const resultA = await createAgency(deps, scope, {
            name: nameA,
            code: codeA,
            agencyType,
          });
          if (resultA.status !== 'ok') return;
          const agencyA = resultA.agency;

          // Create agency B with a different name.
          const resultB = await createAgency(deps, scope, {
            name: nameB,
            code: codeB,
            agencyType,
          });
          if (resultB.status !== 'ok') return;
          const agencyB = resultB.agency;

          // Attempt to rename B to a case-variant of A's name.
          const renameResult = await renameAgency(deps, scope, agencyB.id, {
            name: colliderName,
          });

          // Must be a conflict.
          expect(renameResult.status).toBe('conflict');

          // Agency A must be byte-for-byte unchanged.
          const foundA = await store.findAgencyById(agencyA.id);
          expect(foundA).not.toBeNull();
          if (foundA !== null) {
            expect(foundA.name).toBe(agencyA.name);
            expect(foundA.code).toBe(agencyA.code);
          }

          // Agency B must also be unchanged (the rename must not have persisted).
          const foundB = await store.findAgencyById(agencyB.id);
          expect(foundB).not.toBeNull();
          if (foundB !== null) {
            expect(foundB.name).toBe(agencyB.name);
            expect(foundB.code).toBe(agencyB.code);
          }
        },
      ),
      { numRuns: RUNS },
    );
  });

  /**
   * B.4 — rename collision on code (same tenant).
   *
   * Seed two agencies A and B. Rename B giving it a case-variant of A's code.
   * Must return `conflict`. Both rows unchanged.
   *
   * Validates: Requirements R1.10, R3.4
   */
  it('B.4: rename to duplicate code (case-insensitive) → conflict, both rows unchanged (R1.10, R3.4)', async () => {
    await fc.assert(
      fc.asyncProperty(
        tenantNameArb,
        agencyNameArb, // nameA
        agencyCodeArb, // codeA
        caseVariantCodePairArb, // [codeA_alias, colliderCode] to collide with A's code
        agencyTypeArb,
        async (tenantName, nameA, codeA, [_codeAVariant, _colliderCode], agencyType) => {
          // We want a code that matches codeA case-insensitively, so we rederive by
          // toggling the case of codeA's first character.
          const codeATrimmed = codeA.trim();
          const codeAFirst = codeATrimmed[0] ?? '';
          const actualColliderCode =
            codeAFirst === codeAFirst.toUpperCase()
              ? codeAFirst.toLowerCase() + codeATrimmed.slice(1)
              : codeAFirst.toUpperCase() + codeATrimmed.slice(1);

          // Agency B gets a fresh unique name and code.
          const nameB = nameA.trim() + '-B';
          if (nameB.length > 64) return;

          const codeB = 'B-' + codeA.trim().slice(0, 10); // guaranteed different from codeA
          if (codeB.trim().toLowerCase() === codeA.trim().toLowerCase()) return;
          if (actualColliderCode.trim().toLowerCase() !== codeA.trim().toLowerCase()) return;
          if (codeB.trim().length < 2 || codeB.trim().length > 12) return;

          const store = createMemoryPlatformStore();
          const tenantId = await seedTenant(store, tenantName);
          const deps = { store };
          const scope: ActingScope = { tenantId };

          // Create agency A.
          const resultA = await createAgency(deps, scope, {
            name: nameA,
            code: codeA,
            agencyType,
          });
          if (resultA.status !== 'ok') return;
          const agencyA = resultA.agency;

          // Create agency B.
          const resultB = await createAgency(deps, scope, {
            name: nameB,
            code: codeB,
            agencyType,
          });
          if (resultB.status !== 'ok') return;
          const agencyB = resultB.agency;

          // Attempt to rename B's code to a case-variant of A's code.
          const renameResult = await renameAgency(deps, scope, agencyB.id, {
            code: actualColliderCode,
          });

          // Must be a conflict.
          expect(renameResult.status).toBe('conflict');

          // Both rows must be unchanged.
          const foundA = await store.findAgencyById(agencyA.id);
          expect(foundA).not.toBeNull();
          if (foundA !== null) {
            expect(foundA.code).toBe(agencyA.code);
          }

          const foundB = await store.findAgencyById(agencyB.id);
          expect(foundB).not.toBeNull();
          if (foundB !== null) {
            expect(foundB.code).toBe(agencyB.code);
          }
        },
      ),
      { numRuns: RUNS },
    );
  });
});
