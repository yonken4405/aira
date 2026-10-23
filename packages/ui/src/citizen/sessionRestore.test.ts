import { describe, expect, it } from 'vitest';

// TDD red (task 4.1): `./sessionRestore` does not exist yet — task 4.2 implements the pure
// reducer AND exports the `CitizenView` / `CitizenAuthState` / `Connectivity` types. Until
// then this import fails to resolve and the whole suite is red, which is the intended failure
// for this task.
//
// ── Pinned reducer contract (task 4.2 MUST implement exactly this) ──────────────────────────
//
// The reducer is the pure core of the launch / session-restore flow (DESIGN.md §Architecture →
// "Launch / session-restore flow" + §Data Models → "Auth state model", Correctness Property 2,
// R6.1–R6.4). It maps a single launch session-validation *outcome* to the next auth state plus a
// flag saying whether the stored session token must be cleared. It performs NO I/O: the caller
// (AppNavigator / CitizenAuthProvider) reads the token from the SessionStore, performs the
// `GET /api/citizen/session` request, classifies the result into a `RestoreOutcome`, feeds it to
// this reducer, and then applies `clearToken` against the SessionStore. Keeping it pure is what
// makes it unit- and property-testable in `@aira/ui` (DOM-free core).
//
//   // The backend's citizen shape ({ id, email, emailVerified }) — see the "Verified backend
//   // contracts" table in design.md; `email` is null for a device-key identity.
//   type CitizenView = {
//     readonly id: string;
//     readonly email: string | null;
//     readonly emailVerified: boolean;
//   };
//
//   type CitizenAuthState =
//     | { readonly kind: 'anonymous' }
//     | { readonly kind: 'registered'; readonly citizen: CitizenView }
//     | { readonly kind: 'unknown' };
//
//   type Connectivity = 'online' | 'offline' | 'unknown';
//
//   // The launch session-validation outcome, as classified by the caller:
//   //  - noToken      : no token in the SessionStore → no request is made (R6.1 default).
//   //  - validated    : GET /api/citizen/session returned 200 with the citizen (R6.2).
//   //  - unauthenticated : GET returned 401 unauthenticated (R6.3).
//   //  - unreachable  : offline / timeout / network error during validation (R6.4).
//   type RestoreOutcome =
//     | { readonly kind: 'noToken' }
//     | { readonly kind: 'validated'; readonly citizen: CitizenView }
//     | { readonly kind: 'unauthenticated' }
//     | { readonly kind: 'unreachable' };
//
//   type RestoreResult = {
//     readonly state: CitizenAuthState;
//     readonly clearToken: boolean;
//   };
//
//   function sessionRestore(outcome: RestoreOutcome): RestoreResult;
//
// ────────────────────────────────────────────────────────────────────────────────────────────
import {
  sessionRestore,
  type CitizenView,
  type CitizenAuthState,
  type RestoreOutcome,
  type RestoreResult,
} from './sessionRestore';

// A representative citizen as the backend returns it: email may be present (email identity) or
// null (device-key identity). The reducer must carry this through verbatim on `validated`.
const CITIZEN: CitizenView = { id: 'cit_123', email: 'ally@example.ph', emailVerified: false };

describe('sessionRestore reducer — launch outcome → auth state + clearToken (R6.1–R6.4, Property 2)', () => {
  it('no stored token at launch → anonymous, no token clear (R6.1)', () => {
    // Modelled as the `noToken` outcome: the caller never issues a request, so there is nothing
    // to clear and the app stays anonymous with the grid fully interactive.
    const outcome: RestoreOutcome = { kind: 'noToken' };

    const result: RestoreResult = sessionRestore(outcome);

    expect(result.state).toEqual<CitizenAuthState>({ kind: 'anonymous' });
    expect(result.clearToken).toBe(false);
  });

  it('stored token + 200 with citizen → registered(citizen), token retained (R6.2)', () => {
    const outcome: RestoreOutcome = { kind: 'validated', citizen: CITIZEN };

    const result = sessionRestore(outcome);

    expect(result.state).toEqual<CitizenAuthState>({ kind: 'registered', citizen: CITIZEN });
    // The validated citizen is carried through verbatim (including a null email).
    expect(result.state).toMatchObject({ kind: 'registered' });
    if (result.state.kind === 'registered') {
      expect(result.state.citizen).toEqual(CITIZEN);
    }
    expect(result.clearToken).toBe(false);
  });

  it('stored token + 401 unauthenticated → anonymous, token CLEARED (R6.3)', () => {
    const outcome: RestoreOutcome = { kind: 'unauthenticated' };

    const result = sessionRestore(outcome);

    expect(result.state).toEqual<CitizenAuthState>({ kind: 'anonymous' });
    expect(result.clearToken).toBe(true);
  });

  it('stored token + offline/timeout/network error → unknown, token RETAINED (R6.4)', () => {
    const outcome: RestoreOutcome = { kind: 'unreachable' };

    const result = sessionRestore(outcome);

    // Deferred re-validation: keep the token and sit in `unknown` until connectivity returns.
    expect(result.state).toEqual<CitizenAuthState>({ kind: 'unknown' });
    expect(result.clearToken).toBe(false);
  });

  it('only 401 unauthenticated ever clears the token (R6.2/R6.3/R6.4)', () => {
    // Guards the invariant that `clearToken` is true for exactly one outcome.
    expect(sessionRestore({ kind: 'noToken' }).clearToken).toBe(false);
    expect(sessionRestore({ kind: 'validated', citizen: CITIZEN }).clearToken).toBe(false);
    expect(sessionRestore({ kind: 'unreachable' }).clearToken).toBe(false);
    expect(sessionRestore({ kind: 'unauthenticated' }).clearToken).toBe(true);
  });

  it('carries a device-key citizen (null email) through unchanged on validation (R6.2)', () => {
    const deviceCitizen: CitizenView = { id: 'cit_dev', email: null, emailVerified: false };

    const result = sessionRestore({ kind: 'validated', citizen: deviceCitizen });

    expect(result.state).toEqual<CitizenAuthState>({ kind: 'registered', citizen: deviceCitizen });
  });
});
