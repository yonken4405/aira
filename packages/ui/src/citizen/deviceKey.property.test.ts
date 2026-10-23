/**
 * `generateDeviceKey` — key-format property test (task 1.4, optional PBT).
 *
 * Feature: mobile-citizen-account
 *
 * Encodes the key-format piece of Property 6 (R3.1, DESIGN.md §6): the generated
 * device key MUST always match the server's `DEVICE_KEY_PATTERN`
 * (`/^[A-Za-z0-9_-]{43}$/`) — 43 chars of base64url with no `+`, `/`, or `=`
 * padding — for ANY 32 bytes of injected randomness.
 *
 * The randomness source is injected, so the property models the input space
 * directly with a 32-byte `Uint8Array` generator wrapped into the `randomBytes`
 * thunk `generateDeviceKey` expects. Every case is deterministic: the bytes are
 * drawn from the generated case, no real CSPRNG. The property runs >= 100
 * iterations.
 *
 * This is a post-implementation property: it encodes an invariant the function
 * already satisfies and is EXPECTED TO PASS. A failing case would surface a real
 * format bug (reported with its counterexample), never a reason to weaken it.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { generateDeviceKey } from './deviceKey';

const RUNS = 100;

/** The server's DEVICE_KEY_PATTERN: base64url of 32 bytes is 43 chars, no padding. */
const DEVICE_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

describe('generateDeviceKey — property', () => {
  // Feature: mobile-citizen-account, Property 6 (key-format piece): Generated device keys always match the server pattern
  it('returns a 43-char server-pattern base64url key for any 32 random bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 32, maxLength: 32 }), (bytes) => {
        const key = generateDeviceKey(() => bytes);

        expect(key).toMatch(DEVICE_KEY_PATTERN);
      }),
      { numRuns: RUNS },
    );
  });
});
