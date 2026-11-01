/**
 * @vitest-environment node
 *
 * Routing engine — property-based test (task 6.6).
 *
 * // Feature: tenant-responder-network, Property 10: Only RESPONDER candidates are suggested
 *
 * Property 10: Only RESPONDER candidates are suggested.
 * - Every entry in the result of `rankResponders(...)` has `candidate.role === 'RESPONDER'`.
 * - No DISPATCHER or ADMIN candidate ever appears in the results.
 * - Bonus: result length equals the count of RESPONDER-role candidates in the input.
 *
 * Validates: Requirements 6.5
 *
 * These are post-implementation properties: they encode invariants the existing
 * routing engine already satisfies and are EXPECTED TO PASS. A failing property
 * would surface a real routing bug (reported with its counterexample), never a
 * reason to weaken the property.
 *
 * Each property runs >= 100 iterations.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { AgencyType, EmergencyCategoryId } from '@aira/ui';
import { AGENCY_TYPES } from '@aira/ui';

import type { CapabilityConfig } from '../src/lib/platform/types';
import { rankResponders, type RoutingCandidate } from '../src/lib/routing';

const RUNS = 100;

const FROZEN_CATEGORIES: readonly EmergencyCategoryId[] = [
  'SUNOG',
  'MEDIKAL',
  'KRIMEN',
  'BAHA',
] as const;

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** A random Emergency_Category from the frozen set. */
const arbCategory: fc.Arbitrary<EmergencyCategoryId> = fc.constantFrom(...FROZEN_CATEGORIES);

/** A random AgencyType from the closed taxonomy, or null (DRRM generalist). */
const arbAgencyType: fc.Arbitrary<AgencyType | null> = fc.oneof(
  fc.constantFrom<AgencyType>(...(AGENCY_TYPES as readonly AgencyType[])),
  fc.constant(null),
);

/** A random responder role. */
const arbRole: fc.Arbitrary<'RESPONDER' | 'DISPATCHER' | 'ADMIN'> = fc.constantFrom(
  'RESPONDER' as const,
  'DISPATCHER' as const,
  'ADMIN' as const,
);

/** A base position, or null (unknown centroid). */
const arbBase: fc.Arbitrary<{ lat: number; lon: number } | null> = fc.oneof(
  fc.record({
    lat: fc.float({ min: -90, max: 90, noNaN: true }),
    lon: fc.float({ min: -180, max: 180, noNaN: true }),
  }),
  fc.constant(null),
);

/** Generate a single RoutingCandidate with a specific role. */
function candidateWithRole(role: 'RESPONDER' | 'DISPATCHER' | 'ADMIN') {
  return fc
    .record({
      id: fc.uuid(),
      callsign: fc.hexaString({ minLength: 2, maxLength: 12 }),
      agencyType: arbAgencyType,
      agencyName: fc.oneof(fc.string({ minLength: 1, maxLength: 32 }), fc.constant(null)),
      base: arbBase,
    })
    .map(({ id, callsign, agencyType, agencyName, base }): RoutingCandidate => ({
      id,
      callsign,
      role,
      officeId: 'office-1',
      officeName: 'Test Office',
      agencyType,
      agencyName,
      base,
    }));
}

/** Generate a RoutingCandidate with an arbitrary role. */
const arbCandidateAnyRole: fc.Arbitrary<RoutingCandidate> = arbRole.chain((role) =>
  candidateWithRole(role),
);

/**
 * Generate a non-empty array of candidates that always contains at least one
 * RESPONDER and at least one non-RESPONDER, exercising the role-filter invariant
 * on a realistic mix.
 */
const arbMixedCandidates: fc.Arbitrary<readonly RoutingCandidate[]> = fc
  .tuple(
    // at least 1 RESPONDER
    fc.array(candidateWithRole('RESPONDER'), { minLength: 1, maxLength: 5 }),
    // at least 1 DISPATCHER
    fc.array(candidateWithRole('DISPATCHER'), { minLength: 1, maxLength: 3 }),
    // at least 1 ADMIN
    fc.array(candidateWithRole('ADMIN'), { minLength: 1, maxLength: 3 }),
  )
  .map(([responders, dispatchers, admins]) =>
    // Shuffle the three groups together (stable deterministic interleave).
    ([...responders, ...dispatchers, ...admins] as RoutingCandidate[]).sort((a, b) =>
      a.id.localeCompare(b.id),
    ),
  );

/**
 * A valid CapabilityConfig: each frozen category maps to a subset (possibly
 * empty) of the taxonomy.
 */
const arbCapabilityConfig: fc.Arbitrary<CapabilityConfig> = fc
  .tuple(
    fc.subarray([...AGENCY_TYPES] as AgencyType[]),
    fc.subarray([...AGENCY_TYPES] as AgencyType[]),
    fc.subarray([...AGENCY_TYPES] as AgencyType[]),
    fc.subarray([...AGENCY_TYPES] as AgencyType[]),
  )
  .map(([sunog, medikal, krimen, baha]): CapabilityConfig => ({
    SUNOG: sunog,
    MEDIKAL: medikal,
    KRIMEN: krimen,
    BAHA: baha,
  }));

/** A fixed incident position (the property does not vary over positions). */
const INCIDENT = { lat: 10.3157, lon: 123.8854 };

// ---------------------------------------------------------------------------
// Property 10: Only RESPONDER candidates are suggested
// ---------------------------------------------------------------------------

describe('Property 10: Only RESPONDER candidates are suggested', () => {
  it('every result candidate has role === RESPONDER — mixed input (≥100 runs)', () => {
    fc.assert(
      fc.property(
        arbCategory,
        arbMixedCandidates,
        arbCapabilityConfig,
        (category, candidates, config) => {
          const results = rankResponders(category, INCIDENT, candidates, config);

          // Every result must be a RESPONDER.
          for (const suggestion of results) {
            expect(suggestion.candidate.role).toBe('RESPONDER');
          }
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('no DISPATCHER or ADMIN appears in results — all-non-responder input returns empty (≥100 runs)', () => {
    fc.assert(
      fc.property(
        arbCategory,
        // A set of candidates with NO RESPONDER: only DISPATCHER and ADMIN.
        fc.array(fc.oneof(candidateWithRole('DISPATCHER'), candidateWithRole('ADMIN')), {
          minLength: 1,
          maxLength: 10,
        }),
        arbCapabilityConfig,
        (category, candidates, config) => {
          const results = rankResponders(category, INCIDENT, candidates, config);
          expect(results).toHaveLength(0);
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('result length equals RESPONDER count in input — arbitrary candidate mix (≥100 runs)', () => {
    fc.assert(
      fc.property(
        arbCategory,
        // Use an array with any combination of roles (including 0 RESPONDERs).
        fc.array(arbCandidateAnyRole, { minLength: 0, maxLength: 12 }),
        arbCapabilityConfig,
        (category, candidates, config) => {
          const responderCount = candidates.filter((c) => c.role === 'RESPONDER').length;
          const results = rankResponders(category, INCIDENT, candidates, config);
          expect(results).toHaveLength(responderCount);
        },
      ),
      { numRuns: RUNS },
    );
  });
});
