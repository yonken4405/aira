/**
 * `/api/admin/*` handlers - account roster and authentication audit.
 *
 * ADMIN holds no incident permission, so nothing here can read citizen data
 * (SECURITY.md §4). Every mutation writes an auth audit event.
 */

import { t } from '@aira/ui';

import { generatePassword } from '../auth/password';
import { isRole } from '../auth/rbac';
import { createResponder, revokeResponderSessions, updateResponder } from '../auth/service';
import type { UpdateResponderPatch } from '../auth/types';
import { toResponderView } from '../auth/view';
import { notifyOne, notifySafe } from '../notifications/service';
import type { NotificationPayload } from '../notifications/types';
import {
  createAgency,
  listAgenciesForTenant,
  readCapabilityConfig,
  renameAgency,
  setAgencyActive,
  setCapabilityForCategory,
  type ResponderNetworkDeps,
} from '../responder-network/service';
import type { AppDeps } from './deps';
import {
  errorResponse,
  isNonEmptyString,
  isSameOrigin,
  jsonResponse,
  NO_STORE_HEADERS,
  readJsonObject,
} from './http';
import { authenticate, requirePermission } from './session-guard';

const DEFAULT_AUDIT_LIMIT = 100;
const MAX_AUDIT_LIMIT = 200;

export async function handleListResponders(request: Request, deps: AppDeps): Promise<Response> {
  const context = await authenticate(request, deps);
  if (!context.ok) {
    return context.response;
  }

  // The full roster (last sign-in, session counts, status) is admin-only; dispatchers
  // use the narrower assignee picker in `/api/responders`.
  const forbidden = requirePermission(context.principal, 'responder:manage');
  if (forbidden) {
    return forbidden;
  }

  const [responders, offices, agencies] = await Promise.all([
    deps.authStore.listResponders(context.principal.tenantId),
    deps.authStore.listOffices(context.principal.tenantId),
    deps.authStore.listAgencies(),
  ]);

  return jsonResponse(
    {
      ok: true,
      responders: responders.map((row) => toResponderView(row, row.sessionCount)),
      offices,
      agencies,
    },
    200,
    { ...NO_STORE_HEADERS },
  );
}

export async function handleCreateResponder(request: Request, deps: AppDeps): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse(403, 'forbidden_origin');
  }

  const context = await authenticate(request, deps);
  if (!context.ok) {
    return context.response;
  }

  const forbidden = requirePermission(context.principal, 'responder:manage');
  if (forbidden) {
    return forbidden;
  }

  const body = await readJsonObject(request);
  if (!body) {
    return errorResponse(400, 'invalid_json');
  }

  const { email, callsign, role, officeId, agencyId, password, mustChangePassword } = body;

  if (!isNonEmptyString(email, 254) || !isRole(role) || !isNonEmptyString(officeId, 64)) {
    return errorResponse(400, 'invalid_responder');
  }
  // Callsign is an optional display label.
  if (callsign !== undefined && callsign !== null && !isNonEmptyString(callsign, 32)) {
    return errorResponse(400, 'invalid_responder');
  }
  if (agencyId !== undefined && agencyId !== null && !isNonEmptyString(agencyId, 64)) {
    return errorResponse(400, 'invalid_responder');
  }
  if (password !== undefined && !isNonEmptyString(password, 128)) {
    return errorResponse(400, 'invalid_password');
  }

  // Generated passwords are shown exactly once, to the admin creating the account.
  const initialPassword = typeof password === 'string' ? password : generatePassword();

  const result = await createResponder(deps.auth, {
    email,
    callsign: typeof callsign === 'string' ? callsign : null,
    role,
    officeId,
    agencyId: typeof agencyId === 'string' ? agencyId : null,
    password: initialPassword,
    mustChangePassword: mustChangePassword !== false,
  });

  if (result.status === 'invalid_email') {
    return errorResponse(400, 'invalid_email');
  }
  if (result.status === 'invalid_callsign') {
    return errorResponse(400, 'invalid_responder');
  }
  if (result.status === 'conflict') {
    return errorResponse(409, 'email_taken');
  }
  if (result.status === 'weak') {
    return errorResponse(400, 'weak_password', { problem: result.problem });
  }

  return jsonResponse(
    { ok: true, responder: toResponderView(result.responder), password: initialPassword },
    201,
    { ...NO_STORE_HEADERS },
  );
}

export async function handleUpdateResponder(
  request: Request,
  deps: AppDeps,
  responderId: string,
): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse(403, 'forbidden_origin');
  }

  const context = await authenticate(request, deps);
  if (!context.ok) {
    return context.response;
  }

  const forbidden = requirePermission(context.principal, 'responder:manage');
  if (forbidden) {
    return forbidden;
  }

  const body = await readJsonObject(request);
  if (!body) {
    return errorResponse(400, 'invalid_json');
  }

  const patch: { -readonly [K in keyof UpdateResponderPatch]: UpdateResponderPatch[K] } = {};

  if (body.role !== undefined) {
    if (!isRole(body.role)) {
      return errorResponse(400, 'invalid_role');
    }
    patch.role = body.role;
  }
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') {
      return errorResponse(400, 'invalid_active');
    }
    patch.active = body.active;
  }
  if (body.unlock !== undefined) {
    if (typeof body.unlock !== 'boolean') {
      return errorResponse(400, 'invalid_unlock');
    }
    patch.unlock = body.unlock;
  }
  if (body.mustChangePassword !== undefined) {
    if (typeof body.mustChangePassword !== 'boolean') {
      return errorResponse(400, 'invalid_must_change_password');
    }
    patch.mustChangePassword = body.mustChangePassword;
  }

  if (Object.keys(patch).length === 0) {
    return errorResponse(400, 'empty_patch');
  }

  // An admin cannot demote or disable themselves - that is a lockout, not a permission.
  if (responderId === context.principal.responderId) {
    if (patch.active === false) {
      return errorResponse(409, 'cannot_deactivate_self');
    }
    if (patch.role !== undefined && patch.role !== context.principal.role) {
      return errorResponse(409, 'cannot_change_own_role');
    }
  }

  const updated = await updateResponder(deps.auth, responderId, patch);
  if (!updated) {
    return errorResponse(404, 'responder_not_found');
  }

  // Post-success event hook (R11.2, R11.4): notify ONLY the affected responder —
  // never the acting admin or any other account. A role change, deactivation, or
  // unlock each gets its own account event. Fail-soft so a notification failure
  // can never change this already-committed 200 (R10.5).
  const accountEvent = accountEventFor(patch);
  if (accountEvent) {
    await notifySafe(() =>
      notifyOne(
        deps.notifications,
        { tier: 'responders', principalId: responderId },
        accountEvent,
        { critical: false },
      ),
    );
  }

  return jsonResponse({ ok: true, responder: toResponderView(updated) }, 200, {
    ...NO_STORE_HEADERS,
  });
}

/**
 * Maps an admin responder patch to the single account notification it represents,
 * or `null` when the patch carries no notifiable account event (R11.2). Only one
 * event is emitted per request; role change takes precedence, then deactivate,
 * then unlock. Payload data carries no PII.
 */
function accountEventFor(patch: UpdateResponderPatch): NotificationPayload | null {
  if (patch.role !== undefined) {
    return {
      type: 'account.role_changed',
      data: {},
      title: t('notifyAccountRoleChangedTitle'),
      body: t('notifyAccountRoleChangedBody'),
    };
  }
  if (patch.active === false) {
    return {
      type: 'account.deactivated',
      data: {},
      title: t('notifyAccountDeactivatedTitle'),
      body: t('notifyAccountDeactivatedBody'),
    };
  }
  if (patch.unlock === true) {
    return {
      type: 'account.unlocked',
      data: {},
      title: t('notifyAccountUnlockedTitle'),
      body: t('notifyAccountUnlockedBody'),
    };
  }
  return null;
}

export async function handleRevokeResponderSessions(
  request: Request,
  deps: AppDeps,
  responderId: string,
): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse(403, 'forbidden_origin');
  }

  const context = await authenticate(request, deps);
  if (!context.ok) {
    return context.response;
  }

  const forbidden = requirePermission(context.principal, 'session:revoke:any');
  if (forbidden) {
    return forbidden;
  }

  const target = await deps.authStore.findResponderById(responderId);
  if (!target) {
    return errorResponse(404, 'responder_not_found');
  }

  const revoked = await revokeResponderSessions(deps.auth, responderId, context.principal);
  return jsonResponse({ ok: true, revoked }, 200, { ...NO_STORE_HEADERS });
}

export async function handleListAudit(request: Request, deps: AppDeps): Promise<Response> {
  const context = await authenticate(request, deps);
  if (!context.ok) {
    return context.response;
  }

  const forbidden = requirePermission(context.principal, 'audit:read');
  if (forbidden) {
    return forbidden;
  }

  const requested = Number(new URL(request.url).searchParams.get('limit') ?? DEFAULT_AUDIT_LIMIT);
  const limit = Number.isFinite(requested)
    ? Math.min(Math.max(Math.trunc(requested), 1), MAX_AUDIT_LIMIT)
    : DEFAULT_AUDIT_LIMIT;

  const events = await deps.authStore.listAuthEvents({ limit });
  return jsonResponse({ ok: true, events }, 200, { ...NO_STORE_HEADERS });
}

// ── Responder-network (agency + capability) for the DRRM_Admin tier ───────────
//
// A DRRM_Admin is a RESPONDER-tier ADMIN holding `responder:manage`. Unlike the
// operator tier, the acting tenant ALWAYS comes from the session principal
// (`context.principal.tenantId`), never a URL — so an admin can only ever touch
// its own tenant. The id-bearing agency PATCH is the one place a cross-tenant id
// can be presented: there we distinguish a known-other-tenant row (403 forbidden)
// from a truly unknown id (404 agency_not_found) per R7.4/R7.5.
//
// No coordinate is ever part of these payloads, so nothing here logs the body
// (SECURITY.md §1/§5).

/** Build the responder-network service deps from the platform store + responder auth. */
function adminResponderNetworkDeps(deps: AppDeps): ResponderNetworkDeps {
  return { store: deps.platform.store, auth: deps.auth };
}

/** POST /api/admin/agencies — create an agency within the admin's own tenant (R3.*). */
export async function handleAdminCreateAgency(request: Request, deps: AppDeps): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse(403, 'forbidden_origin');
  }

  const context = await authenticate(request, deps);
  if (!context.ok) {
    return context.response;
  }

  const forbidden = requirePermission(context.principal, 'responder:manage');
  if (forbidden) {
    return forbidden;
  }

  const body = await readJsonObject(request);
  if (!body) {
    return errorResponse(400, 'invalid_json');
  }

  const rn = adminResponderNetworkDeps(deps);
  const result = await createAgency(
    rn,
    { tenantId: context.principal.tenantId },
    {
      name: typeof body.name === 'string' ? body.name : '',
      code: typeof body.code === 'string' ? body.code : '',
      agencyType: typeof body.agencyType === 'string' ? body.agencyType : '',
    },
  );

  switch (result.status) {
    case 'ok':
      return jsonResponse({ ok: true, agency: result.agency }, 201, { ...NO_STORE_HEADERS });
    case 'invalid':
      return errorResponse(400, 'invalid_agency');
    case 'invalid_type':
      // Never echo the submitted agencyType value (R2.4/R2.5).
      return errorResponse(400, 'invalid_agency_type');
    case 'tenant_not_found':
      // Unlikely — the admin's own tenant exists — but map honestly.
      return errorResponse(404, 'tenant_not_found');
    case 'conflict':
      return errorResponse(409, 'agency_exists');
  }
}

/** GET /api/admin/agencies — list the admin's own-tenant agencies (R3.*). */
export async function handleAdminListAgencies(request: Request, deps: AppDeps): Promise<Response> {
  const context = await authenticate(request, deps);
  if (!context.ok) {
    return context.response;
  }

  const forbidden = requirePermission(context.principal, 'responder:manage');
  if (forbidden) {
    return forbidden;
  }

  const rn = adminResponderNetworkDeps(deps);
  const agencies = await listAgenciesForTenant(rn, { tenantId: context.principal.tenantId });
  return jsonResponse({ ok: true, agencies }, 200, { ...NO_STORE_HEADERS });
}

/**
 * PATCH /api/admin/agencies/[id] — rename and/or (de)activate an own-tenant agency.
 *
 * The acting scope is the session tenant. A rename (name/code) and an activate
 * (active) are handled independently. R7.4/R7.5: because the admin is tenant-bounded,
 * a `cross_tenant` result means the id belongs to a KNOWN other tenant → 403 forbidden,
 * while `not_found` means the id does not exist at all → 404 agency_not_found.
 */
export async function handleAdminUpdateAgency(
  request: Request,
  deps: AppDeps,
  agencyId: string,
): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse(403, 'forbidden_origin');
  }

  const context = await authenticate(request, deps);
  if (!context.ok) {
    return context.response;
  }

  const forbidden = requirePermission(context.principal, 'responder:manage');
  if (forbidden) {
    return forbidden;
  }

  const body = await readJsonObject(request);
  if (!body) {
    return errorResponse(400, 'invalid_json');
  }

  const scope = { tenantId: context.principal.tenantId };
  const rn = adminResponderNetworkDeps(deps);

  // Rename (name and/or code) if either field is present.
  if (body.name !== undefined || body.code !== undefined) {
    const patch: { name?: string; code?: string } = {};
    if (body.name !== undefined) {
      patch.name = typeof body.name === 'string' ? body.name : '';
    }
    if (body.code !== undefined) {
      patch.code = typeof body.code === 'string' ? body.code : '';
    }

    const result = await renameAgency(rn, scope, agencyId, patch);
    switch (result.status) {
      case 'ok':
        break;
      case 'invalid':
        return errorResponse(400, 'invalid_agency');
      case 'not_found':
        return errorResponse(404, 'agency_not_found');
      case 'cross_tenant':
        // Known other-tenant row — deny without leaking existence detail (R7.4).
        return errorResponse(403, 'forbidden');
      case 'conflict':
        return errorResponse(409, 'agency_exists');
    }
  }

  // Activate / deactivate if an explicit boolean was supplied.
  if (typeof body.active === 'boolean') {
    const result = await setAgencyActive(rn, scope, agencyId, body.active);
    switch (result.status) {
      case 'ok':
        return jsonResponse({ ok: true, agency: result.agency }, 200, { ...NO_STORE_HEADERS });
      case 'not_found':
        return errorResponse(404, 'agency_not_found');
      case 'cross_tenant':
        return errorResponse(403, 'forbidden');
    }
  }

  // No active flag: return the latest agency state (after any rename).
  const latest = await deps.platform.store.findAgencyById(agencyId);
  if (latest === null) {
    return errorResponse(404, 'agency_not_found');
  }
  return jsonResponse({ ok: true, agency: latest }, 200, { ...NO_STORE_HEADERS });
}

/** GET /api/admin/capability — read the total capability config for the own tenant (R5.*). */
export async function handleAdminReadCapability(
  request: Request,
  deps: AppDeps,
): Promise<Response> {
  const context = await authenticate(request, deps);
  if (!context.ok) {
    return context.response;
  }

  const forbidden = requirePermission(context.principal, 'responder:manage');
  if (forbidden) {
    return forbidden;
  }

  const rn = adminResponderNetworkDeps(deps);
  const capability = await readCapabilityConfig(rn, { tenantId: context.principal.tenantId });
  return jsonResponse({ ok: true, capability }, 200, { ...NO_STORE_HEADERS });
}

/**
 * PATCH /api/admin/capability — set one category's agency-type set for the own tenant.
 *
 * R5.6: `requirePermission` blocks a non-manage role with 403 BEFORE the service is
 * called, so an unauthorized update never persists.
 */
export async function handleAdminSetCapability(request: Request, deps: AppDeps): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse(403, 'forbidden_origin');
  }

  const context = await authenticate(request, deps);
  if (!context.ok) {
    return context.response;
  }

  const forbidden = requirePermission(context.principal, 'responder:manage');
  if (forbidden) {
    return forbidden;
  }

  const body = await readJsonObject(request);
  if (!body) {
    return errorResponse(400, 'invalid_json');
  }

  const category = typeof body.category === 'string' ? body.category : '';
  // agencyTypes must be an array of strings; anything else is a malformed set.
  if (!Array.isArray(body.agencyTypes)) {
    return errorResponse(400, 'invalid_capability');
  }
  const agencyTypes = body.agencyTypes.filter((v): v is string => typeof v === 'string');
  if (agencyTypes.length !== body.agencyTypes.length) {
    return errorResponse(400, 'invalid_capability');
  }

  const rn = adminResponderNetworkDeps(deps);
  const result = await setCapabilityForCategory(
    rn,
    { tenantId: context.principal.tenantId },
    category,
    agencyTypes,
  );
  if (result.status === 'invalid') {
    return errorResponse(400, 'invalid_capability');
  }
  return jsonResponse({ ok: true, capability: result.capability }, 200, { ...NO_STORE_HEADERS });
}
