/**
 * Grid-invariance property test for `AppNavigator` (mobile-citizen-account spec,
 * task 13.1 — TDD RED; implementation is task 13.2).
 *
 * The module under test does NOT exist yet: `../AppNavigator` is the expected red.
 * This file pins the exact component contract task 13.2 must satisfy and proves
 * Correctness Property 1 across every auth × connectivity combination.
 *
 * ── PINNED CONTRACT FOR TASK 13.2 (design §1 "AppNavigator", §"Navigation decision") ──
 *
 *   import { AppNavigator } from '../AppNavigator';
 *
 *   // Props — client + store are injectable for tests (default to the real ones).
 *   interface AppNavigatorProps {
 *     readonly client?: CitizenApiClient;   // from ../../api/citizenClient
 *     readonly store?: SessionStore;         // from ../../storage/sessionStore
 *   }
 *
 * Behaviour the navigator MUST honour (verified below):
 *   - A small union-typed `Screen` state machine; the DEFAULT screen is the grid
 *     (`{ name: 'grid' }`). The grid (`EmergencyGridScreen`) is the always-mounted
 *     root and is the first interactive screen on mount (R1.1).
 *   - The grid renders with its current props/behaviour VERBATIM — it is FROZEN. The
 *     navigator does NOT pass a `transport`, so the grid uses its default mock-mesh
 *     transport whose `onWire` logs the exact frozen wire string via `console.log`
 *     (exactly how `EmergencyGridScreen.test.tsx` observes payloads). All four
 *     `testID="sos-<ID>"` buttons submit without being blocked/disabled/delayed (R1.2/R1.6/R11.3).
 *   - A SINGLE secondary affordance on the grid header switches to `accountHub`:
 *       testID="open-account-hub"   (a lucide-react-native account icon button) (R1.3).
 *     The grid stays mounted underneath; switching back is free — no auth gate (R1.5):
 *       testID="account-hub-back"   returns to the grid.
 *   - The navigator runs the launch session-restore effect, but the grid is interactive
 *     before and during it (R1.4/R6.1/R6.4) — the grid subscribes to NONE of the auth
 *     or connectivity state (this is Correctness Property 1).
 *
 * Requirements: 1.1, 1.2, 1.4, 1.5, 1.6, 11.3.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import fc from 'fast-check';
import type { CitizenView, Connectivity } from '@aira/ui';

import type { ApiResult, CitizenApiClient } from '../../api/citizenClient';
import type { SessionStore } from '../../storage/sessionStore';

// The module under test — does not exist until task 13.2 (expected TDD red).
import { AppNavigator } from '../AppNavigator';

const CITIZEN: CitizenView = { id: 'c-1', email: 'c@example.com', emailVerified: false };

/** The frozen four-category closed enum and the exact wire string each press must emit. */
const EXPECTED_WIRE: Readonly<Record<string, string>> = {
  SUNOG: '["SUNOG",10.3157,123.8854]',
  MEDIKAL: '["MEDIKAL",10.3157,123.8854]',
  KRIMEN: '["KRIMEN",10.3157,123.8854]',
  BAHA: '["BAHA",10.3157,123.8854]',
};
const CATEGORIES = Object.keys(EXPECTED_WIRE) as readonly string[];

/**
 * The target auth state the navigator should settle into after launch session-restore.
 * The navigator derives this from the injected store+client, so each case is driven by
 * configuring those doubles rather than by poking the navigator directly.
 */
type TargetAuth = 'anonymous' | 'registered' | 'unknown';

const okResult = (data: CitizenView): ApiResult<CitizenView> => ({ ok: true, status: 200, data });
const httpError = (status: number, code: string): ApiResult<never> => ({
  ok: false,
  kind: 'http',
  status,
  code,
});
const offline = (): ApiResult<never> => ({ ok: false, kind: 'offline' });

/** An in-memory SessionStore double. A token present at launch drives the restore path. */
function makeStore(token: string | null): SessionStore {
  let session: string | null = token;
  let deviceKey: string | null = null;
  return {
    getSessionToken: jest.fn(async () => session),
    setSessionToken: jest.fn(async (v: string) => {
      session = v;
    }),
    clearSessionToken: jest.fn(async () => {
      session = null;
    }),
    getDeviceKey: jest.fn(async () => deviceKey),
    setDeviceKey: jest.fn(async (v: string) => {
      deviceKey = v;
    }),
    clearDeviceKey: jest.fn(async () => {
      deviceKey = null;
    }),
  };
}

/** A stubbed client whose `getSession` outcome places the provider in the target state. */
function makeClient(getSession: () => Promise<ApiResult<CitizenView>>): CitizenApiClient {
  const unimplemented = (name: string) => async (): Promise<never> => {
    throw new Error(`client.${name} not stubbed for this test`);
  };
  return {
    register: unimplemented('register') as CitizenApiClient['register'],
    login: unimplemented('login') as CitizenApiClient['login'],
    deviceAuth: unimplemented('deviceAuth') as CitizenApiClient['deviceAuth'],
    getSession: jest.fn(getSession) as CitizenApiClient['getSession'],
    logout: async () => ({ ok: true, status: 204, data: undefined }),
    getMedical: unimplemented('getMedical') as CitizenApiClient['getMedical'],
    putMedical: unimplemented('putMedical') as CitizenApiClient['putMedical'],
    deleteMedical: unimplemented('deleteMedical') as CitizenApiClient['deleteMedical'],
    deleteAccount: async () => ({ ok: true, status: 204, data: undefined }),
  };
}

/**
 * Build the injectable `{ client, store }` pair that drives the launch session-restore
 * toward `target`:
 *   - anonymous  → no stored token (no /session request, reducer → anonymous), OR a
 *                  token with a `401 unauthenticated` reply (reducer → anonymous + clear).
 *   - registered → stored token with a `200` reply (reducer → registered).
 *   - unknown    → stored token with an offline reply (reducer → unknown, token retained).
 */
function makeDeps(
  target: TargetAuth,
  connectivity: Connectivity,
): { client: CitizenApiClient; store: SessionStore } {
  switch (target) {
    case 'registered':
      return { store: makeStore('tok'), client: makeClient(async () => okResult(CITIZEN)) };
    case 'unknown':
      return { store: makeStore('tok'), client: makeClient(async () => offline()) };
    case 'anonymous':
    default:
      // When connectivity is 'online' exercise the 401-clears path; otherwise the
      // no-token path. Both land the navigator in `anonymous`.
      return connectivity === 'online'
        ? {
            store: makeStore('tok'),
            client: makeClient(async () => httpError(401, 'unauthenticated')),
          }
        : { store: makeStore(null), client: makeClient(async () => offline()) };
  }
}

describe('AppNavigator — grid invariance (Property 1)', () => {
  let logSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  // Feature: mobile-citizen-account, Property 1: The SOS grid is interactive under every auth and connectivity state
  it('keeps the SOS grid the first interactive screen, never gated, across every auth × connectivity state', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<TargetAuth>('anonymous', 'registered', 'unknown'),
        fc.constantFrom<Connectivity>('online', 'offline', 'unknown'),
        fc.constantFrom(...CATEGORIES),
        async (target, connectivity, category) => {
          logSpy.mockClear();
          const { client, store } = makeDeps(target, connectivity);

          const view = await render(<AppNavigator client={client} store={store} />);
          try {
            // 1. The grid is the first interactive screen on mount: all four buttons
            //    are present immediately, before/during session-restore (R1.1/R1.4/R11.3).
            for (const id of CATEGORIES) {
              expect(screen.getByTestId(`sos-${id}`)).toBeTruthy();
            }

            // 2. A Tier-0 action submits without being blocked/disabled/delayed: the
            //    press emits the exact frozen wire string synchronously (R1.2/R1.6).
            await fireEvent.press(screen.getByTestId(`sos-${category}`));
            await waitFor(() => expect(logSpy).toHaveBeenCalledWith(EXPECTED_WIRE[category]));

            // 3. Switching to the secondary screen and back requires no auth (R1.3/R1.5).
            await fireEvent.press(screen.getByTestId('open-account-hub'));
            await fireEvent.press(screen.getByTestId('account-hub-back'));

            // Back on the grid, every category still submits — the grid was never gated.
            for (const id of CATEGORIES) {
              expect(screen.getByTestId(`sos-${id}`)).toBeTruthy();
            }
            logSpy.mockClear();
            await fireEvent.press(screen.getByTestId(`sos-${category}`));
            await waitFor(() => expect(logSpy).toHaveBeenCalledWith(EXPECTED_WIRE[category]));
          } finally {
            // Let any pending launch session-restore effect settle, then unmount so each
            // fast-check iteration is isolated (no leaked timers/subscriptions).
            await act(async () => {
              await Promise.resolve();
            });
            view.unmount();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
