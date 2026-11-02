/**
 * @vitest-environment node
 *
 * Feature: tenant-responder-network, Property 3: Agency create/rename/activate round-trip + length validation
 *
 * Property-based tests for the agency management service functions:
 * `createAgency`, `renameAgency`, and `setAgencyActive`.
 *
 * Properties verified (≥ 100 runs each):
 *
 *   P1 — `createAgency` succeeds iff trimmed name ∈ [2, 64] chars AND trimmed code ∈
 *        [2, 12] chars (given a valid AgencyType and an existing tenant). An
 *        out-of-range name or code returns `{ status: 'invalid' }` and no row is
 *        written (R3.2, R3.3).
 *
 *   P2 — A successful `createAgency` persists exactly one matching row that is
 *        returned by `findAgencyById` with the correct trimmed name, code, agencyType,
 *        tenantId, and active === true (R3.2, R3.5).
 *
 *   P3 — `renameAgency` reads back the supplied trimmed name / code values from
 *        both the return value and from a subsequent `findAgencyById` (R3.5).
 *
 *   P4 — `setAgencyActive(false)` reads back `active === false`, the row is retained
 *        (R3.6). The operation is idempotent: a second `setAgencyActive(false)` call
 *        still yields `active === false`.
 *
 * Validates: Requirements 3.2, 3.3, 3.5, 3.6
 */

// Feature: tenant-responder-network, Property 3: Agency create/rename/activate round-trip + length validation

import type { AgencyType } from '@aira/ui';
import { AGENCY_TYPES } from '@aira/ui';
import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createMemoryPlatformStore,
  type MemoryPlatformStore,
} from './support/memory-platform-store';
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

// Per-test timeout: guards against vitest's 5s default cap when the full suite
// runs these slow seeded PBTs under heavy parallel-worker load.
const PBT_TIMEOUT_MS = 60_000;

const NOW = 1_700_000_000_000;

// Boundaries defined by the spec (R3.3)
const NAME_MIN = 2;
const NAME_MAX = 64;
const CODE_MIN = 2;
const CODE_MAX = 12;

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let store: MemoryPlatformStore;
let deps: ResponderNetworkDeps;
let tenantId: string;
let scope: ActingScope;

beforeEach(async () => {
  store = createMemoryPlatformStore();
  deps = { store };

  const tenant = await store.createTenantWithLgu({
    name: 'Cebu City DRRMO',
    region: 'Region VII',
    province: 'Cebu',
    lguName: 'Cebu City DRRMO Office',
    lat: 10.3157,
    lon: 123.8854,
    now: NOW,
  });
  tenantId = tenant.id;
  scope = { tenantId };
});

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Arbitrary AgencyType from the closed taxonomy. */
const agencyTypeArb: fc.Arbitrary<AgencyType> = fc.constantFrom(
  ...(AGENCY_TYPES as readonly AgencyType[]),
);

/**
 * A string that, when trimmed, has exactly `len` characters.
 * We produce a core string of `len` visible ASCII chars and optionally wrap it
 * with spaces that will be trimmed away. This ensures the trimmed result is
 * exactly `len` chars long without relying on fc.string internals.
 */
function exactTrimmedLength(len: number): fc.Arbitrary<string> {
  return fc
    .tuple(
      // Core: exactly `len` printable non-whitespace chars
      fc.stringOf(
        fc.char().filter((c) => c.trim().length === 1),
        { minLength: len, maxLength: len },
      ),
      // Optional leading/trailing spaces (0–3 each)
      fc.integer({ min: 0, max: 3 }),
      fc.integer({ min: 0, max: 3 }),
    )
    .map(([core, leading, trailing]) => ' '.repeat(leading) + core + ' '.repeat(trailing));
}

/**
 * A string whose trimmed length is strictly below `min` (i.e. 0 or 1).
 * Includes the empty string and single-char strings.
 */
const tooShortStr: fc.Arbitrary<string> = fc.oneof(
  fc.constant(''),
  fc.constant(' '),
  fc.constant('  '),
  fc
    .char()
    .filter((c) => c.trim().length === 1)
    .map((c) => c),
  fc
    .char()
    .filter((c) => c.trim().length === 1)
    .map((c) => ` ${c}  `),
);

/**
 * Arbitrary name string whose trimmed length is in [NAME_MIN, NAME_MAX].
 */
const validNameArb: fc.Arbitrary<string> = fc
  .integer({ min: NAME_MIN, max: NAME_MAX })
  .chain((len) => exactTrimmedLength(len));

/**
 * Arbitrary code string whose trimmed length is in [CODE_MIN, CODE_MAX].
 */
const validCodeArb: fc.Arbitrary<string> = fc
  .integer({ min: CODE_MIN, max: CODE_MAX })
  .chain((len) => exactTrimmedLength(len));

/**
 * Arbitrary name whose trimmed length is > NAME_MAX (65+).
 */
const tooLongNameArb: fc.Arbitrary<string> = fc
  .integer({ min: NAME_MAX + 1, max: NAME_MAX + 20 })
  .chain((len) => exactTrimmedLength(len));

/**
 * Arbitrary code whose trimmed length is > CODE_MAX (13+).
 */
const tooLongCodeArb: fc.Arbitrary<string> = fc
  .integer({ min: CODE_MAX + 1, max: CODE_MAX + 10 })
  .chain((len) => exactTrimmedLength(len));

// ---------------------------------------------------------------------------
// P1 — Length validation: createAgency rejects out-of-range names and codes
//      with 'invalid'; valid lengths succeed (R3.2, R3.3)
// Validates: Requirements 3.2, 3.3
// ---------------------------------------------------------------------------

describe('Property P1: createAgency succeeds iff trimmed name ∈ [2,64] and trimmed code ∈ [2,12]', () => {
  it(
    'returns { status: "ok" } for every in-range name and code combination',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          validNameArb,
          validCodeArb,
          agencyTypeArb,
          async (name, code, agencyType) => {
            // Recreate the store per iteration so IDs never collide across runs.
            const iterStore = createMemoryPlatformStore();
            const iterTenant = await iterStore.createTenantWithLgu({
              name: 'Test Tenant',
              region: 'R',
              province: 'P',
              lguName: 'Office',
              lat: 10.0,
              lon: 123.0,
              now: NOW,
            });
            const iterDeps: ResponderNetworkDeps = { store: iterStore };
            const iterScope: ActingScope = { tenantId: iterTenant.id };

            const result = await createAgency(iterDeps, iterScope, { name, code, agencyType });
            expect(result.status).toBe('ok');
          },
        ),
        { numRuns: RUNS },
      );
    },
    PBT_TIMEOUT_MS,
  );

  it(
    'returns { status: "invalid" } when trimmed name is too short (< 2 chars)',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          tooShortStr,
          validCodeArb,
          agencyTypeArb,
          async (name, code, agencyType) => {
            const iterStore = createMemoryPlatformStore();
            const iterTenant = await iterStore.createTenantWithLgu({
              name: 'Test Tenant',
              region: 'R',
              province: 'P',
              lguName: 'Office',
              lat: 10.0,
              lon: 123.0,
              now: NOW,
            });
            const iterDeps: ResponderNetworkDeps = { store: iterStore };
            const iterScope: ActingScope = { tenantId: iterTenant.id };

            const initialCount = (await iterStore.listAgenciesForTenant(iterTenant.id)).length;
            const result = await createAgency(iterDeps, iterScope, { name, code, agencyType });

            expect(result.status).toBe('invalid');
            // No row should have been written
            const finalCount = (await iterStore.listAgenciesForTenant(iterTenant.id)).length;
            expect(finalCount).toBe(initialCount);
          },
        ),
        { numRuns: RUNS },
      );
    },
    PBT_TIMEOUT_MS,
  );

  it(
    'returns { status: "invalid" } when trimmed name is too long (> 64 chars)',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          tooLongNameArb,
          validCodeArb,
          agencyTypeArb,
          async (name, code, agencyType) => {
            const iterStore = createMemoryPlatformStore();
            const iterTenant = await iterStore.createTenantWithLgu({
              name: 'Test Tenant',
              region: 'R',
              province: 'P',
              lguName: 'Office',
              lat: 10.0,
              lon: 123.0,
              now: NOW,
            });
            const iterDeps: ResponderNetworkDeps = { store: iterStore };
            const iterScope: ActingScope = { tenantId: iterTenant.id };

            const result = await createAgency(iterDeps, iterScope, { name, code, agencyType });
            expect(result.status).toBe('invalid');
            const finalCount = (await iterStore.listAgenciesForTenant(iterTenant.id)).length;
            expect(finalCount).toBe(0);
          },
        ),
        { numRuns: RUNS },
      );
    },
    PBT_TIMEOUT_MS,
  );

  it(
    'returns { status: "invalid" } when trimmed code is too short (< 2 chars)',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          validNameArb,
          tooShortStr,
          agencyTypeArb,
          async (name, code, agencyType) => {
            const iterStore = createMemoryPlatformStore();
            const iterTenant = await iterStore.createTenantWithLgu({
              name: 'Test Tenant',
              region: 'R',
              province: 'P',
              lguName: 'Office',
              lat: 10.0,
              lon: 123.0,
              now: NOW,
            });
            const iterDeps: ResponderNetworkDeps = { store: iterStore };
            const iterScope: ActingScope = { tenantId: iterTenant.id };

            const result = await createAgency(iterDeps, iterScope, { name, code, agencyType });
            expect(result.status).toBe('invalid');
            const finalCount = (await iterStore.listAgenciesForTenant(iterTenant.id)).length;
            expect(finalCount).toBe(0);
          },
        ),
        { numRuns: RUNS },
      );
    },
    PBT_TIMEOUT_MS,
  );

  it(
    'returns { status: "invalid" } when trimmed code is too long (> 12 chars)',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          validNameArb,
          tooLongCodeArb,
          agencyTypeArb,
          async (name, code, agencyType) => {
            const iterStore = createMemoryPlatformStore();
            const iterTenant = await iterStore.createTenantWithLgu({
              name: 'Test Tenant',
              region: 'R',
              province: 'P',
              lguName: 'Office',
              lat: 10.0,
              lon: 123.0,
              now: NOW,
            });
            const iterDeps: ResponderNetworkDeps = { store: iterStore };
            const iterScope: ActingScope = { tenantId: iterTenant.id };

            const result = await createAgency(iterDeps, iterScope, { name, code, agencyType });
            expect(result.status).toBe('invalid');
            const finalCount = (await iterStore.listAgenciesForTenant(iterTenant.id)).length;
            expect(finalCount).toBe(0);
          },
        ),
        { numRuns: RUNS },
      );
    },
    PBT_TIMEOUT_MS,
  );
});

// ---------------------------------------------------------------------------
// P2 — Successful createAgency persists exactly one matching row (R3.2)
// Validates: Requirements 3.2, 3.5
// ---------------------------------------------------------------------------

describe('Property P2: successful createAgency persists exactly one matching row', () => {
  it(
    'findAgencyById returns the created agency with correct trimmed fields after success',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          validNameArb,
          validCodeArb,
          agencyTypeArb,
          async (name, code, agencyType) => {
            const iterStore = createMemoryPlatformStore();
            const iterTenant = await iterStore.createTenantWithLgu({
              name: 'Test Tenant',
              region: 'R',
              province: 'P',
              lguName: 'Office',
              lat: 10.0,
              lon: 123.0,
              now: NOW,
            });
            const iterDeps: ResponderNetworkDeps = { store: iterStore };
            const iterScope: ActingScope = { tenantId: iterTenant.id };

            const result = await createAgency(iterDeps, iterScope, { name, code, agencyType });

            // Must succeed for in-range inputs
            expect(result.status).toBe('ok');
            if (result.status !== 'ok') return;

            const { agency } = result;

            // findAgencyById must return the same record
            const found = await iterStore.findAgencyById(agency.id);
            expect(found).not.toBeNull();
            if (found === null) return;

            // Trimmed values must be persisted
            expect(found.name).toBe(name.trim());
            expect(found.code).toBe(code.trim());
            expect(found.agencyType).toBe(agencyType);
            expect(found.tenantId).toBe(iterTenant.id);
            expect(found.active).toBe(true);

            // Exactly one row for this tenant
            const all = await iterStore.listAgenciesForTenant(iterTenant.id);
            expect(all.length).toBe(1);
            expect(all[0]?.id).toBe(agency.id);
          },
        ),
        { numRuns: RUNS },
      );
    },
    PBT_TIMEOUT_MS,
  );
});

// ---------------------------------------------------------------------------
// P3 — renameAgency reads back the trimmed new values (R3.5)
// Validates: Requirements 3.5
// ---------------------------------------------------------------------------

describe('Property P3: renameAgency reads back the trimmed new name and code', () => {
  it(
    'rename result and findAgencyById both reflect the trimmed new name and code',
    async () => {
      // Use a single store with a single tenant; give each iteration a unique base name/code
      // so iterations never collide with each other.
      let counter = 0;

      await fc.assert(
        fc.asyncProperty(
          // Only generate new name/code for the rename (the original is deterministic per counter)
          validNameArb,
          validCodeArb,
          async (newName, newCode) => {
            counter += 1;
            const idx = counter;

            // Original name/code must be different from new name/code to avoid self-collision.
            // We use deterministic originals keyed by counter so there is never a per-tenant duplicate.
            const origName = `Orig${idx.toString().padStart(6, '0')}`;
            const origCode = `OC${idx.toString().padStart(4, '0')}`;

            const createResult = await createAgency(deps, scope, {
              name: origName,
              code: origCode,
              agencyType: 'FIRE',
            });
            // Should always succeed (originals are unique and in-range)
            expect(createResult.status).toBe('ok');
            if (createResult.status !== 'ok') return;

            const agencyId = createResult.agency.id;

            // Rename to the generated new values
            const renameResult = await renameAgency(deps, scope, agencyId, {
              name: newName,
              code: newCode,
            });

            // A conflict means another iteration already stored the same trimmed name or code.
            // That is a valid store behaviour; we only assert the round-trip on success.
            if (renameResult.status === 'conflict') return;

            expect(renameResult.status).toBe('ok');
            if (renameResult.status !== 'ok') return;

            // The returned agency must carry the trimmed new values.
            expect(renameResult.agency.name).toBe(newName.trim());
            expect(renameResult.agency.code).toBe(newCode.trim());

            // A subsequent findAgencyById must also reflect the trimmed values.
            const found = await store.findAgencyById(agencyId);
            expect(found).not.toBeNull();
            if (found === null) return;

            expect(found.name).toBe(newName.trim());
            expect(found.code).toBe(newCode.trim());
          },
        ),
        { numRuns: RUNS },
      );
    },
    PBT_TIMEOUT_MS,
  );
});

// ---------------------------------------------------------------------------
// P4 — setAgencyActive(false) reads back active === false, retains the row,
//      and is idempotent on repeat (R3.6)
// Validates: Requirements 3.6
// ---------------------------------------------------------------------------

describe('Property P4: setAgencyActive(false) reads back active === false and is idempotent', () => {
  it(
    'deactivating an agency sets active to false, retains the row, and is idempotent',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          validNameArb,
          validCodeArb,
          agencyTypeArb,
          async (name, code, agencyType) => {
            const iterStore = createMemoryPlatformStore();
            const iterTenant = await iterStore.createTenantWithLgu({
              name: 'Test Tenant',
              region: 'R',
              province: 'P',
              lguName: 'Office',
              lat: 10.0,
              lon: 123.0,
              now: NOW,
            });
            const iterDeps: ResponderNetworkDeps = { store: iterStore };
            const iterScope: ActingScope = { tenantId: iterTenant.id };

            // Create the agency (starts active === true)
            const createResult = await createAgency(iterDeps, iterScope, {
              name,
              code,
              agencyType,
            });
            if (createResult.status !== 'ok') return;

            const agencyId = createResult.agency.id;
            expect(createResult.agency.active).toBe(true);

            // First deactivation
            const deactivate1 = await setAgencyActive(iterDeps, iterScope, agencyId, false);
            expect(deactivate1.status).toBe('ok');
            if (deactivate1.status !== 'ok') return;
            expect(deactivate1.agency.active).toBe(false);

            // Row must still exist (not deleted)
            const found1 = await iterStore.findAgencyById(agencyId);
            expect(found1).not.toBeNull();
            expect(found1?.active).toBe(false);

            // Second deactivation (idempotent)
            const deactivate2 = await setAgencyActive(iterDeps, iterScope, agencyId, false);
            expect(deactivate2.status).toBe('ok');
            if (deactivate2.status !== 'ok') return;
            expect(deactivate2.agency.active).toBe(false);

            // Row still exists after second call
            const found2 = await iterStore.findAgencyById(agencyId);
            expect(found2).not.toBeNull();
            expect(found2?.active).toBe(false);

            // Other fields are unchanged
            expect(found2?.id).toBe(agencyId);
            expect(found2?.tenantId).toBe(iterTenant.id);
            expect(found2?.name).toBe(name.trim());
            expect(found2?.code).toBe(code.trim());
            expect(found2?.agencyType).toBe(agencyType);
          },
        ),
        { numRuns: RUNS },
      );
    },
    PBT_TIMEOUT_MS,
  );

  it(
    'setAgencyActive(true) after setAgencyActive(false) reads back active === true',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          validNameArb,
          validCodeArb,
          agencyTypeArb,
          async (name, code, agencyType) => {
            const iterStore = createMemoryPlatformStore();
            const iterTenant = await iterStore.createTenantWithLgu({
              name: 'Test Tenant',
              region: 'R',
              province: 'P',
              lguName: 'Office',
              lat: 10.0,
              lon: 123.0,
              now: NOW,
            });
            const iterDeps: ResponderNetworkDeps = { store: iterStore };
            const iterScope: ActingScope = { tenantId: iterTenant.id };

            const createResult = await createAgency(iterDeps, iterScope, {
              name,
              code,
              agencyType,
            });
            if (createResult.status !== 'ok') return;

            const agencyId = createResult.agency.id;

            // Deactivate then reactivate
            await setAgencyActive(iterDeps, iterScope, agencyId, false);
            const reactivate = await setAgencyActive(iterDeps, iterScope, agencyId, true);

            expect(reactivate.status).toBe('ok');
            if (reactivate.status !== 'ok') return;
            expect(reactivate.agency.active).toBe(true);

            const found = await iterStore.findAgencyById(agencyId);
            expect(found).not.toBeNull();
            expect(found?.active).toBe(true);
          },
        ),
        { numRuns: RUNS },
      );
    },
    PBT_TIMEOUT_MS,
  );
});
