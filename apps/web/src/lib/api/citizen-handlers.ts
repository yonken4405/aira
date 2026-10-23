/**
 * `/api/citizen/*` handlers: optional registered-citizen tier (SECURITY.md §7).
 *
 * Entirely separate from `/api/auth/*` (responders). A citizen principal is returned
 * only as a minimal, role-less view; it can never reach a responder route.
 */

import { readCookie } from '../auth/session';
import {
  authenticateWithDeviceKey,
  loginWithEmail,
  logoutCitizen,
  registerWithEmail,
  resolveCitizenSession,
} from '../citizen/service';
import type { CitizenPrincipal } from '../citizen/types';
import {
  CITIZEN_SESSION_COOKIE,
  serializeCitizenSessionCookie,
  serializeClearedCitizenSessionCookie,
} from '../citizen/session';
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

const MAX_EMAIL_LENGTH = 254;
const MAX_PASSWORD_LENGTH = 128;
const MAX_DEVICE_KEY_LENGTH = 64;

/** Minimal, role-less projection handed to the citizen app. Never a responder shape. */
export interface CitizenView {
  readonly id: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
}

function viewOf(principal: CitizenPrincipal): CitizenView {
  return {
    id: principal.citizenId,
    email: principal.email,
    emailVerified: principal.emailVerified,
  };
}

export function readCitizenToken(request: Request): string | null {
  return readCookie(request.headers.get('cookie'), CITIZEN_SESSION_COOKIE);
}

/** Resolves the citizen session, or null. Used by tracking/profile routes. */
export async function authenticateCitizen(
  request: Request,
  deps: AppDeps,
): Promise<CitizenPrincipal | null> {
  return resolveCitizenSession(deps.citizen, readCitizenToken(request));
}

function sessionCookie(deps: AppDeps, token: string): Record<string, string> {
  return { 'set-cookie': serializeCitizenSessionCookie(token, { secure: deps.secureCookies }) };
}

export async function handleCitizenRegister(request: Request, deps: AppDeps): Promise<Response> {
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
  if (
    !isNonEmptyString(email, MAX_EMAIL_LENGTH) ||
    !isNonEmptyString(password, MAX_PASSWORD_LENGTH)
  ) {
    return errorResponse(400, 'invalid_credentials');
  }

  const result = await registerWithEmail(deps.citizen, { email, password });

  if (result.status === 'invalid_email') {
    return errorResponse(400, 'invalid_email');
  }
  if (result.status === 'weak') {
    return errorResponse(400, 'weak_password', { problem: result.problem });
  }
  if (result.status === 'conflict') {
    // Generic: do not confirm whether an email is already registered (enumeration).
    return errorResponse(409, 'registration_unavailable');
  }

  return jsonResponse(
    { ok: true, citizen: viewOf(result.principal) },
    201,
    sessionCookie(deps, result.token),
  );
}

export async function handleCitizenLogin(request: Request, deps: AppDeps): Promise<Response> {
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
  if (
    !isNonEmptyString(email, MAX_EMAIL_LENGTH) ||
    !isNonEmptyString(password, MAX_PASSWORD_LENGTH)
  ) {
    return errorResponse(400, 'invalid_credentials');
  }

  const result = await loginWithEmail(deps.citizen, { email, password });

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

  return jsonResponse(
    { ok: true, citizen: viewOf(result.principal) },
    200,
    sessionCookie(deps, result.token),
  );
}

/** Zero-friction device-key path: register-or-login in one step (PRODUCT.md §1a/§6). */
export async function handleCitizenDeviceAuth(request: Request, deps: AppDeps): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse(403, 'forbidden_origin');
  }

  const body = await readJsonObject(request);
  if (!body) {
    return errorResponse(400, 'invalid_json');
  }

  const { deviceKey } = body;
  if (!isNonEmptyString(deviceKey, MAX_DEVICE_KEY_LENGTH)) {
    return errorResponse(400, 'invalid_device_key');
  }

  const result = await authenticateWithDeviceKey(deps.citizen, deviceKey);
  if (result.status === 'invalid_device_key') {
    return errorResponse(400, 'invalid_device_key');
  }

  return jsonResponse(
    { ok: true, citizen: viewOf(result.principal) },
    200,
    sessionCookie(deps, result.token),
  );
}

export async function handleCitizenSession(request: Request, deps: AppDeps): Promise<Response> {
  const principal = await authenticateCitizen(request, deps);
  if (!principal) {
    return errorResponse(401, 'unauthenticated');
  }
  return jsonResponse({ ok: true, citizen: viewOf(principal) });
}

export async function handleCitizenLogout(request: Request, deps: AppDeps): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse(403, 'forbidden_origin');
  }

  const principal = await authenticateCitizen(request, deps);
  if (principal) {
    await logoutCitizen(deps.citizen, principal);
  }

  return new Response(null, {
    status: 204,
    headers: {
      ...NO_STORE_HEADERS,
      'set-cookie': serializeClearedCitizenSessionCookie({ secure: deps.secureCookies }),
    },
  });
}
