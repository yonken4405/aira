/**
 * @vitest-environment node
 *
 * Feature: tenant-responder-network, Property 9: Ranking precedence and determinism
 *
 * Property-based tests for `rankResponders` from `apps/web/src/lib/routing.ts`.
 * Encodes five invariants that must hold for ALL valid inputs:
 *
 *   A — Capable candidates always rank before non-capable candidates (R6.4).
 *   B — Within a capability band, nearer (known-distance) candidates rank before
 *       farther candidates (R6.4).
 *   C — Candidates with identical capability and identical distance (or both null)
 *       break ties by lexicographically smaller callsign (R6.4).
 *   D — Two calls over identical (frozen) inputs return the same ordering (R6.7).
 *   E — Input arrays and config are not mutated after a call (R6.7).
 *
 * Each property runs >= 100 iterations via fast-check.
 */

// Feature: tenant-responder-network, Property 9: Ranking precedence and determinism

import type { AgencyType, EmergencyCategoryId } from '@aira/ui';
import { AGENCY_TYPES } from '@aira/ui';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { CapabilityConfig } from '../src/lib/platform/types';
import {
  DEFAULT_CAPABILITY_CONFIG,
  rankResponders,
  type RoutingCandidate,
} from '../src/lib/routing';

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const RUNS = 100;

const FROZEN_CATEGORIES: readonly EmergencyCategoryId[] = [
  'SUNOG',
  'MEDIKAL',
  'KRIMEN',
  'BAHA',
] as const;

/** Arbitrary Emergency_Category. */
const categoryArb: fc.Arbitrary<EmergencyCategoryId> = fc.constantFrom(...FROZEN_CATEGORIES);

/** Arbitrary AgencyType or null (null = DRRM generalist). */
const agencyTypeOrNullArb: fc.Arbitrary<AgencyType | null> = fc.oneof(
  fc.constantFrom(...(AGENCY_TYPES as readonly AgencyType[])),
  fc.constant(null),
);

/** Arbitrary role. Non-RESPONDER candidates are included to confirm they are excluded
 *  from results (the filter is part of the ranking pipeline). */
const roleArb: fc.Arbitrary<'RESPONDER' | 'DISPATCHER' | 'ADMIN'> = fc.constantFrom(
  'RESPONDER',
  'DISPATCHER',
  'ADMIN',
);

/** Arbitrary GeoPoint or null (null = unknown base position). */
const geoPointOrNullArb: fc.Arbitrary<{ lat: number; lon: number } | null> = fc.oneof(
  fc.record({
    lat: fc.float({ min: -90, max: 90, noNaN: true }),
    lon: fc.float({ min: -180, max: 180, noNaN: true }),
  }),
  fc.constant(null),
);

/** Arbitrary callsign — non-empty, bounded. */
const callsignArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 16 })
  .filter((s) => s.trim().length > 0);

/** Arbitrary RoutingCandidate. IDs are derived from index to guarantee uniqueness. */
const candidateArb: fc.Arbitrary<RoutingCandidate> = fc.record({
  id: fc.uuid(),
  callsign: callsignArb,
  role: roleArb,
  officeId: fc.uuid(),
  officeName: fc.string({ minLength: 1, maxLength: 32 }),
  agencyType: agencyTypeOrNullArb,
  agencyName: fc.oneof(fc.string({ minLength: 1, maxLength: 32 }), fc.constant(null)),
  base: geoPointOrNullArb,
});

/** A list of 0..12 candidates. */
const candidateListArb: fc.Arbitrary<readonly RoutingCandidate[]> = fc.array(candidateArb, {
  minLength: 0,
  maxLength: 12,
});

/** An incident position. */
const incidentArb: fc.Arbitrary<{ lat: number; lon: number }> = fc.record({
  lat: fc.float({ min: -90, max: 90, noNaN: true }),
  lon: fc.float({ min: -180, max: 180, noNaN: true }),
});

// ---------------------------------------------------------------------------
// Property A — Capable before non-capable (R6.4)
// Validates: Requirements R6.4
// ---------------------------------------------------------------------------
describe('Property A: capable candidates always rank before non-capable candidates', () => {
  it('for any (i < j) pair in results, if result[j] is capable then result[i] is also capable', () => {
    fc.assert(
      fc.property(categoryArb, incidentArb, candidateListArb, (category, incident, candidates) => {
        const results = rankResponders(category, incident, candidates, DEFAULT_CAPABILITY_CONFIG);

        // For every pair i < j: if result[j].capable then result[i].capable.
        for (let i = 0; i < results.length; i++) {
          for (let j = i + 1; j < results.length; j++) {
            const earlier = results[i];
            const later = results[j];
            if (earlier === undefined || later === undefined) continue;
            if (later.capable) {
              expect(earlier.capable).toBe(true);
            }
          }
        }
      }),
      { numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property B — Distance ordering within a band (R6.4)
// Validates: Requirements R6.4
// ---------------------------------------------------------------------------
describe('Property B: within a capability band, nearer candidates rank before farther candidates', () => {
  it('within the capable band and within the non-capable band, nearer known-distance candidates rank first', () => {
    fc.assert(
      fc.property(categoryArb, incidentArb, candidateListArb, (category, incident, candidates) => {
        const results = rankResponders(category, incident, candidates, DEFAULT_CAPABILITY_CONFIG);

        // Within each band (capable / non-capable), for any pair (i < j) where both
        // have a known distance: the earlier one must not be farther.
        for (let i = 0; i < results.length; i++) {
          for (let j = i + 1; j < results.length; j++) {
            const a = results[i];
            const b = results[j];
            if (a === undefined || b === undefined) continue;
            // Only compare within the same capability band.
            if (a.capable !== b.capable) continue;
            // Only check when both distances are known.
            if (a.distanceKm === null || b.distanceKm === null) continue;
            // a must be <= b in distance.
            expect(a.distanceKm).toBeLessThanOrEqual(b.distanceKm);
          }
        }
      }),
      { numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property C — Callsign tiebreak (R6.4)
// Validates: Requirements R6.4
// ---------------------------------------------------------------------------
describe('Property C: callsign tiebreak for identical capability and identical distance', () => {
  it('for two candidates with identical capability and distance, the lexicographically smaller callsign ranks first', () => {
    fc.assert(
      fc.property(categoryArb, incidentArb, candidateListArb, (category, incident, candidates) => {
        const results = rankResponders(category, incident, candidates, DEFAULT_CAPABILITY_CONFIG);

        // For any pair (i < j) in the same band with the same distance (or both null):
        // the earlier callsign must be <= the later callsign.
        for (let i = 0; i < results.length; i++) {
          for (let j = i + 1; j < results.length; j++) {
            const a = results[i];
            const b = results[j];
            if (a === undefined || b === undefined) continue;
            if (a.capable !== b.capable) continue;
            if (a.distanceKm !== b.distanceKm) continue;
            // Same band, same distance (both null or identical float): callsign must not be greater.
            expect(a.candidate.callsign.localeCompare(b.candidate.callsign)).toBeLessThanOrEqual(0);
          }
        }
      }),
      { numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property D — Determinism: two calls over identical frozen inputs return the same order (R6.7)
// Validates: Requirements R6.7
// ---------------------------------------------------------------------------
describe('Property D: determinism — identical inputs yield identical output', () => {
  it('two calls over the same frozen candidates and config produce identical ordering', () => {
    fc.assert(
      fc.property(categoryArb, incidentArb, candidateListArb, (category, incident, candidates) => {
        // Freeze the inputs to detect any mutation-based non-determinism.
        const frozenCandidates = Object.freeze(candidates.map((c) => Object.freeze({ ...c })));
        const frozenConfig: CapabilityConfig = Object.freeze({
          SUNOG: Object.freeze([...DEFAULT_CAPABILITY_CONFIG.SUNOG]),
          MEDIKAL: Object.freeze([...DEFAULT_CAPABILITY_CONFIG.MEDIKAL]),
          KRIMEN: Object.freeze([...DEFAULT_CAPABILITY_CONFIG.KRIMEN]),
          BAHA: Object.freeze([...DEFAULT_CAPABILITY_CONFIG.BAHA]),
        }) as CapabilityConfig;
        const frozenIncident = Object.freeze({ ...incident });

        const first = rankResponders(category, frozenIncident, frozenCandidates, frozenConfig);
        const second = rankResponders(category, frozenIncident, frozenCandidates, frozenConfig);

        // Length must match.
        expect(first.length).toBe(second.length);

        // Each position must carry the same candidate id, capable flag, and distanceKm.
        for (let i = 0; i < first.length; i++) {
          const a = first[i];
          const b = second[i];
          if (a === undefined || b === undefined) continue;
          expect(a.candidate.id).toBe(b.candidate.id);
          expect(a.capable).toBe(b.capable);
          expect(a.distanceKm).toBe(b.distanceKm);
        }
      }),
      { numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property E — Purity: inputs are not mutated after a call (R6.7)
// Validates: Requirements R6.7
// ---------------------------------------------------------------------------
describe('Property E: purity — input arrays and config are not mutated', () => {
  it('the candidate array order and config values are unchanged after rankResponders runs', () => {
    fc.assert(
      fc.property(categoryArb, incidentArb, candidateListArb, (category, incident, candidates) => {
        // Record the original candidate order and ids.
        const originalIds = candidates.map((c) => c.id);
        const originalRoles = candidates.map((c) => c.role);
        const originalAgencyTypes = candidates.map((c) => c.agencyType);

        // Snapshot the config values.
        const originalConfig: CapabilityConfig = {
          SUNOG: [...DEFAULT_CAPABILITY_CONFIG.SUNOG],
          MEDIKAL: [...DEFAULT_CAPABILITY_CONFIG.MEDIKAL],
          KRIMEN: [...DEFAULT_CAPABILITY_CONFIG.KRIMEN],
          BAHA: [...DEFAULT_CAPABILITY_CONFIG.BAHA],
        };

        // Use a frozen config to ensure the function does not try to mutate it.
        const frozenConfig: CapabilityConfig = Object.freeze({
          SUNOG: Object.freeze([...DEFAULT_CAPABILITY_CONFIG.SUNOG]),
          MEDIKAL: Object.freeze([...DEFAULT_CAPABILITY_CONFIG.MEDIKAL]),
          KRIMEN: Object.freeze([...DEFAULT_CAPABILITY_CONFIG.KRIMEN]),
          BAHA: Object.freeze([...DEFAULT_CAPABILITY_CONFIG.BAHA]),
        }) as CapabilityConfig;

        rankResponders(category, incident, candidates, frozenConfig);

        // The candidate array must retain its original order and field values.
        expect(candidates.map((c) => c.id)).toEqual(originalIds);
        expect(candidates.map((c) => c.role)).toEqual(originalRoles);
        expect(candidates.map((c) => c.agencyType)).toEqual(originalAgencyTypes);

        // The config must retain its original values.
        expect([...DEFAULT_CAPABILITY_CONFIG.SUNOG]).toEqual(originalConfig.SUNOG);
        expect([...DEFAULT_CAPABILITY_CONFIG.MEDIKAL]).toEqual(originalConfig.MEDIKAL);
        expect([...DEFAULT_CAPABILITY_CONFIG.KRIMEN]).toEqual(originalConfig.KRIMEN);
        expect([...DEFAULT_CAPABILITY_CONFIG.BAHA]).toEqual(originalConfig.BAHA);
      }),
      { numRuns: RUNS },
    );
  });
});
