/**
 * Citizen auth context for the mobile app (design §"CitizenAuthProvider").
 *
 * Holds the `CitizenAuthState` + `Connectivity` model and wraps `CitizenApiClient` and
 * `SessionStore`, keeping them in sync. It never stores a password or device key in
 * React state beyond the single call that uses it (R2.8/R4.6).
 */

import {
  errorToCopyKey,
  generateDeviceKey,
  sessionRestore,
  type ApiError,
  type CitizenAuthState,
  type CitizenView,
  type Connectivity,
  type MessageKey,
  type RestoreOutcome,
} from '@aira/ui';
import { getRandomBytes } from 'expo-crypto';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

import {
  createCitizenApiClient,
  type ApiFailure,
  type ApiResult,
  type CitizenApiClient,
} from '../api/citizenClient';
import { failureToApiError } from '../api/apiError';
import { resolveCitizenApiBase } from '../api/config';
import { createSessionStore, type SessionStore } from '../storage/sessionStore';

export type AuthOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly copyKey: MessageKey;
      readonly retryAfterSeconds?: number;
    };

export type AccountDeleteOutcome = AuthOutcome;

export interface CitizenAuth {
  readonly state: CitizenAuthState;
  readonly connectivity: Connectivity;
  /** The single client instance so screens reuse the same cookie jar + store. */
  readonly client: CitizenApiClient;
  register(email: string, password: string): Promise<AuthOutcome>;
  login(email: string, password: string): Promise<AuthOutcome>;
  deviceAuth(): Promise<AuthOutcome>;
  restore(): Promise<void>;
  logout(): Promise<void>;
  deleteAccount(): Promise<AccountDeleteOutcome>;
  /** Called when a 401 on a medical route means the session is gone (R7.9). */
  sessionExpired(): Promise<void>;
  /** Outcome-derived connectivity for screens that call the client directly (R11). */
  noteConnectivity(value: Connectivity): void;
}

export interface CitizenAuthProviderProps {
  readonly children: ReactNode;
  /** Injectable for tests; defaults to the secure-store-backed client. */
  readonly client?: CitizenApiClient;
  readonly store?: SessionStore;
  /** Injectable key generator; defaults to `generateDeviceKey(expo-crypto)`. */
  readonly generateKey?: () => string;
  /** Test-only initial state override (Property 1 drives every combination). */
  readonly initialState?: CitizenAuthState;
  /** Test-only initial connectivity override. */
  readonly initialConnectivity?: Connectivity;
}

const CitizenAuthContext = createContext<CitizenAuth | null>(null);

/** Public hook; throws outside the provider so wiring mistakes fail loudly. */
export function useCitizenAuth(): CitizenAuth {
  const value = useContext(CitizenAuthContext);
  if (!value) {
    throw new Error('useCitizenAuth must be used inside CitizenAuthProvider');
  }
  return value;
}

function toApiError(failure: ApiFailure): ApiError {
  return failureToApiError(failure);
}

function failed(
  route: 'register' | 'login' | 'account' | 'device',
  failure: ApiFailure,
): { readonly ok: false; readonly copyKey: MessageKey; readonly retryAfterSeconds?: number } {
  const copyKey =
    route === 'device'
      ? errorToCopyKey('device', toApiError(failure))
      : errorToCopyKey(route, toApiError(failure));
  const retryAfterSeconds = failure.kind === 'http' ? failure.retryAfterSeconds : undefined;
  return retryAfterSeconds === undefined
    ? { ok: false, copyKey }
    : { ok: false, copyKey, retryAfterSeconds };
}

export function CitizenAuthProvider({
  children,
  client,
  store,
  generateKey,
  initialState,
  initialConnectivity,
}: CitizenAuthProviderProps): ReactElement {
  const [services] = useState(() => {
    const sessionStore = store ?? createSessionStore();
    return {
      store: sessionStore,
      client:
        client ?? createCitizenApiClient({ baseUrl: resolveCitizenApiBase(), store: sessionStore }),
    };
  });
  const [state, setState] = useState<CitizenAuthState>(initialState ?? { kind: 'anonymous' });
  const [connectivity, setConnectivity] = useState<Connectivity>(initialConnectivity ?? 'unknown');

  const generate = useCallback(
    () => (generateKey ? generateKey() : generateDeviceKey(getRandomBytes)),
    [generateKey],
  );

  const applyRestore = useCallback(
    async (outcome: RestoreOutcome): Promise<void> => {
      const result = sessionRestore(outcome);
      if (result.clearToken) {
        await services.store.clearSessionToken();
      }
      setState(result.state);
    },
    [services.store],
  );

  const succeed = useCallback((citizen: CitizenView): AuthOutcome => {
    setState({ kind: 'registered', citizen });
    setConnectivity('online');
    return { ok: true };
  }, []);

  const restore = useCallback(async (): Promise<void> => {
    const token = await services.store.getSessionToken();
    if (!token) {
      await applyRestore({ kind: 'noToken' });
      return;
    }

    const result = await services.client.getSession();
    if (result.ok) {
      setConnectivity('online');
      await applyRestore({ kind: 'validated', citizen: result.data });
      return;
    }
    if (result.kind === 'http' && result.status === 401) {
      setConnectivity('online');
      await applyRestore({ kind: 'unauthenticated' });
      return;
    }

    // Offline / timeout / network: keep the token and defer validation (R6.4).
    setConnectivity('offline');
    await applyRestore({ kind: 'unreachable' });
  }, [applyRestore, services.client, services.store]);

  const register = useCallback(
    async (email: string, password: string): Promise<AuthOutcome> => {
      // The password lives only in this call frame; it is never put into state.
      const result: ApiResult<CitizenView> = await services.client.register(email, password);
      if (result.ok) {
        return succeed(result.data);
      }
      setConnectivity(result.kind === 'http' ? 'online' : 'offline');
      return failed('register', result);
    },
    [services.client, succeed],
  );

  const login = useCallback(
    async (email: string, password: string): Promise<AuthOutcome> => {
      const result: ApiResult<CitizenView> = await services.client.login(email, password);
      if (result.ok) {
        return succeed(result.data);
      }
      setConnectivity(result.kind === 'http' ? 'online' : 'offline');
      return failed('login', result);
    },
    [services.client, succeed],
  );

  const deviceAuth = useCallback(async (): Promise<AuthOutcome> => {
    // Reuse-first (R3.2): mint a key only when none is stored.
    let key = await services.store.getDeviceKey();
    if (!key) {
      key = generate();
      await services.store.setDeviceKey(key);
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await services.client.deviceAuth(key);

      if (result.ok) {
        return succeed(result.data);
      }

      if (result.kind === 'http' && result.code === 'invalid_device_key') {
        if (attempt === 0) {
          // Discard + regenerate, then retry exactly once (R3.5).
          key = generate();
          await services.store.setDeviceKey(key);
          continue;
        }
        setConnectivity('online');
        return { ok: false, copyKey: 'citizenDeviceRetryFailed' };
      }

      setConnectivity(result.kind === 'http' ? 'online' : 'offline');
      return failed('device', result);
    }

    return { ok: false, copyKey: 'citizenDeviceRetryFailed' };
  }, [generate, services.client, services.store, succeed]);

  const logout = useCallback(async (): Promise<void> => {
    try {
      await services.client.logout();
    } catch {
      // Backend unreachable: local removal below is still the source of truth (R5.3).
    } finally {
      // Local removal is unconditional (R5.2/R5.3).
      await services.store.clearSessionToken();
      setState({ kind: 'anonymous' });
    }
  }, [services.client, services.store]);

  const deleteAccount = useCallback(async (): Promise<AccountDeleteOutcome> => {
    const result = await services.client.deleteAccount();
    if (result.ok) {
      await services.store.clearSessionToken();
      await services.store.clearDeviceKey();
      setState({ kind: 'anonymous' });
      setConnectivity('online');
      return { ok: true };
    }

    if (result.kind === 'http' && result.status === 401) {
      await services.store.clearSessionToken();
      setState({ kind: 'anonymous' });
      setConnectivity('online');
      return { ok: false, copyKey: 'citizenSessionExpired' };
    }

    setConnectivity(result.kind === 'http' ? 'online' : 'offline');
    return failed('account', result);
  }, [services.client, services.store]);

  const sessionExpired = useCallback(async (): Promise<void> => {
    await services.store.clearSessionToken();
    setState({ kind: 'anonymous' });
  }, [services.store]);

  const noteConnectivity = useCallback((value: Connectivity): void => {
    setConnectivity(value);
  }, []);

  const value = useMemo<CitizenAuth>(
    () => ({
      state,
      connectivity,
      client: services.client,
      register,
      login,
      deviceAuth,
      restore,
      logout,
      deleteAccount,
      sessionExpired,
      noteConnectivity,
    }),
    [
      state,
      connectivity,
      services.client,
      register,
      login,
      deviceAuth,
      restore,
      logout,
      deleteAccount,
      sessionExpired,
      noteConnectivity,
    ],
  );

  return <CitizenAuthContext.Provider value={value}>{children}</CitizenAuthContext.Provider>;
}
