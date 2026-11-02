/**
 * `/api/admin/*` handlers - account roster and authentication audit.
 *
 * ADMIN holds no incident permission, so nothing here can read citizen data
 * (SECURITY.md §4). Every mutation writes an auth audit event.
 */

import { t } from '@aira/ui';

import { isRole } from '../auth/rbac';
import { revokeResponderSessions, updateResponder } from '../auth/service';
import type { UpdateResponderPatch } from '../auth/types';
import { toResponderView } from '../auth/view';
import { notifyOne, notifySafe } from '../notifications/service';
import type { NotificationPayload } from '../notifications/types';
import {
  createAgency,
  listAgenciesForTenant,
  listAgencyCoverage,
  provisionResponder,
  renameAgency,
  setAgencyActive,
  setAgencyCoverage,
  type ActingScope,
  type ResponderNetworkDeps,
} from '../responder-network/service';
import { can } from '../auth/rbac';
import { notifyMany } from '../notifications/service';
import type { AppDeps } from './deps';
import {
  errorResponse,
  isNonEmptyString,
  isSameOrigin,
  jsonResponse,
  NO_STORE_HEADERS,
  readJsonObject,
} from './http';
import { authenticate, requireAnyPermission, requirePermission } from './session-guard';

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
    deps.authStore.listAgencies(context.principal.tenantId),
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

  // Both the LDRRMO coordinator (responder:manage) and an agency admin (agency:manage)
  // may provision accounts; the agency admin is bounded to its own agency below.
  const forbidden = requireAnyPermission(context.principal, ['responder:manage', 'agency:manage']);
  if (forbidden) {
    return forbidden;
  }

  const body = await readJsonObject(request);
  if (!body) {
    return errorResponse(400, 'invalid_json');
  }

  const { email, callsign, role, officeId, agencyId, mustChangePassword } = body;

  if (!isNonEmptyString(email, 254) || !isRole(role) || !isNonEmptyString(officeId, 64)) {
    return errorResponse(400, 'invalid_responder');
  }
  // Callsign is an optional display label.
  if (callsign !== undefined && callsign !== null && !isNonEmptyString(callsign, 32)) {
    return errorResponse(400, 'invalid_responder');
  }
  // Agency is REQUIRED now (R3.2); a blank/non-string agency is rejected up front.
  if (!isNonEmptyString(agencyId, 64)) {
    return errorResponse(400, 'invalid_responder');
  }

  // Route through provisionResponder so agency-required + agency-scope + office/agency
  // tenant checks all run in one place. The acting scope carries the caller's agency
  // when it is an agency admin, so it can only ever create accounts in its OWN agency.
  const result = await provisionResponder(
    { store: deps.platform.store, auth: deps.auth },
    actingScopeFor(context.principal),
    {
      email,
      callsign: typeof callsign === 'string' ? callsign : null,
      role,
      officeId,
      agencyId,
      mustChangePassword: mustChangePassword !== false,
    },
  );

  switch (result.status) {
    case 'ok':
      return jsonResponse(
        { ok: true, responder: toResponderView(result.responder), password: result.password },
        201,
        { ...NO_STORE_HEADERS },
      );
    case 'invalid':
      return errorResponse(400, 'invalid_responder');
    case 'office_not_found':
      return errorResponse(404, 'office_not_found');
    case 'office_cross_tenant':
      return errorResponse(403, 'forbidden');
    case 'agency_not_found':
      return errorResponse(404, 'agency_not_found');
    case 'agency_cross_tenant':
      return errorResponse(400, 'invalid_agency');
    case 'agency_inactive':
      return errorResponse(400, 'invalid_agency');
    case 'cross_agency':
      return errorResponse(403, 'forbidden');
    case 'conflict':
      return errorResponse(409, 'email_taken');
  }
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

/**
 * The acting scope for a management call. The tenant always comes from the session.
 * An AGENCY_ADMIN is additionally bounded to its OWN agency (`agency:manage` but not
 * `responder:manage`); the LDRRMO coordinator (`responder:manage`) is tenant-wide.
 */
function actingScopeFor(principal: {
  readonly tenantId: string;
  readonly agencyId: string | null;
  readonly role: Parameters<typeof can>[0];
}): ActingScope {
  const agencyBounded =
    can(principal.role, 'agency:manage') && !can(principal.role, 'responder:manage');
  return {
    tenantId: principal.tenantId,
    agencyId: agencyBounded ? principal.agencyId : undefined,
  };
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

// ── Agency coverage (single-lgu-agency-network R5) ────────────────────────────

/** GET /api/admin/agencies/[id]/coverage — the office ids an agency covers. */
export async function handleAdminGetCoverage(
  request: Request,
  deps: AppDeps,
  agencyId: string,
): Promise<Response> {
  const context = await authenticate(request, deps);
  if (!context.ok) {
    return context.response;
  }

  // AGENCY_ADMIN manages its own coverage; the LDRRMO coordinator reads all agencies.
  const forbidden = requireAnyPermission(context.principal, ['coverage:manage', 'agency:read:all']);
  if (forbidden) {
    return forbidden;
  }

  const rn = adminResponderNetworkDeps(deps);
  const result = await listAgencyCoverage(rn, actingScopeFor(context.principal), agencyId);
  switch (result.status) {
    case 'ok':
      return jsonResponse({ ok: true, officeIds: result.officeIds }, 200, { ...NO_STORE_HEADERS });
    case 'cross_agency':
      return errorResponse(403, 'forbidden');
    case 'not_found':
      return errorResponse(404, 'agency_not_found');
  }
}

/** PUT /api/admin/agencies/[id]/coverage — full-replace an agency's coverage. */
export async function handleAdminSetCoverage(
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

  // Only an agency admin writes coverage; the LDRRMO coordinator is read-only on agencies.
  const forbidden = requirePermission(context.principal, 'coverage:manage');
  if (forbidden) {
    return forbidden;
  }

  const body = await readJsonObject(request);
  if (!body || !Array.isArray(body.officeIds)) {
    return errorResponse(400, 'invalid_coverage');
  }
  const officeIds = body.officeIds.filter((v): v is string => typeof v === 'string');
  if (officeIds.length !== body.officeIds.length) {
    return errorResponse(400, 'invalid_coverage');
  }

  const rn = adminResponderNetworkDeps(deps);
  const result = await setAgencyCoverage(
    rn,
    actingScopeFor(context.principal),
    agencyId,
    officeIds,
  );
  switch (result.status) {
    case 'ok':
      return jsonResponse({ ok: true, officeIds: result.officeIds }, 200, { ...NO_STORE_HEADERS });
    case 'cross_agency':
      return errorResponse(403, 'forbidden');
    case 'not_found':
      return errorResponse(404, 'agency_not_found');
    case 'invalid_office':
      return errorResponse(400, 'invalid_coverage');
  }
}

// ── Users / organisation view (single-lgu-agency-network R8) ──────────────────

/**
 * GET /api/admin/org — the roster + hierarchy, scoped to the viewer's authority.
 *
 * An AGENCY_ADMIN sees only its own agency's members; the LDRRMO coordinator sees all
 * agencies and the full office tree (R8.3). Coordinate-free: offices are name/kind only.
 */
export async function handleAdminOrg(request: Request, deps: AppDeps): Promise<Response> {
  const context = await authenticate(request, deps);
  if (!context.ok) {
    return context.response;
  }

  // Either tier that reaches the admin surface may read the org view.
  const forbidden = requireAnyPermission(context.principal, ['agency:read:all', 'agency:manage']);
  if (forbidden) {
    return forbidden;
  }

  const { principal } = context;
  const agencyBounded =
    can(principal.role, 'agency:manage') && !can(principal.role, 'agency:read:all');
  const agencyFilter = agencyBounded ? principal.agencyId : null;

  const [responders, offices, agencies] = await Promise.all([
    deps.authStore.listResponders(principal.tenantId, { agencyId: agencyFilter }),
    deps.authStore.listOffices(principal.tenantId),
    deps.authStore.listAgencies(principal.tenantId),
  ]);

  // An agency-bounded viewer sees only its own agency in the hierarchy.
  const visibleAgencies = agencyBounded
    ? agencies.filter((a) => a.id === principal.agencyId)
    : agencies;

  return jsonResponse(
    {
      ok: true,
      members: responders.map((row) => toResponderView(row, row.sessionCount)),
      offices,
      agencies: visibleAgencies,
    },
    200,
    { ...NO_STORE_HEADERS },
  );
}

// ── LDRRMO coordination nudge (single-lgu-agency-network R4.4) ─────────────────

/**
 * POST /api/admin/coordination/nudge — the LDRRMO coordinator sends a coordinate-free
 * help request / nudge to a target agency's members. Coordination only: it never
 * assigns or advances an incident (separation of duties). Fail-soft notifications.
 */
export async function handleAdminNudge(request: Request, deps: AppDeps): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse(403, 'forbidden_origin');
  }

  const context = await authenticate(request, deps);
  if (!context.ok) {
    return context.response;
  }

  const forbidden = requirePermission(context.principal, 'coordination:nudge');
  if (forbidden) {
    return forbidden;
  }

  const body = await readJsonObject(request);
  if (!body || !isNonEmptyString(body.agencyId, 64)) {
    return errorResponse(400, 'invalid_nudge');
  }
  const targetAgencyId = body.agencyId;

  // The target agency must belong to the coordinator's own LGU (tenant).
  const agency = await deps.platform.store.findAgencyById(targetAgencyId);
  if (agency === null || agency.tenantId !== context.principal.tenantId) {
    return errorResponse(404, 'agency_not_found');
  }

  // Resolve the agency's members as notification recipients (ids only — no coordinates).
  const members = await deps.authStore.listResponders(context.principal.tenantId, {
    agencyId: targetAgencyId,
  });
  const recipients = members.map((m) => ({ tier: 'responders' as const, principalId: m.id }));

  await notifyMany(
    deps.notifications,
    recipients,
    {
      type: 'coordination.nudge',
      data: { agencyId: targetAgencyId },
      title: t('notifyCoordinationNudgeTitle'),
      body: t('notifyCoordinationNudgeBody'),
    },
    { critical: false },
  );

  return jsonResponse({ ok: true, notified: recipients.length }, 200, { ...NO_STORE_HEADERS });
}
