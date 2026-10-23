/**
 * @vitest-environment node
 *
 * Civilian-broadcast endpoint (`/api/broadcasts`) — property-based tests (tasks
 * 26.3–26.4).
 *
 * Feature: web-ux-and-notifications
 *
 * These encode Properties 6 and 7 from design.md over the REAL
 * `handleCreateBroadcast` (`../src/lib/api/broadcast-handlers`) driven end-to-end
 * through the handler-test harness (TESTING.md §4.3): a real auth store + session
 * token, the memory `NotificationStore` seeded per generated case, and the fixed
 * harness clock.
 *
 * Every property is deterministic per generated case: the office/citizen scope
 * and the sender are seeded from the case, the clock is fixed by the harness, and
 * no real timers or network are involved. Each property runs >= 100 iterations.
 *
 * Determinism + isolation per case without a per-iteration login: the sender and
 * its session token are minted ONCE per property (the argon2id login is the only
 * slow step), and each iteration swaps a FRESH in-memory `NotificationStore` into
 * `deps.notifications.store` so no notification/audit state leaks between cases.
 *
 * These are post-implementation properties: they encode invariants the existing
 * handler already satisfies and are EXPECTED TO PASS. A failing property would
 * surface a real handler bug (reported with its counterexample), never a reason
 * to weaken the property.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { handleLogin } from '../src/lib/api/auth-handlers';
import { handleCreateBroadcast } from '../src/lib/api/broadcast-handlers';
import type { NotificationStore, PrincipalRef } from '../src/lib/notifications/types';
import { createTestHarness, jsonBody, withSession } from './support/harness';
import {
  createMemoryNotificationStore,
  type MemoryNotificationStore,
} from './support/memory-notification-store';
import { TEST_PASSWORD } from './support/fixtures';

const RUNS = 100;

const URL = 'http://localhost/api/broadcasts';

const TENANT_ID = '7e000000-0000-4000-8000-000000000001';
const LGU_OFFICE_ID = '0f100000-0000-4000-8000-000000000001'; // the sender's own office

/** A DISPATCHER sender (holds `civilian-broadcast`) all cases log in as. */
const DISPATCHER_CALLSIGN = 'OPCEN-01';

type World = ReturnType<typeof createTestHarness> & { readonly token: string };

/**
 * Builds a harness with a DISPATCHER sender seeded in `(TENANT_ID,
 * LGU_OFFICE_ID)` and mints that sender's session token ONCE (the slow argon2id
 * step). Per-case scope is seeded on a fresh store swapped in by each iteration.
 */
async function makeWorld(): Promise<World> {
  const harness = createTestHarness();

  harness.authStore.seedResponder({
    id: 'responder-dispatcher',
    callsign: DISPATCHER_CALLSIGN,
    role: 'DISPATCHER',
    tenantId: TENANT_ID,
    officeId: LGU_OFFICE_ID,
  });

  const response = await handleLogin(
    new Request(
      'http://localhost/api/auth/login',
      jsonBody('POST', {
        email: `${DISPATCHER_CALLSIGN.toLowerCase()}@aira.test`,
        password: TEST_PASSWORD,
      }),
    ),
    harness.deps,
  );
  const cookie = response.headers.get('set-cookie') ?? '';
  const token = /aira_session=([A-Za-z0-9_-]+)/.exec(cookie)?.[1];
  if (!token) {
    throw new Error(`login_failed_${response.status}`);
  }

  return { ...harness, token };
}

/**
 * Swaps a fresh notification store into the shared deps so a generated case runs
 * against clean state, and returns it for seeding + assertions.
 */
function freshStore(world: World): MemoryNotificationStore {
  const store = createMemoryNotificationStore();
  // deps.notifications.store is mutable; point it at the fresh instance.
  const mutable = world.deps.notifications as { store: NotificationStore };
  mutable.store = store;
  return store;
}

/** An arbitrary citizen principal id (non-blank, bounded). */
const citizenIdArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 16 })
  .filter((s) => s.trim().length > 0);

/**
 * An arbitrary seeded in-scope citizen set keyed by unique principal id. Size 0
 * is included (empty → zero recipients, accepted with recipientCount 0).
 */
const citizenSetArb: fc.Arbitrary<readonly PrincipalRef[]> = fc
  .uniqueArray(citizenIdArb, { minLength: 0, maxLength: 8 })
  .map((ids) => ids.map((principalId) => ({ tier: 'citizens' as const, principalId })));

/** Bounded, non-blank arbitrary message title/body. */
const nonBlank = (maxLength: number): fc.Arbitrary<string> =>
  fc.string({ minLength: 1, maxLength }).filter((s) => s.trim().length > 0);

const messageArb = fc.record({
  title: nonBlank(80),
  body: nonBlank(400),
});

// ---------------------------------------------------------------------------
// Property 6 — Tenant-scope targeting is the authoritative recipient set.
// Feature: web-ux-and-notifications, Property 6
// Validates: Requirements 13.4, 16.1
// ---------------------------------------------------------------------------
describe('Property 6: Tenant-scope targeting is the authoritative recipient set', () => {
  it('a whole-tenant send delivers to EXACTLY the seeded OFFICE_SCOPE citizen set — no more, no fewer', async () => {
    const world = await makeWorld();

    await fc.assert(
      fc.asyncProperty(
        citizenSetArb,
        messageArb,
        fc.boolean(),
        async (citizens, message, critical) => {
          const store = freshStore(world);

          // Seed the authoritative OFFICE_SCOPE for the sender's own office (the
          // root of a whole-tenant send).
          store.seedCitizenScope(TENANT_ID, LGU_OFFICE_ID, citizens);

          const response = await handleCreateBroadcast(
            withSession(
              URL,
              world.token,
              jsonBody('POST', { message, critical, granularity: 'tenant' }),
            ),
            world.deps,
          );

          // Accepted (R13.6) — even for an empty scope (recipientCount 0).
          expect(response.status).toBe(200);
          const payload = (await response.json()) as { ok?: boolean; recipientCount?: number };
          expect(payload.ok).toBe(true);
          expect(payload.recipientCount).toBe(citizens.length);

          // The set of citizens who received a notification equals EXACTLY the
          // seeded set — no more, no fewer (authoritative recipient set).
          const expected = [...citizens.map((c) => c.principalId)].sort();
          const notified = store.notifications.map((n) => n.recipient.principalId).sort();
          expect(notified).toEqual(expected);

          // Every notification targets a citizen-tier recipient and carries the
          // broadcast message verbatim.
          for (const n of store.notifications) {
            expect(n.recipient.tier).toBe('citizens');
            expect(n.payload.title).toBe(message.title);
            expect(n.payload.body).toBe(message.body);
          }

          // In_App delivery reaches exactly the seeded set (R14 minimum), so a
          // delivery can never land on a citizen outside OFFICE_SCOPE.
          const inAppRecipients = store.deliveries
            .filter((d) => d.channel === 'in_app' && d.outcome === 'sent')
            .map(
              (d) =>
                store.notifications.find((x) => x.id === d.notificationId)?.recipient.principalId,
            )
            .sort();
          expect(inAppRecipients).toEqual(expected);

          // The accepted audit records the resolved count exactly (R13.7).
          const accepted = store.broadcastAudits.filter((a) => a.outcome === 'accepted');
          expect(accepted).toHaveLength(1);
          expect(accepted[0]!.recipientCount).toBe(citizens.length);
        },
      ),
      { numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7 — Out-of-subtree targeting is denied atomically, no partial delivery.
// Feature: web-ux-and-notifications, Property 7
// Validates: Requirements 13.5, 16.2
// ---------------------------------------------------------------------------
describe('Property 7: Out-of-subtree targeting is denied atomically with no partial delivery', () => {
  it('a barangay target outside the seeded office scope is denied with zero delivery and one denied audit', async () => {
    const world = await makeWorld();

    await fc.assert(
      fc.asyncProperty(
        // A random out-of-scope barangay target id.
        nonBlank(32),
        // A random in-scope seed set + an in-scope office id to prove the denial
        // is invariant to what IS in scope (the target just is not among it).
        citizenSetArb,
        fc.string({ minLength: 1, maxLength: 24 }).filter((s) => s.trim().length > 0),
        messageArb,
        fc.boolean(),
        async (targetOfficeId, citizens, inScopeOffice, message, critical) => {
          // Seed a scope that EXCLUDES the generated target: the sender's own
          // office plus one arbitrary in-scope office, but never the target, so
          // `isOfficeInScope` is false for `targetOfficeId`.
          fc.pre(targetOfficeId !== LGU_OFFICE_ID && targetOfficeId !== inScopeOffice);

          const store = freshStore(world);
          store.seedOfficeScope(TENANT_ID, LGU_OFFICE_ID, [LGU_OFFICE_ID, inScopeOffice]);
          // Even though some citizens are seeded under the target scope, the
          // denial must happen BEFORE any resolution — seed them to prove
          // nothing leaks through.
          store.seedCitizenScope(TENANT_ID, targetOfficeId, citizens);

          const response = await handleCreateBroadcast(
            withSession(
              URL,
              world.token,
              jsonBody('POST', {
                message,
                critical,
                granularity: 'barangay',
                targetOfficeId,
              }),
            ),
            world.deps,
          );

          // Denied with a client-error status (>= 400).
          expect(response.status).toBeGreaterThanOrEqual(400);
          const payload = (await response.json()) as { error?: string; violation?: string };
          const indicatesViolation =
            typeof payload.violation === 'string' ||
            /violation|scope|forbidden|target/i.test(payload.error ?? '');
          expect(indicatesViolation).toBe(true);

          // Atomic: ZERO notifications and ZERO deliveries created.
          expect(store.notifications).toHaveLength(0);
          expect(store.deliveries).toHaveLength(0);

          // Exactly one `denied` audit, recipientCount 0, with a violation, and
          // nothing accepted — regardless of message/critical/target id.
          const denied = store.broadcastAudits.filter((a) => a.outcome === 'denied');
          expect(denied).toHaveLength(1);
          expect(denied[0]!.recipientCount).toBe(0);
          expect(denied[0]!.violation).toBeTruthy();
          expect(denied[0]!.targetOfficeId).toBe(targetOfficeId);
          expect(store.broadcastAudits.filter((a) => a.outcome === 'accepted')).toHaveLength(0);
        },
      ),
      { numRuns: RUNS },
    );
  });
});
