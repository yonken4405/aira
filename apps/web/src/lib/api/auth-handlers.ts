/**
 * `/api/auth/*` handlers: login, logout, current session, password change.
 *
 * Login is deliberately boring on failure: one generic reason, one status, and a
 * per-address rate limit in front of the database-backed lockout.
 */

import { t } from '@aira/ui';

import {
  changePassword,
  isValidEmail,
  login,
  logout,
  normalizeEmail,
  updateOwnProfile,
} from '../auth/service';
import { serializeClearedSessionCookie, serializeSessionCookie } from '../auth/session';
import type { Viewer } from '../auth/types';
import { viewerOfPrincipal } from '../auth/view';
import { notifyOne, notifySafe } from '../notifications/service';
import type { AppDeps } from './deps';
import {
  clientFingerprint,
  errorResponse,
  isNonEmptyString,
  isSameOrigin,
  jsonResponse,
  NO_STORE_HEADERS,
  readJsonObject,
  readSessionToken,
} from './http';
import { authenticate } from './session-guard';

const MAX_EMAIL_LENGTH = 254;
const MAX_PASSWORD_LENGTH = 128;

function viewerResponse(viewer: Viewer, headers: Record<string, string> = {}): Response {
  return jsonResponse({ ok: true, viewer }, 200, headers);
}

export async function handleLogin(request: Request, deps: AppDeps): Promise<Response> {
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

  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized)) {
    return errorResponse(400, 'invalid_credentials');
  }

  const result = await login(deps.auth, { email: normalized, password });

  if (result.status === 'invalid') {
    return errorResponse(401, 'invalid_credentials');
  }

  if (result.status === 'locked') {
    // Post-lock event hook (R11.2, R11.4): notify ONLY the affected responder that
    // their account is locked. The locked `LoginResult` carries no principal id
    // (the response stays a generic 423), so resolve the responder by the
    // submitted email via the auth store. Fail-soft so a notification failure can
    // never change the 423 the caller already earned (R10.5).
    await notifySafe(async () => {
      const responder = await deps.authStore.findResponderByEmail(normalized);
      if (!responder) {
        return;
      }
      await notifyOne(
        deps.notifications,
        { tier: 'responders', principalId: responder.id },
        {
          type: 'account.locked',
          data: {},
          title: t('notifyAccountLockedTitle'),
          body: t('notifyAccountLockedBody'),
        },
        { critical: false },
      );
    });

    return jsonResponse(
      { ok: false, error: 'account_locked', retryAfterSeconds: result.retryAfterSeconds },
      423,
      { 'retry-after': String(result.retryAfterSeconds) },
    );
  }

  return viewerResponse(viewerOfPrincipal(result.principal), {
    'set-cookie': serializeSessionCookie(result.token, { secure: deps.secureCookies }),
  });
}

export async function handleLogout(request: Request, deps: AppDeps): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse(403, 'forbidden_origin');
  }

  const token = readSessionToken(request);
  if (token) {
    const context = await authenticate(request, deps);
    if (context.ok) {
      await logout(deps.auth, context.principal);
    }
  }

  return new Response(null, {
    status: 204,
    headers: {
      ...NO_STORE_HEADERS,
      'set-cookie': serializeClearedSessionCookie({ secure: deps.secureCookies }),
    },
  });
}

export async function handleSession(request: Request, deps: AppDeps): Promise<Response> {
  const context = await authenticate(request, deps);
  if (!context.ok) {
    return context.response;
  }

  return viewerResponse(viewerOfPrincipal(context.principal));
}

export async function handleChangePassword(request: Request, deps: AppDeps): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse(403, 'forbidden_origin');
  }

  const context = await authenticate(request, deps);
  if (!context.ok) {
    return context.response;
  }

  const body = await readJsonObject(request);
  if (!body) {
    return errorResponse(400, 'invalid_json');
  }

  const { currentPassword, newPassword } = body;
  if (
    !isNonEmptyString(currentPassword, MAX_PASSWORD_LENGTH) ||
    !isNonEmptyString(newPassword, MAX_PASSWORD_LENGTH)
  ) {
    return errorResponse(400, 'invalid_password');
  }

  const result = await changePassword(deps.auth, context.principal, currentPassword, newPassword);

  if (result.status === 'invalid_current') {
    return errorResponse(401, 'invalid_current_password');
  }

  if (result.status === 'weak') {
    return errorResponse(400, 'weak_password', { problem: result.problem });
  }

  return new Response(null, { status: 204, headers: { ...NO_STORE_HEADERS } });
}

const MAX_CALLSIGN_LENGTH = 32;

/**
 * Self-service profile update (R6.4). Same-origin + authenticated; the caller may
 * only edit its OWN record (the handler scopes the write to `context.principal`,
 * never an id from the body). The display label is the callsign (view.ts derives
 * `displayName` from it), so the edited callsign is what we persist.
 */
export async function handleUpdateProfile(request: Request, deps: AppDeps): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse(403, 'forbidden_origin');
  }

  const context = await authenticate(request, deps);
  if (!context.ok) {
    return context.response;
  }

  const body = await readJsonObject(request);
  if (!body) {
    return errorResponse(400, 'invalid_json');
  }

  const { callsign } = body;
  if (callsign !== undefined && callsign !== null && typeof callsign !== 'string') {
    return errorResponse(400, 'invalid_profile');
  }
  if (typeof callsign === 'string' && callsign.length > MAX_CALLSIGN_LENGTH) {
    return errorResponse(400, 'invalid_profile');
  }

  const result = await updateOwnProfile(deps.auth, context.principal, {
    callsign: callsign ?? null,
  });

  if (!result) {
    return errorResponse(404, 'responder_not_found');
  }

  if (result.status === 'invalid_callsign') {
    return errorResponse(400, 'invalid_callsign');
  }

  return jsonResponse({ ok: true }, 200);
}
