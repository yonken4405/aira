/**
 * Session-restore reducer for the mobile citizen account launch flow
 * (R6.1–R6.4, DESIGN.md §Architecture → "Launch / session-restore flow" +
 * §Data Models → "Auth state model", Correctness Property 2).
 *
 * This is the pure core of the launch / session-restore flow. It maps a single
 * launch session-validation *outcome* to the next auth state plus a flag saying
 * whether the stored session token must be cleared. It performs NO I/O: the
 * caller (AppNavigator / CitizenAuthProvider) reads the token from the
 * SessionStore, performs the `GET /api/citizen/session` request, classifies the
 * result into a `RestoreOutcome`, feeds it to this reducer, and then applies
 * `clearToken` against the SessionStore. Keeping it pure is what makes it unit-
 * and property-testable in `@aira/ui` (DOM-free core).
 */

/**
 * The backend's citizen shape ({ id, email, emailVerified }) — see the
 * "Verified backend contracts" table in design.md; `email` is null for a
 * device-key identity.
 */
export type CitizenView = {
  readonly id: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
};

/** The resolved citizen auth state after a launch session-restore. */
export type CitizenAuthState =
  | { readonly kind: 'anonymous' }
  | { readonly kind: 'registered'; readonly citizen: CitizenView }
  | { readonly kind: 'unknown' };

/** Connectivity classification used by the caller when deciding the outcome. */
export type Connectivity = 'online' | 'offline' | 'unknown';

/**
 * The launch session-validation outcome, as classified by the caller:
 *  - noToken         : no token in the SessionStore → no request is made (R6.1 default).
 *  - validated       : GET /api/citizen/session returned 200 with the citizen (R6.2).
 *  - unauthenticated : GET returned 401 unauthenticated (R6.3).
 *  - unreachable     : offline / timeout / network error during validation (R6.4).
 */
export type RestoreOutcome =
  | { readonly kind: 'noToken' }
  | { readonly kind: 'validated'; readonly citizen: CitizenView }
  | { readonly kind: 'unauthenticated' }
  | { readonly kind: 'unreachable' };

/** The reducer result: the next auth state plus whether to clear the stored token. */
export type RestoreResult = {
  readonly state: CitizenAuthState;
  readonly clearToken: boolean;
};

/**
 * Map a launch session-validation outcome to the next auth state and a
 * token-clear flag.
 *
 *  - noToken         → anonymous, token retained (R6.1).
 *  - validated       → registered(citizen), token retained (R6.2).
 *  - unauthenticated → anonymous, token CLEARED (R6.3).
 *  - unreachable     → unknown, token retained (R6.4, deferred re-validation).
 *
 * `clearToken` is true for exactly one outcome: `unauthenticated`.
 */
export function sessionRestore(outcome: RestoreOutcome): RestoreResult {
  switch (outcome.kind) {
    case 'noToken':
      return { state: { kind: 'anonymous' }, clearToken: false };
    case 'validated':
      return { state: { kind: 'registered', citizen: outcome.citizen }, clearToken: false };
    case 'unauthenticated':
      return { state: { kind: 'anonymous' }, clearToken: true };
    case 'unreachable':
      return { state: { kind: 'unknown' }, clearToken: false };
  }
}
