/**
 * Authentication and account service (SECURITY.md §4).
 *
 * All rules live here, in pure functions over an injected store and clock, so the
 * entire login/lockout/session lifecycle is testable without Postgres.
 *
 * Guarantees:
 * - unknown callsigns cost the same time as wrong passwords (no enumeration oracle);
 * - every failure reports the same generic reason;
 * - only the hash of a session token is persisted;
 * - idle and absolute expiry are enforced server-side on every request;
 * - role changes and deactivations revoke live sessions immediately.
 */

import {
  equalizeVerificationTime,
  hashPassword,
  verifyPassword,
  validatePassword,
  type PasswordProblem,
} from './password';
import type { Role } from './rbac';
import {
  createSessionToken,
  evaluateSession,
  hashSessionToken,
  isSessionToken,
  nextIdleExpiry,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  shouldTouchSession,
} from './session';
import type {
  AuthEventInput,
  AuthStore,
  AuthenticatedPrincipal,
  CreateResponderInput,
  ResponderRecord,
  ResponderSessionRecord,
  UpdateResponderPatch,
} from './types';

export interface AuthServiceDeps {
  readonly store: AuthStore;
  readonly now: () => number;
  /** `Secure` cookie flag - false on local http://localhost development. */
  readonly secureCookies: boolean;
}

export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_LOCK_MS = 15 * 60 * 1000;

/** Optional operational display label (not a login): letters, digits, dashes. */
export const CALLSIGN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,31}$/;
/** RFC-5322-lite email check (same shape as the citizen tier). */
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type LoginResult =
  | { readonly status: 'ok'; readonly token: string; readonly principal: AuthenticatedPrincipal }
  | { readonly status: 'invalid' }
  | { readonly status: 'locked'; readonly retryAfterSeconds: number };

export type ChangePasswordResult =
  | { readonly status: 'ok' }
  | { readonly status: 'invalid_current' }
  | { readonly status: 'weak'; readonly problem: PasswordProblem };

export type CreateResponderResult =
  | { readonly status: 'ok'; readonly responder: ResponderRecord }
  | { readonly status: 'conflict' }
  | { readonly status: 'weak'; readonly problem: PasswordProblem };

/** Emails are stored and compared lower-case so login is case-insensitive. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_PATTERN.test(value);
}

/** Callsign is an optional display label; validate only when one is supplied. */
export function isValidCallsign(value: string): boolean {
  return CALLSIGN_PATTERN.test(value);
}

function principalFrom(responder: ResponderRecord, sessionId: string): AuthenticatedPrincipal {
  return {
    responderId: responder.id,
    sessionId,
    email: responder.email,
    callsign: responder.callsign,
    role: responder.role,
    tenantId: responder.tenantId,
    officeId: responder.officeId,
    officeName: responder.officeName,
    mustChangePassword: responder.mustChangePassword,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505'
  );
}

async function audit(deps: AuthServiceDeps, event: AuthEventInput): Promise<void> {
  await deps.store.appendAuthEvent(event);
}

export async function login(
  deps: AuthServiceDeps,
  input: { readonly email: string; readonly password: string },
): Promise<LoginResult> {
  const email = normalizeEmail(input.email);
  const now = deps.now();
  const responder = await deps.store.findResponderByEmail(email);

  if (!responder) {
    // Same work as a real verification, so the response time does not reveal that
    // the email is unknown (no account-enumeration oracle).
    await equalizeVerificationTime(input.password);
    await audit(deps, {
      event: 'LOGIN_FAILURE',
      callsign: email,
      detail: 'unknown_email',
      at: now,
    });
    return { status: 'invalid' };
  }

  if (responder.lockedUntil !== null && responder.lockedUntil > now) {
    await audit(deps, {
      event: 'LOGIN_FAILURE',
      responderId: responder.id,
      callsign: email,
      detail: 'account_locked',
      at: now,
    });
    return {
      status: 'locked',
      retryAfterSeconds: Math.max(1, Math.ceil((responder.lockedUntil - now) / 1000)),
    };
  }

  const passwordOk = await verifyPassword(responder.passwordHash, input.password);

  if (!passwordOk) {
    const failure = await deps.store.markLoginFailure(responder.id, {
      now,
      lockMs: LOGIN_LOCK_MS,
      threshold: LOGIN_MAX_FAILURES,
    });
    const locked = failure.lockedUntil !== null && failure.lockedUntil > now;

    await audit(deps, {
      event: locked ? 'ACCOUNT_LOCKED' : 'LOGIN_FAILURE',
      responderId: responder.id,
      callsign: email,
      detail: locked ? 'max_failures' : 'bad_password',
      at: now,
    });

    return locked
      ? {
          status: 'locked',
          retryAfterSeconds: Math.max(1, Math.ceil((failure.lockedUntil ?? now) - now) / 1000),
        }
      : { status: 'invalid' };
  }

  if (!responder.active) {
    // Deactivated accounts are indistinguishable from bad credentials.
    await audit(deps, {
      event: 'LOGIN_FAILURE',
      responderId: responder.id,
      callsign: email,
      detail: 'inactive',
      at: now,
    });
    return { status: 'invalid' };
  }

  await deps.store.markLoginSuccess(responder.id, now);

  const token = createSessionToken();
  const session = await deps.store.createSession({
    responderId: responder.id,
    tokenHash: hashSessionToken(token),
    createdAt: now,
    expiresAt: now + SESSION_IDLE_MS,
    absoluteExpiresAt: now + SESSION_ABSOLUTE_MS,
  });

  await audit(deps, {
    event: 'LOGIN_SUCCESS',
    responderId: responder.id,
    sessionId: session.id,
    callsign: email,
    at: now,
  });

  return { status: 'ok', token, principal: principalFrom(responder, session.id) };
}

/** Resolves a cookie token into a principal, extending the idle window when due. */
export async function resolveSession(
  deps: AuthServiceDeps,
  token: string | null,
): Promise<AuthenticatedPrincipal | null> {
  if (!isSessionToken(token)) {
    return null;
  }

  const session: ResponderSessionRecord | null = await deps.store.findSessionByTokenHash(
    hashSessionToken(token),
  );
  if (!session) {
    return null;
  }

  const now = deps.now();
  const evaluation = evaluateSession(session, now);

  if (!evaluation.ok) {
    if (evaluation.reason !== 'revoked') {
      await deps.store.revokeSession(session.id, { at: now, reason: evaluation.reason });
    }
    return null;
  }

  const responder = await deps.store.findResponderById(session.responderId);
  if (!responder || !responder.active) {
    await deps.store.revokeSession(session.id, { at: now, reason: 'account_disabled' });
    return null;
  }

  if (shouldTouchSession(session, now)) {
    await deps.store.touchSession(session.id, {
      lastSeenAt: now,
      expiresAt: nextIdleExpiry(session, now),
    });
  }

  return principalFrom(responder, session.id);
}

export async function logout(
  deps: AuthServiceDeps,
  principal: AuthenticatedPrincipal,
): Promise<void> {
  const now = deps.now();
  await deps.store.revokeSession(principal.sessionId, { at: now, reason: 'logout' });
  await audit(deps, {
    event: 'LOGOUT',
    responderId: principal.responderId,
    sessionId: principal.sessionId,
    callsign: principal.email,
    at: now,
  });
}

export async function changePassword(
  deps: AuthServiceDeps,
  principal: AuthenticatedPrincipal,
  currentPassword: string,
  newPassword: string,
): Promise<ChangePasswordResult> {
  const responder = await deps.store.findResponderById(principal.responderId);
  if (!responder || !responder.active) {
    return { status: 'invalid_current' };
  }

  const currentOk = await verifyPassword(responder.passwordHash, currentPassword);
  if (!currentOk) {
    return { status: 'invalid_current' };
  }

  const problem = validatePassword(newPassword, responder.email);
  if (problem) {
    return { status: 'weak', problem };
  }

  const passwordHash = await hashPassword(newPassword);
  await deps.store.updatePassword(responder.id, { passwordHash, mustChangePassword: false });

  // A password change ends every other session; the caller keeps this one.
  await deps.store.revokeResponderSessions(responder.id, {
    at: deps.now(),
    reason: 'password_changed',
    exceptSessionId: principal.sessionId,
  });

  await audit(deps, {
    event: 'PASSWORD_CHANGED',
    responderId: responder.id,
    sessionId: principal.sessionId,
    callsign: responder.email,
    at: deps.now(),
  });

  return { status: 'ok' };
}

export type CreateResponderInvalid =
  { readonly status: 'invalid_email' } | { readonly status: 'invalid_callsign' };

export async function createResponder(
  deps: AuthServiceDeps,
  input: {
    readonly email: string;
    /** Optional operational display label. */
    readonly callsign?: string | null;
    readonly role: Role;
    readonly officeId: string;
    readonly agencyId: string | null;
    readonly password: string;
    readonly mustChangePassword: boolean;
  },
): Promise<CreateResponderResult | CreateResponderInvalid> {
  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) {
    return { status: 'invalid_email' };
  }

  const rawCallsign = input.callsign?.trim() ?? '';
  const callsign = rawCallsign.length > 0 ? rawCallsign : null;
  if (callsign !== null && !isValidCallsign(callsign)) {
    return { status: 'invalid_callsign' };
  }

  const problem = validatePassword(input.password, email);
  if (problem) {
    return { status: 'weak', problem };
  }

  const passwordHash = await hashPassword(input.password);
  const createInput: CreateResponderInput = {
    email,
    callsign,
    role: input.role,
    passwordHash,
    officeId: input.officeId,
    agencyId: input.agencyId,
    mustChangePassword: input.mustChangePassword,
  };

  try {
    const responder = await deps.store.createResponder(createInput);
    await audit(deps, {
      event: 'ACCOUNT_CREATED',
      responderId: responder.id,
      callsign: email,
      detail: responder.role,
      at: deps.now(),
    });
    return { status: 'ok', responder };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { status: 'conflict' };
    }
    throw error;
  }
}

export async function updateResponder(
  deps: AuthServiceDeps,
  responderId: string,
  patch: UpdateResponderPatch,
): Promise<ResponderRecord | null> {
  const before = await deps.store.findResponderById(responderId);
  if (!before) {
    return null;
  }

  const updated = await deps.store.updateResponder(responderId, patch);
  if (!updated) {
    return null;
  }

  const roleChanged = patch.role !== undefined && patch.role !== before.role;
  const deactivated = patch.active === false && before.active;

  await audit(deps, {
    event: roleChanged ? 'ROLE_CHANGED' : 'ACCOUNT_UPDATED',
    responderId: updated.id,
    callsign: updated.email,
    detail: roleChanged ? `${before.role}->${updated.role}` : undefined,
    at: deps.now(),
  });

  if (roleChanged || deactivated) {
    // Privileges changed mid-session: force a fresh sign-in under the new role.
    await deps.store.revokeResponderSessions(updated.id, {
      at: deps.now(),
      reason: roleChanged ? 'role_changed' : 'account_disabled',
    });
  }

  return updated;
}

export type UpdateOwnProfileResult =
  | { readonly status: 'ok'; readonly responder: ResponderRecord }
  | { readonly status: 'invalid_callsign' };

/**
 * Self-service profile edit (R6): the signed-in responder updates its own display
 * label (the callsign). The caller's principal is the only identity touched, so a
 * responder can never edit another account. An empty callsign clears it (the
 * display label then falls back to the email local-part).
 */
export async function updateOwnProfile(
  deps: AuthServiceDeps,
  principal: AuthenticatedPrincipal,
  input: { readonly callsign?: string | null },
): Promise<UpdateOwnProfileResult | null> {
  const rawCallsign = input.callsign?.trim() ?? '';
  const callsign = rawCallsign.length > 0 ? rawCallsign : null;
  if (callsign !== null && !isValidCallsign(callsign)) {
    return { status: 'invalid_callsign' };
  }

  const updated = await deps.store.updateOwnProfile(principal.responderId, { callsign });
  if (!updated) {
    return null;
  }

  await audit(deps, {
    event: 'ACCOUNT_UPDATED',
    responderId: updated.id,
    callsign: updated.email,
    detail: 'profile',
    at: deps.now(),
  });

  return { status: 'ok', responder: updated };
}

export async function revokeResponderSessions(
  deps: AuthServiceDeps,
  responderId: string,
  actor: AuthenticatedPrincipal,
): Promise<number> {
  const removed = await deps.store.revokeResponderSessions(responderId, {
    at: deps.now(),
    reason: 'admin_revoked',
  });

  await audit(deps, {
    event: 'SESSION_REVOKED',
    responderId,
    sessionId: actor.sessionId,
    callsign: actor.email,
    detail: `revoked:${removed}`,
    at: deps.now(),
  });

  return removed;
}
