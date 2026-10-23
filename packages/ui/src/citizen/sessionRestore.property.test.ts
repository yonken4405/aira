/**
 * Session-restore reducer — launch-outcome mapping property test (task 4.3, optional PBT).
 *
 * Feature: mobile-citizen-account
 *
 * Encodes Property 2 (R6.1–R6.4, DESIGN.md §Architecture → "Launch / session-restore flow" +
 * §Data Models → "Auth state model"): the pure `sessionRestore` reducer maps EVERY launch
 * session-validation `RestoreOutcome` to the exact next auth state + token-clear flag the spec
 * pins:
 *
 *   - noToken         → { state: anonymous,                   clearToken: false }  (R6.1)
 *   - validated       → { state: registered(citizen verbatim), clearToken: false }  (R6.2)
 *   - unauthenticated → { state: anonymous,                   clearToken: true  }  (R6.3)
 *   - unreachable     → { state: unknown,                     clearToken: false }  (R6.4)
 *
 * and the single-outcome invariant: `clearToken === true` iff the outcome is `unauthenticated`.
 *
 * The input space is the whole `RestoreOutcome` union, so the generator covers all four kinds;
 * the `validated` arm carries a freely generated `CitizenView` (id, email string|null,
 * emailVerified boolean) which the reducer must carry through verbatim. This is a
 * post-implementation property expected to PASS; a counterexample would surface a real mapping
 * bug, never a reason to weaken the assertion. The property runs >= 100 iterations.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  sessionRestore,
  type CitizenView,
  type RestoreOutcome,
  type RestoreResult,
} from './sessionRestore';

const RUNS = 100;

/** A freely generated `CitizenView`: email may be a string (email identity) or null (device-key). */
const citizenArb: fc.Arbitrary<CitizenView> = fc.record({
  id: fc.string(),
  email: fc.option(fc.string(), { nil: null }),
  emailVerified: fc.boolean(),
});

/** An arbitrary over the entire `RestoreOutcome` union. */
const outcomeArb: fc.Arbitrary<RestoreOutcome> = fc.oneof(
  fc.constant<RestoreOutcome>({ kind: 'noToken' }),
  fc.constant<RestoreOutcome>({ kind: 'unauthenticated' }),
  fc.constant<RestoreOutcome>({ kind: 'unreachable' }),
  citizenArb.map<RestoreOutcome>((citizen) => ({ kind: 'validated', citizen })),
);

describe('sessionRestore — property', () => {
  // Feature: mobile-citizen-account, Property 2: Session-restore maps each launch outcome to the correct state
  it('maps every launch outcome to the pinned state + clearToken, clearing only on unauthenticated', () => {
    fc.assert(
      fc.property(outcomeArb, (outcome) => {
        const result: RestoreResult = sessionRestore(outcome);

        // The spec mapping, exactly, for each outcome kind.
        switch (outcome.kind) {
          case 'noToken':
            expect(result).toEqual<RestoreResult>({ state: { kind: 'anonymous' }, clearToken: false });
            break;
          case 'validated':
            // The validated citizen is carried through verbatim (including a null email).
            expect(result).toEqual<RestoreResult>({
              state: { kind: 'registered', citizen: outcome.citizen },
              clearToken: false,
            });
            break;
          case 'unauthenticated':
            expect(result).toEqual<RestoreResult>({ state: { kind: 'anonymous' }, clearToken: true });
            break;
          case 'unreachable':
            expect(result).toEqual<RestoreResult>({ state: { kind: 'unknown' }, clearToken: false });
            break;
        }

        // Invariant: the token is cleared for exactly one outcome — `unauthenticated`.
        expect(result.clearToken).toBe(outcome.kind === 'unauthenticated');
      }),
      { numRuns: RUNS },
    );
  });
});
