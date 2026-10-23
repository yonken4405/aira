/**
 * Platform-operator service (multi-tenant superadmin tier).
 *
 * Pure rules over an injected store + clock. Handles its own auth (argon2id, lockout,
 * hashed opaque sessions - mirroring the responder/citizen tiers) and the tenant/office
 * management an operator performs when onboarding an office in person.
 *
 * A platform principal NEVER carries incident access. Bootstrapping a tenant's first
 * DRRM admin goes through the normal responder service, so that account is an ordinary
 * tenant-scoped ADMIN with no platform powers.
 */

import { createResponder, type AuthServiceDeps } from '../auth/service';
import {
  equalizeVerificationTime,
  generatePassword,
  hashPassword,
  validatePassword,
  verifyPassword,
} from '../auth/password';
import { roundCoord } from '@aira/ui';
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
import type {
  CreateTenantInput,
  OfficePin,
  PlatformAdminRecord,
  PlatformPrincipal,
  PlatformSessionRecord,
  PlatformStore,
  TenantRecord,
  TenantStatus,
} from './types';

export interface PlatformServiceDeps {
  readonly store: PlatformStore;
  readonly now: () => number;
  readonly secureCookies: boolean;
  /** For bootstrapping a tenant's first DRRM admin through the responder service. */
  readonly auth: AuthServiceDeps;
}

export const PLATFORM_MAX_FAILURES = 5;
export const PLATFORM_LOCK_MS = 15 * 60 * 1000;

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_PATTERN.test(value);
}

function principalFrom(admin: PlatformAdminRecord, sessionId: string): PlatformPrincipal {
  return { adminId: admin.id, sessionId, email: admin.email };
}

export type PlatformLoginResult =
  | { readonly status: 'ok'; readonly token: string; readonly principal: PlatformPrincipal }
  | { readonly status: 'invalid' }
  | { readonly status: 'locked'; readonly retryAfterSeconds: number };

export async function login(
  deps: PlatformServiceDeps,
  input: { readonly email: string; readonly password: string },
): Promise<PlatformLoginResult> {
  const email = normalizeEmail(input.email);
  const now = deps.now();
  const admin = await deps.store.findAdminByEmail(email);

  if (!admin) {
    await equalizeVerificationTime(input.password);
    return { status: 'invalid' };
  }
  if (admin.lockedUntil !== null && admin.lockedUntil > now) {
    return {
      status: 'locked',
      retryAfterSeconds: Math.max(1, Math.ceil((admin.lockedUntil - now) / 1000)),
    };
  }

  const ok = await verifyPassword(admin.passwordHash, input.password);
  if (!ok) {
    const failure = await deps.store.markLoginFailure(admin.id, {
      now,
      lockMs: PLATFORM_LOCK_MS,
      threshold: PLATFORM_MAX_FAILURES,
    });
    const locked = failure.lockedUntil !== null && failure.lockedUntil > now;
    return locked
      ? {
          status: 'locked',
          retryAfterSeconds: Math.max(1, Math.ceil(((failure.lockedUntil ?? now) - now) / 1000)),
        }
      : { status: 'invalid' };
  }
  if (!admin.active) {
    return { status: 'invalid' };
  }

  await deps.store.markLoginSuccess(admin.id, now);
  const token = createSessionToken();
  const session = await deps.store.createSession({
    adminId: admin.id,
    tokenHash: hashSessionToken(token),
    createdAt: now,
    expiresAt: now + SESSION_IDLE_MS,
    absoluteExpiresAt: now + SESSION_ABSOLUTE_MS,
  });
  return { status: 'ok', token, principal: principalFrom(admin, session.id) };
}

export async function resolvePlatformSession(
  deps: PlatformServiceDeps,
  token: string | null,
): Promise<PlatformPrincipal | null> {
  if (!isSessionToken(token)) {
    return null;
  }
  const session: PlatformSessionRecord | null = await deps.store.findSessionByTokenHash(
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
  const admin = await deps.store.findAdminById(session.adminId);
  if (!admin || !admin.active) {
    await deps.store.revokeSession(session.id, { at: now, reason: 'account_disabled' });
    return null;
  }
  if (shouldTouchSession(session, now)) {
    await deps.store.touchSession(session.id, {
      lastSeenAt: now,
      expiresAt: nextIdleExpiry(session, now),
    });
  }
  return principalFrom(admin, session.id);
}

export async function logout(
  deps: PlatformServiceDeps,
  principal: PlatformPrincipal,
): Promise<void> {
  await deps.store.revokeSession(principal.sessionId, { at: deps.now(), reason: 'logout' });
}

// --- Tenant / office management -------------------------------------------------

export async function listTenants(deps: PlatformServiceDeps): Promise<readonly TenantRecord[]> {
  return deps.store.listTenants();
}

export async function listOfficePins(deps: PlatformServiceDeps): Promise<readonly OfficePin[]> {
  return deps.store.listOfficePins();
}

export type CreateTenantResult =
  | { readonly status: 'ok'; readonly tenant: TenantRecord }
  | { readonly status: 'invalid' }
  | { readonly status: 'conflict' };

/** Validates + rounds the pin to 4 dp, then provisions the tenant with its LGU office. */
export async function createTenant(
  deps: PlatformServiceDeps,
  input: CreateTenantInput,
): Promise<CreateTenantResult> {
  const name = input.name.trim();
  const region = input.region.trim();
  const province = input.province.trim();
  const lguName = input.lguName.trim();
  if (name.length < 2 || region.length < 2 || province.length < 2 || lguName.length < 2) {
    return { status: 'invalid' };
  }

  const lat = input.lat === null ? null : roundCoord(input.lat);
  const lon = input.lon === null ? null : roundCoord(input.lon);
  if (lat !== null && (lat < -90 || lat > 90)) {
    return { status: 'invalid' };
  }
  if (lon !== null && (lon < -180 || lon > 180)) {
    return { status: 'invalid' };
  }

  try {
    const tenant = await deps.store.createTenantWithLgu({
      name,
      region,
      province,
      lguName,
      lat,
      lon,
      now: deps.now(),
    });
    return { status: 'ok', tenant };
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: unknown }).code === '23505'
    ) {
      return { status: 'conflict' };
    }
    throw error;
  }
}

export async function setTenantStatus(
  deps: PlatformServiceDeps,
  tenantId: string,
  status: TenantStatus,
): Promise<TenantRecord | null> {
  return deps.store.setTenantStatus(tenantId, status);
}

export type BootstrapAdminResult =
  | { readonly status: 'ok'; readonly email: string; readonly password: string }
  | { readonly status: 'tenant_not_found' }
  | { readonly status: 'invalid_email' }
  | { readonly status: 'conflict' };

/**
 * Creates a tenant's FIRST DRRM admin: an ordinary tenant-scoped ADMIN responder placed
 * in the tenant's LGU office, with a one-time password. This is the only account the
 * platform operator creates; the DRRM admin then manages their own responders.
 */
export async function bootstrapTenantAdmin(
  deps: PlatformServiceDeps,
  input: { readonly tenantId: string; readonly email: string },
): Promise<BootstrapAdminResult> {
  const officeId = await deps.store.lguOfficeIdForTenant(input.tenantId);
  if (!officeId) {
    return { status: 'tenant_not_found' };
  }

  const password = generatePassword();
  const result = await createResponder(deps.auth, {
    email: input.email,
    callsign: null,
    role: 'ADMIN',
    officeId,
    agencyId: null,
    password,
    mustChangePassword: true,
  });

  if (result.status === 'invalid_email') {
    return { status: 'invalid_email' };
  }
  if (result.status === 'invalid_callsign' || result.status === 'weak') {
    // Generated password is always strong and callsign is null, so these are unreachable
    // in practice; treat as invalid input defensively.
    return { status: 'invalid_email' };
  }
  if (result.status === 'conflict') {
    return { status: 'conflict' };
  }

  return { status: 'ok', email: result.responder.email, password };
}

/** Used by the bootstrap CLI to hash the first platform admin's password. */
export async function hashPlatformPassword(password: string): Promise<string> {
  return hashPassword(password);
}

export function validatePlatformPassword(
  password: string,
  email: string,
): ReturnType<typeof validatePassword> {
  return validatePassword(password, email);
}
