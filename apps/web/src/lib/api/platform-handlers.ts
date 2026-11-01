/**
 * `/api/platform/*` handlers: the internal superadmin console (multi-tenant).
 *
 * A separate identity tier from responders and citizens. A platform session can never
 * authenticate a responder/citizen route (cross-tier isolation), and these handlers
 * expose only tenant/office management + the nationwide office pins - never incident or
 * citizen data.
 */

import { t } from '@aira/ui';

import { readCookie } from '../auth/session';
import {
  bootstrapTenantAdmin,
  createTenant,
  listOfficePins,
  listTenants,
  login,
  logout,
  resolvePlatformSession,
  setTenantStatus,
} from '../platform/service';
import type { PlatformPrincipal } from '../platform/types';
import { isRole } from '../auth/rbac';
import {
  createAgency,
  listAgenciesForTenant,
  provisionResponder,
  readCapabilityConfig,
  renameAgency,
  setAgencyActive,
  setCapabilityForCategory,
  type ResponderNetworkDeps,
} from '../responder-network/service';
import {
  PLATFORM_SESSION_COOKIE,
  serializeClearedPlatformSessionCookie,
  serializePlatformSessionCookie,
} from '../platform/session';
import { notifyMany, notifySafe } from '../notifications/service';
import type { AppDeps } from './deps';
import {
  clientFingerprint,
  errorResponse,
  isNonEmptyString,
  isSameOrigin,
  jsonResponse,
  NO_STORE_HEADERS,
  PRIVATE_CACHE_HEADERS,
  readJsonObject,
} from './http';

const MAX_EMAIL = 254;
const MAX_PASSWORD = 128;

export function readPlatformToken(request: Request): string | null {
  return readCookie(request.headers.get('cookie'), PLATFORM_SESSION_COOKIE);
}

export async function authenticatePlatform(
  request: Request,
  deps: AppDeps,
): Promise<PlatformPrincipal | null> {
  return resolvePlatformSession(deps.platform, readPlatformToken(request));
}

interface PlatformContext {
  readonly principal: PlatformPrincipal;
}

async function requirePlatform(
  request: Request,
  deps: AppDeps,
): Promise<PlatformContext | { readonly response: Response }> {
  const principal = await authenticatePlatform(request, deps);
  if (!principal) {
    return { response: errorResponse(401, 'unauthenticated') };
  }
  return { principal };
}

export async function handlePlatformLogin(request: Request, deps: AppDeps): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse(403, 'forbidden_origin');
  }
  const limit = deps.loginLimiter.consume(clientFingerprint(request));
  if (!limit.allowed) {
    return jsonResponse({ ok: false, error: 'rate_limited' }, 429, {
      'retry-after': String(limit.retryAfterSeconds),
    });
  }

  const body = await readJsonObject(request);
  if (!body) {
    return errorResponse(400, 'invalid_json');
  }
  const { email, password } = body;
  if (!isNonEmptyString(email, MAX_EMAIL) || !isNonEmptyString(password, MAX_PASSWORD)) {
    return errorResponse(400, 'invalid_credentials');
  }

  const result = await login(deps.platform, { email, password });
  if (result.status === 'invalid') {
    return errorResponse(401, 'invalid_credentials');
  }
  if (result.status === 'locked') {
    return jsonResponse(
      { ok: false, error: 'account_locked', retryAfterSeconds: result.retryAfterSeconds },
      423,
      { 'retry-after': String(result.retryAfterSeconds) },
    );
  }

  return jsonResponse({ ok: true, admin: { email: result.principal.email } }, 200, {
    'set-cookie': serializePlatformSessionCookie(result.token, { secure: deps.secureCookies }),
  });
}

export async function handlePlatformSession(request: Request, deps: AppDeps): Promise<Response> {
  const principal = await authenticatePlatform(request, deps);
  if (!principal) {
    return errorResponse(401, 'unauthenticated');
  }
  return jsonResponse({ ok: true, admin: { email: principal.email } });
}

export async function handlePlatformLogout(request: Request, deps: AppDeps): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse(403, 'forbidden_origin');
  }
  const principal = await authenticatePlatform(request, deps);
  if (principal) {
    await logout(deps.platform, principal);
  }
  return new Response(null, {
    status: 204,
    headers: {
      ...NO_STORE_HEADERS,
      'set-cookie': serializeClearedPlatformSessionCookie({ secure: deps.secureCookies }),
    },
  });
}

export async function handleListTenants(request: Request, deps: AppDeps): Promise<Response> {
  const ctx = await requirePlatform(request, deps);
  if ('response' in ctx) {
    return ctx.response;
  }
  const tenants = await listTenants(deps.platform);
  return jsonResponse({ ok: true, tenants }, 200, { ...PRIVATE_CACHE_HEADERS });
}

/** Nationwide office pins for the operator map. Office locations only - no citizen data. */
export async function handleListOfficePins(request: Request, deps: AppDeps): Promise<Response> {
  const ctx = await requirePlatform(request, deps);
  if ('response' in ctx) {
    return ctx.response;
  }
  const offices = await listOfficePins(deps.platform);
  return jsonResponse({ ok: true, offices }, 200, { ...PRIVATE_CACHE_HEADERS });
}

export async function handleCreateTenant(request: Request, deps: AppDeps): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse(403, 'forbidden_origin');
  }
  const ctx = await requirePlatform(request, deps);
  if ('response' in ctx) {
    return ctx.response;
  }

  const body = await readJsonObject(request);
  if (!body) {
    return errorResponse(400, 'invalid_json');
  }
  const { name, region, province, lguName, lat, lon } = body;
  if (
    !isNonEmptyString(name, 120) ||
    !isNonEmptyString(region, 64) ||
    !isNonEmptyString(province, 64) ||
    !isNonEmptyString(lguName, 96)
  ) {
    return errorResponse(400, 'invalid_tenant');
  }
  const latNum = typeof lat === 'number' ? lat : null;
  const lonNum = typeof lon === 'number' ? lon : null;

  const result = await createTenant(deps.platform, {
    name,
    region,
    province,
    lguName,
    lat: latNum,
    lon: lonNum,
  });

  if (result.status === 'invalid') {
    return errorResponse(400, 'invalid_tenant');
  }
  if (result.status === 'conflict') {
    return errorResponse(409, 'tenant_exists');
  }

  // Post-success event hook (R12.1, R12.4): notify platform admins that a tenant
  // was onboarded. Payload carries only tenant identity — never any incident or
  // citizen data. Fail-soft so a notification failure can never change this
  // already-committed 201 (R10.5).
  const onboarded = result.tenant;
  await notifySafe(async () => {
    const recipients = await deps.notifications.store.listPlatformAdmins();
    await notifyMany(
      deps.notifications,
      recipients,
      {
        type: 'tenant.onboarded',
        data: { tenantId: onboarded.id, tenantName: onboarded.name },
        title: t('notifyTenantOnboardedTitle'),
        body: t('notifyTenantOnboardedBody'),
      },
      { critical: false },
    );
  });

  return jsonResponse({ ok: true, tenant: result.tenant }, 201, { ...NO_STORE_HEADERS });
}

export async function handleSetTenantStatus(
  request: Request,
  deps: AppDeps,
  tenantId: string,
): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse(403, 'forbidden_origin');
  }
  const ctx = await requirePlatform(request, deps);
  if ('response' in ctx) {
    return ctx.response;
  }

  const body = await readJsonObject(request);
  const status = body?.status;
  if (status !== 'active' && status !== 'suspended') {
    return errorResponse(400, 'invalid_status');
  }

  const tenant = await setTenantStatus(deps.platform, tenantId, status);
  if (!tenant) {
    return errorResponse(404, 'tenant_not_found');
  }

  // Post-success event hook (R12.2, R12.4): when a tenant is suspended, notify
  // platform admins. Payload carries only tenant identity — no incident/citizen
  // data. Fail-soft so a notification failure can never change the 200 (R10.5).
  if (status === 'suspended') {
    const suspended = tenant;
    await notifySafe(async () => {
      const recipients = await deps.notifications.store.listPlatformAdmins();
      await notifyMany(
        deps.notifications,
        recipients,
        {
          type: 'tenant.suspended',
          data: { tenantId: suspended.id, tenantName: suspended.name },
          title: t('notifyTenantSuspendedTitle'),
          body: t('notifyTenantSuspendedBody'),
        },
        { critical: false },
      );
    });
  }

  return jsonResponse({ ok: true, tenant }, 200, { ...NO_STORE_HEADERS });
}

export async function handleBootstrapTenantAdmin(
  request: Request,
  deps: AppDeps,
  tenantId: string,
): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse(403, 'forbidden_origin');
  }
  const ctx = await requirePlatform(request, deps);
  if ('response' in ctx) {
    return ctx.response;
  }

  const body = await readJsonObject(request);
  if (!body || !isNonEmptyString(body.email, MAX_EMAIL)) {
    return errorResponse(400, 'invalid_email');
  }

  const result = await bootstrapTenantAdmin(deps.platform, { tenantId, email: body.email });
  if (result.status === 'tenant_not_found') {
    return errorResponse(404, 'tenant_not_found');
  }
  if (result.status === 'invalid_email') {
    return errorResponse(400, 'invalid_email');
  }
  if (result.status === 'conflict') {
    return errorResponse(409, 'email_taken');
  }

  // The one-time password is shown exactly once to the operator (like responder provisioning).
  return jsonResponse({ ok: true, email: result.email, password: result.password }, 201, {
    ...NO_STORE_HEADERS,
  });
}

// ── Responder-network (agency + capability + responder provisioning) ──────────
//
// Operator-tier management of a tenant's agency roster, category→agency-type
// capability map, and responder accounts. An operator is NOT tenant-bounded, so the
// acting scope is always built from the explicit tenantId in the route (or, for a
// bare agency PATCH, from the agency's own tenant). No coordinate is ever part of
// these payloads, so nothing here logs the request body (SECURITY.md §1/§5, R7.6).

/** Build the responder-network service deps from the platform store + responder auth. */
function responderNetworkDeps(
  deps: AppDeps,
): ResponderNetworkDeps & { readonly auth: typeof deps.auth } {
  return { store: deps.platform.store, auth: deps.auth };
}

/** POST /api/platform/tenants/[id]/agencies — create an agency for a tenant (R3.*). */
export async function handlePlatformCreateAgency(
  request: Request,
  deps: AppDeps,
  tenantId: string,
): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse(403, 'forbidden_origin');
  }
  const ctx = await requirePlatform(request, deps);
  if ('response' in ctx) {
    return ctx.response;
  }

  const body = await readJsonObject(request);
  if (!body) {
    return errorResponse(400, 'invalid_json');
  }

  const rn = responderNetworkDeps(deps);
  const result = await createAgency(
    rn,
    { tenantId },
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
      return errorResponse(404, 'tenant_not_found');
    case 'conflict':
      return errorResponse(409, 'agency_exists');
  }
}

/** GET /api/platform/tenants/[id]/agencies — list a tenant's agencies (R3.*). */
export async function handlePlatformListAgencies(
  request: Request,
  deps: AppDeps,
  tenantId: string,
): Promise<Response> {
  const ctx = await requirePlatform(request, deps);
  if ('response' in ctx) {
    return ctx.response;
  }

  const rn = responderNetworkDeps(deps);
  const agencies = await listAgenciesForTenant(rn, { tenantId });
  return jsonResponse({ ok: true, agencies }, 200, { ...PRIVATE_CACHE_HEADERS });
}

/**
 * PATCH /api/platform/agencies/[agencyId] — rename and/or (de)activate an agency.
 *
 * An operator is not tenant-bounded, so the acting scope is resolved from the agency's
 * own tenant. A rename (name/code) and an activate (active) are handled independently;
 * the final agency record is returned.
 */
export async function handlePlatformUpdateAgency(
  request: Request,
  deps: AppDeps,
  agencyId: string,
): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse(403, 'forbidden_origin');
  }
  const ctx = await requirePlatform(request, deps);
  if ('response' in ctx) {
    return ctx.response;
  }

  const body = await readJsonObject(request);
  if (!body) {
    return errorResponse(400, 'invalid_json');
  }

  // Resolve the acting scope from the agency itself (operator is not tenant-bounded).
  const agency = await deps.platform.store.findAgencyById(agencyId);
  if (agency === null) {
    return errorResponse(404, 'agency_not_found');
  }
  const scope = { tenantId: agency.tenantId };
  const rn = responderNetworkDeps(deps);

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
        // Scope came from the agency, so this cannot happen; treat as not found.
        return errorResponse(404, 'agency_not_found');
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
        return errorResponse(404, 'agency_not_found');
    }
  }

  // No active flag: return the latest agency state (after any rename).
  const latest = await deps.platform.store.findAgencyById(agencyId);
  if (latest === null) {
    return errorResponse(404, 'agency_not_found');
  }
  return jsonResponse({ ok: true, agency: latest }, 200, { ...NO_STORE_HEADERS });
}

/** GET /api/platform/tenants/[id]/capability — read the total capability config (R5.*). */
export async function handlePlatformReadCapability(
  request: Request,
  deps: AppDeps,
  tenantId: string,
): Promise<Response> {
  const ctx = await requirePlatform(request, deps);
  if ('response' in ctx) {
    return ctx.response;
  }

  const rn = responderNetworkDeps(deps);
  const capability = await readCapabilityConfig(rn, { tenantId });
  return jsonResponse({ ok: true, capability }, 200, { ...PRIVATE_CACHE_HEADERS });
}

/** PATCH /api/platform/tenants/[id]/capability — set one category's agency-type set (R5.*). */
export async function handlePlatformSetCapability(
  request: Request,
  deps: AppDeps,
  tenantId: string,
): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse(403, 'forbidden_origin');
  }
  const ctx = await requirePlatform(request, deps);
  if ('response' in ctx) {
    return ctx.response;
  }

  const body = await readJsonObject(request);
  if (!body) {
    return errorResponse(400, 'invalid_json');
  }

  const category = typeof body.category === 'string' ? body.category : '';
  const agencyTypes = Array.isArray(body.agencyTypes)
    ? body.agencyTypes.filter((v): v is string => typeof v === 'string')
    : [];
  // A non-array agencyTypes (or one with non-string entries) is a malformed set; the
  // service validates the category and every type, returning invalid for anything bad.
  if (!Array.isArray(body.agencyTypes) || agencyTypes.length !== body.agencyTypes.length) {
    return errorResponse(400, 'invalid_capability');
  }

  const rn = responderNetworkDeps(deps);
  const result = await setCapabilityForCategory(rn, { tenantId }, category, agencyTypes);
  if (result.status === 'invalid') {
    return errorResponse(400, 'invalid_capability');
  }
  return jsonResponse({ ok: true, capability: result.capability }, 200, { ...NO_STORE_HEADERS });
}

/** POST /api/platform/tenants/[id]/responders — provision a responder account (R4.*). */
export async function handlePlatformProvisionResponder(
  request: Request,
  deps: AppDeps,
  tenantId: string,
): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse(403, 'forbidden_origin');
  }
  const ctx = await requirePlatform(request, deps);
  if ('response' in ctx) {
    return ctx.response;
  }

  const body = await readJsonObject(request);
  if (!body) {
    return errorResponse(400, 'invalid_json');
  }

  const rn = responderNetworkDeps(deps);
  const result = await provisionResponder(
    rn,
    { tenantId },
    {
      email: typeof body.email === 'string' ? body.email : '',
      officeId: typeof body.officeId === 'string' ? body.officeId : null,
      agencyId: typeof body.agencyId === 'string' ? body.agencyId : null,
      callsign: typeof body.callsign === 'string' ? body.callsign : null,
      role: isRole(body.role) ? body.role : undefined,
    },
  );

  switch (result.status) {
    case 'ok':
      // The one-time password is shown exactly once (mirror handleBootstrapTenantAdmin).
      return jsonResponse(
        {
          ok: true,
          responder: result.responder,
          email: result.responder.email,
          password: result.password,
        },
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
    case 'conflict':
      return errorResponse(409, 'email_taken');
  }
}
