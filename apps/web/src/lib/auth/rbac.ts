/**
 * Role-based access control (SECURITY.md §4, single-lgu-agency-network §3).
 *
 * The roles model how a single LGU coordinates its line agencies under RA 10121's
 * notify-and-coordinate doctrine:
 *   - RESPONDER     — a field unit; acts only on its own assignments.
 *   - DISPATCHER    — AGENCY-scoped: runs one agency's operations center, assigns that
 *                     agency's units for incidents routed to that agency.
 *   - AGENCY_ADMIN  — manages ONE agency's accounts + office↔agency coverage, and reads
 *                     its own agency's incidents read-only. Never dispatches.
 *   - ADMIN         — the LDRRMO coordinator: LGU-wide READ-ONLY incident/metrics
 *                     oversight, sees ALL agencies, may send a coordination nudge. Never
 *                     dispatches (separation of duties).
 *
 * Residents are an app-only principal: no account, no session, no database row. The
 * CITIZEN role exists here only to describe the single permission the public intake
 * endpoint grants. It can never be issued a credential.
 *
 * Deny by default: anything not explicitly granted is refused.
 */

export const ROLES = ['RESPONDER', 'DISPATCHER', 'AGENCY_ADMIN', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export const CITIZEN = 'CITIZEN' as const;
export type PrincipalRole = Role | typeof CITIZEN;

export const PERMISSIONS = [
  /** POST an alert payload from the citizen app (public, no session). */
  'incident:submit',
  /** Read incidents assigned to the signed-in responder. */
  'incident:read:own',
  /** Read every incident inside the responder's office subtree (LDRRMO, LGU-wide read-only). */
  'incident:read:office',
  /** Read incidents routed to the caller's own agency (dispatcher/agency-admin). */
  'incident:read:agency',
  /** Assign or reassign a unit within the caller's own agency (agency dispatcher). */
  'incident:assign:agency',
  /** Advance the status of an incident assigned to the responder. */
  'incident:status:own',
  /** Advance the status of any incident the caller's agency owns (agency dispatcher). */
  'incident:status:any',
  /** Manage the caller's own agency accounts (agency admin). */
  'agency:manage',
  /** Manage the caller's own agency office↔agency coverage links (agency admin). */
  'coverage:manage',
  /** See every agency in the LGU for coordination (LDRRMO coordinator). */
  'agency:read:all',
  /** Send a coordination nudge / help request to another agency (LDRRMO coordinator). */
  'coordination:nudge',
  /** Read the responder roster (needed to pick an assignee). */
  'responder:read',
  /** Create, deactivate, re-role and unlock accounts. */
  'responder:manage',
  /** Read the append-only authentication audit trail. */
  'audit:read',
  /** Read aggregate oversight metrics (volume, response times, active units). */
  'metrics:read',
  /** Revoke the caller's own sessions. */
  'session:revoke:own',
  /** Revoke another responder's sessions. */
  'session:revoke:any',
  /** Change the caller's own password. */
  'account:change-password',
  /** Send a tenant-scoped civilian broadcast (DISPATCHER/ADMIN; R13.1). */
  'civilian-broadcast',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/**
 * Exhaustive grant table (single-lgu-agency-network §3). DISPATCHER and AGENCY_ADMIN are
 * agency-scoped; the ADMIN (LDRRMO coordinator) is LGU-wide read-only and never dispatches.
 */
const ROLE_PERMISSIONS: Readonly<Record<PrincipalRole, readonly Permission[]>> = {
  [CITIZEN]: ['incident:submit'],
  RESPONDER: [
    'incident:read:own',
    'incident:status:own',
    'session:revoke:own',
    'account:change-password',
  ],
  // DISPATCHER = an agency's operations center. Reads/assigns ONLY its own agency's
  // units for incidents routed to that agency (bounded at the store layer).
  DISPATCHER: [
    'incident:read:agency',
    'incident:assign:agency',
    'incident:status:any',
    'responder:read',
    'metrics:read',
    'session:revoke:own',
    'account:change-password',
    'civilian-broadcast',
  ],
  // AGENCY_ADMIN manages ONE agency: its accounts + its office↔agency coverage, and reads
  // its own agency's incidents read-only. No dispatch, no LGU-wide reach.
  AGENCY_ADMIN: [
    'agency:manage',
    'coverage:manage',
    'responder:read',
    'incident:read:agency',
    'metrics:read',
    'audit:read',
    'session:revoke:own',
    'account:change-password',
  ],
  // ADMIN = LDRRMO coordinator: LGU-wide READ-ONLY oversight (incident:read:office +
  // metrics:read), sees ALL agencies, may nudge. Deliberately NO incident:assign:* /
  // incident:status:* - dispatching stays with agency dispatchers (separation of duties).
  ADMIN: [
    'incident:read:office',
    'metrics:read',
    'responder:read',
    'responder:manage',
    'agency:read:all',
    'coordination:nudge',
    'audit:read',
    'session:revoke:any',
    'session:revoke:own',
    'account:change-password',
    'civilian-broadcast',
  ],
};

export class AccessDeniedError extends Error {
  readonly permission: Permission;

  constructor(permission: Permission) {
    super(`access_denied:${permission}`);
    this.name = 'AccessDeniedError';
    this.permission = permission;
  }
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export function permissionsFor(role: PrincipalRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

/** The single authorisation check used by every route and page. */
export function can(role: PrincipalRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** True when the role holds at least one of the permissions. */
export function canAny(role: PrincipalRole, permissions: readonly Permission[]): boolean {
  return permissions.some((permission) => can(role, permission));
}

export function assertPermission(role: PrincipalRole, permission: Permission): void {
  if (!can(role, permission)) {
    throw new AccessDeniedError(permission);
  }
}

/**
 * Where a role lands after signing in. The admin surfaces (LDRRMO coordinator + agency
 * admin) land on `/admin`; dispatch/field roles land on the `/console` (SECURITY.md §4).
 */
export function landingFor(role: Role): '/admin' | '/console' {
  return role === 'ADMIN' || role === 'AGENCY_ADMIN' ? '/admin' : '/console';
}

/**
 * Platform-tier capability flag for the system-notice action (R15.1).
 *
 * System_Notice is a Platform_Tier capability, NOT a responder Role permission. Platform
 * operators live outside the responder Role union ({@link Role}) and therefore have no row
 * in {@link ROLE_PERMISSIONS}, so this capability cannot be expressed through `can()`.
 * It is modelled instead as this documented platform-tier capability constant, which the
 * server checks alongside `authenticatePlatform()` before allowing a System_Notice send.
 */
export const PLATFORM_CAN_SYSTEM_NOTICE = true;
