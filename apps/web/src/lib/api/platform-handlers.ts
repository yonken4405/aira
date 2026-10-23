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
