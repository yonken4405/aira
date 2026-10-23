/**
 * Citizen account service (SECURITY.md §7).
 *
 * Pure rules over an injected store + clock, so the whole signup/login/session
 * lifecycle is testable without Postgres. Mirrors the responder service's security
 * properties: argon2id passwords, lockout, timing equalisation against enumeration,
 * only hashed session tokens, idle + absolute expiry.
 *
 * A citizen principal NEVER carries a role or a responder permission (SECURITY.md §7.2).
 */

import { createHash } from 'node:crypto';

import {
  equalizeVerificationTime,
  hashPassword,
  verifyPassword,
  validatePassword,
  type PasswordProblem,
} from '../auth/password';
import {
  createSessionToken,
  evaluateSession,
  hashSessionToken,
  isSessionToken,
  nextIdleExpiry,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  shouldTouchSession,
} from '../auth/session';
import { deleteOwnProfile, type MedicalServiceDeps } from '../medical/service';
import type { CitizenPrincipal, CitizenRecord, CitizenSessionRecord, CitizenStore } from './types';

export interface CitizenServiceDeps {
  readonly store: CitizenStore;
  readonly now: () => number;
  readonly secureCookies: boolean;
}

export const CITIZEN_MAX_FAILURES = 5;
export const CITIZEN_LOCK_MS = 15 * 60 * 1000;

/** RFC-5322-lite: good enough to reject obvious garbage without a login wall. */
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
/** Opaque device key: URL-safe, 43 chars (a base64url 32-byte token). */
const DEVICE_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_PATTERN.test(value);
}

export function isValidDeviceKey(value: string): boolean {
  return DEVICE_KEY_PATTERN.test(value);
}

/** Device keys are stored only as a SHA-256 hash (SECURITY.md §7.3). */
export function hashDeviceKey(deviceKey: string): string {
  return createHash('sha256').update(deviceKey, 'utf8').digest('hex');
}

function principalFrom(citizen: CitizenRecord, sessionId: string): CitizenPrincipal {
  return {
    citizenId: citizen.id,
    sessionId,
    email: citizen.email,
    emailVerified: citizen.emailVerified,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505'
  );
}

async function issueSession(
  deps: CitizenServiceDeps,
  citizen: CitizenRecord,
): Promise<{ token: string; principal: CitizenPrincipal }> {
  const now = deps.now();
  await deps.store.markLoginSuccess(citizen.id, now);
  const token = createSessionToken();
  const session = await deps.store.createSession({
    citizenId: citizen.id,
    tokenHash: hashSessionToken(token),
    createdAt: now,
    expiresAt: now + SESSION_IDLE_MS,
    absoluteExpiresAt: now + SESSION_ABSOLUTE_MS,
  });
  return { token, principal: principalFrom(citizen, session.id) };
}

export type RegisterResult =
  | { readonly status: 'ok'; readonly token: string; readonly principal: CitizenPrincipal }
  | { readonly status: 'invalid_email' }
  | { readonly status: 'weak'; readonly problem: PasswordProblem }
  | { readonly status: 'conflict' };

/** Email + password signup. Email verification is mocked (SECURITY.md §7.1). */
export async function registerWithEmail(
  deps: CitizenServiceDeps,
  input: { readonly email: string; readonly password: string },
): Promise<RegisterResult> {
  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) {
    return { status: 'invalid_email' };
  }

  const problem = validatePassword(input.password, email);
  if (problem) {
    return { status: 'weak', problem };
  }

  const passwordHash = await hashPassword(input.password);

  try {
    const citizen = await deps.store.create({
      email,
      deviceKeyHash: null,
      passwordHash,
      // Mocked verification: a real email channel is a later, reviewed change.
      emailVerified: false,
    });
    const { token, principal } = await issueSession(deps, citizen);
    return { status: 'ok', token, principal };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { status: 'conflict' };
    }
    throw error;
  }
}

export type LoginResult =
  | { readonly status: 'ok'; readonly token: string; readonly principal: CitizenPrincipal }
  | { readonly status: 'invalid' }
  | { readonly status: 'locked'; readonly retryAfterSeconds: number };

/** Email + password login, with lockout + timing equalisation (no enumeration oracle). */
export async function loginWithEmail(
  deps: CitizenServiceDeps,
  input: { readonly email: string; readonly password: string },
): Promise<LoginResult> {
  const email = normalizeEmail(input.email);
  const now = deps.now();
  const citizen = await deps.store.findByEmail(email);

  if (!citizen || citizen.passwordHash === null) {
    await equalizeVerificationTime(input.password);
    return { status: 'invalid' };
  }

  if (citizen.lockedUntil !== null && citizen.lockedUntil > now) {
    return {
      status: 'locked',
      retryAfterSeconds: Math.max(1, Math.ceil((citizen.lockedUntil - now) / 1000)),
    };
  }

  const ok = await verifyPassword(citizen.passwordHash, input.password);
  if (!ok) {
    const failure = await deps.store.markLoginFailure(citizen.id, {
      now,
      lockMs: CITIZEN_LOCK_MS,
      threshold: CITIZEN_MAX_FAILURES,
    });
    const locked = failure.lockedUntil !== null && failure.lockedUntil > now;
    return locked
      ? {
          status: 'locked',
          retryAfterSeconds: Math.max(1, Math.ceil(((failure.lockedUntil ?? now) - now) / 1000)),
        }
      : { status: 'invalid' };
  }

  if (!citizen.active) {
    return { status: 'invalid' };
  }

  const { token, principal } = await issueSession(deps, citizen);
  return { status: 'ok', token, principal };
}

export type DeviceAuthResult = {
  readonly status: 'ok';
  readonly token: string;
  readonly principal: CitizenPrincipal;
};

/**
 * Device-key identity: register-or-login in one step. A fresh device key provisions a
 * passwordless account; a known one signs it in. This is the zero-friction path for a
 * citizen who wants tracking without typing an email (PRODUCT.md §1a/§6).
 */
export async function authenticateWithDeviceKey(
  deps: CitizenServiceDeps,
  deviceKey: string,
): Promise<DeviceAuthResult | { readonly status: 'invalid_device_key' }> {
  if (!isValidDeviceKey(deviceKey)) {
    return { status: 'invalid_device_key' };
  }

  const deviceKeyHash = hashDeviceKey(deviceKey);
  const existing = await deps.store.findByDeviceKeyHash(deviceKeyHash);

  const citizen =
    existing ??
    (await deps.store.create({
      email: null,
      deviceKeyHash,
      passwordHash: null,
      emailVerified: false,
    }));

  if (!citizen.active) {
    // Reuse the create path's shape; an inactive device account cannot sign in.
    return { status: 'invalid_device_key' };
  }

  const { token, principal } = await issueSession(deps, citizen);
  return { status: 'ok', token, principal };
}

/** Resolve a citizen cookie token into a principal, extending the idle window when due. */
export async function resolveCitizenSession(
  deps: CitizenServiceDeps,
  token: string | null,
): Promise<CitizenPrincipal | null> {
  if (!isSessionToken(token)) {
    return null;
  }

  const session: CitizenSessionRecord | null = await deps.store.findSessionByTokenHash(
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

  const citizen = await deps.store.findById(session.citizenId);
  if (!citizen || !citizen.active) {
    await deps.store.revokeSession(session.id, { at: now, reason: 'account_disabled' });
    return null;
  }

  if (shouldTouchSession(session, now)) {
    await deps.store.touchSession(session.id, {
      lastSeenAt: now,
      expiresAt: nextIdleExpiry(session, now),
    });
  }

  return principalFrom(citizen, session.id);
}

export async function logoutCitizen(
  deps: CitizenServiceDeps,
  principal: CitizenPrincipal,
): Promise<void> {
  await deps.store.revokeSession(principal.sessionId, { at: deps.now(), reason: 'logout' });
}

/**
 * Hard-deletes a citizen account (SECURITY.md §7.5, Requirement 10.1).
 *
 * Order matters: revoke the caller's session first (R10.4 — the current token must
 * stop resolving), then drop the encrypted medical row (reuses MedicalStore.remove),
 * then delete the citizen identity row. Anonymous incidents are never touched here
 * (R10.5): this function only reaches the citizen and medical stores. No identity,
 * profile, or contact values are logged (R10.7).
 */
export async function deleteCitizenAccount(
  citizenDeps: CitizenServiceDeps,
  medicalDeps: MedicalServiceDeps,
  principal: CitizenPrincipal,
): Promise<void> {
  await citizenDeps.store.revokeSession(principal.sessionId, {
    at: citizenDeps.now(),
    reason: 'account_deleted',
  });
  await deleteOwnProfile(medicalDeps, principal.citizenId);
  await citizenDeps.store.deleteCitizen(principal.citizenId);
}
