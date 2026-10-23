/**
 * `/api/broadcasts` handler: the civilian-broadcast send (R13).
 *
 * A Civilian_Broadcast is created and sent by a Tenant principal whose role holds the
 * `civilian-broadcast` permission (DISPATCHER or ADMIN; R13.1, R13.2). Targeting is
 * bounded by the sender's Office_Subtree — the `OFFICE_SCOPE` CTE constrained by the
 * sender's `tenant_id` (R13.4, R16.1) — so the sender's `tenantId` and `officeId`
 * always come from the authenticated principal and are NEVER taken from the request
 * body.
 *
 * Any send that would address an office outside that subtree is refused ATOMICALLY:
 * no notification is created, no delivery is recorded, and a `denied` broadcast audit
 * row with a `violation` string is written before the error response is returned
 * (R13.5, R16.2, R22.3). An accepted send resolves the in-scope citizens, fans out via
 * `notifyMany`, and records an `accepted` audit row with the resolved recipient count
 * (R13.6, R13.7).
 */

import type { NotificationPayload, PrincipalRef } from '../notifications/types';
import { notifyMany } from '../notifications/service';
import type { AppDeps } from './deps';
import {
  errorResponse,
  isNonEmptyString,
  isSameOrigin,
  jsonResponse,
  readJsonObject,
} from './http';
import { authenticate, requirePermission } from './session-guard';

/** Rendered In_App title/body are bounded so a hostile client cannot store unbounded data. */
const MAX_TITLE_LENGTH = 200;
const MAX_BODY_LENGTH = 4000;
const MAX_OFFICE_ID_LENGTH = 200;

type Granularity = 'tenant' | 'barangay';

interface ParsedBroadcast {
  readonly title: string;
  readonly body: string;
  readonly critical: boolean;
  readonly granularity: Granularity;
  /** Required and non-null only for `granularity === 'barangay'`. */
  readonly targetOfficeId: string | null;
}

/**
 * Parses and validates the request body. The sender's tenant/office are resolved from
 * the session, so only the message, critical flag, and targeting live here. Returns
 * `null` for any malformed body (missing message, bad granularity, or a `barangay`
 * send without a `targetOfficeId`).
 */
function parseBroadcast(body: Record<string, unknown>): ParsedBroadcast | null {
  const { message, critical, granularity, targetOfficeId } = body;

  if (typeof message !== 'object' || message === null) {
    return null;
  }
  const { title, body: text } = message as Record<string, unknown>;
  if (!isNonEmptyString(title, MAX_TITLE_LENGTH) || !isNonEmptyString(text, MAX_BODY_LENGTH)) {
    return null;
  }

  if (critical !== undefined && typeof critical !== 'boolean') {
    return null;
  }

  if (granularity !== 'tenant' && granularity !== 'barangay') {
    return null;
  }

  let resolvedTarget: string | null = null;
  if (granularity === 'barangay') {
    if (!isNonEmptyString(targetOfficeId, MAX_OFFICE_ID_LENGTH)) {
      return null;
    }
    resolvedTarget = targetOfficeId;
  }

  return {
    title,
    body: text,
    critical: critical ?? false,
    granularity,
    targetOfficeId: resolvedTarget,
  };
}

/**
 * POST — authorize, resolve targeting inside the sender's subtree, and either deliver
 * to every in-scope citizen (accepted) or refuse atomically (denied).
 */
export async function handleCreateBroadcast(request: Request, deps: AppDeps): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse(403, 'forbidden_origin');
  }

  const auth = await authenticate(request, deps);
  if (!auth.ok) {
    return auth.response;
  }
  const { principal } = auth;

  // DISPATCHER + ADMIN hold `civilian-broadcast`; a RESPONDER does not (R13.1, R13.2).
  const denied = requirePermission(principal, 'civilian-broadcast');
  if (denied) {
    return denied;
  }

  const body = await readJsonObject(request);
  if (!body) {
    return errorResponse(400, 'invalid_json');
  }

  const parsed = parseBroadcast(body);
  if (!parsed) {
    return errorResponse(400, 'invalid_broadcast');
  }

  const { notifications } = deps;
  const { store, now } = notifications;
  const { tenantId, officeId } = principal;

  // The subtree root: a whole-tenant send roots at the sender's own office; a
  // barangay send roots at the explicit target office (R13.3, R13.4).
  const root = parsed.granularity === 'tenant' ? officeId : (parsed.targetOfficeId as string);

  // A barangay target must prove it is inside the sender's subtree BEFORE any
  // delivery. The sender's own office is implicitly in scope, so a whole-tenant send
  // skips the guard (R13.5, R16.2).
  if (parsed.granularity === 'barangay') {
    const inScope = await store.isOfficeInScope(tenantId, officeId, root);
    if (!inScope) {
      // Atomic denial: deliver nothing, record a `denied` audit with the violation,
      // then return an error that carries the targeting violation (R13.5, R13.7, R16.2).
      const violation = `target office ${root} is outside the sender's office subtree`;
      await store.recordBroadcastAudit({
        senderId: principal.responderId,
        senderRole: principal.role,
        tenantId,
        granularity: parsed.granularity,
        targetOfficeId: parsed.targetOfficeId,
        recipientCount: 0,
        outcome: 'denied',
        violation,
        at: now(),
      });

      return errorResponse(403, 'targeting_violation', { violation });
    }
  }

  // Authorized + in scope: resolve the in-scope citizens and fan out (R13.6, R16.1).
  const recipients: readonly PrincipalRef[] = await store.resolveCitizensInOfficeScope(
    tenantId,
    root,
  );

  const payload: NotificationPayload = {
    type: 'civilian.broadcast',
    data: {
      granularity: parsed.granularity,
      targetOfficeId: parsed.targetOfficeId,
      senderId: principal.responderId,
      senderRole: principal.role,
      tenantId,
    },
    title: parsed.title,
    body: parsed.body,
  };

  await notifyMany(notifications, recipients, payload, { critical: parsed.critical });

  await store.recordBroadcastAudit({
    senderId: principal.responderId,
    senderRole: principal.role,
    tenantId,
    granularity: parsed.granularity,
    targetOfficeId: parsed.granularity === 'tenant' ? null : parsed.targetOfficeId,
    recipientCount: recipients.length,
    outcome: 'accepted',
    violation: null,
    at: now(),
  });

  return jsonResponse({ ok: true, recipientCount: recipients.length }, 200);
}
