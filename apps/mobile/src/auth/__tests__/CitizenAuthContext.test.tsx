/**
 * Failing tests for `CitizenAuthProvider` + `useCitizenAuth`
 * (mobile-citizen-account spec, task 12.1 — TDD RED; implementation is task 12.2).
 *
 * The module under test does NOT exist yet: `../CitizenAuthContext` is the expected
 * red. These tests pin the exact component/hook contract task 12.2 must satisfy.
 *
 * ── PINNED CONTRACT FOR TASK 12.2 (design §2 "CitizenAuthProvider + useCitizenAuth") ──
 *
 *   import { CitizenAuthProvider, useCitizenAuth } from '../CitizenAuthContext';
 *
 *   // Props — client + store are injectable for tests (default to the real ones).
 *   interface CitizenAuthProviderProps {
 *     readonly client: CitizenApiClient;    // from ../../api/citizenClient
 *     readonly store: SessionStore;          // from ../../storage/sessionStore
 *     readonly children: React.ReactNode;
 *   }
 *
 *   // Hook return — state/connectivity reuse the @aira/ui pure models.
 *   interface CitizenAuth {
 *     readonly state: CitizenAuthState;      // { kind:'anonymous' | 'registered'(+citizen) | 'unknown' }
 *     readonly connectivity: Connectivity;   // 'online' | 'offline' | 'unknown'
 *     register(email: string, password: string): Promise<AuthOutcome>;
 *     login(email: string, password: string): Promise<AuthOutcome>;
 *     deviceAuth(): Promise<AuthOutcome>;    // generate/reuse key via @aira/ui, retry-once (R3)
 *     restore(): Promise<void>;              // launch session-restore (R6)
 *     logout(): Promise<void>;               // always clears local state (R5)
 *     deleteAccount(): Promise<AuthOutcome>; // R10
 *   }
 *
 *   type AuthOutcome =
 *     | { readonly ok: true }
 *     | { readonly ok: false; readonly copyKey: MessageKey; readonly retryAfterSeconds?: number };
 *
 * Behaviour the provider MUST honour (verified below):
 *   - register/login/deviceAuth success → state `registered` + session token persisted via store.
 *   - restore drives the @aira/ui session-restore reducer: GET /session 200 → `registered`;
 *     401 unauthenticated → `anonymous` + stored token CLEARED; offline/timeout → `unknown` +
 *     token RETAINED.
 *   - deviceAuth reuses an existing stored device key (no regeneration) and retries ONCE on a
 *     `400 invalid_device_key`, discarding+regenerating the key for the single retry.
 *   - the password is dropped as soon as the request resolves — it is never written to state
 *     nor the store, and never logged.
 *   - deleteAccount success clears BOTH the session token and the device key.
 *
 * Requirements: 2.3, 2.8, 3.2, 3.4, 3.5, 4.2, 4.6, 6.1, 6.2, 6.3, 6.4, 10.6.
 */

import { act, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { CitizenView } from '@aira/ui';

import type { ApiResult, CitizenApiClient, MedicalProfile } from '../../api/citizenClient';
import type { SessionStore } from '../../storage/sessionStore';

// The module under test — does not exist until task 12.2 (expected TDD red).
import { CitizenAuthProvider, useCitizenAuth } from '../CitizenAuthContext';

const CITIZEN: CitizenView = { id: 'c-1', email: 'c@example.com', emailVerified: false };
const DEVICE_CITIZEN: CitizenView = { id: 'c-2', email: null, emailVerified: false };

const okResult = (data: CitizenView): ApiResult<CitizenView> => ({ ok: true, status: 200, data });
const httpError = (status: number, code: string): ApiResult<never> => ({
  ok: false,
  kind: 'http',
  status,
  code,
});
const offline = (): ApiResult<never> => ({ ok: false, kind: 'offline' });

/** An in-memory SessionStore double that records writes/clears so tests can assert persistence. */
function makeStore(initial?: { token?: string | null; deviceKey?: string | null }): SessionStore & {
  readonly reads: () => { token: string | null; deviceKey: string | null };
} {
  let token: string | null = initial?.token ?? null;
  let deviceKey: string | null = initial?.deviceKey ?? null;
  return {
    getSessionToken: jest.fn(async () => token),
    setSessionToken: jest.fn(async (value: string) => {
      token = value;
    }),
    clearSessionToken: jest.fn(async () => {
      token = null;
    }),
    getDeviceKey: jest.fn(async () => deviceKey),
    setDeviceKey: jest.fn(async (value: string) => {
      deviceKey = value;
    }),
    clearDeviceKey: jest.fn(async () => {
      deviceKey = null;
    }),
    reads: () => ({ token, deviceKey }),
  };
}

/** A fully-stubbed CitizenApiClient; override only the methods a given test exercises. */
function makeClient(overrides: Partial<CitizenApiClient> = {}): CitizenApiClient {
  const unimplemented = (name: string) => async (): Promise<never> => {
    throw new Error(`client.${name} not stubbed for this test`);
  };
  return {
    register: overrides.register ?? (unimplemented('register') as CitizenApiClient['register']),
    login: overrides.login ?? (unimplemented('login') as CitizenApiClient['login']),
    deviceAuth:
      overrides.deviceAuth ?? (unimplemented('deviceAuth') as CitizenApiClient['deviceAuth']),
    getSession:
      overrides.getSession ?? (unimplemented('getSession') as CitizenApiClient['getSession']),
    logout: overrides.logout ?? (async () => ({ ok: true, status: 204, data: undefined })),
    getMedical:
      overrides.getMedical ?? (unimplemented('getMedical') as CitizenApiClient['getMedical']),
    putMedical:
      overrides.putMedical ?? (unimplemented('putMedical') as CitizenApiClient['putMedical']),
    deleteMedical:
      overrides.deleteMedical ??
      (unimplemented('deleteMedical') as CitizenApiClient['deleteMedical']),
    deleteAccount:
      overrides.deleteAccount ?? (async () => ({ ok: true, status: 204, data: undefined })),
  };
}

/**
 * Harness: renders the hook state through testIDs and exposes the actions via a ref-like
 * captured object so tests can call them inside `act`.
 */
type Captured = {
  register: ReturnType<typeof useCitizenAuth>['register'];
  login: ReturnType<typeof useCitizenAuth>['login'];
  deviceAuth: ReturnType<typeof useCitizenAuth>['deviceAuth'];
  restore: ReturnType<typeof useCitizenAuth>['restore'];
  logout: ReturnType<typeof useCitizenAuth>['logout'];
  deleteAccount: ReturnType<typeof useCitizenAuth>['deleteAccount'];
};

function Harness({ sink }: { sink: Captured }): JSX.Element {
  const auth = useCitizenAuth();
  sink.register = auth.register;
  sink.login = auth.login;
  sink.deviceAuth = auth.deviceAuth;
  sink.restore = auth.restore;
  sink.logout = auth.logout;
  sink.deleteAccount = auth.deleteAccount;
  const email = auth.state.kind === 'registered' ? (auth.state.citizen.email ?? '') : '';
  return (
    <>
      <Text testID="auth-kind">{auth.state.kind}</Text>
      <Text testID="auth-email">{email}</Text>
      <Text testID="connectivity">{auth.connectivity}</Text>
    </>
  );
}

function renderAuth(client: CitizenApiClient, store: SessionStore): Captured {
  const sink = {} as Captured;
  render(
    <CitizenAuthProvider client={client} store={store}>
      <Harness sink={sink} />
    </CitizenAuthProvider>,
  );
  return sink;
}

const kind = (): string => screen.getByTestId('auth-kind').props.children as string;

describe('CitizenAuthProvider / useCitizenAuth', () => {
  let logSpy: ReturnType<typeof jest.spyOn>;
  let warnSpy: ReturnType<typeof jest.spyOn>;
  let errorSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  const noConsoleContains = (needle: string): void => {
    for (const spy of [logSpy, warnSpy, errorSpy]) {
      for (const call of spy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(needle);
      }
    }
  };

  it('starts anonymous before any action', () => {
    renderAuth(makeClient(), makeStore());
    expect(kind()).toBe('anonymous');
  });

  it('register success → registered + token persisted, password never persisted or logged (R2.3/R2.8)', async () => {
    const store = makeStore();
    const register = jest.fn(async () => okResult(CITIZEN)) as CitizenApiClient['register'];
    const auth = renderAuth(makeClient({ register }), store);

    let outcome: Awaited<ReturnType<Captured['register']>> | undefined;
    await act(async () => {
      outcome = await auth.register('c@example.com', 'hunter2-strong-pw');
    });

    expect(outcome).toEqual({ ok: true });
    await waitFor(() => expect(kind()).toBe('registered'));
    expect(screen.getByTestId('auth-email').props.children).toBe('c@example.com');
    expect(store.setSessionToken).toHaveBeenCalled();
    // The password is never written to the store and never logged (R2.8).
    expect(store.reads().deviceKey).toBeNull();
    noConsoleContains('hunter2-strong-pw');
  });

  it('login success → registered + token persisted, password never logged (R4.2/R4.6)', async () => {
    const store = makeStore();
    const login = jest.fn(async () => okResult(CITIZEN)) as CitizenApiClient['login'];
    const auth = renderAuth(makeClient({ login }), store);

    await act(async () => {
      await auth.login('c@example.com', 'correct-horse-battery');
    });

    await waitFor(() => expect(kind()).toBe('registered'));
    expect(store.setSessionToken).toHaveBeenCalled();
    noConsoleContains('correct-horse-battery');
  });

  it('login invalid_credentials → stays anonymous with a copy key (R4.3)', async () => {
    const login = jest.fn(async () =>
      httpError(401, 'invalid_credentials'),
    ) as CitizenApiClient['login'];
    const auth = renderAuth(makeClient({ login }), makeStore());

    let outcome: Awaited<ReturnType<Captured['login']>> | undefined;
    await act(async () => {
      outcome = await auth.login('c@example.com', 'wrong');
    });

    expect(outcome).toMatchObject({ ok: false, copyKey: 'citizenInvalidCredentials' });
    expect(kind()).toBe('anonymous');
  });

  it('deviceAuth success → registered + session token persisted (R3.4)', async () => {
    const store = makeStore({ deviceKey: 'A'.repeat(43) });
    const deviceAuth = jest.fn(async () =>
      okResult(DEVICE_CITIZEN),
    ) as CitizenApiClient['deviceAuth'];
    const auth = renderAuth(makeClient({ deviceAuth }), store);

    await act(async () => {
      await auth.deviceAuth();
    });

    await waitFor(() => expect(kind()).toBe('registered'));
    expect(store.setSessionToken).toHaveBeenCalled();
  });

  it('deviceAuth reuses the existing stored device key without regenerating (R3.2)', async () => {
    const existingKey = 'B'.repeat(43);
    const store = makeStore({ deviceKey: existingKey });
    const deviceAuth = jest.fn(async () =>
      okResult(DEVICE_CITIZEN),
    ) as CitizenApiClient['deviceAuth'];
    const auth = renderAuth(makeClient({ deviceAuth }), store);

    await act(async () => {
      await auth.deviceAuth();
    });

    // The one /device call used the existing key verbatim; no new key was generated/stored.
    expect(deviceAuth).toHaveBeenCalledTimes(1);
    expect(deviceAuth).toHaveBeenCalledWith(existingKey);
    expect(store.setDeviceKey).not.toHaveBeenCalled();
    expect(store.reads().deviceKey).toBe(existingKey);
  });

  it('deviceAuth retries once on 400 invalid_device_key, regenerating the key for the retry (R3.5)', async () => {
    const staleKey = 'C'.repeat(43);
    const store = makeStore({ deviceKey: staleKey });
    const deviceAuth = jest
      .fn<CitizenApiClient['deviceAuth']>()
      .mockResolvedValueOnce(httpError(400, 'invalid_device_key'))
      .mockResolvedValueOnce(okResult(DEVICE_CITIZEN)) as CitizenApiClient['deviceAuth'];
    const auth = renderAuth(makeClient({ deviceAuth }), store);

    await act(async () => {
      await auth.deviceAuth();
    });

    // Exactly two attempts; the second used a freshly generated key (not the stale one).
    await waitFor(() => expect(deviceAuth).toHaveBeenCalledTimes(2));
    const mock = deviceAuth as unknown as jest.Mock;
    const firstKey = mock.mock.calls[0]?.[0] as string;
    const secondKey = mock.mock.calls[1]?.[0] as string;
    expect(firstKey).toBe(staleKey);
    expect(secondKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(secondKey).not.toBe(staleKey);
    expect(store.setDeviceKey).toHaveBeenCalledWith(secondKey);
    await waitFor(() => expect(kind()).toBe('registered'));
  });

  it('restore with a stored token and GET /session 200 → registered (R6.1/R6.2)', async () => {
    const store = makeStore({ token: 'sess-token' });
    const getSession = jest.fn(async () => okResult(CITIZEN)) as CitizenApiClient['getSession'];
    const auth = renderAuth(makeClient({ getSession }), store);

    await act(async () => {
      await auth.restore();
    });

    await waitFor(() => expect(kind()).toBe('registered'));
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(store.clearSessionToken).not.toHaveBeenCalled();
  });

  it('restore with 401 unauthenticated → anonymous + stored token cleared (R6.3)', async () => {
    const store = makeStore({ token: 'stale-token' });
    const getSession = jest.fn(async () =>
      httpError(401, 'unauthenticated'),
    ) as CitizenApiClient['getSession'];
    const auth = renderAuth(makeClient({ getSession }), store);

    await act(async () => {
      await auth.restore();
    });

    await waitFor(() => expect(kind()).toBe('anonymous'));
    expect(store.clearSessionToken).toHaveBeenCalled();
    expect(store.reads().token).toBeNull();
  });

  it('restore while offline → unknown + token retained (R6.4)', async () => {
    const store = makeStore({ token: 'keep-me' });
    const getSession = jest.fn(async () => offline()) as CitizenApiClient['getSession'];
    const auth = renderAuth(makeClient({ getSession }), store);

    await act(async () => {
      await auth.restore();
    });

    await waitFor(() => expect(kind()).toBe('unknown'));
    expect(store.clearSessionToken).not.toHaveBeenCalled();
    expect(store.reads().token).toBe('keep-me');
  });

  it('restore with no stored token → anonymous without a /session request (R6.1)', async () => {
    const store = makeStore({ token: null });
    const getSession = jest.fn(async () => okResult(CITIZEN)) as CitizenApiClient['getSession'];
    const auth = renderAuth(makeClient({ getSession }), store);

    await act(async () => {
      await auth.restore();
    });

    expect(kind()).toBe('anonymous');
    expect(getSession).not.toHaveBeenCalled();
  });

  it('deleteAccount success → anonymous with session token AND device key cleared (R10.6)', async () => {
    const store = makeStore({ token: 'sess', deviceKey: 'D'.repeat(43) });
    const login = jest.fn(async () => okResult(CITIZEN)) as CitizenApiClient['login'];
    const deleteAccount = jest.fn(async () => ({
      ok: true as const,
      status: 204,
      data: undefined,
    })) as CitizenApiClient['deleteAccount'];
    const auth = renderAuth(makeClient({ login, deleteAccount }), store);

    await act(async () => {
      await auth.login('c@example.com', 'pw-to-drop');
    });
    await waitFor(() => expect(kind()).toBe('registered'));

    await act(async () => {
      await auth.deleteAccount();
    });

    await waitFor(() => expect(kind()).toBe('anonymous'));
    expect(store.clearSessionToken).toHaveBeenCalled();
    expect(store.clearDeviceKey).toHaveBeenCalled();
    expect(store.reads().token).toBeNull();
    expect(store.reads().deviceKey).toBeNull();
  });

  it('logout always returns to anonymous and clears the local session (R5)', async () => {
    const store = makeStore({ token: 'sess' });
    const login = jest.fn(async () => okResult(CITIZEN)) as CitizenApiClient['login'];
    const auth = renderAuth(makeClient({ login }), store);

    await act(async () => {
      await auth.login('c@example.com', 'pw');
    });
    await waitFor(() => expect(kind()).toBe('registered'));

    await act(async () => {
      await auth.logout();
    });

    await waitFor(() => expect(kind()).toBe('anonymous'));
    expect(store.clearSessionToken).toHaveBeenCalled();
  });
});

// Keep MedicalProfile referenced so the type import is used (the provider contract touches it).
export type __MedicalProfileRef = MedicalProfile;
