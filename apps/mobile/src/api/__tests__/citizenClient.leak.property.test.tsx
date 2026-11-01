// Feature: mobile-citizen-account, Property 4: Credentials and session tokens never leak to logs or URLs
//
// Validates: Requirements 2.8, 4.6, 6.5
//
// Property 4 pins the single most sensitive invariant of the citizen client: no
// matter what sequence of operations a citizen performs, the credentials they type
// (passwords) and the opaque session token issued by the server must never surface
// where they could be harvested — not in any `console.*` output, not in any request
// URL, and (for the password) not in on-device storage. The token lives in exactly
// two places: the secure `SessionStore` and the `Cookie` request header. It never
// belongs in a URL or a log line.
//
// Strategy: drive the REAL client (`createCitizenApiClient`) against an injected
// `fetch` recorder. On every auth success the recorder returns a realistic,
// attribute-laden `Set-Cookie` header carrying a *generated* session token, so the
// client's manual cookie jar persists and re-attaches a *generated* value — not a
// fixed string that could accidentally pass. We spy on every console channel, run an
// arbitrary sequence of operations with generated passwords, then assert the leak
// invariants over everything observed.

import fc from 'fast-check';

import { createCitizenApiClient } from '../citizenClient';
import type { SessionStore } from '../../storage/sessionStore';

const BASE = 'https://aira.example';
const CITIZEN = { id: 'citizen-1', email: 'juan@example.com', emailVerified: false };
const EMPTY_PROFILE = {
  bloodType: null,
  ageBand: null,
  allergies: [],
  conditions: [],
  medications: [],
  notes: null,
  contacts: [],
};

type MemoryStore = SessionStore & {
  readonly secrets: { token: string | null; deviceKey: string | null };
};

function createMemoryStore(initial: { token?: string; deviceKey?: string } = {}): MemoryStore {
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

function fakeResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  const map = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => map.get(name.toLowerCase()) ?? null },
    json: async () => body,
  };
}

/** A realistic attribute-laden Set-Cookie header carrying the issued session token. */
function setCookie(token: string): string {
  return `aira_citizen_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400; Secure`;
}

// The operations we exercise. Auth operations ("issuers") mint a fresh session
// cookie on success; the rest are authenticated follow-up calls.
type Op = 'register' | 'login' | 'deviceAuth' | 'getSession' | 'getMedical' | 'logout';

const opArb: fc.Arbitrary<Op> = fc.constantFrom(
  'register',
  'login',
  'deviceAuth',
  'getSession',
  'getMedical',
  'logout',
);

// Passwords: arbitrary non-trivial strings, kept long enough to be meaningful and
// filtered so an empty/whitespace-only string can't make `toContain` vacuous.
const passwordArb = fc
  .string({ minLength: 4, maxLength: 40 })
  .filter((value) => value.trim().length >= 4);

// Session tokens the server "issues": opaque, URL-safe-ish, always non-empty.
const tokenArb = fc
  .string({ minLength: 8, maxLength: 48 })
  .filter((value) => value.trim().length >= 8);

interface RecordedCall {
  readonly url: string;
}

function makeRecorder(sessionToken: string) {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (url: string, init: { method?: string }): Promise<unknown> => {
    calls.push({ url: String(url) });
    const method = init.method ?? 'GET';
    const path = String(url);

    // Auth issuers return a fresh session cookie on success.
    if (path.endsWith('/api/citizen/register')) {
      return fakeResponse(
        201,
        { ok: true, citizen: CITIZEN },
        { 'set-cookie': setCookie(sessionToken) },
      );
    }
    if (path.endsWith('/api/citizen/login') || path.endsWith('/api/citizen/device')) {
      return fakeResponse(
        200,
        { ok: true, citizen: CITIZEN },
        { 'set-cookie': setCookie(sessionToken) },
      );
    }
    if (path.endsWith('/api/citizen/session')) {
      return method === 'DELETE'
        ? fakeResponse(204, undefined)
        : fakeResponse(200, { ok: true, citizen: CITIZEN });
    }
    if (path.endsWith('/api/citizen/medical')) {
      return fakeResponse(200, { ok: true, profile: EMPTY_PROFILE });
    }
    return fakeResponse(200, { ok: true });
  }) as unknown as typeof fetch;

  return { fetchImpl, calls };
}

describe('Property 4: credentials and session tokens never leak to logs or URLs', () => {
  it('no password or issued session token appears in console output, request URLs, or stored password', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(opArb, { minLength: 1, maxLength: 8 }),
        passwordArb,
        tokenArb,
        async (ops, password, sessionToken) => {
          const logs: unknown[][] = [];
          const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
            jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
              logs.push(args);
            }),
          );

          try {
            const store = createMemoryStore({ deviceKey: 'device-key-fixture' });
            const { fetchImpl, calls } = makeRecorder(sessionToken);
            const client = createCitizenApiClient({ baseUrl: BASE, store, fetchImpl });

            for (const op of ops) {
              switch (op) {
                case 'register':
                  await client.register('juan@example.com', password);
                  break;
                case 'login':
                  await client.login('juan@example.com', password);
                  break;
                case 'deviceAuth':
                  await client.deviceAuth('device-key-fixture');
                  break;
                case 'getSession':
                  await client.getSession();
                  break;
                case 'getMedical':
                  await client.getMedical();
                  break;
                case 'logout':
                  await client.logout();
                  break;
              }
            }

            const consoleOutput = logs.flat().map(String).join(' ');
            const urls = calls.map((call) => call.url);

            // --- Password invariants (R4.6, R2.8) ---
            // Never logged.
            expect(consoleOutput).not.toContain(password);
            // Never placed in a request URL (it travels only in the JSON body).
            for (const url of urls) {
              expect(url).not.toContain(password);
            }
            // Never persisted: the store only ever holds the token, never the password.
            expect(store.secrets.token).not.toBe(password);
            expect(store.secrets.deviceKey).not.toBe(password);

            // --- Session token invariants (R6.5) ---
            // Never logged.
            expect(consoleOutput).not.toContain(sessionToken);
            // Never placed in a request URL — it travels only as the Cookie header value.
            for (const url of urls) {
              expect(url).not.toContain(sessionToken);
            }
          } finally {
            for (const spy of spies) {
              spy.mockRestore();
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
