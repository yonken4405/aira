/**
 * Role-based access control (SECURITY.md §4).
 *
 * The roles mirror how Philippine LGU DRRM offices are actually organised under
 * RA 10121 §12(b): a DRRM Officer heads the office (ADMIN), the Operations & Warning
 * division runs the 24/7 Operations Center as duty dispatchers (DISPATCHER), and the
 * emergency response units in the field are the responders (RESPONDER).
 *
 * Residents are an app-only principal: no account, no session, no database row. The
 * CITIZEN role exists here only to describe the single permission the public intake
 * endpoint grants. It can never be issued a credential.
 *
 * Deny by default: anything not explicitly granted is refused.
 */

export const ROLES = ['RESPONDER', 'DISPATCHER', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export const CITIZEN = 'CITIZEN' as const;
export type PrincipalRole = Role | typeof CITIZEN;

export const PERMISSIONS = [
  /** POST an alert payload from the citizen app (public, no session). */
  'incident:submit',
  /** Read incidents assigned to the signed-in responder. */
  'incident:read:own',
  /** Read every incident inside the responder's office subtree. */
  'incident:read:office',
  /** Assign or reassign a unit (dispatcher routing action). */
  'incident:assign',
  /** Advance the status of an incident assigned to the responder. */
  'incident:status:own',
  /** Advance the status of any incident in the office subtree. */
  'incident:status:any',
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
 * Exhaustive grant table. ADMIN deliberately holds no incident permission: the DRRM
 * officer manages accounts and audit, and the console holds no citizen data by default
 * (SECURITY.md §4).
 */
const ROLE_PERMISSIONS: Readonly<Record<PrincipalRole, readonly Permission[]>> = {
  [CITIZEN]: ['incident:submit'],
  RESPONDER: [
    'incident:read:own',
    'incident:status:own',
    'session:revoke:own',
    'account:change-password',
  ],
  DISPATCHER: [
    'incident:read:office',
    'incident:assign',
    'incident:status:any',
    'responder:read',
    'metrics:read',
    'session:revoke:own',
    'account:change-password',
    'civilian-broadcast',
  ],
  // ADMIN = DRRM officer: READ-ONLY oversight (incident:read:office + metrics:read) and
  // account/audit management. Deliberately NO incident:assign / incident:status:* -
  // dispatching stays with dispatchers (separation of duties, SECURITY.md §4).
  ADMIN: [
    'incident:read:office',
    'metrics:read',
    'responder:read',
    'responder:manage',
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

/** Where a role lands after signing in. ADMIN has no incident console (SECURITY.md §4). */
export function landingFor(role: Role): '/admin' | '/console' {
  return role === 'ADMIN' ? '/admin' : '/console';
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
