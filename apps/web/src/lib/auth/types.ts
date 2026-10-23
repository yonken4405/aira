/**
 * Auth/RBAC domain types and the store port.
 *
 * The service layer depends only on this interface, so every rule is unit-testable
 * without Postgres (TESTING.md §4.3) and the adapter is the only SQL-aware module.
 */

import type { Role } from './rbac';

export interface ResponderRecord {
  readonly id: string;
  /** Login identifier (globally unique, lower-cased). */
  readonly email: string;
  /** Optional operational display label (map/queue/audit/radio). May be null. */
  readonly callsign: string | null;
  readonly role: Role;
  readonly passwordHash: string;
  readonly active: boolean;
  /** Owning tenant (the subscribing office). Scopes every read. */
  readonly tenantId: string;
  readonly officeId: string;
  readonly officeName: string;
  readonly agencyId: string | null;
  readonly agencyName: string | null;
  readonly mustChangePassword: boolean;
  readonly failedAttempts: number;
  readonly lockedUntil: number | null;
  readonly lastLoginAt: number | null;
}

export interface ResponderSessionRecord {
  readonly id: string;
  readonly responderId: string;
  readonly tokenHash: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly absoluteExpiresAt: number;
  readonly lastSeenAt: number;
  readonly revokedAt: number | null;
}

/** What a request is allowed to act as. Never contains a token or a password hash. */
export interface AuthenticatedPrincipal {
  readonly responderId: string;
  readonly sessionId: string;
  readonly email: string;
  /** Optional display label; prefer `displayName()` for UI/audit text. */
  readonly callsign: string | null;
  readonly role: Role;
  readonly tenantId: string;
  readonly officeId: string;
  readonly officeName: string;
  readonly mustChangePassword: boolean;
}

/** Shape handed to the browser by `/api/auth/session` and the server layouts. */
export interface Viewer {
  readonly id: string;
  readonly email: string;
  readonly callsign: string | null;
  /** Precomputed display label: callsign when set, else the email local-part. */
  readonly displayName: string;
  readonly role: Role;
  readonly tenantId: string;
  readonly officeName: string;
  readonly mustChangePassword: boolean;
}

export type AuthEventType =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILURE'
  | 'ACCOUNT_LOCKED'
  | 'LOGOUT'
  | 'SESSION_REVOKED'
  | 'PASSWORD_CHANGED'
  | 'ACCOUNT_CREATED'
  | 'ACCOUNT_UPDATED'
  | 'ROLE_CHANGED';

export interface AuthEventInput {
  readonly event: AuthEventType;
  readonly responderId?: string | null;
  readonly sessionId?: string | null;
  readonly callsign?: string | null;
  readonly detail?: string | null;
  readonly at?: number;
}

export interface AuthEventRecord {
  readonly id: string;
  readonly responderId: string | null;
  readonly sessionId: string | null;
  readonly event: AuthEventType;
  readonly callsign: string | null;
  readonly detail: string | null;
  readonly createdAt: number;
}

export interface AdminResponderRow extends ResponderRecord {
  readonly sessionCount: number;
}

/**
 * Safe projection of an account row for the browser. `passwordHash` never leaves the
 * server: serialising a `ResponderRecord` into a client component or JSON response
 * would ship the hash to the console (SECURITY.md §4.4).
 */
export interface ResponderView {
  readonly id: string;
  readonly email: string;
  readonly callsign: string | null;
  readonly displayName: string;
  readonly role: Role;
  readonly active: boolean;
  readonly officeId: string;
  readonly officeName: string;
  readonly agencyId: string | null;
  readonly agencyName: string | null;
  readonly mustChangePassword: boolean;
  readonly lockedUntil: number | null;
  readonly lastLoginAt: number | null;
  readonly sessionCount: number;
}

export interface OfficeSummary {
  readonly id: string;
  readonly name: string;
  readonly kind: 'LGU' | 'BARANGAY';
}

export interface AgencySummary {
  readonly id: string;
  readonly name: string;
  readonly code: string;
}

export interface AssignableResponder {
  readonly id: string;
  readonly email: string;
  readonly callsign: string | null;
  readonly displayName: string;
  readonly role: Role;
  readonly officeName: string;
  readonly agencyName: string | null;
}

export interface CreateResponderInput {
  readonly email: string;
  readonly callsign: string | null;
  readonly role: Role;
  readonly passwordHash: string;
  readonly officeId: string;
  readonly agencyId: string | null;
  readonly mustChangePassword: boolean;
}

export interface UpdateResponderPatch {
  readonly role?: Role;
  readonly active?: boolean;
  readonly mustChangePassword?: boolean;
  readonly unlock?: boolean;
}

export interface LoginFailureResult {
  readonly failedAttempts: number;
  readonly lockedUntil: number | null;
}

/** Persistence port for responders, sessions and the auth audit trail. */
export interface AuthStore {
  findResponderByEmail(email: string): Promise<ResponderRecord | null>;
  findResponderById(id: string): Promise<ResponderRecord | null>;

  markLoginFailure(
    responderId: string,
    options: { readonly now: number; readonly lockMs: number; readonly threshold: number },
  ): Promise<LoginFailureResult>;
  markLoginSuccess(responderId: string, now: number): Promise<void>;

  createSession(input: {
    readonly responderId: string;
    readonly tokenHash: string;
    readonly createdAt: number;
    readonly expiresAt: number;
    readonly absoluteExpiresAt: number;
  }): Promise<{ readonly id: string }>;
  findSessionByTokenHash(tokenHash: string): Promise<ResponderSessionRecord | null>;
  touchSession(
    id: string,
    input: { readonly lastSeenAt: number; readonly expiresAt: number },
  ): Promise<void>;
  revokeSession(id: string, input: { readonly at: number; readonly reason: string }): Promise<void>;
  revokeResponderSessions(
    responderId: string,
    input: { readonly at: number; readonly reason: string; readonly exceptSessionId?: string },
  ): Promise<number>;

  updatePassword(
    responderId: string,
    input: { readonly passwordHash: string; readonly mustChangePassword: boolean },
  ): Promise<void>;

  createResponder(input: CreateResponderInput): Promise<ResponderRecord>;
  updateResponder(id: string, patch: UpdateResponderPatch): Promise<ResponderRecord | null>;
  /**
   * Self-service profile edit (R6): updates ONLY the responder's own display
   * label (the callsign). Scoped to the caller's id by the handler; never edits
   * another account.
   */
  updateOwnProfile(
    id: string,
    patch: { readonly callsign: string | null },
  ): Promise<ResponderRecord | null>;

  /** Responders within one tenant (admin roster). */
  listResponders(tenantId: string): Promise<readonly AdminResponderRow[]>;
  listAssignableResponders(officeId: string): Promise<readonly AssignableResponder[]>;
  /** Offices within one tenant (provisioning pickers). */
  listOffices(tenantId: string): Promise<readonly OfficeSummary[]>;
  listAgencies(): Promise<readonly AgencySummary[]>;

  appendAuthEvent(input: AuthEventInput): Promise<void>;
  listAuthEvents(input: {
    readonly limit: number;
    readonly before?: number;
  }): Promise<readonly AuthEventRecord[]>;
}
