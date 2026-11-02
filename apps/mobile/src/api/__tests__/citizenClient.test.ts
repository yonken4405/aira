import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { extractSessionToken, formatCookieHeader } from '@aira/ui';

// =============================================================================
// TDD (task 11.1): this file is the FAILING half of the 11.1/11.2 pair.
// `../citizenClient` does NOT exist yet — it is implemented in task 11.2.
// Importing it is the expected red (module-not-found) until 11.2 lands.
//
// ---------------------------------------------------------------------------
// EXPECTED INTERFACE FOR TASK 11.2 (pin — implement `src/api/citizenClient.ts`)
// ---------------------------------------------------------------------------
// The client is constructed through an injectable factory so tests can supply a
// base URL, a mock `SessionStore`, a mock `fetch` recorder, and a development
// flag. The real app wires the secure-store-backed `SessionStore`, the global
// `fetch`, the configured base URL, and `isDevelopment = __DEV__`.
//
//   export function createCitizenClient(opts: {
//     readonly baseUrl: string;          // e.g. "https://console.aira.example"
//     readonly store: SessionStore;      // src/storage/sessionStore.ts shape
//     readonly fetch?: typeof fetch;     // defaults to global fetch
//     readonly isDevelopment?: boolean;  // defaults to __DEV__
//   }): CitizenApiClient;
//
// Construction MUST refuse a non-HTTPS `baseUrl` when `isDevelopment` is false
// (R12.4) — throwing synchronously from `createCitizenClient`.
//
// `CitizenApiClient` / `ApiResult<T>` match design.md §"API client contract":
//
//   type ApiResult<T> =
//     | { ok: true;  status: number; data: T }
//     | { ok: false; kind: 'http'; status: number; code: string;
//         retryAfterSeconds?: number }
//     | { ok: false; kind: 'offline' }   // fetch threw (network error)
//     | { ok: false; kind: 'timeout' };  // AbortController fired after 10s
//
//   interface CitizenApiClient {
//     register(email, password):  Promise<ApiResult<CitizenView>>;
//     login(email, password):     Promise<ApiResult<CitizenView>>;
//     deviceAuth(deviceKey):      Promise<ApiResult<CitizenView>>;
//     getSession():               Promise<ApiResult<CitizenView>>;
//     logout():                   Promise<ApiResult<void>>;  // DELETE /api/citizen/session
//     getMedical():               Promise<ApiResult<MedicalProfile>>;
//     putMedical(draft):          Promise<ApiResult<MedicalProfile>>;
//     deleteMedical():            Promise<ApiResult<void>>;
//     deleteAccount():            Promise<ApiResult<void>>;  // DELETE /api/citizen/account
//   }
//
// Behaviour the tests below pin:
//  * every request uses an AbortController with a 10_000 ms deadline;
//  * on register/login/device 2xx, the `set-cookie` token is extracted via the
//    pure `@aira/ui` `extractSessionToken`, persisted via `SessionStore`, and
//    re-attached on later requests as `Cookie: aira_citizen_session=<token>`
//    (via `@aira/ui` `formatCookieHeader`);
//  * on logout / account-delete / any 401, the jar + store are cleared;
//  * non-2xx bodies parse into { status, code, retryAfterSeconds };
//  * nothing secret (body, cookie, device key, medical field) is ever logged.
// =============================================================================

import { createCitizenClient } from '../citizenClient';
import type { SessionStore } from '../../storage/sessionStore';

const VALID_BASE = 'https://console.aira.example';
const SESSION_TOKEN = 'opaque-session-token-xyz';
const COOKIE_HEADER = `aira_citizen_session=${SESSION_TOKEN}; Path=/; HttpOnly; SameSite=Lax`;
const DEVICE_KEY = 'AbCdEf0123456789_-AbCdEf0123456789_-AbCdEf0'; // 43-char base64url shape

// ---------------------------------------------------------------------------
// A mock SessionStore (independent in-memory slots), per the real interface.
// ---------------------------------------------------------------------------
function makeStore(initial?: {
  session?: string | null;
  deviceKey?: string | null;
}): SessionStore & {
  _session: string | null;
  _deviceKey: string | null;
} {
  let session: string | null = initial?.session ?? null;
  let deviceKey: string | null = initial?.deviceKey ?? null;
  return {
    get _session() {
      return session;
    },
    get _deviceKey() {
      return deviceKey;
    },
    getSessionToken: jest.fn(async () => session),
    setSessionToken: jest.fn(async (t: string) => {
      session = t;
    }),
    clearSessionToken: jest.fn(async () => {
      session = null;
    }),
    getDeviceKey: jest.fn(async () => deviceKey),
    setDeviceKey: jest.fn(async (k: string) => {
      deviceKey = k;
    }),
    clearDeviceKey: jest.fn(async () => {
      deviceKey = null;
    }),
  };
}

// ---------------------------------------------------------------------------
// A `fetch` recorder: records every (url, init) and replays queued responses.
// Each queued entry is a function so a test can inspect/assert the init it got.
// ---------------------------------------------------------------------------
type FetchCall = { url: string; init: RequestInit };

function makeResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  const hdrs = new Headers(headers);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: hdrs,
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  } as unknown as Response;
}

function makeFetch(responders: Array<(call: FetchCall) => Promise<Response>>): {
  fetch: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  let i = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: FetchCall = { url: String(input), init: init ?? {} };
    calls.push(call);
    const responder = responders[i++];
    if (!responder) {
      throw new Error(`unexpected fetch call #${i}: ${call.url}`);
    }
    return responder(call);
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, calls };
}

function headerValue(init: RequestInit, name: string): string | null {
  const h = init.headers;
  if (!h) return null;
  if (h instanceof Headers) return h.get(name);
  if (Array.isArray(h)) {
    const found = h.find(([k]) => k.toLowerCase() === name.toLowerCase());
    return found ? found[1] : null;
  }
  const rec = h as Record<string, string>;
  const key = Object.keys(rec).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? (rec[key] ?? null) : null;
}

// `fetch` recorder helper: assert a call exists and return it (narrows away
// `undefined` from noUncheckedIndexedAccess on the calls array).
function callAt(calls: FetchCall[], index: number): FetchCall {
  const call = calls[index];
  if (!call) {
    throw new Error(`expected a fetch call at index ${index}, but none was recorded`);
  }
  return call;
}

describe('createCitizenClient', () => {
  let logSpies: ReturnType<typeof jest.spyOn>[];

  beforeEach(() => {
    logSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      jest.spyOn(console, method).mockImplementation(() => undefined),
    );
  });

  afterEach(() => {
    for (const spy of logSpies) spy.mockRestore();
    jest.useRealTimers();
  });

  function allLoggedText(): string {
    const lines: string[] = [];
    for (const spy of logSpies) {
      for (const call of spy.mock.calls) {
        lines.push(call.map((arg: unknown) => String(arg)).join(' '));
      }
    }
    return lines.join('\n');
  }

  // ------------------------------------------------------------------------
  // HTTPS-base enforcement (R12.4)
  // ------------------------------------------------------------------------
  describe('HTTPS base enforcement', () => {
    it('refuses a non-HTTPS base outside development', () => {
      const store = makeStore();
      const { fetch } = makeFetch([]);
      expect(() =>
        createCitizenClient({
          baseUrl: 'http://insecure.example',
          store,
          fetch,
          isDevelopment: false,
        }),
      ).toThrow();
    });

    it('allows a non-HTTPS base in development', () => {
      const store = makeStore();
      const { fetch } = makeFetch([]);
      expect(() =>
        createCitizenClient({
          baseUrl: 'http://192.168.1.42:3000',
          store,
          fetch,
          isDevelopment: true,
        }),
      ).not.toThrow();
    });

    it('allows an HTTPS base outside development', () => {
      const store = makeStore();
      const { fetch } = makeFetch([]);
      expect(() =>
        createCitizenClient({ baseUrl: VALID_BASE, store, fetch, isDevelopment: false }),
      ).not.toThrow();
    });
  });

  // ------------------------------------------------------------------------
  // 10 s AbortController timeout (R3.3 / R7.1 / R7.8)
  // ------------------------------------------------------------------------
  describe('10 s request timeout', () => {
    it('yields { ok:false, kind:"timeout" } when a request exceeds 10 s', async () => {
      jest.useFakeTimers();
      const store = makeStore();
      // The responder rejects when its AbortSignal aborts; otherwise it hangs.
      const { fetch } = makeFetch([
        (call) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = call.init.signal;
            if (signal) {
              signal.addEventListener('abort', () => {
                const err: Error & { name?: string } = new Error('Aborted');
                err.name = 'AbortError';
                reject(err);
              });
            }
          }),
      ]);
      const client = createCitizenClient({ baseUrl: VALID_BASE, store, fetch });

      const promise = client.getSession();
      // Advance past the 10 s deadline; the client's AbortController must fire.
      await jest.advanceTimersByTimeAsync(10_000);
      const result = await promise;

      expect(result).toEqual({ ok: false, kind: 'timeout' });
    });

    it('passes an AbortSignal on every request', async () => {
      const store = makeStore();
      const { fetch, calls } = makeFetch([
        async () =>
          makeResponse(200, { ok: true, citizen: { id: 'c1', email: null, emailVerified: false } }),
      ]);
      const client = createCitizenClient({ baseUrl: VALID_BASE, store, fetch });

      await client.getSession();

      expect(callAt(calls, 0).init.signal).toBeDefined();
    });
  });

  // ------------------------------------------------------------------------
  // Network error → offline
  // ------------------------------------------------------------------------
  it('yields { ok:false, kind:"offline" } on a network error', async () => {
    const store = makeStore();
    const { fetch } = makeFetch([
      async () => {
        throw new TypeError('Network request failed');
      },
    ]);
    const client = createCitizenClient({ baseUrl: VALID_BASE, store, fetch });

    const result = await client.getSession();

    expect(result).toEqual({ ok: false, kind: 'offline' });
  });

  // ------------------------------------------------------------------------
  // Cookie jar: extract on 2xx, persist via SessionStore, re-attach on later
  // requests (R6.5 / R12.2) — via the pure @aira/ui extractor + formatter.
  // ------------------------------------------------------------------------
  describe('cookie jar — extract, persist, re-attach', () => {
    it('extracts and persists the session token on register 2xx, then attaches it on the next request', async () => {
      const store = makeStore();
      const { fetch, calls } = makeFetch([
        // register → 201 with Set-Cookie
        async () =>
          makeResponse(
            201,
            { ok: true, citizen: { id: 'c1', email: 'a@b.co', emailVerified: false } },
            { 'set-cookie': COOKIE_HEADER },
          ),
        // subsequent getSession → 200, no new cookie
        async () =>
          makeResponse(200, {
            ok: true,
            citizen: { id: 'c1', email: 'a@b.co', emailVerified: false },
          }),
      ]);
      const client = createCitizenClient({ baseUrl: VALID_BASE, store, fetch });

      const reg = await client.register('a@b.co', 'hunter2hunter2');
      expect(reg.ok).toBe(true);

      // The token extracted equals the pure extractor's output and is persisted.
      expect(extractSessionToken(COOKIE_HEADER)).toBe(SESSION_TOKEN);
      expect(store.setSessionToken).toHaveBeenCalledWith(SESSION_TOKEN);
      expect(store._session).toBe(SESSION_TOKEN);

      await client.getSession();

      // The second request carries the Cookie header the server reads back.
      expect(headerValue(callAt(calls, 1).init, 'cookie')).toBe(formatCookieHeader(SESSION_TOKEN));
    });

    it('also persists the token on login 2xx', async () => {
      const store = makeStore();
      const { fetch } = makeFetch([
        async () =>
          makeResponse(
            200,
            { ok: true, citizen: { id: 'c1', email: 'a@b.co', emailVerified: false } },
            { 'set-cookie': COOKIE_HEADER },
          ),
      ]);
      const client = createCitizenClient({ baseUrl: VALID_BASE, store, fetch });

      await client.login('a@b.co', 'hunter2hunter2');

      expect(store.setSessionToken).toHaveBeenCalledWith(SESSION_TOKEN);
    });

    it('also persists the token on device-auth 2xx', async () => {
      const store = makeStore();
      const { fetch, calls } = makeFetch([
        async () =>
          makeResponse(
            200,
            { ok: true, citizen: { id: 'c1', email: null, emailVerified: false } },
            { 'set-cookie': COOKIE_HEADER },
          ),
      ]);
      const client = createCitizenClient({ baseUrl: VALID_BASE, store, fetch });

      await client.deviceAuth(DEVICE_KEY);

      expect(store.setSessionToken).toHaveBeenCalledWith(SESSION_TOKEN);
      // device-key is sent in the /device request body (and only there).
      expect(callAt(calls, 0).url).toContain('/api/citizen/device');
      expect(String(callAt(calls, 0).init.body)).toContain(DEVICE_KEY);
    });

    it('attaches a token already present in the store to the first request', async () => {
      const store = makeStore({ session: SESSION_TOKEN });
      const { fetch, calls } = makeFetch([
        async () =>
          makeResponse(200, { ok: true, citizen: { id: 'c1', email: null, emailVerified: false } }),
      ]);
      const client = createCitizenClient({ baseUrl: VALID_BASE, store, fetch });

      await client.getSession();

      expect(headerValue(callAt(calls, 0).init, 'cookie')).toBe(formatCookieHeader(SESSION_TOKEN));
    });
  });

  // ------------------------------------------------------------------------
  // Jar + store cleared on logout / account-delete / 401
  // ------------------------------------------------------------------------
  describe('clearing the session', () => {
    it('clears the jar + store on logout (204)', async () => {
      const store = makeStore({ session: SESSION_TOKEN });
      const { fetch, calls } = makeFetch([async () => makeResponse(204, null)]);
      const client = createCitizenClient({ baseUrl: VALID_BASE, store, fetch });

      const result = await client.logout();

      expect(result.ok).toBe(true);
      expect(callAt(calls, 0).url).toContain('/api/citizen/session');
      expect(callAt(calls, 0).init.method).toBe('DELETE');
      expect(store.clearSessionToken).toHaveBeenCalled();
      expect(store._session).toBeNull();
    });

    it('clears the jar + store (and device key) on account-delete (204)', async () => {
      const store = makeStore({ session: SESSION_TOKEN, deviceKey: DEVICE_KEY });
      const { fetch, calls } = makeFetch([async () => makeResponse(204, null)]);
      const client = createCitizenClient({ baseUrl: VALID_BASE, store, fetch });

      const result = await client.deleteAccount();

      expect(result.ok).toBe(true);
      expect(callAt(calls, 0).url).toContain('/api/citizen/account');
      expect(callAt(calls, 0).init.method).toBe('DELETE');
      expect(store.clearSessionToken).toHaveBeenCalled();
      expect(store.clearDeviceKey).toHaveBeenCalled();
      expect(store._session).toBeNull();
      expect(store._deviceKey).toBeNull();
    });

    it('clears the jar + store on any 401 unauthenticated', async () => {
      const store = makeStore({ session: SESSION_TOKEN });
      const { fetch } = makeFetch([
        async () => makeResponse(401, { ok: false, error: 'unauthenticated' }),
      ]);
      const client = createCitizenClient({ baseUrl: VALID_BASE, store, fetch });

      const result = await client.getMedical();

      expect(result.ok).toBe(false);
      expect(store.clearSessionToken).toHaveBeenCalled();
      expect(store._session).toBeNull();
    });
  });

  // ------------------------------------------------------------------------
  // Non-2xx → { status, code, retryAfterSeconds }
  // ------------------------------------------------------------------------
  describe('non-2xx HTTP error parsing', () => {
    it('parses a plain 4xx error code', async () => {
      const store = makeStore();
      const { fetch } = makeFetch([
        async () => makeResponse(400, { ok: false, error: 'invalid_email' }),
      ]);
      const client = createCitizenClient({ baseUrl: VALID_BASE, store, fetch });

      const result = await client.register('bad', 'hunter2hunter2');

      expect(result).toMatchObject({ ok: false, kind: 'http', status: 400, code: 'invalid_email' });
    });

    it('extracts retryAfterSeconds from a 423 account_locked body', async () => {
      const store = makeStore();
      const { fetch } = makeFetch([
        async () =>
          makeResponse(
            423,
            { ok: false, error: 'account_locked', retryAfterSeconds: 300 },
            { 'retry-after': '300' },
          ),
      ]);
      const client = createCitizenClient({ baseUrl: VALID_BASE, store, fetch });

      const result = await client.login('a@b.co', 'hunter2hunter2');

      expect(result).toMatchObject({
        ok: false,
        kind: 'http',
        status: 423,
        code: 'account_locked',
        retryAfterSeconds: 300,
      });
    });

    it('extracts retryAfterSeconds from a 429 retry-after header', async () => {
      const store = makeStore();
      const { fetch } = makeFetch([
        async () =>
          makeResponse(429, { ok: false, error: 'rate_limited' }, { 'retry-after': '60' }),
      ]);
      const client = createCitizenClient({ baseUrl: VALID_BASE, store, fetch });

      const result = await client.register('a@b.co', 'hunter2hunter2');

      expect(result).toMatchObject({
        ok: false,
        kind: 'http',
        status: 429,
        code: 'rate_limited',
        retryAfterSeconds: 60,
      });
    });
  });

  // ------------------------------------------------------------------------
  // No secret logging (R2.8 / R6.5 / R7.11 / R12): no body, cookie, device key,
  // or medical field ever reaches the console.
  // ------------------------------------------------------------------------
  describe('no secret logging', () => {
    it('never logs the password, cookie/session token, device key, or medical fields', async () => {
      const store = makeStore();
      const password = 'sup3r-secret-pass-phrase';
      const allergy = 'penicillin-secret-allergy';
      const { fetch } = makeFetch([
        // register → 201 with the session cookie
        async () =>
          makeResponse(
            201,
            { ok: true, citizen: { id: 'c1', email: 'a@b.co', emailVerified: false } },
            { 'set-cookie': COOKIE_HEADER },
          ),
        // device-auth → 200
        async () =>
          makeResponse(200, { ok: true, citizen: { id: 'c1', email: null, emailVerified: false } }),
        // putMedical → 200 canonical profile echoing the allergy
        async () =>
          makeResponse(200, {
            ok: true,
            profile: {
              bloodType: null,
              ageBand: null,
              allergies: [allergy],
              conditions: [],
              medications: [],
              notes: null,
              contacts: [],
            },
          }),
      ]);
      const client = createCitizenClient({ baseUrl: VALID_BASE, store, fetch });

      await client.register('a@b.co', password);
      await client.deviceAuth(DEVICE_KEY);
      await client.putMedical({
        bloodType: null,
        ageBand: null,
        allergies: [allergy],
        conditions: [],
        medications: [],
        notes: null,
        contacts: [],
      });

      const logged = allLoggedText();
      expect(logged).not.toContain(password);
      expect(logged).not.toContain(SESSION_TOKEN);
      expect(logged).not.toContain(DEVICE_KEY);
      expect(logged).not.toContain(allergy);
    });
  });
});
