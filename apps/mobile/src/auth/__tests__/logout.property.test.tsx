import fc from 'fast-check';

import { createCitizenApiClient } from '../../api/citizenClient';
import type { SessionStore } from '../../storage/sessionStore';

// Feature: mobile-citizen-account, Property 5: Logout always clears the local session regardless of backend reachability

const BASE = 'https://aira.example';

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

function okResponse(status: number) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (_name: string) => null },
    json: async () => null,
  };
}

/** The DELETE /api/citizen/session outcome, spanning every backend reachability case. */
type LogoutOutcome =
  | { readonly kind: 'http'; readonly status: number }
  | { readonly kind: 'network' }
  | { readonly kind: 'timeout' };

/** fast-check generator covering 204, arbitrary 5xx, a thrown network error, and a timeout. */
const logoutOutcome: fc.Arbitrary<LogoutOutcome> = fc.oneof(
  fc.constant<LogoutOutcome>({ kind: 'http', status: 204 }),
  fc.integer({ min: 500, max: 599 }).map<LogoutOutcome>((status) => ({ kind: 'http', status })),
  fc.constant<LogoutOutcome>({ kind: 'network' }),
  fc.constant<LogoutOutcome>({ kind: 'timeout' }),
);

/**
 * Property 5 (R5.2/R5.3): driving the REAL client's `logout()` with a store seeded with a
 * live session token, the local session token is cleared for EVERY backend outcome —
 * a `204`, an arbitrary `5xx`, a thrown network error, or a timeout.
 */
describe('logout clears the local session for every backend outcome (Property 5)', () => {
  it('leaves SessionStore.getSessionToken() === null regardless of reachability', async () => {
    await fc.assert(
      fc.asyncProperty(
        logoutOutcome,
        fc.string({ minLength: 1, maxLength: 40 }),
        async (outcome, token) => {
          const store = createMemoryStore({ token });

          const fetchImpl = (async (
            _url: string,
            init: { signal?: AbortSignal },
          ): Promise<ReturnType<typeof okResponse>> => {
            switch (outcome.kind) {
              case 'http':
                return okResponse(outcome.status);
              case 'network':
                throw new TypeError('network down');
              case 'timeout':
                // Never resolve; the client's 10 s deadline aborts and rejects.
                return new Promise((_resolve, reject) => {
                  init.signal?.addEventListener('abort', () =>
                    reject(new Error('request_timeout')),
                  );
                }) as never;
            }
          }) as unknown as typeof fetch;

          // A tiny timeout keeps the timeout branch fast without fake timers.
          const client = createCitizenApiClient({
            baseUrl: BASE,
            store,
            fetchImpl,
            timeoutMs: 5,
          });

          await client.logout();

          // R5.2/R5.3: the local session is gone no matter what the backend did.
          expect(await store.getSessionToken()).toBeNull();
          expect(store.secrets.token).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });
});
