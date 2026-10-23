/**
 * `/api/notifications` handlers: the caller's In_App inbox, read-state mutations,
 * and per-channel delivery preferences (R7, R8, R14.5).
 *
 * Every read and mutation is scoped to the authenticated caller. The recipient is
 * ALWAYS derived from the session via the same cross-tier `resolveRecipient`
 * pattern as `push-subscription-handlers.ts` (responders → platform admins →
 * citizens, first cookie that authenticates wins) and is NEVER read from the
 * request body or query. This makes every operation owner-scoped by construction:
 * a caller can only ever see or mutate its OWN notifications and preferences, and
 * can never address another principal (R8.6).
 *
 * Reads (GET) require only authentication. Mutations (POST) additionally require a
 * same-origin request (CSRF guard), matching `http.ts` and the push handlers.
 */

import type { ChannelPreference, NotificationRecord, PrincipalRef } from '../notifications/types';
import { authenticateCitizen } from './citizen-handlers';
import type { AppDeps } from './deps';
import { errorResponse, isSameOrigin, jsonResponse, readJsonObject } from './http';
import { authenticatePlatform } from './platform-handlers';
import { authenticate } from './session-guard';

/** Upper bound on how many notifications a single list call returns. */
const LIST_LIMIT = 50;

/**
 * The client-facing projection of a persisted notification. The rendered
 * `title`/`body` are lifted out of the payload so the inbox UI never has to reach
 * into the structured `data` (R8.2, R9.7).
 */
export interface NotificationView {
  readonly id: string;
  readonly type: string;
  readonly read: boolean;
  readonly createdAt: number;
  readonly title: string;
  readonly body: string;
}

/**
 * Resolves the caller's tier-scoped recipient from whichever session cookie is
 * present. Each tier is checked independently (no cross-tier trust); the first that
 * authenticates wins. Returns `null` for an unauthenticated request. Mirrors
 * `push-subscription-handlers.ts` so both endpoints key recipients identically.
 */
async function resolveRecipient(request: Request, deps: AppDeps): Promise<PrincipalRef | null> {
  const responder = await authenticate(request, deps);
  if (responder.ok) {
    return { tier: 'responders', principalId: responder.principal.responderId };
  }

  const platform = await authenticatePlatform(request, deps);
  if (platform) {
    return { tier: 'platform_admins', principalId: platform.adminId };
  }

  const citizen = await authenticateCitizen(request, deps);
  if (citizen) {
    return { tier: 'citizens', principalId: citizen.citizenId };
  }

  return null;
}

/** Projects a persisted record to the client view, lifting the rendered payload. */
function toView(record: NotificationRecord): NotificationView {
  return {
    id: record.id,
    type: record.type,
    read: record.read,
    createdAt: record.createdAt,
    title: record.payload.title,
    body: record.payload.body,
  };
}

/**
 * GET — list the caller's In_App notifications, newest first.
 *
 * Default: `{ ok, notifications }` — the caller's full recent list (R8.2, R8.6).
 * With `?unread=1`: `{ ok, count, recent }` — the caller's unread count plus the
 * same recent list, for the badge/dropdown (R8.3). `store.listForRecipient` already
 * returns reverse-chronological, owner-scoped rows.
 */
export async function handleListNotifications(request: Request, deps: AppDeps): Promise<Response> {
  const recipient = await resolveRecipient(request, deps);
  if (!recipient) {
    return errorResponse(401, 'unauthenticated');
  }

  const store = deps.notifications.store;
  const records = await store.listForRecipient(recipient, LIST_LIMIT);
  const notifications = records.map(toView);

  const unread = new URL(request.url).searchParams.get('unread') === '1';
  if (unread) {
    const count = await store.countUnread(recipient);
    return jsonResponse({ ok: true, count, recent: notifications });
  }

  return jsonResponse({ ok: true, notifications });
}

/**
 * POST — mark ONE of the caller's notifications read.
 *
 * Same-origin + authenticated. `store.markRead` is recipient-scoped, so passing an
 * id the caller does not own is a no-op for state (no cross-principal existence
 * oracle) and still returns 200 (R8.4, R8.6).
 */
export async function handleMarkNotificationRead(
  request: Request,
  deps: AppDeps,
  id: string,
): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse(403, 'forbidden_origin');
  }

  const recipient = await resolveRecipient(request, deps);
  if (!recipient) {
    return errorResponse(401, 'unauthenticated');
  }

  await deps.notifications.store.markRead(recipient, id);
  return jsonResponse({ ok: true });
}

/**
 * POST — mark every one of the caller's notifications read.
 *
 * Same-origin + authenticated. The caller's unread count becomes 0; other
 * principals are untouched (R8.5, R8.6).
 */
export async function handleMarkAllNotificationsRead(
  request: Request,
  deps: AppDeps,
): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse(403, 'forbidden_origin');
  }

  const recipient = await resolveRecipient(request, deps);
  if (!recipient) {
    return errorResponse(401, 'unauthenticated');
  }

  await deps.notifications.store.markAllRead(recipient);
  return jsonResponse({ ok: true });
}

/** Projects a stored preference down to the client-facing channel flags. */
function toPreferenceView(pref: ChannelPreference): {
  inApp: boolean;
  email: boolean;
  webPush: boolean;
} {
  return { inApp: pref.inApp, email: pref.email, webPush: pref.webPush };
}

/**
 * GET — the caller's per-channel delivery preferences.
 *
 * Authenticated. `store.getPreference` defaults to all-enabled when none is stored
 * (R7.3).
 */
export async function handleGetPreferences(request: Request, deps: AppDeps): Promise<Response> {
  const recipient = await resolveRecipient(request, deps);
  if (!recipient) {
    return errorResponse(401, 'unauthenticated');
  }

  const preference = await deps.notifications.store.getPreference(recipient);
  return jsonResponse({ ok: true, preference: toPreferenceView(preference) });
}

/** Reads an optional boolean field; returns `undefined` for absent, throws nothing. */
function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * POST — update the caller's per-channel delivery preferences.
 *
 * Same-origin + authenticated. Body `{ inApp?, email?, webPush? }` is merged onto
 * the caller's current preference, so an omitted field keeps its stored value
 * (R7.4).
 *
 * R14.5: In_App can never be disabled — a critical warning must always reach the
 * In_App copy. An explicit `inApp: false` is REJECTED with 400 and NOTHING is
 * persisted (the handler refuses rather than silently coercing).
 */
export async function handleSetPreferences(request: Request, deps: AppDeps): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse(403, 'forbidden_origin');
  }

  const recipient = await resolveRecipient(request, deps);
  if (!recipient) {
    return errorResponse(401, 'unauthenticated');
  }

  const body = await readJsonObject(request);
  if (!body) {
    return errorResponse(400, 'invalid_json');
  }

  const inApp = optionalBoolean(body.inApp);
  const email = optionalBoolean(body.email);
  const webPush = optionalBoolean(body.webPush);

  // R14.5: refuse to disable In_App — persist nothing.
  if (inApp === false) {
    return errorResponse(400, 'in_app_required');
  }

  const store = deps.notifications.store;
  const current = await store.getPreference(recipient);

  const next: ChannelPreference = {
    recipient,
    inApp: inApp ?? current.inApp,
    email: email ?? current.email,
    webPush: webPush ?? current.webPush,
  };

  await store.setPreference(next);
  return jsonResponse({ ok: true, preference: toPreferenceView(next) });
}
