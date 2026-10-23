/**
 * Citizen identity domain types + store port (SECURITY.md §7).
 *
 * Deliberately disjoint from the responder auth types: a citizen principal carries no
 * role and no responder permission. The only thing a citizen may ever do is submit and
 * track their own incidents (PRODUCT.md §1a).
 */

export interface CitizenRecord {
  readonly id: string;
  readonly email: string | null;
  readonly deviceKeyHash: string | null;
  readonly passwordHash: string | null;
  readonly emailVerified: boolean;
  readonly active: boolean;
  readonly failedAttempts: number;
  readonly lockedUntil: number | null;
  readonly lastLoginAt: number | null;
}

export interface CitizenSessionRecord {
  readonly id: string;
  readonly citizenId: string;
  readonly tokenHash: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly absoluteExpiresAt: number;
  readonly lastSeenAt: number;
  readonly revokedAt: number | null;
}

/** What a citizen request may act as. Never a role, never a responder permission. */
export interface CitizenPrincipal {
  readonly citizenId: string;
  readonly sessionId: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
}

export interface CreateCitizenInput {
  readonly email: string | null;
  readonly deviceKeyHash: string | null;
  readonly passwordHash: string | null;
  readonly emailVerified: boolean;
}

export interface CitizenLoginFailureResult {
  readonly failedAttempts: number;
  readonly lockedUntil: number | null;
}

/** Persistence port for citizen accounts and their sessions. */
export interface CitizenStore {
  findByEmail(email: string): Promise<CitizenRecord | null>;
  findByDeviceKeyHash(deviceKeyHash: string): Promise<CitizenRecord | null>;
  findById(id: string): Promise<CitizenRecord | null>;

  create(input: CreateCitizenInput): Promise<CitizenRecord>;

  /** Hard-delete a citizen row by id (account deletion, SECURITY.md §7.5). */
  deleteCitizen(id: string): Promise<void>;

  markLoginFailure(
    citizenId: string,
    options: { readonly now: number; readonly lockMs: number; readonly threshold: number },
  ): Promise<CitizenLoginFailureResult>;
  markLoginSuccess(citizenId: string, now: number): Promise<void>;

  createSession(input: {
    readonly citizenId: string;
    readonly tokenHash: string;
    readonly createdAt: number;
    readonly expiresAt: number;
    readonly absoluteExpiresAt: number;
  }): Promise<{ readonly id: string }>;
  findSessionByTokenHash(tokenHash: string): Promise<CitizenSessionRecord | null>;
  touchSession(
    id: string,
    input: { readonly lastSeenAt: number; readonly expiresAt: number },
  ): Promise<void>;
  revokeSession(id: string, input: { readonly at: number; readonly reason: string }): Promise<void>;
}
