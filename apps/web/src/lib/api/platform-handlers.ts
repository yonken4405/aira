/**
 * `/api/platform/*` auth plumbing for the break-glass superadmin tier.
 *
 * single-lgu-agency-network (R2): the operator CONSOLE and its tenant/office/agency/
 * capability/responder management routes are removed. What remains is the login/session
 * plumbing for the retained break-glass superadmin tier (CLI-provisioned) and the
 * `authenticatePlatform` guard the shipped notification / system-notice tier depends on.
 *
 * A platform session can never authenticate a responder/citizen route (cross-tier
 * isolation) and holds no incident or citizen access.
 */

import { readCookie } from '../auth/session';
import { login, logout, resolvePlatformSession } from '../platform/service';
import type { PlatformPrincipal } from '../platform/types';
import {
  PLATFORM_SESSION_COOKIE,
  serializeClearedPlatformSessionCookie,
  serializePlatformSessionCookie,
} from '../platform/session';
import type { AppDeps } from './deps';
import {
  clientFingerprint,
  errorResponse,
  isNonEmptyString,
  isSameOrigin,
  jsonResponse,
  NO_STORE_HEADERS,
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
