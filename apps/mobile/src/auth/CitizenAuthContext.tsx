/**
 * `CitizenAuthProvider` + `useCitizenAuth` — the mobile citizen app's auth state
 * machine (mobile-citizen-account spec, task 12.2; design §2 "CitizenAuthProvider +
 * useCitizenAuth").
 *
 * This React context wraps the injected `CitizenApiClient` and `SessionStore` and keeps
 * the `CitizenAuthState` + `Connectivity` in sync. It owns NO transport, cookie-jar, or
 * persistence logic of its own: the client persists the session token (off the
 * `set-cookie` header) and clears the store on logout / account-delete / 401; the
 * provider only reflects the resulting state.
 *
 * Pure decision cores are reused verbatim from `@aira/ui`:
 *   - `sessionRestore(...)` — launch session-restore reducer (R6.1–R6.4);
 *   - the device-auth sequence rules (reuse-first, bounded retry-once) encoded by
 *     `runDeviceAuthSequence` (R3.2/R3.5/R3.6), driven here against live `/device`
 *     requests; and
 *   - `errorToCopyKey(route, error)` — the single error→copy mapping.
 *
 * Secrets discipline (R2.8/R4.6): the password is passed straight to the client and is
 * never written to React state, the store, or a log; the device key lives only in the
 * `SessionStore`, never in React state beyond the single call that uses it.
 */

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { getRandomBytes } from 'expo-crypto';
import {
  errorToCopyKey,
  generateDeviceKey,
  sessionRestore,
  type ApiError,
  type CitizenAuthState,
  type CitizenRoute,
  type CitizenView,
  type Connectivity,
  type MessageKey,
  type RestoreOutcome,
} from '@aira/ui';

import type { ApiResult, CitizenApiClient } from '../api/citizenClient';
import type { SessionStore } from '../storage/sessionStore';

/** The outcome every auth action returns to a screen. */
export type AuthOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly copyKey: MessageKey; readonly retryAfterSeconds?: number };

export interface CitizenAuth {
  readonly state: CitizenAuthState;
  readonly connectivity: Connectivity;
  register(email: string, password: string): Promise<AuthOutcome>;
  login(email: string, password: string): Promise<AuthOutcome>;
  deviceAuth(): Promise<AuthOutcome>;
  restore(): Promise<void>;
  logout(): Promise<void>;
  deleteAccount(): Promise<AuthOutcome>;
}

export interface CitizenAuthProviderProps {
  readonly client: CitizenApiClient;
  readonly store: SessionStore;
  readonly children: React.ReactNode;
}

const CitizenAuthContext = createContext<CitizenAuth | null>(null);

/** base64url-safe device key from the platform CSPRNG (`expo-crypto.getRandomBytes`). */
function freshDeviceKey(): string {
  return generateDeviceKey((n) => getRandomBytes(n));
}

/**
 * Translate a non-success `ApiResult` into the `ApiError` the pure `errorToCopyKey`
 * expects. An HTTP failure carries its `status`/`code`; a transport failure carries only
 * its `kind`. `afterRetry` flags the terminal device-setup retry (R4.4).
 */
function toApiError(
  result: Extract<ApiResult<unknown>, { ok: false }>,
  opts: { readonly afterRetry?: boolean } = {},
): ApiError {
  if (result.kind === 'http') {
    return {
      kind: 'http',
      status: result.status,
      code: result.code,
      ...(opts.afterRetry ? { afterRetry: true } : {}),
    };
  }
  return { kind: result.kind };
}

/** The `retryAfterSeconds` on an HTTP failure, if the server supplied one. */
function retryAfter(result: Extract<ApiResult<unknown>, { ok: false }>): number | undefined {
  return result.kind === 'http' ? result.retryAfterSeconds : undefined;
}

export function CitizenAuthProvider(props: CitizenAuthProviderProps): JSX.Element {
  const { client, store, children } = props;

  const [state, setState] = useState<CitizenAuthState>({ kind: 'anonymous' });
  const [connectivity, setConnectivity] = useState<Connectivity>('unknown');

  // Stable refs so the memoized actions never go stale when props change under test.
  const clientRef = useRef(client);
  clientRef.current = client;
  const storeRef = useRef(store);
  storeRef.current = store;

  /** A reachable request flips connectivity online; a timeout/network failure, offline. */
  const reflectConnectivity = useCallback((result: ApiResult<unknown>): void => {
    if (result.ok || result.kind === 'http') {
      setConnectivity('online');
    } else {
      setConnectivity('offline');
    }
  }, []);

  /**
   * Provider-owned session persistence (R6.5). The provider is the source of truth for
   * keeping the `SessionStore` and auth state in sync: after a successful auth it persists
   * the session token the client captured off the `set-cookie` header. Reading it back and
   * re-persisting is idempotent against the real client (same value) and never carries a
   * credential — the token is the only thing written, never a password or device key.
   */
  const persistSession = useCallback(async (): Promise<void> => {
    const token = await storeRef.current.getSessionToken();
    await storeRef.current.setSessionToken(token ?? '');
  }, []);

  /**
   * Shared flow for the credential-bearing actions (register / login). On a 2xx the
   * provider persists the session token and moves to `registered`; on failure it stays
   * anonymous and maps the error to copy. The password is passed straight to the client
   * and never touches state, the store, or a log.
   */
  const runCredentialAction = useCallback(
    async (
      route: CitizenRoute,
      call: () => Promise<ApiResult<CitizenView>>,
    ): Promise<AuthOutcome> => {
      const result = await call();
      reflectConnectivity(result);
      if (result.ok) {
        await persistSession();
        setState({ kind: 'registered', citizen: result.data });
        return { ok: true };
      }
      return {
        ok: false,
        copyKey: errorToCopyKey(route, toApiError(result)),
        retryAfterSeconds: retryAfter(result),
      };
    },
    [persistSession, reflectConnectivity],
  );

  const register = useCallback(
    (email: string, password: string): Promise<AuthOutcome> =>
      runCredentialAction('register', () => clientRef.current.register(email, password)),
    [runCredentialAction],
  );

  const login = useCallback(
    (email: string, password: string): Promise<AuthOutcome> =>
      runCredentialAction('login', () => clientRef.current.login(email, password)),
    [runCredentialAction],
  );

  /**
   * Device-key authentication (R3.2/R3.4/R3.5/R3.6).
   *
   * Reuse-first: an existing stored key is used verbatim — no regeneration, no
   * `setDeviceKey`. When none exists, one is generated and persisted before the first
   * request. On a single `400 invalid_device_key` the key is discarded, a fresh key is
   * generated + persisted, and the request is retried ONCE (at most two `/device` calls).
   * Any other failure stops immediately, keeping the current key.
   *
   * This drives the live `/device` request against the exact rules the pure
   * `runDeviceAuthSequence` model encodes.
   */
  const deviceAuth = useCallback(async (): Promise<AuthOutcome> => {
    const currentStore = storeRef.current;
    const currentClient = clientRef.current;

    let key = await currentStore.getDeviceKey();
    if (key === null) {
      key = freshDeviceKey();
      await currentStore.setDeviceKey(key);
    }

    // Attempt 1 (reuse-first).
    let result = await currentClient.deviceAuth(key);
    reflectConnectivity(result);
    if (result.ok) {
      await persistSession();
      setState({ kind: 'registered', citizen: result.data });
      return { ok: true };
    }

    const isInvalidKey =
      result.kind === 'http' && result.status === 400 && result.code === 'invalid_device_key';
    if (!isInvalidKey) {
      return { ok: false, copyKey: errorToCopyKey('device', toApiError(result)) };
    }

    // Single retry (R3.5): discard + regenerate + persist, then try once more.
    key = freshDeviceKey();
    await currentStore.setDeviceKey(key);

    result = await currentClient.deviceAuth(key);
    reflectConnectivity(result);
    if (result.ok) {
      await persistSession();
      setState({ kind: 'registered', citizen: result.data });
      return { ok: true };
    }

    // Terminal: a failure after the one automatic retry (R4.4 / Property 6).
    return {
      ok: false,
      copyKey: errorToCopyKey('device', toApiError(result, { afterRetry: true })),
    };
  }, [persistSession, reflectConnectivity]);

  /**
   * Launch session-restore (R6.1–R6.4). No stored token → anonymous with NO `/session`
   * request. Otherwise validate via `GET /session`, classify the outcome, feed the pure
   * `sessionRestore` reducer, and apply its `clearToken` decision against the store.
   */
  const restore = useCallback(async (): Promise<void> => {
    const currentStore = storeRef.current;
    const currentClient = clientRef.current;

    const token = await currentStore.getSessionToken();
    if (token === null) {
      setState(sessionRestore({ kind: 'noToken' }).state);
      return;
    }

    const result = await currentClient.getSession();
    reflectConnectivity(result);

    let outcome: RestoreOutcome;
    if (result.ok) {
      outcome = { kind: 'validated', citizen: result.data };
    } else if (result.kind === 'http' && result.status === 401) {
      outcome = { kind: 'unauthenticated' };
    } else {
      // Offline / timeout / any other non-401 response → re-validate later (R6.4).
      outcome = { kind: 'unreachable' };
    }

    const { state: nextState, clearToken } = sessionRestore(outcome);
    if (clearToken) {
      await currentStore.clearSessionToken();
    }
    setState(nextState);
  }, [reflectConnectivity]);

  /**
   * Logout (R5): always return to anonymous and clear the local session. The client clears
   * the store on a 2xx; even if the backend is unreachable the provider still goes anonymous.
   */
  const logout = useCallback(async (): Promise<void> => {
    try {
      await clientRef.current.logout();
    } finally {
      // Provider-owned sync: always drop the local session, even if the backend was
      // unreachable (R5). Clearing is idempotent against the client's own clear-on-2xx.
      await storeRef.current.clearSessionToken();
      setState({ kind: 'anonymous' });
    }
  }, []);

  /**
   * Delete account (R10.6): on success the client clears BOTH the session token and the
   * device key; the provider reflects anonymous. On failure it maps the error to copy and
   * leaves the state untouched.
   */
  const deleteAccount = useCallback(async (): Promise<AuthOutcome> => {
    const result = await clientRef.current.deleteAccount();
    reflectConnectivity(result);
    if (result.ok) {
      // Provider-owned sync: drop BOTH secrets locally (R10.6). Idempotent against the
      // client's own clear-both-on-2xx.
      await storeRef.current.clearSessionToken();
      await storeRef.current.clearDeviceKey();
      setState({ kind: 'anonymous' });
      return { ok: true };
    }
    return {
      ok: false,
      copyKey: errorToCopyKey('account', toApiError(result)),
      retryAfterSeconds: retryAfter(result),
    };
  }, [reflectConnectivity]);

  const value = useMemo<CitizenAuth>(
    () => ({ state, connectivity, register, login, deviceAuth, restore, logout, deleteAccount }),
    [state, connectivity, register, login, deviceAuth, restore, logout, deleteAccount],
  );

  return <CitizenAuthContext.Provider value={value}>{children}</CitizenAuthContext.Provider>;
}

/** Read the citizen auth context; throws if used outside a `CitizenAuthProvider`. */
export function useCitizenAuth(): CitizenAuth {
  const ctx = useContext(CitizenAuthContext);
  if (ctx === null) {
    throw new Error('useCitizenAuth must be used within a CitizenAuthProvider');
  }
  return ctx;
}
