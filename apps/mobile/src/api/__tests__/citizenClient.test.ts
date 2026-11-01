import type { MedicalDraft } from '@aira/ui';

import { createCitizenApiClient } from '../citizenClient';
import type { SessionStore } from '../../storage/sessionStore';

const BASE = 'https://aira.example';

interface RecordedCall {
  readonly url: string;
  readonly init: {
    readonly method?: string;
    readonly headers?: Record<string, string>;
    readonly body?: string;
    readonly signal?: AbortSignal;
  };
}

function createMemoryStore(initial: { token?: string; deviceKey?: string } = {}): SessionStore & {
  readonly secrets: { token: string | null; deviceKey: string | null };
} {
  const secrets = {
    token: initial.token ?? null,
    deviceKey: initial.deviceKey ?? null,
  };
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

function fakeResponse(status: number, body: unknown = null, headers: Record<string, string> = {}) {
  const map = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => map.get(name.toLowerCase()) ?? null },
    json: async () => body,
  };
}

function recorder(responses: Array<ReturnType<typeof fakeResponse>>) {
  const calls: RecordedCall[] = [];
  let index = 0;
  const fetchImpl = (async (
    url: string,
    init: RecordedCall['init'],
  ): Promise<ReturnType<typeof fakeResponse>> => {
    calls.push({ url: String(url), init });
    const response = responses[index];
    index += 1;
    if (!response) {
      throw new Error('unexpected_request');
    }
    return response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const CITIZEN = { id: 'citizen-1', email: 'juan@example.com', emailVerified: false };

describe('CitizenApiClient', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('refuses a non-HTTPS base outside development (R12.4)', () => {
    const store = createMemoryStore();
    const { fetchImpl } = recorder([]);

    expect(() =>
      createCitizenApiClient({
        baseUrl: 'http://insecure.example',
        store,
        fetchImpl,
        allowInsecure: false,
      }),
    ).toThrow(/https/i);

    expect(() =>
      createCitizenApiClient({
        baseUrl: 'https://secure.example',
        store,
        fetchImpl,
        allowInsecure: false,
      }),
    ).not.toThrow();
  });

  it('times out after the 10 s deadline (R3.3/R7.1/R7.8)', async () => {
    jest.useFakeTimers();
    const store = createMemoryStore({ token: 'tok' });
    const fetchImpl = jest.fn(
      (_url: string, init: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    ) as unknown as typeof fetch;

    const client = createCitizenApiClient({ baseUrl: BASE, store, fetchImpl });
    const pending = client.getSession();
    await jest.advanceTimersByTimeAsync(10_000);

    await expect(pending).resolves.toEqual({ ok: false, kind: 'timeout' });
  });

  it('maps a network error to offline', async () => {
    const store = createMemoryStore();
    const fetchImpl = (async () => {
      throw new TypeError('network down');
    }) as unknown as typeof fetch;
    const client = createCitizenApiClient({ baseUrl: BASE, store, fetchImpl });

    await expect(client.getSession()).resolves.toEqual({ ok: false, kind: 'offline' });
  });

  it('persists the issued cookie and attaches it to later requests', async () => {
    const store = createMemoryStore();
    const { fetchImpl, calls } = recorder([
      fakeResponse(
        201,
        { ok: true, citizen: CITIZEN },
        {
          'set-cookie': 'aira_citizen_session=issued-token; Path=/; HttpOnly; SameSite=Lax',
        },
      ),
      fakeResponse(200, { ok: true, citizen: CITIZEN }),
    ]);
    const client = createCitizenApiClient({ baseUrl: BASE, store, fetchImpl });

    const registered = await client.register('juan@example.com', 'correct horse battery');
    expect(registered).toEqual({ ok: true, status: 201, data: CITIZEN });
    expect(store.secrets.token).toBe('issued-token');
    expect(calls[0]?.url).toBe(`${BASE}/api/citizen/register`);

    await expect(client.getSession()).resolves.toEqual({ ok: true, status: 200, data: CITIZEN });
    expect(calls[1]?.init.headers?.['cookie']).toBe('aira_citizen_session=issued-token');
  });

  it('parses non-2xx outcomes with retry-after semantics', async () => {
    const store = createMemoryStore();
    const { fetchImpl } = recorder([
      fakeResponse(
        423,
        { ok: false, error: 'account_locked', retryAfterSeconds: 300 },
        {
          'retry-after': '300',
        },
      ),
      fakeResponse(429, { ok: false, error: 'rate_limited' }, { 'retry-after': '7' }),
    ]);
    const client = createCitizenApiClient({ baseUrl: BASE, store, fetchImpl });

    await expect(client.login('juan@example.com', 'wrong')).resolves.toEqual({
      ok: false,
      kind: 'http',
      status: 423,
      code: 'account_locked',
      retryAfterSeconds: 300,
    });
    await expect(client.register('juan@example.com', 'weak')).resolves.toEqual({
      ok: false,
      kind: 'http',
      status: 429,
      code: 'rate_limited',
      retryAfterSeconds: 7,
    });
  });

  it('clears the stored token on 401 (R6.3/R7.9)', async () => {
    const store = createMemoryStore({ token: 'old-token' });
    const { fetchImpl } = recorder([fakeResponse(401, { ok: false, error: 'unauthenticated' })]);
    const client = createCitizenApiClient({ baseUrl: BASE, store, fetchImpl });

    await expect(client.getSession()).resolves.toEqual({
      ok: false,
      kind: 'http',
      status: 401,
      code: 'unauthenticated',
    });
    expect(store.secrets.token).toBeNull();
  });

  it('clears the local token on logout even when the backend fails (R5.3)', async () => {
    for (const response of [fakeResponse(500, { ok: false, error: 'boom' }), fakeResponse(204)]) {
      const store = createMemoryStore({ token: 'live-token' });
      const { fetchImpl } = recorder([response]);
      const client = createCitizenApiClient({ baseUrl: BASE, store, fetchImpl });

      await client.logout();
      expect(store.secrets.token).toBeNull();
    }

    const store = createMemoryStore({ token: 'live-token' });
    const offlineFetch = (async () => {
      throw new TypeError('offline');
    }) as unknown as typeof fetch;
    const client = createCitizenApiClient({ baseUrl: BASE, store, fetchImpl: offlineFetch });
    await client.logout();
    expect(store.secrets.token).toBeNull();
  });

  it('deletes the account via the citizen route and clears both secrets (R10.6)', async () => {
    const store = createMemoryStore({ token: 'live-token', deviceKey: 'device-key' });
    const { fetchImpl, calls } = recorder([fakeResponse(204)]);
    const client = createCitizenApiClient({ baseUrl: BASE, store, fetchImpl });

    await expect(client.deleteAccount()).resolves.toEqual({
      ok: true,
      status: 204,
      data: undefined,
    });
    expect(calls[0]?.url).toBe(`${BASE}/api/citizen/account`);
    expect(store.secrets.token).toBeNull();
    expect(store.secrets.deviceKey).toBeNull();
  });

  it('sends the device key only in the /device body (R3.7)', async () => {
    const store = createMemoryStore({ deviceKey: 'the-device-key' });
    const { fetchImpl, calls } = recorder([
      fakeResponse(
        200,
        { ok: true, citizen: CITIZEN },
        {
          'set-cookie': 'aira_citizen_session=session-token; Path=/',
        },
      ),
      fakeResponse(200, { ok: true, citizen: CITIZEN }),
    ]);
    const client = createCitizenApiClient({ baseUrl: BASE, store, fetchImpl });

    await client.deviceAuth('the-device-key');
    await client.getSession();

    for (const call of calls) {
      expect(new URL(call.url).pathname.startsWith('/api/citizen/')).toBe(true);
      expect(call.url).not.toContain('the-device-key');
    }
    expect(calls[0]?.init.body).toContain('the-device-key');
    expect(calls[1]?.init.body).toBeUndefined();
    expect(calls[1]?.init.headers?.['cookie']).toBe('aira_citizen_session=session-token');
  });

  it('never logs a password, token, device key, or medical field', async () => {
    const logs: unknown[][] = [];
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logs.push(args);
      }),
    );

    try {
      const store = createMemoryStore();
      const { fetchImpl } = recorder([
        fakeResponse(
          200,
          { ok: true, citizen: CITIZEN },
          {
            'set-cookie': 'aira_citizen_session=secret-token; Path=/',
          },
        ),
        fakeResponse(200, { ok: true, profile: { bloodType: null } }),
      ]);
      const client = createCitizenApiClient({ baseUrl: BASE, store, fetchImpl });

      const draft: MedicalDraft = {
        bloodType: 'O-',
        ageBand: '18-39',
        allergies: ['penicillin-secret'],
        conditions: [],
        medications: [],
        notes: 'private-note',
        contacts: [{ name: 'Contact-Secret', phone: '0917-111-2222', relation: null }],
      };
      await client.login('juan@example.com', 'password-secret');
      await client.putMedical(draft);

      const output = logs.flat().map(String).join(' ');
      for (const secret of [
        'password-secret',
        'secret-token',
        'penicillin-secret',
        'private-note',
        'Contact-Secret',
        '0917-111-2222',
      ]) {
        expect(output).not.toContain(secret);
      }
    } finally {
      for (const spy of spies) {
        spy.mockRestore();
      }
    }
  });
});
