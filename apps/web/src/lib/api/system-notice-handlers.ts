/**
 * `/api/system-notices` handler: the Platform_Tier broadcast that reaches every
 * user across all three Identity_Tiers (R15, R16.3, R16.4).
 *
 * Authorization is Platform_Tier only: a same-origin request carrying a platform
 * session (`authenticatePlatform`) plus the documented `PLATFORM_CAN_SYSTEM_NOTICE`
 * capability. A responder/citizen/unauthenticated caller is denied with zero
 * delivery and no audit (R15.1, R15.2).
 *
 * On success the notice fans out to every principal returned by
 * `listAllPrincipals()` across all three tiers via `notifyMany` (subject to
 * Channel_Preference / R14), a single system-notice audit row is recorded
 * (sender id + UTC, R15.6), and the handler returns a bare acknowledgement.
 *
 * Separation of duties: this handler WRITES notifications only. It never reads or
 * returns citizen/incident data — the response body carries only a recipient
 * count (R15.5, R16.3). Granting a platform operator the ability to broadcast
 * never grants them responder/citizen read access.
 */

import { PLATFORM_CAN_SYSTEM_NOTICE } from '../auth/rbac';
import { notifyMany } from '../notifications/service';
import type { NotificationPayload } from '../notifications/types';
import { authenticatePlatform } from './platform-handlers';
import type { AppDeps } from './deps';
import { errorResponse, isSameOrigin, jsonResponse, readJsonObject } from './http';

const MAX_TITLE = 200;
const MAX_BODY = 4000;

function isNonEmptyBounded(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

export async function handleCreateSystemNotice(request: Request, deps: AppDeps): Promise<Response> {
  // CSRF guard for the mutation.
  if (!isSameOrigin(request)) {
    return errorResponse(403, 'forbidden_origin');
  }

  // Platform_Tier only. A responder/citizen/unauthenticated caller never resolves
  // a platform principal, so they are denied with zero delivery (R15.2).
  const principal = await authenticatePlatform(request, deps);
  if (!principal) {
    return errorResponse(401, 'unauthenticated');
  }

  // Capability gate (R15.1). System_Notice is a platform-tier capability, not a
  // responder Role permission, so it is checked as a constant alongside the
  // platform session.
  if (!PLATFORM_CAN_SYSTEM_NOTICE) {
    return errorResponse(403, 'forbidden');
  }

  const body = await readJsonObject(request);
  if (!body) {
    return errorResponse(400, 'invalid_json');
  }

  const message = body.message;
  if (typeof message !== 'object' || message === null || Array.isArray(message)) {
    return errorResponse(400, 'invalid_notice');
  }
  const { title, body: text } = message as Record<string, unknown>;
  if (!isNonEmptyBounded(title, MAX_TITLE) || !isNonEmptyBounded(text, MAX_BODY)) {
    return errorResponse(400, 'invalid_notice');
  }

  const critical = body.critical === undefined ? false : body.critical;
  if (typeof critical !== 'boolean') {
    return errorResponse(400, 'invalid_notice');
  }

  // Fan out to every principal across all three tiers (R15.3). The handler writes
  // notifications only; it never reads incident/citizen rows (R15.5, R16.3).
  const recipients = await deps.notifications.store.listAllPrincipals();

  const payload: NotificationPayload = {
    type: 'system.notice',
    data: { title, body: text, critical },
    title,
    body: text,
  };

  await notifyMany(deps.notifications, recipients, payload, { critical });

  // Record the audit row: sender id + UTC, exactly once (R15.6).
  await deps.notifications.store.recordSystemNoticeAudit({
    senderId: principal.adminId,
    at: deps.notifications.now(),
  });

  // Acknowledgement only — no citizen/incident data (R15.5, R16.3).
  return jsonResponse({ ok: true, recipientCount: recipients.length }, 201);
}
