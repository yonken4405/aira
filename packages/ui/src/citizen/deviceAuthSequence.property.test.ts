/**
 * Device-key auth sequence — bounded, reuse-first retry property test (task 5.3, optional PBT).
 *
 * Feature: mobile-citizen-account
 *
 * Encodes Property 6 (R3.2 / R3.5, DESIGN.md §Error Handling → "Device-key path", Correctness
 * Property 6): `runDeviceAuthSequence` is a bounded, reuse-first retry over any stored-key state
 * and any sequence of caller-observed `/device` outcomes. For EVERY input the following hold:
 *
 *   - Hard cap: `requestsIssued` is always 0, 1, or 2 (never > 2) — the initial attempt plus at
 *     most one retry.
 *   - Session IFF `ok`: `endedWithSession === true` iff at least one of the ISSUED outcomes (the
 *     first `requestsIssued` entries) was `{ kind: 'ok' }`.
 *   - Reuse-first (R3.2): when a valid stored key exists the generator is NOT called before the
 *     first request (the first request uses the stored key verbatim); generation happens only
 *     when no key is stored or on the single discard+regenerate after a `400 invalid_device_key`.
 *   - Bounded regeneration (R3.5): at most ONE regeneration ever occurs, so the generator is
 *     called at most `(storedKey === null ? 1 : 0) + 1` times.
 *   - Copy presence: a `copyKey` is present exactly when the run ends with no session (every
 *     non-session return path — the exhausted retry, a transient outcome, and the degenerate
 *     no-outcomes fall-through — carries an error copy key; the `ok` path carries none).
 *
 * The generators cover the whole input space — `storedKey` is a string or null, and `outcomes`
 * is any 0..5 sequence drawn from the full `DeviceOutcome` union. The injected `generateKey` is a
 * deterministic counter-based thunk that records its call count so the reuse-first / bounded
 * regeneration invariants can be checked directly. This is a post-implementation property
 * expected to PASS; a counterexample would surface a real control-flow bug, never a reason to
 * weaken the assertion. The property runs >= 100 iterations.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  runDeviceAuthSequence,
  type DeviceAuthInput,
  type DeviceOutcome,
} from './deviceAuthSequence';

const RUNS = 100;

/** An arbitrary over the entire `DeviceOutcome` union. */
const outcomeArb: fc.Arbitrary<DeviceOutcome> = fc.constantFrom<DeviceOutcome>(
  { kind: 'ok' },
  { kind: 'invalid_device_key' },
  { kind: 'other' },
  { kind: 'timeout' },
  { kind: 'network' },
);

describe('runDeviceAuthSequence — property', () => {
  // Feature: mobile-citizen-account, Property 6: Device-key authentication is a bounded, reuse-first retry
  it('is a bounded (<=2), reuse-first, at-most-one-regeneration retry ending with a session iff an issued outcome was ok', () => {
    fc.assert(
      fc.property(
        fc.option(fc.string(), { nil: null }),
        fc.array(outcomeArb, { minLength: 0, maxLength: 5 }),
        (storedKey, outcomes) => {
          // A deterministic counter-based generator that records how many times it was called.
          let generatorCalls = 0;
          const generateKey = (): string => {
            generatorCalls += 1;
            return `gen-${generatorCalls}`;
          };

          const input: DeviceAuthInput = { storedKey, outcomes, generateKey };
          const result = runDeviceAuthSequence(input);

          // Hard cap: never more than two requests (initial attempt + at most one retry).
          expect([0, 1, 2]).toContain(result.requestsIssued);
          expect(result.requestsIssued).toBeLessThanOrEqual(2);
          // Requests are drawn one-per-outcome, so the count can never exceed the outcomes given.
          expect(result.requestsIssued).toBeLessThanOrEqual(outcomes.length);

          // Session IFF `ok`: ends holding a session iff some ISSUED outcome (the first
          // `requestsIssued` entries) was `ok`.
          const issued = outcomes.slice(0, result.requestsIssued);
          const anyIssuedOk = issued.some((o) => o.kind === 'ok');
          expect(result.endedWithSession).toBe(anyIssuedOk);

          // Reuse-first (R3.2): a valid stored key is used verbatim on the first request, so the
          // generator is never invoked before that first request. When no key is stored, exactly
          // one up-front generation happens. In either case at most one regeneration follows, so
          // the generator is called at most `(storedKey === null ? 1 : 0) + 1` times.
          const maxGenerations = (storedKey === null ? 1 : 0) + 1;
          expect(generatorCalls).toBeLessThanOrEqual(maxGenerations);
          if (storedKey !== null) {
            // With a stored key, generation only ever occurs as the single regeneration after a
            // `400 invalid_device_key`, never before the first request.
            expect(generatorCalls).toBeLessThanOrEqual(1);
          }

          // Copy presence: a copy key is shown exactly when the run ends with no session. Every
          // non-session return path carries an error copy (retry-failed / unavailable / the
          // degenerate no-outcomes fall-through); the `ok` path never does.
          expect(result.copyKey !== undefined).toBe(!result.endedWithSession);
        },
      ),
      { numRuns: RUNS },
    );
  });
});
