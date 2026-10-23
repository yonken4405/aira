/**
 * @vitest-environment node
 *
 * Notifications API integration tests (`/api/notifications`, mark-read,
 * mark-all-read, preferences) — Task 25.1 (TDD RED).
 *
 * These tests are written BEFORE the handlers exist. They import from
 * `../src/lib/api/notifications-handlers`, which Task 25.2 must create, so this
 * suite fails at import time until the implementation lands. Do NOT implement the
 * handlers here.
 *
 * The suite drives the real handlers with the memory `NotificationStore` from the
 * test harness (TESTING.md §4.3) and the login→token→withSession flow mirrored from
 * `api-push-subscriptions.test.ts`. Notifications are seeded directly through
 * `notificationStore.createNotification(...)` so the handlers are exercised against
 * persisted rows.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * HANDLER CONTRACT (authoritative for Task 25.2 — implement EXACTLY these)
 * ──────────────────────────────────────────────────────────────────────────────
 * File: apps/web/src/lib/api/notifications-handlers.ts
 *
 * The caller's recipient is ALWAYS derived from the authenticated session via the
 * same cross-tier `resolveRecipient` pattern used by
 * `push-subscription-handlers.ts` (responders → platform_admins → citizens, first
 * cookie that authenticates wins). It is NEVER read from the request body or query,
 * so every read/mutation is owner-scoped by construction (R8.6). An unauthenticated
 * request yields `errorResponse(401, 'unauthenticated')`.
 *
 * Mutations additionally require `isSameOrigin(request)` (→ 403 'forbidden_origin'),
 * matching `http.ts` / the push-subscription handlers. GET is a read and is not
 * origin-gated (only authenticated).
 *
 *   handleListNotifications(request, deps): Promise<Response>
 *     - GET. Authenticated.
 *     - Default (no `?unread=1`): 200 with
 *         { ok: true, notifications: NotificationView[] }
 *       listing ONLY the caller's notifications in reverse-chronological order
 *       (newest first) (R8.2, R8.6).
 *     - With `?unread=1` (query on request.url): 200 with
 *         { ok: true, count: number, recent: NotificationView[] }
 *       where `count` is the caller's unread count and `recent` is the caller's
 *       recent list (reverse-chronological) (R8.3).
 *     - `NotificationView` exposes at least { id, type, read, createdAt, title, body }.
 *
 *   handleMarkNotificationRead(request, deps, id): Promise<Response>
 *     - POST. Authenticated + same-origin. `id` is the notification id (from the
 *       route segment `/api/notifications/[id]/read`).
 *     - Marks that ONE notification read, scoped to the caller: a caller can never
 *       mark another principal's notification read (R8.4, R8.6). Marking an id the
 *       caller does not own is a no-op for state (store.markRead is recipient-scoped)
 *       and still returns 200 { ok: true } (no existence oracle across principals).
 *
 *   handleMarkAllNotificationsRead(request, deps): Promise<Response>
 *     - POST. Authenticated + same-origin.
 *     - Marks every one of the caller's notifications read; caller's unread count
 *       becomes 0 (R8.5). Returns 200 { ok: true }.
 *
 *   handleGetPreferences(request, deps): Promise<Response>
 *     - GET. Authenticated.
 *     - 200 { ok: true, preference: { inApp, email, webPush } } — the caller's
 *       ChannelPreference, defaulting to all-enabled when none is stored (R7.3).
 *
 *   handleSetPreferences(request, deps): Promise<Response>
 *     - POST. Authenticated + same-origin.
 *     - Body: { inApp?: boolean, email?: boolean, webPush?: boolean }.
 *     - Persists the caller's ChannelPreference and returns
 *         200 { ok: true, preference: { inApp, email, webPush } } (R7.4).
 *     - R14.5 ENFORCEMENT (the chosen contract): an attempt to set `inApp: false`
 *       is REJECTED with `errorResponse(400, ...)` and NOTHING is persisted — the
 *       In_App channel can never be disabled because critical warnings must always
 *       reach the In_App copy. (The handler rejects rather than silently coercing.)
 * ──────────────────────────────────────────────────────────────────────────────
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { handleLogin } from '../src/lib/api/auth-handlers';
import {
  handleGetPreferences,
  handleListNotifications,
  handleMarkAllNotificationsRead,
  handleMarkNotificationRead,
  handleSetPreferences,
} from '../src/lib/api/notifications-handlers';
import type { PrincipalRef } from '../src/lib/notifications/types';
import { createTestHarness, jsonBody, withSession } from './support/harness';
import { TEST_PASSWORD } from './support/fixtures';

const LIST_URL = 'http://localhost/api/notifications';
const UNREAD_URL = 'http://localhost/api/notifications?unread=1';
const MARK_ALL_URL = 'http://localhost/api/notifications/mark-all-read';
const PREFS_URL = 'http://localhost/api/notifications/preferences';

const CALLER: PrincipalRef = { tier: 'responders', principalId: 'responder-field' };
const OTHER: PrincipalRef = { tier: 'responders', principalId: 'responder-dispatcher' };

function makeWorld() {
  const harness = createTestHarness();
  harness.authStore.seedResponder({
    id: 'responder-field',
    callsign: 'K9-01',
    role: 'RESPONDER',
  });
  harness.authStore.seedResponder({
    id: 'responder-dispatcher',
    callsign: 'OPCEN-01',
    role: 'DISPATCHER',
  });

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

  /** Seeds a notification for `recipient`, returning the persisted record. */
  async function seedNotification(
    recipient: PrincipalRef,
    type: string,
    createdAt: number,
    critical = false,
  ) {
    return harness.notificationStore.createNotification({
      recipient,
      type,
      payload: { type, data: {}, title: `title:${type}`, body: `body:${type}` },
      critical,
      createdAt,
    });
  }

  return { ...harness, tokenFor, seedNotification };
}

let world: ReturnType<typeof makeWorld>;

beforeEach(() => {
  world = makeWorld();
});

describe('GET /api/notifications (list)', () => {
  it('rejects an unauthenticated request', async () => {
    const response = await handleListNotifications(new Request(LIST_URL), world.deps);
    expect(response.status).toBe(401);
  });

  it("returns only the caller's notifications, reverse-chronological (R8.2, R8.6)", async () => {
    const token = await world.tokenFor('K9-01');

    // Seed for the caller (out of order) + a different principal.
    await world.seedNotification(CALLER, 'incident.assigned', 1_000);
    await world.seedNotification(CALLER, 'account.role_changed', 3_000);
    await world.seedNotification(CALLER, 'account.unlocked', 2_000);
    await world.seedNotification(OTHER, 'incident.assigned', 2_500);

    const response = await handleListNotifications(withSession(LIST_URL, token), world.deps);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      ok: boolean;
      notifications: { type: string; createdAt: number }[];
    };

    // Reverse-chronological: newest first.
    expect(body.notifications.map((n) => n.type)).toEqual([
      'account.role_changed',
      'account.unlocked',
      'incident.assigned',
    ]);
    // The other principal's notification never appears.
    const times = body.notifications.map((n) => n.createdAt);
    expect(times).not.toContain(2_500);
    expect(body.notifications).toHaveLength(3);
  });
});

describe('GET /api/notifications?unread=1 (count)', () => {
  it("returns the caller's unread count and recent list (R8.3)", async () => {
    const token = await world.tokenFor('K9-01');

    await world.seedNotification(CALLER, 'incident.assigned', 1_000);
    await world.seedNotification(CALLER, 'account.role_changed', 2_000);
    await world.seedNotification(OTHER, 'incident.assigned', 1_500);

    const response = await handleListNotifications(withSession(UNREAD_URL, token), world.deps);
    expect(response.status).toBe(200);

    const body = (await response.json()) as { ok: boolean; count: number };
    // Only the caller's two unread notifications are counted.
    expect(body.count).toBe(2);
  });
});

describe('POST /api/notifications/[id]/read (mark-read)', () => {
  it('rejects an unauthenticated request', async () => {
    const response = await handleMarkNotificationRead(
      new Request(`${LIST_URL}/notif-x/read`, { method: 'POST' }),
      world.deps,
      'notif-x',
    );
    expect(response.status).toBe(401);
  });

  it("marks the caller's own notification read and decrements unread (R8.4, R8.6)", async () => {
    const token = await world.tokenFor('K9-01');

    const first = await world.seedNotification(CALLER, 'incident.assigned', 1_000);
    await world.seedNotification(CALLER, 'account.role_changed', 2_000);

    const before = await world.notificationStore.countUnread(CALLER);
    expect(before).toBe(2);

    const response = await handleMarkNotificationRead(
      withSession(`${LIST_URL}/${first.id}/read`, token, { method: 'POST' }),
      world.deps,
      first.id,
    );
    expect(response.status).toBe(200);

    const after = await world.notificationStore.countUnread(CALLER);
    expect(after).toBe(1);
  });

  it("cannot mark another principal's notification read (R8.6)", async () => {
    const token = await world.tokenFor('K9-01');

    const foreign = await world.seedNotification(OTHER, 'incident.assigned', 1_000);

    const response = await handleMarkNotificationRead(
      withSession(`${LIST_URL}/${foreign.id}/read`, token, { method: 'POST' }),
      world.deps,
      foreign.id,
    );
    // Recipient-scoped mutation: the caller's request never touches OTHER's row.
    expect(response.status).toBe(200);
    expect(await world.notificationStore.countUnread(OTHER)).toBe(1);
  });
});

describe('POST /api/notifications/mark-all-read', () => {
  it('rejects an unauthenticated request', async () => {
    const response = await handleMarkAllNotificationsRead(
      new Request(MARK_ALL_URL, { method: 'POST' }),
      world.deps,
    );
    expect(response.status).toBe(401);
  });

  it("zeroes the caller's unread count without touching other principals (R8.5, R8.6)", async () => {
    const token = await world.tokenFor('K9-01');

    await world.seedNotification(CALLER, 'incident.assigned', 1_000);
    await world.seedNotification(CALLER, 'account.role_changed', 2_000);
    await world.seedNotification(OTHER, 'incident.assigned', 1_500);

    const response = await handleMarkAllNotificationsRead(
      withSession(MARK_ALL_URL, token, { method: 'POST' }),
      world.deps,
    );
    expect(response.status).toBe(200);

    expect(await world.notificationStore.countUnread(CALLER)).toBe(0);
    // The other principal's unread is untouched.
    expect(await world.notificationStore.countUnread(OTHER)).toBe(1);
  });
});

describe('GET /api/notifications/preferences', () => {
  it('rejects an unauthenticated request', async () => {
    const response = await handleGetPreferences(new Request(PREFS_URL), world.deps);
    expect(response.status).toBe(401);
  });

  it('returns the all-enabled default when none is stored (R7.3)', async () => {
    const token = await world.tokenFor('K9-01');

    const response = await handleGetPreferences(withSession(PREFS_URL, token), world.deps);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      ok: boolean;
      preference: { inApp: boolean; email: boolean; webPush: boolean };
    };
    expect(body.preference).toMatchObject({ inApp: true, email: true, webPush: true });
  });
});

describe('POST /api/notifications/preferences', () => {
  it('rejects an unauthenticated request', async () => {
    const response = await handleSetPreferences(
      new Request(PREFS_URL, jsonBody('POST', { email: false })),
      world.deps,
    );
    expect(response.status).toBe(401);
  });

  it('persists the caller ChannelPreference (R7.4)', async () => {
    const token = await world.tokenFor('K9-01');

    const response = await handleSetPreferences(
      withSession(PREFS_URL, token, jsonBody('POST', { inApp: true, email: false, webPush: true })),
      world.deps,
    );
    expect(response.status).toBe(200);

    const stored = await world.notificationStore.getPreference(CALLER);
    expect(stored).toMatchObject({ inApp: true, email: false, webPush: true });
  });

  it('rejects an attempt to disable In_App and persists nothing (R14.5)', async () => {
    const token = await world.tokenFor('K9-01');

    const response = await handleSetPreferences(
      withSession(PREFS_URL, token, jsonBody('POST', { inApp: false, email: true, webPush: true })),
      world.deps,
    );
    // The chosen contract: reject inApp:false with a 400 so R14.5 always holds.
    expect(response.status).toBe(400);

    // Nothing persisted → In_App stays enabled (the all-enabled default).
    const stored = await world.notificationStore.getPreference(CALLER);
    expect(stored.inApp).toBe(true);
  });
});
