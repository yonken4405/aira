import { describe, expect, it } from 'vitest';

// TDD red (task 5.1): `./deviceAuthSequence` does not exist yet — task 5.2 implements the pure
// model AND exports its types. Until then this import fails to resolve and the whole suite is
// red, which is the intended failure for this task.
//
// ── Pinned model contract (task 5.2 MUST implement exactly this) ────────────────────────────
//
// This is the DOM-free, deterministic core of the device-key authentication control flow
// (DESIGN.md §Components and Interfaces → `CitizenAuthProvider.deviceAuth`, §Error Handling →
// the "Device-key path" bullet, Correctness Property 6, R3.2 / R3.5 / R3.6). It performs NO I/O
// and no key generation side effects: the caller (CitizenAuthProvider) owns the SessionStore
// and the real `/api/citizen/device` request. The caller feeds this model the initial
// stored-key state, the ordered list of `/device` response *outcomes* it would observe, and a
// pure `generateKey()` thunk (injected so the model stays deterministic under test — the app
// supplies `generateDeviceKey(expo-crypto getRandomBytes)`). The model returns how many
// requests were issued, whether the run ends holding a session, the final key that must remain
// in the SessionStore, and the error copy key (if any) to surface.
//
// The exact rules this model encodes (from the design's Device-key path bullet, verbatim
// intent):
//   • Reuse-first (R3.2): if a valid stored key already exists, use it rather than generating a
//     new one; generation happens ONLY when no stored key exists.
//   • Bounded retry (R3.5): a single `400 invalid_device_key` discards the stored key,
//     regenerates a new key, and retries ONCE; a second `invalid_device_key` stops with no
//     session and the retry-failed copy, RETAINING the newly generated key.
//   • Session IFF a 200 (R3.4 / Property 6): the run ends holding a session if and only if some
//     issued request's outcome was `ok`.
//   • At most TWO `/device` requests are ever issued (Property 6).
//   • Any `other` / `timeout` / `network` outcome (R3.6) keeps the EXISTING key, ends
//     pre-registration (no session), and does NOT consume the retry budget reserved for
//     `invalid_device_key` — it simply stops.
//
//   /** A single `/api/citizen/device` response outcome, as classified by the caller. */
//   type DeviceOutcome =
//     | { readonly kind: 'ok' }                 // 200: register-or-login succeeded
//     | { readonly kind: 'invalid_device_key' } // 400 invalid_device_key
//     | { readonly kind: 'other' }              // any other non-200 HTTP status
//     | { readonly kind: 'timeout' }            // exceeded the 10s deadline
//     | { readonly kind: 'network' };           // fetch threw a network error
//
//   /** The copy key surfaced to the screen; see the design's error→copy table. */
//   type DeviceCopyKey = 'citizenDeviceRetryFailed' | 'citizenDeviceUnavailable';
//
//   interface DeviceAuthInput {
//     /** The device key already in the SessionStore, or null when none exists. */
//     readonly storedKey: string | null;
//     /** The ordered `/device` outcomes the caller observes, one per issued request. */
//     readonly outcomes: readonly DeviceOutcome[];
//     /** Pure key generator (injected). Called only when a new key must be produced. */
//     readonly generateKey: () => string;
//   }
//
//   interface DeviceAuthResult {
//     /** Number of `/device` requests issued — always 0, 1, or 2 (never > 2). */
//     readonly requestsIssued: number;
//     /** True iff some issued outcome was `ok` (a 200). */
//     readonly endedWithSession: boolean;
//     /** The key that must remain in the SessionStore after the run (may be null). */
//     readonly finalStoredKey: string | null;
//     /** Error copy key to show, present only on a non-session outcome. */
//     readonly copyKey?: DeviceCopyKey;
//   }
//
//   function runDeviceAuthSequence(input: DeviceAuthInput): DeviceAuthResult;
//
// ────────────────────────────────────────────────────────────────────────────────────────────
import {
  runDeviceAuthSequence,
  type DeviceAuthInput,
  type DeviceAuthResult,
  type DeviceOutcome,
} from './deviceAuthSequence';

/** The stored key the happy-path tests reuse (43-char base64url, server DEVICE_KEY_PATTERN). */
const STORED_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
/** The key the injected generator produces when a new key must be minted. */
const GENERATED_KEY = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

/**
 * A `generateKey` thunk that records how many times it was invoked, so tests can assert the
 * reuse-first rule (generation happens ONLY when no stored key exists / on regeneration).
 */
function recordingGenerator(key: string): { generateKey: () => string; readonly calls: number[] } {
  const state = { calls: [] as number[] };
  let next = 0;
  return {
    generateKey: () => {
      next += 1;
      state.calls.push(next);
      return key;
    },
    get calls() {
      return state.calls;
    },
  };
}

describe('runDeviceAuthSequence — bounded, reuse-first device-key retry (R3.2/R3.5/R3.6, Property 6)', () => {
  it('reuses an existing valid stored key on 200: no generation, one request, session (R3.2/R3.4)', () => {
    const gen = recordingGenerator(GENERATED_KEY);
    const input: DeviceAuthInput = {
      storedKey: STORED_KEY,
      outcomes: [{ kind: 'ok' }],
      generateKey: gen.generateKey,
    };

    const result: DeviceAuthResult = runDeviceAuthSequence(input);

    // Reuse-first: a valid stored key is used verbatim, the generator is never called (R3.2).
    expect(gen.calls).toHaveLength(0);
    expect(result.requestsIssued).toBe(1);
    expect(result.endedWithSession).toBe(true);
    expect(result.finalStoredKey).toBe(STORED_KEY);
    expect(result.copyKey).toBeUndefined();
  });

  it('generates a key when none is stored, then succeeds on 200 (R3.1 generation only when absent)', () => {
    const gen = recordingGenerator(GENERATED_KEY);
    const input: DeviceAuthInput = {
      storedKey: null,
      outcomes: [{ kind: 'ok' }],
      generateKey: gen.generateKey,
    };

    const result = runDeviceAuthSequence(input);

    // No stored key → exactly one generation before the first request.
    expect(gen.calls).toHaveLength(1);
    expect(result.requestsIssued).toBe(1);
    expect(result.endedWithSession).toBe(true);
    expect(result.finalStoredKey).toBe(GENERATED_KEY);
    expect(result.copyKey).toBeUndefined();
  });

  it('single 400 invalid_device_key → discard+regenerate, retry ONCE, then 200 succeeds (R3.5)', () => {
    const gen = recordingGenerator(GENERATED_KEY);
    const input: DeviceAuthInput = {
      storedKey: STORED_KEY,
      outcomes: [{ kind: 'invalid_device_key' }, { kind: 'ok' }],
      generateKey: gen.generateKey,
    };

    const result = runDeviceAuthSequence(input);

    // Exactly one regeneration (the discard+regenerate on the single retry), two requests, and
    // the run ends holding a session on the retried 200; the NEW key is retained.
    expect(gen.calls).toHaveLength(1);
    expect(result.requestsIssued).toBe(2);
    expect(result.endedWithSession).toBe(true);
    expect(result.finalStoredKey).toBe(GENERATED_KEY);
    expect(result.copyKey).toBeUndefined();
  });

  it('two invalid_device_key in a row → no session, retry-failed copy, keeps the NEW key (R3.5)', () => {
    const gen = recordingGenerator(GENERATED_KEY);
    const input: DeviceAuthInput = {
      storedKey: STORED_KEY,
      outcomes: [{ kind: 'invalid_device_key' }, { kind: 'invalid_device_key' }],
      generateKey: gen.generateKey,
    };

    const result = runDeviceAuthSequence(input);

    // The single retry is exhausted: stop with no session, retain the regenerated key (R3.5).
    expect(gen.calls).toHaveLength(1);
    expect(result.requestsIssued).toBe(2);
    expect(result.endedWithSession).toBe(false);
    expect(result.finalStoredKey).toBe(GENERATED_KEY);
    expect(result.copyKey).toBe('citizenDeviceRetryFailed');
  });

  it('never issues more than TWO requests even if more outcomes are supplied (Property 6)', () => {
    const gen = recordingGenerator(GENERATED_KEY);
    const input: DeviceAuthInput = {
      storedKey: STORED_KEY,
      outcomes: [
        { kind: 'invalid_device_key' },
        { kind: 'invalid_device_key' },
        { kind: 'ok' },
        { kind: 'ok' },
      ],
      generateKey: gen.generateKey,
    };

    const result = runDeviceAuthSequence(input);

    // The third/fourth outcomes are never consumed — the retry budget caps at two requests.
    expect(result.requestsIssued).toBe(2);
    expect(result.endedWithSession).toBe(false);
    expect(result.copyKey).toBe('citizenDeviceRetryFailed');
  });

  it.each<DeviceOutcome['kind']>(['other', 'timeout', 'network'])(
    'a first %s outcome keeps the existing key, ends pre-registration, no retry consumed (R3.6)',
    (kind) => {
      const gen = recordingGenerator(GENERATED_KEY);
      const input: DeviceAuthInput = {
        storedKey: STORED_KEY,
        // A following `ok` MUST NOT be reached: `other`/`timeout`/`network` stops immediately
        // without spending the invalid_device_key retry budget.
        outcomes: [{ kind }, { kind: 'ok' }],
        generateKey: gen.generateKey,
      };

      const result = runDeviceAuthSequence(input);

      expect(gen.calls).toHaveLength(0); // existing key kept, nothing regenerated (R3.6)
      expect(result.requestsIssued).toBe(1); // stop after the first non-retryable outcome
      expect(result.endedWithSession).toBe(false);
      expect(result.finalStoredKey).toBe(STORED_KEY);
      expect(result.copyKey).toBe('citizenDeviceUnavailable');
    },
  );

  it('invalid_device_key then a transient outcome → retried once, keeps NEW key, unavailable copy (R3.5/R3.6)', () => {
    const gen = recordingGenerator(GENERATED_KEY);
    const input: DeviceAuthInput = {
      storedKey: STORED_KEY,
      outcomes: [{ kind: 'invalid_device_key' }, { kind: 'timeout' }],
      generateKey: gen.generateKey,
    };

    const result = runDeviceAuthSequence(input);

    // The retry was spent on the invalid key (regenerating), then the retried request hit a
    // transient failure: no session, the newly generated key is retained (R3.6 keeps the
    // current — now regenerated — key), and the unavailable copy is shown.
    expect(gen.calls).toHaveLength(1);
    expect(result.requestsIssued).toBe(2);
    expect(result.endedWithSession).toBe(false);
    expect(result.finalStoredKey).toBe(GENERATED_KEY);
    expect(result.copyKey).toBe('citizenDeviceUnavailable');
  });

  it('ends holding a session IFF some issued outcome was `ok` (Property 6 biconditional)', () => {
    const gen = recordingGenerator(GENERATED_KEY);

    // No `ok` anywhere in the (bounded) issued prefix → no session.
    const noOk = runDeviceAuthSequence({
      storedKey: STORED_KEY,
      outcomes: [{ kind: 'invalid_device_key' }, { kind: 'invalid_device_key' }],
      generateKey: gen.generateKey,
    });
    expect(noOk.endedWithSession).toBe(false);

    // An `ok` in the issued prefix → session.
    const withOk = runDeviceAuthSequence({
      storedKey: STORED_KEY,
      outcomes: [{ kind: 'invalid_device_key' }, { kind: 'ok' }],
      generateKey: gen.generateKey,
    });
    expect(withOk.endedWithSession).toBe(true);
  });
});
