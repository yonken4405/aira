import { act, render } from '@testing-library/react-native';
import type { CitizenView } from '@aira/ui';

import type { ApiResult } from '../../api/citizenClient';
import type { ComponentProps } from 'react';

import type { CitizenApiClient } from '../../api/citizenClient';
import type { SessionStore } from '../../storage/sessionStore';
import { CitizenAuthProvider, useCitizenAuth, type CitizenAuth } from '../CitizenAuthContext';

const CITIZEN: CitizenView = {
  id: 'citizen-1',
  email: 'juan@example.com',
  emailVerified: false,
};

function createStore(initial: { token?: string; deviceKey?: string } = {}): SessionStore & {
  readonly secrets: { token: string | null; deviceKey: string | null };
} {
  const secrets = { token: initial.token ?? null, deviceKey: initial.deviceKey ?? null };
  return {
    secrets,
    getSessionToken: async () => secrets.token,
    setSessionToken: async (token) => {
      secrets.token = token;
    },
    clearSessionToken: async () => {
      secrets.token = null;
    },
    getDeviceKey: async () => secrets.deviceKey,
    setDeviceKey: async (key) => {
      secrets.deviceKey = key;
    },
    clearDeviceKey: async () => {
      secrets.deviceKey = null;
    },
  };
}

function createClient(overrides: Partial<CitizenApiClient> = {}): CitizenApiClient {
  return {
    register: jest.fn(async () => ({ ok: true, status: 201, data: CITIZEN })),
    login: jest.fn(async () => ({ ok: true, status: 200, data: CITIZEN })),
    deviceAuth: jest.fn(async () => ({ ok: true, status: 200, data: CITIZEN })),
    getSession: jest.fn(async () => ({ ok: true, status: 200, data: CITIZEN })),
    logout: jest.fn(async () => ({ ok: true, status: 204, data: undefined })),
    getMedical: jest.fn(async () => ({
      ok: true,
      status: 200,
      data: {
        bloodType: null,
        ageBand: null,
        allergies: [],
        conditions: [],
        medications: [],
        notes: null,
        contacts: [],
      },
    })),
    putMedical: jest.fn(async () => ({
      ok: true,
      status: 200,
      data: {
        bloodType: null,
        ageBand: null,
        allergies: [],
        conditions: [],
        medications: [],
        notes: null,
        contacts: [],
      },
    })),
    deleteMedical: jest.fn(async () => ({ ok: true, status: 204, data: undefined })),
    deleteAccount: jest.fn(async () => ({ ok: true, status: 204, data: undefined })),
    ...overrides,
  } as CitizenApiClient;
}

let auth: CitizenAuth | null = null;

function Capture() {
  auth = useCitizenAuth();
  return null;
}

async function mount(
  props: Partial<ComponentProps<typeof CitizenAuthProvider>> = {},
): Promise<void> {
  await render(
    <CitizenAuthProvider
      client={props.client ?? createClient()}
      store={props.store ?? createStore()}
      generateKey={props.generateKey}
      initialState={props.initialState}
      initialConnectivity={props.initialConnectivity}
    >
      <Capture />
    </CitizenAuthProvider>,
  );
}

describe('CitizenAuthProvider', () => {
  beforeEach(() => {
    auth = null;
  });

  it('register success moves to registered and the client persists the token', async () => {
    const store = createStore();
    const client = createClient({
      register: jest.fn(async (): Promise<ApiResult<CitizenView>> => {
        await store.setSessionToken('session-token');
        return { ok: true, status: 201, data: CITIZEN };
      }),
    });
    await mount({ client, store });

    await act(async () => {
      await expect(auth?.register('juan@example.com', 'correct horse')).resolves.toEqual({
        ok: true,
      });
    });

    expect(auth?.state).toEqual({ kind: 'registered', citizen: CITIZEN });
    expect(store.secrets.token).toBe('session-token');
  });

  it('maps register failures to copy keys and retry-after values', async () => {
    const client = createClient({
      register: jest.fn(async (): Promise<ApiResult<CitizenView>> => ({
        ok: false,
        kind: 'http',
        status: 429,
        code: 'rate_limited',
        retryAfterSeconds: 30,
      })),
    });
    await mount({ client });

    await act(async () => {
      await expect(auth?.register('juan@example.com', 'x')).resolves.toEqual({
        ok: false,
        copyKey: 'citizenRateLimited',
        retryAfterSeconds: 30,
      });
    });
    expect(auth?.connectivity).toBe('online');
  });

  it('restore maps 200 -> registered without prompting', async () => {
    const store = createStore({ token: 'tok' });
    await mount({ store });
    await act(async () => {
      await auth?.restore();
    });
    expect(auth?.state).toEqual({ kind: 'registered', citizen: CITIZEN });
    expect(store.secrets.token).toBe('tok');
  });

  it('restore maps 401 -> anonymous and clears the token', async () => {
    const store = createStore({ token: 'tok' });
    const client = createClient({
      getSession: jest.fn(async (): Promise<ApiResult<CitizenView>> => ({
        ok: false,
        kind: 'http',
        status: 401,
        code: 'unauthenticated',
      })),
    });
    await mount({ client, store });
    await act(async () => {
      await auth?.restore();
    });
    expect(auth?.state).toEqual({ kind: 'anonymous' });
    expect(store.secrets.token).toBeNull();
  });

  it('restore maps offline -> unknown and retains the token (R6.4)', async () => {
    const store = createStore({ token: 'tok' });
    const client = createClient({
      getSession: jest.fn(async (): Promise<ApiResult<CitizenView>> => ({
        ok: false,
        kind: 'offline',
      })),
    });
    await mount({ client, store });
    await act(async () => {
      await auth?.restore();
    });
    expect(auth?.state).toEqual({ kind: 'unknown' });
    expect(store.secrets.token).toBe('tok');
    expect(auth?.connectivity).toBe('offline');
  });

  it('restore with no token makes no request', async () => {
    const client = createClient();
    await mount({ client, store: createStore() });
    await act(async () => {
      await auth?.restore();
    });
    expect(client.getSession).not.toHaveBeenCalled();
    expect(auth?.state).toEqual({ kind: 'anonymous' });
  });

  it('deviceAuth reuses a stored key and retries once after invalid_device_key (R3.2/R3.5)', async () => {
    const store = createStore({ deviceKey: 'stored-key' });
    const generateKey = jest.fn(() => 'regenerated-key');
    const deviceAuthMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        kind: 'http',
        status: 400,
        code: 'invalid_device_key',
      })
      .mockResolvedValueOnce({ ok: true, status: 200, data: CITIZEN });
    const deviceAuth = deviceAuthMock as unknown as CitizenApiClient['deviceAuth'];
    const client = createClient({ deviceAuth });

    await mount({ client, store, generateKey });
    await act(async () => {
      await expect(auth?.deviceAuth()).resolves.toEqual({ ok: true });
    });

    expect(deviceAuthMock).toHaveBeenCalledTimes(2);
    expect(deviceAuthMock).toHaveBeenNthCalledWith(1, 'stored-key');
    expect(deviceAuthMock).toHaveBeenNthCalledWith(2, 'regenerated-key');
    expect(generateKey).toHaveBeenCalledTimes(1);
    expect(store.secrets.deviceKey).toBe('regenerated-key');
    expect(auth?.state).toEqual({ kind: 'registered', citizen: CITIZEN });
  });

  it('deviceAuth generates a key when none is stored', async () => {
    const store = createStore();
    const generateKey = jest.fn(() => 'fresh-key');
    await mount({ client: createClient(), store, generateKey });

    await act(async () => {
      await auth?.deviceAuth();
    });
    expect(generateKey).toHaveBeenCalledTimes(1);
    expect(store.secrets.deviceKey).toBe('fresh-key');
  });

  it('deviceAuth stops after a second invalid key with the retry copy', async () => {
    const client = createClient({
      deviceAuth: jest.fn(async (): Promise<ApiResult<CitizenView>> => ({
        ok: false,
        kind: 'http',
        status: 400,
        code: 'invalid_device_key',
      })),
    });
    await mount({ client, store: createStore({ deviceKey: 'stored' }) });

    await act(async () => {
      await expect(auth?.deviceAuth()).resolves.toEqual({
        ok: false,
        copyKey: 'citizenDeviceRetryFailed',
      });
    });
    expect(client.deviceAuth).toHaveBeenCalledTimes(2);
    expect(auth?.state).toEqual({ kind: 'anonymous' });
  });

  it('deviceAuth maps a timeout to the unavailable copy and keeps the key', async () => {
    const store = createStore({ deviceKey: 'stored' });
    const client = createClient({
      deviceAuth: jest.fn(async (): Promise<ApiResult<CitizenView>> => ({
        ok: false,
        kind: 'timeout',
      })),
    });
    await mount({ client, store });

    await act(async () => {
      await expect(auth?.deviceAuth()).resolves.toEqual({
        ok: false,
        copyKey: 'citizenDeviceUnavailable',
      });
    });
    expect(store.secrets.deviceKey).toBe('stored');
    expect(auth?.state).toEqual({ kind: 'anonymous' });
  });

  it('logout clears the local session even when the backend fails (R5.3)', async () => {
    const store = createStore({ token: 'tok' });
    const client = createClient({
      logout: jest.fn(async () => {
        throw new TypeError('offline');
      }),
    });
    await mount({
      client,
      store,
      initialState: { kind: 'registered', citizen: CITIZEN },
    });

    await act(async () => {
      await auth?.logout();
    });

    expect(store.secrets.token).toBeNull();
    expect(auth?.state).toEqual({ kind: 'anonymous' });
  });

  it('deleteAccount success clears the session token and device key (R10.6)', async () => {
    const store = createStore({ token: 'tok', deviceKey: 'key' });
    await mount({
      client: createClient(),
      store,
      initialState: { kind: 'registered', citizen: CITIZEN },
    });

    await act(async () => {
      await expect(auth?.deleteAccount()).resolves.toEqual({ ok: true });
    });
    expect(store.secrets.token).toBeNull();
    expect(store.secrets.deviceKey).toBeNull();
    expect(auth?.state).toEqual({ kind: 'anonymous' });
  });

  it('never keeps or logs the password after the request completes (R2.8/R4.6)', async () => {
    const logs: unknown[][] = [];
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logs.push(args);
      }),
    );
    const store = createStore();
    try {
      await mount({ client: createClient(), store });
      await act(async () => {
        await auth?.login('juan@example.com', 'super-secret-password');
      });

      const serialized = JSON.stringify(auth);
      expect(serialized).not.toContain('super-secret-password');
      expect(JSON.stringify(store.secrets)).not.toContain('super-secret-password');
      expect(logs.flat().map(String).join(' ')).not.toContain('super-secret-password');
    } finally {
      for (const spy of spies) {
        spy.mockRestore();
      }
    }
  });
});
