/**
 * @vitest-environment node
 *
 * System-notice API (`/api/system-notices`) — the platform-team broadcast that
 * reaches every user across all three Identity_Tiers (R15, R16.3, R16.4).
 *
 * These are the failing integration tests for task 27.1. They drive the (not yet
 * implemented) real handler `handleCreateSystemNotice(request, deps)` from
 * `system-notice-handlers.ts` with the memory `NotificationStore` from the test
 * harness (TESTING.md §4.3), and assert on the persisted `notificationStore`
 * rows: `notifications[]` for the fan-out/deliveries and `systemNoticeAudits[]`
 * for the audit capture.
 *
 * The platform session is obtained the way `api-platform.test.ts` does it: seed a
 * platform admin via `platformStore.seedAdmin`, log in via `handlePlatformLogin`,
 * and extract the `PLATFORM_SESSION_COOKIE` token from the `set-cookie` header.
 *
 * ── Request body contract (documented for 27.2) ──────────────────────────────
 * POST /api/system-notices
 *   {
 *     message: { title: string; body: string },
 *     critical?: boolean   // defaults to false; true forces channels per R14.3
 *   }
 * Authorization: a Platform_Tier session (authenticatePlatform) plus the
 * PLATFORM_CAN_SYSTEM_NOTICE capability. On success the handler fans the notice
 * out to every principal from `listAllPrincipals()` across all three tiers via
 * `notifyMany` (subject to Channel_Preference / R14), then records a system-notice
 * audit row (sender id + UTC). It writes notifications ONLY — it never reads or
 * returns citizen/incident data (R15.5, R16.3).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { hashPassword } from '../src/lib/auth/password';
import { handlePlatformLogin } from '../src/lib/api/platform-handlers';
// Does NOT exist yet — 27.2 will create it. Importing it here makes this suite
// fail to load (red), which is the intended TDD state for 27.1.
import { handleCreateSystemNotice } from '../src/lib/api/system-notice-handlers';
import { handleListIncidents } from '../src/lib/api/incidents-handlers';
import { PLATFORM_SESSION_COOKIE } from '../src/lib/platform/session';
import { SESSION_COOKIE } from '../src/lib/auth/session';
import type { PrincipalRef } from '../src/lib/notifications/types';
import { createTestHarness, jsonBody } from './support/harness';

const PASSWORD = 'correct horse battery staple';
const URL = 'http://localhost/api/system-notices';

const NOTICE = {
  message: {
    title: 'Scheduled maintenance',
    body: 'AIRA will be briefly unavailable tonight from 02:00 to 02:30 PHT.',
  },
};

/** Principals spanning all three Identity_Tiers for the fan-out assertions (R15.3). */
const ALL_PRINCIPALS: readonly PrincipalRef[] = [
  { tier: 'responders', principalId: 'responder-field' },
  { tier: 'responders', principalId: 'responder-dispatcher' },
  { tier: 'platform_admins', principalId: 'ops-1' },
  { tier: 'citizens', principalId: 'citizen-aaa' },
  { tier: 'citizens', principalId: 'citizen-bbb' },
];

let world: ReturnType<typeof createTestHarness>;

beforeEach(async () => {
  world = createTestHarness();
  world.platformStore.seedAdmin({
    id: 'ops-1',
    email: 'ops@aira.ph',
    passwordHash: await hashPassword(PASSWORD),
  });
  // The authoritative all-tiers recipient set returned by listAllPrincipals().
  world.notificationStore.seedAllPrincipals(ALL_PRINCIPALS);
});

/** Mints a platform session cookie token, exactly as api-platform.test.ts does. */
async function opsToken(): Promise<string> {
  const response = await handlePlatformLogin(
    new Request(
      'http://localhost/api/platform/login',
      jsonBody('POST', { email: 'ops@aira.ph', password: PASSWORD }),
    ),
    world.deps,
  );
  const cookie = response.headers.get('set-cookie') ?? '';
  const token = new RegExp(`${PLATFORM_SESSION_COOKIE}=([A-Za-z0-9_-]+)`).exec(cookie)?.[1];
  if (!token) {
    throw new Error(`platform_login_failed_${response.status}`);
  }
  return token;
}

const withPlatform = (token: string, init: RequestInit = {}): Request => {
  const headers = new Headers(init.headers);
  headers.set('cookie', `${PLATFORM_SESSION_COOKIE}=${token}`);
  return new Request(URL, { ...init, headers });
};

describe('POST /api/system-notices — authorization (R15.1, R15.2, R16.4)', () => {
  it('denies an unauthenticated caller with zero deliveries and no audit', async () => {
    const response = await handleCreateSystemNotice(
      new Request(URL, jsonBody('POST', NOTICE)),
      world.deps,
    );

    expect(response.status).toBe(401);
    expect(world.notificationStore.notifications).toHaveLength(0);
    expect(world.notificationStore.deliveries).toHaveLength(0);
    expect(world.notificationStore.systemNoticeAudits).toHaveLength(0);
  });

  it('denies a non-platform (responder-session) caller with zero deliveries and no audit', async () => {
    // A responder session cookie must never authorize a platform-tier send.
    world.authStore.seedResponder({
      id: 'responder-dispatcher',
      callsign: 'OPCEN-01',
      role: 'DISPATCHER',
    });
    const fabricatedResponderToken = 'a'.repeat(43);

    const response = await handleCreateSystemNotice(
      new Request(URL, {
        ...jsonBody('POST', NOTICE),
        headers: {
          'content-type': 'application/json',
          cookie: `${SESSION_COOKIE}=${fabricatedResponderToken}`,
        },
      }),
      world.deps,
    );

    expect([401, 403]).toContain(response.status);
    expect(world.notificationStore.notifications).toHaveLength(0);
    expect(world.notificationStore.deliveries).toHaveLength(0);
    expect(world.notificationStore.systemNoticeAudits).toHaveLength(0);
  });
});

describe('POST /api/system-notices — fan-out (R15.3, R15.4)', () => {
  it('fans out to every principal from listAllPrincipals across all three tiers', async () => {
    const token = await opsToken();

    const response = await handleCreateSystemNotice(
      withPlatform(token, jsonBody('POST', NOTICE)),
      world.deps,
    );

    expect(response.status).toBe(201);

    // One notification per principal across all three tiers (R15.3).
    expect(world.notificationStore.notifications).toHaveLength(ALL_PRINCIPALS.length);
    const addressed = world.notificationStore.notifications.map((n) => ({
      tier: n.recipient.tier,
      principalId: n.recipient.principalId,
    }));
    for (const ref of ALL_PRINCIPALS) {
      expect(addressed).toContainEqual({ tier: ref.tier, principalId: ref.principalId });
    }
    // Every tier is represented.
    const tiers = new Set(addressed.map((a) => a.tier));
    expect(tiers).toEqual(new Set(['responders', 'platform_admins', 'citizens']));

    // At minimum an in_app delivery is created for each recipient, subject to R14.
    const inAppDeliveries = world.notificationStore.deliveries.filter(
      (d) => d.channel === 'in_app',
    );
    expect(inAppDeliveries).toHaveLength(ALL_PRINCIPALS.length);
    for (const delivery of inAppDeliveries) {
      expect(delivery.outcome).toBe('sent');
    }

    // The rendered content is carried onto each notification.
    for (const n of world.notificationStore.notifications) {
      expect(n.payload.title).toBe(NOTICE.message.title);
      expect(n.payload.body).toBe(NOTICE.message.body);
    }
  });
});

describe('POST /api/system-notices — separation of duties (R15.5, R16.3)', () => {
  it('grants the sender no citizen/incident read access (handler only writes notifications)', async () => {
    const token = await opsToken();

    const response = await handleCreateSystemNotice(
      withPlatform(token, jsonBody('POST', NOTICE)),
      world.deps,
    );

    expect(response.status).toBe(201);

    // The response body carries no incident or citizen data — only an acknowledgement
    // (e.g. a recipient count), never reporter/category/citizen fields.
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty('incidents');
    expect(body).not.toHaveProperty('citizens');
    expect(JSON.stringify(body)).not.toMatch(/reporterCitizenId|category|incident/i);

    // The platform session still cannot reach a responder incident route as a result.
    const asResponder = await handleListIncidents(
      new Request('http://localhost/api/incidents', {
        headers: { cookie: `${SESSION_COOKIE}=${token}` },
      }),
      world.deps,
    );
    expect(asResponder.status).toBe(401);
  });
});

describe('POST /api/system-notices — audit (R15.6)', () => {
  it('records the sender id and a UTC timestamp exactly once', async () => {
    const token = await opsToken();

    const response = await handleCreateSystemNotice(
      withPlatform(token, jsonBody('POST', NOTICE)),
      world.deps,
    );

    expect(response.status).toBe(201);
    expect(world.notificationStore.systemNoticeAudits).toHaveLength(1);

    const audit = world.notificationStore.systemNoticeAudits[0]!;
    expect(audit.senderId).toBe('ops-1');
    expect(audit.at).toBe(world.clock.now());
  });
});
