/**
 * @vitest-environment node
 *
 * Feature: tenant-responder-network, Property 1: Agency_Type validation accepts exactly the taxonomy
 *
 * Property-based tests for `createAgency` from
 * `apps/web/src/lib/responder-network/service.ts`.
 *
 * Encodes one invariant:
 *
 *   P1 — For any arbitrary string value supplied as `agencyType`:
 *        - If the value IS one of {FIRE, POLICE, MEDICAL, DRRM, OTHER}, the call
 *          accepts it (returns `ok` when the tenant exists and name/code are valid).
 *        - If the value is NOT in the taxonomy (including empty string, unknown words,
 *          numeric strings, etc.) the call returns `{ status: 'invalid_type' }`.
 *        - The error result never echoes the submitted invalid value anywhere in its
 *          structure (R2.4 / R2.5: generic, value-free error identifiers).
 *
 * Additionally verifies that `undefined` and `null` cast to `string` (as the handler
 * would produce them) also yield `invalid_type`.
 *
 * Each property runs ≥ 100 iterations via fast-check.
 *
 * Validates: Requirements 1.4, 1.5, 2.4, 2.5
 */

// Feature: tenant-responder-network, Property 1: Agency_Type validation accepts exactly the taxonomy

import type { AgencyType } from '@aira/ui';
import { AGENCY_TYPES } from '@aira/ui';
import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createAgency,
  type ActingScope,
  type CreateAgencyResult,
  type ResponderNetworkDeps,
} from '../src/lib/responder-network/service';
import {
  createMemoryPlatformStore,
  type MemoryPlatformStore,
} from './support/memory-platform-store';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RUNS = 100;

/** A valid name and code that pass the length constraints so type validation is isolated. */
const VALID_NAME = 'Cebu City Fire Station';
const VALID_CODE = 'CCFS';

/** Fixed clock value for seeding. */
const NOW = 1_700_000_000_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let store: MemoryPlatformStore;
let deps: ResponderNetworkDeps;
let scope: ActingScope;

beforeEach(async () => {
  store = createMemoryPlatformStore();
  deps = { store };

  // Seed one tenant so createAgency can succeed for valid inputs.
  const tenant = await store.createTenantWithLgu({
    name: 'Cebu City DRRMO',
    region: 'Region VII',
    province: 'Cebu',
    lguName: 'Cebu City DRRMO Office',
    lat: 10.3157,
    lon: 123.8854,
    now: NOW,
  });
  scope = { tenantId: tenant.id };
});

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Arbitrary valid AgencyType (one of the five taxonomy members). */
const validTypeArb: fc.Arbitrary<AgencyType> = fc.constantFrom(
  ...(AGENCY_TYPES as readonly AgencyType[]),
);

/**
 * Arbitrary string that is guaranteed NOT to be one of the five taxonomy members.
 *
 * Strategy: generate any string, filter out the five valid tokens. fast-check handles
 * the filtering without exhaustion because the five tokens are a negligible fraction of
 * the arbitrary-string space.
 */
const invalidTypeArb: fc.Arbitrary<string> = fc
  .string()
  .filter((s) => !(AGENCY_TYPES as readonly string[]).includes(s));

// ---------------------------------------------------------------------------
// P1a — Valid taxonomy members are accepted
// Validates: Requirements 1.4, 1.5
// ---------------------------------------------------------------------------
describe('Property P1a: createAgency accepts agencyType iff it is in {FIRE,POLICE,MEDICAL,DRRM,OTHER}', () => {
  it('returns ok for every member of the taxonomy when name/code/tenant are valid', () => {
    // Synchronous property over valid types — each iteration is an independent async call,
    // but fast-check's asyncProperty handles the await correctly.
    return fc.assert(
      fc.asyncProperty(validTypeArb, async (agencyType) => {
        const result: CreateAgencyResult = await createAgency(deps, scope, {
          name: VALID_NAME,
          code: VALID_CODE,
          agencyType,
        });
        // Accept either 'ok' or 'conflict' (if the same name/code was used in a prior
        // iteration within this property run). Both mean the type itself was valid.
        expect(['ok', 'conflict']).toContain(result.status);
      }),
      { numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// P1b — Non-taxonomy strings are rejected with invalid_type, never echoing the value
// Validates: Requirements 1.4, 1.5, 2.4, 2.5
// ---------------------------------------------------------------------------
describe('Property P1b: createAgency rejects any agencyType not in the taxonomy with invalid_type', () => {
  it('returns invalid_type for every non-taxonomy string (generic, no echo)', () => {
    return fc.assert(
      fc.asyncProperty(invalidTypeArb, async (badType) => {
        const result: CreateAgencyResult = await createAgency(deps, scope, {
          name: VALID_NAME,
          code: VALID_CODE,
          agencyType: badType,
        });

        // The status must be invalid_type — no other outcome is acceptable.
        expect(result.status).toBe('invalid_type');

        // R2.4 / R2.5: the error must never echo the submitted value.
        // The result is a discriminated union with ONLY the 'status' field for
        // invalid_type — no 'value', 'received', 'input', or any other key that
        // would reflect the submitted string back to the caller.
        const keys = Object.keys(result);
        expect(keys).toEqual(['status']);
      }),
      { numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// P1c — Edge-case non-taxonomy values: undefined/null coerced to string
// Validates: Requirements 2.4, 2.5
// ---------------------------------------------------------------------------
describe('Property P1c: undefined and null coerced to string yield invalid_type', () => {
  it('returns invalid_type when agencyType is "undefined" (coerced undefined)', async () => {
    const result: CreateAgencyResult = await createAgency(deps, scope, {
      name: VALID_NAME,
      code: VALID_CODE,
      agencyType: String(undefined), // → "undefined"
    });
    expect(result.status).toBe('invalid_type');
    // R2.4/R2.5: no extra fields — the submitted value is never echoed back.
    expect(Object.keys(result)).toEqual(['status']);
  });

  it('returns invalid_type when agencyType is "null" (coerced null)', async () => {
    const result: CreateAgencyResult = await createAgency(deps, scope, {
      name: VALID_NAME,
      code: VALID_CODE,
      agencyType: String(null), // → "null"
    });
    expect(result.status).toBe('invalid_type');
    // R2.4/R2.5: no extra fields — the submitted value is never echoed back.
    expect(Object.keys(result)).toEqual(['status']);
  });

  it('returns invalid_type for an empty string agencyType', async () => {
    const result: CreateAgencyResult = await createAgency(deps, scope, {
      name: VALID_NAME,
      code: VALID_CODE,
      agencyType: '',
    });
    expect(result.status).toBe('invalid_type');
  });

  it('returns invalid_type for a lowercase taxonomy word (case-sensitive check)', async () => {
    // The taxonomy is uppercase-only; lowercase variants must be rejected.
    return fc.assert(
      fc.asyncProperty(validTypeArb, async (validType) => {
        const result: CreateAgencyResult = await createAgency(deps, scope, {
          name: VALID_NAME,
          code: VALID_CODE,
          agencyType: validType.toLowerCase(),
        });
        expect(result.status).toBe('invalid_type');
      }),
      { numRuns: RUNS },
    );
  });
});
