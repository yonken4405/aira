// Feature: mobile-citizen-account, Property 3: Client requests target only the citizen tier and the device key leaves only via /device

import fc from 'fast-check';

import type { MedicalDraft } from '@aira/ui';

import { createCitizenApiClient, type CitizenApiClient } from '../citizenClient';
import { createTestStore } from '../../test-utils/citizen';

jest.setTimeout(180_000);

const BASE = 'https://aira.example';

/** Every request the recorder observed, captured verbatim. */
interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string | undefined;
}

/**
 * A `fetch` double that records every (url, method, headers, body) and answers with a
 * benign success. Device-auth/register/login get a citizen body + a session cookie so the
 * client's cookie jar fills up (exercising the "cookie only on citizen requests" assertion);
 * medical reads get a minimal profile body; everything else is a bare 204.
 */
function createRecorder(): {
  readonly fetchImpl: typeof fetch;
  readonly requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];

  const headerMap = (headers: Record<string, string>) => {
    const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    return { get: (name: string): string | null => map.get(name.toLowerCase()) ?? null };
  };

  const fetchImpl = (async (
    input: string,
    init: { method?: string; headers?: Record<string, string>; body?: string } = {},
  ) => {
    const url = String(input);
    requests.push({
      url,
      method: init.method ?? 'GET',
      headers: { ...(init.headers ?? {}) },
      body: init.body,
    });

    const path = new URL(url).pathname;

    if (
      path === '/api/citizen/register' ||
      path === '/api/citizen/login' ||
      path === '/api/citizen/device'
    ) {
      return {
        ok: true,
        status: 200,
        headers: headerMap({
          'set-cookie': 'aira_citizen_session=issued-session; Path=/; HttpOnly',
        }),
        json: async () => ({
          ok: true,
          citizen: { id: 'citizen-1', email: 'juan@example.com', emailVerified: false },
        }),
      };
    }

    if (path === '/api/citizen/session') {
      return {
        ok: true,
        status: 200,
        headers: headerMap({}),
        json: async () => ({
          ok: true,
          citizen: { id: 'citizen-1', email: 'juan@example.com', emailVerified: false },
        }),
      };
    }

    if (path === '/api/citizen/medical') {
      return {
        ok: true,
        status: 200,
        headers: headerMap({}),
        json: async () => ({
          ok: true,
          profile: {
            bloodType: null,
            ageBand: null,
            allergies: [],
            conditions: [],
            medications: [],
            notes: null,
            contacts: [],
          },
        }),
      };
    }

    // account delete / logout / anything else: a bare success.
    return {
      ok: true,
      status: 204,
      headers: headerMap({}),
      json: async () => undefined,
    };
  }) as unknown as typeof fetch;

  return { fetchImpl, requests };
}

// --- generators -------------------------------------------------------------

const emailArb = fc
  .tuple(
    fc.stringMatching(/^[a-z]{1,12}$/),
    fc.stringMatching(/^[a-z]{1,12}$/),
    fc.constantFrom('com', 'net', 'ph', 'org'),
  )
  .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

const passwordArb = fc.string({ minLength: 8, maxLength: 48 });

const listArb = fc.array(fc.string({ minLength: 1, maxLength: 40 }), { maxLength: 5 });

const contactArb = fc.record({
  name: fc.string({ minLength: 1, maxLength: 40 }),
  phone: fc.stringMatching(/^[0-9+ -]{3,20}$/),
  relation: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: null }),
});

const medicalDraftArb: fc.Arbitrary<MedicalDraft> = fc.record({
  bloodType: fc.option(fc.constantFrom('O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'), {
    nil: null,
  }),
  ageBand: fc.option(fc.constantFrom('0-12', '13-17', '18-39', '40-64', '65+'), { nil: null }),
  allergies: listArb,
  conditions: listArb,
  medications: listArb,
  notes: fc.option(fc.string({ maxLength: 100 }), { nil: null }),
  contacts: fc.array(contactArb, { maxLength: 3 }),
}) as fc.Arbitrary<MedicalDraft>;

/**
 * A recognizable, URL-safe device key we can scan for across *every other* request. The
 * marker is unlikely to appear anywhere else (email/password/medical generators cannot
 * produce it), so finding it outside a `/device` body is proof of a leak.
 */
const DEVICE_KEY = 'DEVKEYMARKER_0123456789abcdefABCDEF-_0123xyz';

type Op =
  | { readonly kind: 'register'; readonly email: string; readonly password: string }
  | { readonly kind: 'login'; readonly email: string; readonly password: string }
  | { readonly kind: 'deviceAuth' }
  | { readonly kind: 'getSession' }
  | { readonly kind: 'logout' }
  | { readonly kind: 'getMedical' }
  | { readonly kind: 'putMedical'; readonly draft: MedicalDraft }
  | { readonly kind: 'deleteMedical' }
  | { readonly kind: 'deleteAccount' };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ kind: fc.constant('register' as const), email: emailArb, password: passwordArb }),
  fc.record({ kind: fc.constant('login' as const), email: emailArb, password: passwordArb }),
  fc.constant({ kind: 'deviceAuth' as const }),
  fc.constant({ kind: 'getSession' as const }),
  fc.constant({ kind: 'logout' as const }),
  fc.constant({ kind: 'getMedical' as const }),
  fc.record({ kind: fc.constant('putMedical' as const), draft: medicalDraftArb }),
  fc.constant({ kind: 'deleteMedical' as const }),
  fc.constant({ kind: 'deleteAccount' as const }),
);

async function runOp(client: CitizenApiClient, op: Op): Promise<void> {
  switch (op.kind) {
    case 'register':
      await client.register(op.email, op.password);
      return;
    case 'login':
      await client.login(op.email, op.password);
      return;
    case 'deviceAuth':
      await client.deviceAuth(DEVICE_KEY);
      return;
    case 'getSession':
      await client.getSession();
      return;
    case 'logout':
      await client.logout();
      return;
    case 'getMedical':
      await client.getMedical();
      return;
    case 'putMedical':
      await client.putMedical(op.draft);
      return;
    case 'deleteMedical':
      await client.deleteMedical();
      return;
    case 'deleteAccount':
      await client.deleteAccount();
      return;
  }
}

/**
 * Property 3 (R3.7, R12.2): across an arbitrary sequence of client operations run against a
 * single client instance, every request targets `/api/citizen/*` and the device key leaves
 * the app only inside the body of `/api/citizen/device`.
 */
describe('CitizenApiClient tier isolation + device-key egress (Property 3)', () => {
  it('only ever talks to the citizen tier and leaks the device key only via /device', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: 12 }), async (ops) => {
        const { fetchImpl, requests } = createRecorder();
        // The stored device key must match the one deviceAuth sends, so the jar/store is realistic.
        const store = createTestStore({ deviceKey: DEVICE_KEY });
        const client = createCitizenApiClient({ baseUrl: BASE, store, fetchImpl });

        for (const op of ops) {
          await runOp(client, op);
        }

        for (const req of requests) {
          const { pathname } = new URL(req.url);

          // --- tier isolation (R12.2): only ever /api/citizen/* ---
          expect(pathname.startsWith('/api/citizen/')).toBe(true);
          expect(req.url).not.toMatch(/\/api\/(responder|platform|admin)\b/);

          const isDeviceRequest = pathname === '/api/citizen/device';

          // --- device-key egress (R3.7) ---
          // The marker must never appear in any URL or header, on any request.
          expect(req.url).not.toContain(DEVICE_KEY);
          for (const value of Object.values(req.headers)) {
            expect(value).not.toContain(DEVICE_KEY);
          }
          // The marker may appear in a body ONLY for the /device request.
          if (!isDeviceRequest) {
            expect(req.body ?? '').not.toContain(DEVICE_KEY);
          }

          // --- cookie discipline: the only cookie ever attached is the citizen session ---
          const cookie = req.headers['cookie'];
          if (cookie !== undefined) {
            expect(cookie.startsWith('aira_citizen_session=')).toBe(true);
            expect(cookie).not.toMatch(/aira_(responder|platform)_session/);
          }
        }

        // When deviceAuth ran at least once, the marker must actually have reached a /device body
        // (otherwise the "only via /device" guarantee would be vacuous for this run).
        if (ops.some((op) => op.kind === 'deviceAuth')) {
          const deviceBodies = requests
            .filter((req) => new URL(req.url).pathname === '/api/citizen/device')
            .map((req) => req.body ?? '');
          expect(deviceBodies.some((body) => body.includes(DEVICE_KEY))).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});
