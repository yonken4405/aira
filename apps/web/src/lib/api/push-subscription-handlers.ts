/**
 * `/api/notifications/subscriptions` handlers: Web_Push subscription registration.
 *
 * A browser that has been granted the Notification permission posts its
 * `PushSubscription` here so the server can later deliver Web_Push notifications. The
 * subscription is bound to the SIGNED-IN principal's `(tier, principalId)` pair — the
 * same tier-scoped recipient key the notification engine addresses (R9.4). Ownership
 * is enforced on the server: the recipient is derived from the authenticated session,
 * never from the request body, so a caller can only ever register, replace, or delete
 * its OWN subscription and can never touch another principal's.
 *
 * The endpoint spans the three identity tiers (responders, platform admins, citizens),
 * each resolved from its own session cookie with no cross-tier trust.
 */

import type { PrincipalRef } from '../notifications/types';
import { authenticateCitizen } from './citizen-handlers';
import type { AppDeps } from './deps';
import {
  errorResponse,
  isNonEmptyString,
  isSameOrigin,
  jsonResponse,
  readJsonObject,
} from './http';
import { authenticatePlatform } from './platform-handlers';
import { authenticate } from './session-guard';

/** Push endpoints and keys are bounded so a hostile client cannot store unbounded data. */
const MAX_ENDPOINT_LENGTH = 2048;
const MAX_KEY_LENGTH = 512;

/**
 * Resolves the caller's tier-scoped recipient from whichever session cookie is
 * present. Each tier is checked independently (no cross-tier trust); the first that
 * authenticates wins. Returns `null` for an unauthenticated request.
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

interface ParsedSubscription {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
}

/**
 * Parses the browser `PushSubscription` JSON shape:
 * `{ endpoint, keys: { p256dh, auth } }`. Returns `null` for any malformed body.
 */
function parseSubscription(body: Record<string, unknown>): ParsedSubscription | null {
  const { endpoint, keys } = body;
  if (!isNonEmptyString(endpoint, MAX_ENDPOINT_LENGTH)) {
    return null;
  }
  if (typeof keys !== 'object' || keys === null) {
    return null;
  }
  const { p256dh, auth } = keys as Record<string, unknown>;
  if (!isNonEmptyString(p256dh, MAX_KEY_LENGTH) || !isNonEmptyString(auth, MAX_KEY_LENGTH)) {
    return null;
  }
  return { endpoint, p256dh, auth };
}

/**
 * POST — register (or replace) the caller's Web_Push subscription.
 *
 * Same-origin + authenticated. The subscription is persisted against the recipient
 * derived from the session, so it is owner-scoped by construction (R9.4). Re-posting
 * the same endpoint upserts rather than duplicating (the store keys on
 * `(recipient, endpoint)`).
 */
export async function handleRegisterPushSubscription(
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

  const body = await readJsonObject(request);
  if (!body) {
    return errorResponse(400, 'invalid_json');
  }

  const subscription = parseSubscription(body);
  if (!subscription) {
    return errorResponse(400, 'invalid_subscription');
  }

  await deps.notifications.store.saveSubscription({
    recipient,
    endpoint: subscription.endpoint,
    p256dh: subscription.p256dh,
    auth: subscription.auth,
    at: deps.notifications.now(),
  });

  return jsonResponse({ ok: true }, 201);
}

/**
 * DELETE — unsubscribe the caller's Web_Push subscription by endpoint.
 *
 * Same-origin + authenticated. Deletion is scoped to the caller's own recipient, so a
 * caller can never remove another principal's subscription even if it knows the
 * endpoint (R9.4).
 */
export async function handleUnregisterPushSubscription(
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

  const body = await readJsonObject(request);
  if (!body) {
    return errorResponse(400, 'invalid_json');
  }

  const { endpoint } = body;
  if (!isNonEmptyString(endpoint, MAX_ENDPOINT_LENGTH)) {
    return errorResponse(400, 'invalid_subscription');
  }

  await deps.notifications.store.deleteSubscription(recipient, endpoint);

  return jsonResponse({ ok: true }, 200);
}
