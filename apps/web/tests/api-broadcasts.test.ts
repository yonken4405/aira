/**
 * @vitest-environment node
 *
 * Civilian-broadcast endpoint (`/api/broadcasts`) — handler integration tests.
 *
 * A Civilian_Broadcast is created and sent by a Tenant principal whose role is
 * DISPATCHER or ADMIN (the `civilian-broadcast` permission, R13.1). Targeting is
 * bounded by the sender's Office_Subtree computed by the `OFFICE_SCOPE` CTE
 * constrained by `tenant_id` (R13.4, R16.1), and any send that would address a
 * citizen/office/Tenant outside that subtree is denied ATOMICALLY with no partial
 * delivery (R13.5, R16.2) — the key tenant-isolation-denial case (R22.3).
 *
 * These are TDD RED tests: they import the not-yet-existing
 * `broadcast-handlers.ts` (task 26.2), so the whole file fails to import until the
 * handler is implemented. They drive the real handler with the memory
 * `NotificationStore` + `AuthStore` from the test harness (TESTING.md §4.3) and
 * assert on the persisted `notificationStore.notifications` /
 * `notificationStore.broadcastAudits` rows.
 *
 * REQUEST BODY CONTRACT (documented here; implemented by task 26.2):
 *   POST /api/broadcasts
 *   {
 *     message: { title: string; body: string };   // rendered In_App payload (R9.7)
 *     critical?: boolean;                          // Critical_Warning flag (R14)
 *     granularity: 'tenant' | 'barangay';          // targeting granularity (R13.3)
 *     targetOfficeId?: string;                     // required when granularity === 'barangay'
 *   }
 * The SENDER is a responder (DISPATCHER or ADMIN) resolved from the session; the
 * sender's `tenantId` and `officeId` come from the authenticated principal and are
 * NEVER taken from the request body. For `granularity: 'tenant'` the subtree root
 * is the sender's own office; for `granularity: 'barangay'` the root is
 * `targetOfficeId`, which must pass `isOfficeInScope` before any delivery.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { handleLogin } from '../src/lib/api/auth-handlers';
// RED: this module does not exist until task 26.2 implements it.
import { handleCreateBroadcast } from '../src/lib/api/broadcast-handlers';
import { createTestHarness, jsonBody, withSession } from './support/harness';
import { TEST_PASSWORD } from './support/fixtures';

const URL = 'http://localhost/api/broadcasts';

const TENANT_ID = '7e000000-0000-4000-8000-000000000001';
const LGU_OFFICE_ID = '0f100000-0000-4000-8000-000000000001'; // sender's office (fixtures OFFICE_ID)
const BARANGAY_IN_SCOPE = 'office-lahug'; // a barangay within the sender's subtree
const BARANGAY_OUT_OF_SCOPE = 'office-outside-0001'; // a barangay in another subtree/tenant

const MESSAGE = { title: 'Flood advisory', body: 'Move to higher ground immediately.' };

/** Citizen principals seeded as the in-scope recipient set (OFFICE_SCOPE result). */
const CITIZENS = [
  { tier: 'citizens', principalId: 'citizen-1' },
  { tier: 'citizens', principalId: 'citizen-2' },
  { tier: 'citizens', principalId: 'citizen-3' },
] as const;

function makeWorld() {
  const harness = createTestHarness();

  // Senders: a DISPATCHER and an ADMIN both hold civilian-broadcast; a plain
  // RESPONDER does not. All share the same tenant/office so targeting is
  // deterministic.
  harness.authStore.seedResponder({
    id: 'responder-dispatcher',
    callsign: 'OPCEN-01',
    role: 'DISPATCHER',
    tenantId: TENANT_ID,
    officeId: LGU_OFFICE_ID,
  });
  harness.authStore.seedResponder({
    id: 'responder-admin',
    callsign: 'ADMIN-1',
    role: 'ADMIN',
    tenantId: TENANT_ID,
    officeId: LGU_OFFICE_ID,
  });
  harness.authStore.seedResponder({
    id: 'responder-field',
    callsign: 'K9-01',
    role: 'RESPONDER',
    tenantId: TENANT_ID,
    officeId: LGU_OFFICE_ID,
  });

  // Whole-tenant scope (root = sender's own office) resolves to the three citizens.
  harness.notificationStore.seedCitizenScope(TENANT_ID, LGU_OFFICE_ID, CITIZENS);
  // A single barangay within the subtree also resolves to its citizens.
  harness.notificationStore.seedCitizenScope(TENANT_ID, BARANGAY_IN_SCOPE, [CITIZENS[0]]);

  // Office-scope guard: the LGU office itself and the in-scope barangay are in the
  // subtree; the out-of-scope barangay is NOT seeded, so isOfficeInScope → false.
  harness.notificationStore.seedOfficeScope(TENANT_ID, LGU_OFFICE_ID, [
    LGU_OFFICE_ID,
    BARANGAY_IN_SCOPE,
  ]);

  async function tokenFor(callsign: string): Promise<string> {
    const response = await handleLogin(
      new Request(
        'http://localhost/api/auth/login',
        jsonBody('POST', { email: `${callsign.toLowerCase()}@aira.test`, password: TEST_PASSWORD }),
      ),
      harness.deps,
    );
    const cookie = response.headers.get('set-cookie') ?? '';
    const token = /aira_session=([A-Za-z0-9_-]+)/.exec(cookie)?.[1];
    if (!token) {
      throw new Error(`login_failed_${callsign}_${response.status}`);
    }
    return token;
  }

  return { ...harness, tokenFor };
}

let world: ReturnType<typeof makeWorld>;

beforeEach(() => {
  world = makeWorld();
});

describe('POST /api/broadcasts — authorization (R13.1, R13.2)', () => {
  it('denies an unauthenticated caller with zero delivery and zero accepted audit', async () => {
    const response = await handleCreateBroadcast(
      new Request(URL, jsonBody('POST', { message: MESSAGE, granularity: 'tenant' })),
      world.deps,
    );

    expect(response.status).toBe(401);
    expect(world.notificationStore.notifications).toHaveLength(0);
    expect(world.notificationStore.deliveries).toHaveLength(0);
    expect(
      world.notificationStore.broadcastAudits.filter((a) => a.outcome === 'accepted'),
    ).toHaveLength(0);
  });

  it('denies a RESPONDER (lacks civilian-broadcast) 403 with zero delivery', async () => {
    const token = await world.tokenFor('K9-01');

    const response = await handleCreateBroadcast(
      withSession(URL, token, jsonBody('POST', { message: MESSAGE, granularity: 'tenant' })),
      world.deps,
    );

    expect(response.status).toBe(403);
    expect(world.notificationStore.notifications).toHaveLength(0);
    expect(world.notificationStore.deliveries).toHaveLength(0);
    expect(
      world.notificationStore.broadcastAudits.filter((a) => a.outcome === 'accepted'),
    ).toHaveLength(0);
  });
});

describe('POST /api/broadcasts — targeting resolution (R13.3, R13.4, R13.6)', () => {
  it('delivers a whole-tenant broadcast to every in-scope citizen (one notification each)', async () => {
    const token = await world.tokenFor('OPCEN-01');

    const response = await handleCreateBroadcast(
      withSession(URL, token, jsonBody('POST', { message: MESSAGE, granularity: 'tenant' })),
      world.deps,
    );

    expect(response.status).toBe(200);

    // One In_App notification per in-scope citizen (R13.6 / R14 minimum).
    const notified = world.notificationStore.notifications.map((n) => n.recipient.principalId);
    expect(notified.sort()).toEqual(['citizen-1', 'citizen-2', 'citizen-3']);
    for (const n of world.notificationStore.notifications) {
      expect(n.recipient.tier).toBe('citizens');
      expect(n.payload.title).toBe(MESSAGE.title);
      expect(n.payload.body).toBe(MESSAGE.body);
    }

    // At minimum an in_app delivery row exists for each targeted citizen (R14).
    const inAppDeliveries = world.notificationStore.deliveries.filter(
      (d) => d.channel === 'in_app' && d.outcome === 'sent',
    );
    expect(inAppDeliveries).toHaveLength(CITIZENS.length);
  });

  it('delivers a barangay-targeted broadcast to an in-scope office', async () => {
    const token = await world.tokenFor('OPCEN-01');

    const response = await handleCreateBroadcast(
      withSession(
        URL,
        token,
        jsonBody('POST', {
          message: MESSAGE,
          granularity: 'barangay',
          targetOfficeId: BARANGAY_IN_SCOPE,
        }),
      ),
      world.deps,
    );

    expect(response.status).toBe(200);

    const notified = world.notificationStore.notifications.map((n) => n.recipient.principalId);
    expect(notified).toEqual(['citizen-1']);
  });
});

describe('POST /api/broadcasts — tenant-isolation denial (R13.5, R16.2, R22.3)', () => {
  it('denies an out-of-subtree barangay target atomically: zero delivery, denied audit, violation', async () => {
    const token = await world.tokenFor('OPCEN-01');

    const response = await handleCreateBroadcast(
      withSession(
        URL,
        token,
        jsonBody('POST', {
          message: MESSAGE,
          granularity: 'barangay',
          targetOfficeId: BARANGAY_OUT_OF_SCOPE,
        }),
      ),
      world.deps,
    );

    // Atomic denial — no partial delivery (R13.5, R16.2).
    expect(world.notificationStore.notifications).toHaveLength(0);
    expect(world.notificationStore.deliveries).toHaveLength(0);

    // The response indicates the targeting violation, not success.
    expect(response.status).toBeGreaterThanOrEqual(400);
    const payload = (await response.json()) as { error?: string; violation?: string };
    const indicatesViolation =
      typeof payload.violation === 'string' ||
      /violation|scope|forbidden|target/i.test(payload.error ?? '');
    expect(indicatesViolation).toBe(true);

    // A 'denied' broadcast audit with a recorded violation (R13.7).
    const denied = world.notificationStore.broadcastAudits.filter((a) => a.outcome === 'denied');
    expect(denied).toHaveLength(1);
    expect(denied[0]!.violation).toBeTruthy();
    expect(denied[0]!.recipientCount).toBe(0);
    expect(denied[0]!.targetOfficeId).toBe(BARANGAY_OUT_OF_SCOPE);

    // Nothing was accepted.
    expect(
      world.notificationStore.broadcastAudits.filter((a) => a.outcome === 'accepted'),
    ).toHaveLength(0);
  });
});

describe('POST /api/broadcasts — accepted audit (R13.7)', () => {
  it('records an accepted audit with sender id/role, tenant, granularity, count, and outcome', async () => {
    const token = await world.tokenFor('ADMIN-1');

    const response = await handleCreateBroadcast(
      withSession(
        URL,
        token,
        jsonBody('POST', { message: MESSAGE, critical: true, granularity: 'tenant' }),
      ),
      world.deps,
    );

    expect(response.status).toBe(200);

    const accepted = world.notificationStore.broadcastAudits.filter(
      (a) => a.outcome === 'accepted',
    );
    expect(accepted).toHaveLength(1);

    const audit = accepted[0]!;
    expect(audit.senderId).toBe('responder-admin');
    expect(audit.senderRole).toBe('ADMIN');
    expect(audit.tenantId).toBe(TENANT_ID);
    expect(audit.granularity).toBe('tenant');
    expect(audit.recipientCount).toBe(CITIZENS.length);
    expect(audit.violation).toBeNull();
    expect(typeof audit.at).toBe('number');

    // Critical broadcast still persists the In_App copy for every recipient (R14.2).
    for (const n of world.notificationStore.notifications) {
      expect(n.critical).toBe(true);
    }
  });
});
