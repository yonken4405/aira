/**
 * Bounded, reuse-first device-key authentication control flow for the mobile citizen
 * account (R3.2 / R3.5 / R3.6, DESIGN.md §Components and Interfaces →
 * `CitizenAuthProvider.deviceAuth`, §Error Handling "Device-key path", Correctness
 * Property 6).
 *
 * DOM-free and deterministic: this is the pure core of the `/api/citizen/device`
 * control flow. It performs NO I/O and no key-generation side effects — the caller
 * (`CitizenAuthProvider`) owns the SessionStore and the real `/device` request. The
 * caller feeds this model the initial stored-key state, the ordered list of `/device`
 * response outcomes it would observe, and a pure `generateKey()` thunk (injected so the
 * model stays deterministic; the app supplies `generateDeviceKey(expo-crypto)`).
 *
 * Encoded rules:
 *   • Reuse-first (R3.2): a valid stored key is used verbatim; generation happens ONLY
 *     when no stored key exists, or on the discard+regenerate during the single retry.
 *   • Bounded retry (R3.5): a single `invalid_device_key` discards the stored key,
 *     regenerates once, and retries ONCE; a second `invalid_device_key` stops with no
 *     session and the retry-failed copy, RETAINING the newly generated key.
 *   • Session IFF `ok` (R3.4 / Property 6): ends holding a session iff some issued
 *     outcome was `ok`.
 *   • At most TWO `/device` requests are ever issued (Property 6).
 *   • `other` / `timeout` / `network` (R3.6): keep the current key, end pre-registration
 *     (no session), and do NOT consume the `invalid_device_key` retry budget — stop.
 */

/** A single `/api/citizen/device` response outcome, as classified by the caller. */
export type DeviceOutcome =
  | { readonly kind: 'ok' } // 200: register-or-login succeeded
  | { readonly kind: 'invalid_device_key' } // 400 invalid_device_key
  | { readonly kind: 'other' } // any other non-200 HTTP status
  | { readonly kind: 'timeout' } // exceeded the 10s deadline
  | { readonly kind: 'network' }; // fetch threw a network error

/** The copy key surfaced to the screen; see the design's error→copy table. */
export type DeviceCopyKey = 'citizenDeviceRetryFailed' | 'citizenDeviceUnavailable';

export interface DeviceAuthInput {
  /** The device key already in the SessionStore, or null when none exists. */
  readonly storedKey: string | null;
  /** The ordered `/device` outcomes the caller observes, one per issued request. */
  readonly outcomes: readonly DeviceOutcome[];
  /** Pure key generator (injected). Called only when a new key must be produced. */
  readonly generateKey: () => string;
}

export interface DeviceAuthResult {
  /** Number of `/device` requests issued — always 0, 1, or 2 (never > 2). */
  readonly requestsIssued: number;
  /** True iff some issued outcome was `ok` (a 200). */
  readonly endedWithSession: boolean;
  /** The key that must remain in the SessionStore after the run (may be null). */
  readonly finalStoredKey: string | null;
  /** Error copy key to show, present only on a non-session outcome. */
  readonly copyKey?: DeviceCopyKey;
}

/** Hard cap on issued requests (Property 6): the initial attempt plus one retry. */
const MAX_REQUESTS = 2;

/**
 * Run the bounded, reuse-first device-key sequence against the caller-observed outcomes.
 *
 * Pure and deterministic: all randomness enters through `input.generateKey`.
 */
export function runDeviceAuthSequence(input: DeviceAuthInput): DeviceAuthResult {
  // Reuse-first (R3.2): mint a key only when none is stored.
  let currentKey: string | null =
    input.storedKey === null ? input.generateKey() : input.storedKey;

  let requestsIssued = 0;
  let retriedOnInvalidKey = false;

  while (requestsIssued < MAX_REQUESTS) {
    const outcome = input.outcomes[requestsIssued];

    // No more outcomes supplied by the caller — nothing left to issue.
    if (outcome === undefined) {
      break;
    }

    requestsIssued += 1;

    switch (outcome.kind) {
      case 'ok':
        // Session IFF a 200 (R3.4 / Property 6): retain the key that was issued.
        return {
          requestsIssued,
          endedWithSession: true,
          finalStoredKey: currentKey,
        };

      case 'invalid_device_key':
        if (retriedOnInvalidKey) {
          // Second invalid key: retry budget exhausted — stop, keep the regenerated key.
          return {
            requestsIssued,
            endedWithSession: false,
            finalStoredKey: currentKey,
            copyKey: 'citizenDeviceRetryFailed',
          };
        }
        // First invalid key: discard + regenerate (R3.5), then retry once.
        retriedOnInvalidKey = true;
        currentKey = input.generateKey();
        break;

      case 'other':
      case 'timeout':
      case 'network':
        // Transient / non-retryable (R3.6): stop immediately, keep the current key, do not
        // consume the invalid_device_key retry budget.
        return {
          requestsIssued,
          endedWithSession: false,
          finalStoredKey: currentKey,
          copyKey: 'citizenDeviceUnavailable',
        };
    }
  }

  // Reached the request cap with the last issued outcome being an invalid key (the retry was
  // spent regenerating): stop with no session, retain the regenerated key.
  return {
    requestsIssued,
    endedWithSession: false,
    finalStoredKey: currentKey,
    copyKey: 'citizenDeviceRetryFailed',
  };
}
