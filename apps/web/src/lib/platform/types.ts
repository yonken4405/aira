/**
 * Platform-operator (superadmin) domain types + store port.
 *
 * A third identity tier, disjoint from responders and citizens. A platform principal
 * carries NO role and NO incident access; it manages tenants/offices and bootstraps a
 * tenant's first DRRM admin. Never place `incident:*` or responder fields here.
 */

export interface PlatformAdminRecord {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly active: boolean;
  readonly failedAttempts: number;
  readonly lockedUntil: number | null;
  readonly lastLoginAt: number | null;
}

export interface PlatformSessionRecord {
  readonly id: string;
  readonly adminId: string;
  readonly tokenHash: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly absoluteExpiresAt: number;
  readonly lastSeenAt: number;
  readonly revokedAt: number | null;
}

/** What a platform request may act as. No role, no tenant - operators see all tenants. */
export interface PlatformPrincipal {
  readonly adminId: string;
  readonly sessionId: string;
  readonly email: string;
}

export type TenantStatus = 'active' | 'suspended';

export interface TenantRecord {
  readonly id: string;
  readonly name: string;
  readonly region: string;
  readonly province: string;
  readonly status: TenantStatus;
  readonly createdAt: number;
}

/** An office pin for the nationwide operator map. No citizen data - office location only. */
export interface OfficePin {
  readonly id: string;
  readonly tenantId: string;
  readonly tenantName: string;
  readonly name: string;
  readonly kind: 'LGU' | 'BARANGAY';
  readonly region: string | null;
  readonly province: string | null;
  readonly lat: number | null;
  readonly lon: number | null;
  readonly status: TenantStatus;
}

export interface CreateTenantInput {
  readonly name: string;
  readonly region: string;
  readonly province: string;
  /** The tenant's LGU office + its 4 dp location pin. */
  readonly lguName: string;
  readonly lat: number | null;
  readonly lon: number | null;
}

/** Persistence port for the platform tier: its own identity + tenant/office management. */
export interface PlatformStore {
  findAdminByEmail(email: string): Promise<PlatformAdminRecord | null>;
  findAdminById(id: string): Promise<PlatformAdminRecord | null>;
  markLoginFailure(
    adminId: string,
    options: { readonly now: number; readonly lockMs: number; readonly threshold: number },
  ): Promise<{ readonly failedAttempts: number; readonly lockedUntil: number | null }>;
  markLoginSuccess(adminId: string, now: number): Promise<void>;

  createSession(input: {
    readonly adminId: string;
    readonly tokenHash: string;
    readonly createdAt: number;
    readonly expiresAt: number;
    readonly absoluteExpiresAt: number;
  }): Promise<{ readonly id: string }>;
  findSessionByTokenHash(tokenHash: string): Promise<PlatformSessionRecord | null>;
  touchSession(
    id: string,
    input: { readonly lastSeenAt: number; readonly expiresAt: number },
  ): Promise<void>;
  revokeSession(id: string, input: { readonly at: number; readonly reason: string }): Promise<void>;

  // Tenant / office management
  listTenants(): Promise<readonly TenantRecord[]>;
  createTenantWithLgu(input: CreateTenantInput & { readonly now: number }): Promise<TenantRecord>;
  setTenantStatus(tenantId: string, status: TenantStatus): Promise<TenantRecord | null>;
  /** All office pins across every tenant for the nationwide map. */
  listOfficePins(): Promise<readonly OfficePin[]>;
  /** The LGU office id for a tenant (used to bootstrap its first admin). */
  lguOfficeIdForTenant(tenantId: string): Promise<string | null>;
}
