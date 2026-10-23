/**
 * @vitest-environment node
 *
 * Authorisation matrix (SECURITY.md §4). These assertions are the contract: if a role
 * gains or loses a permission, this file must change with it.
 */

import { describe, expect, it } from 'vitest';

import {
  AccessDeniedError,
  CITIZEN,
  PLATFORM_CAN_SYSTEM_NOTICE,
  type Permission,
  ROLES,
  assertPermission,
  can,
  isRole,
  landingFor,
  permissionsFor,
} from '../src/lib/auth/rbac';

describe('role matrix', () => {
  it('grants the citizen exactly one permission: intake', () => {
    expect(permissionsFor(CITIZEN)).toEqual(['incident:submit']);
    expect(can(CITIZEN, 'incident:submit')).toBe(true);
    expect(can(CITIZEN, 'incident:read:own')).toBe(false);
  });

  it('scopes responders to their own assignments', () => {
    expect(can('RESPONDER', 'incident:read:own')).toBe(true);
    expect(can('RESPONDER', 'incident:status:own')).toBe(true);

    expect(can('RESPONDER', 'incident:read:office')).toBe(false);
    expect(can('RESPONDER', 'incident:assign')).toBe(false);
    expect(can('RESPONDER', 'incident:status:any')).toBe(false);
    expect(can('RESPONDER', 'responder:manage')).toBe(false);
    expect(can('RESPONDER', 'audit:read')).toBe(false);
  });

  it('scopes dispatchers to their office queue plus routing and metrics', () => {
    expect(can('DISPATCHER', 'incident:read:office')).toBe(true);
    expect(can('DISPATCHER', 'incident:assign')).toBe(true);
    expect(can('DISPATCHER', 'incident:status:any')).toBe(true);
    expect(can('DISPATCHER', 'responder:read')).toBe(true);
    expect(can('DISPATCHER', 'metrics:read')).toBe(true);

    expect(can('DISPATCHER', 'incident:read:own')).toBe(false);
    expect(can('DISPATCHER', 'responder:manage')).toBe(false);
    expect(can('DISPATCHER', 'audit:read')).toBe(false);
    expect(can('DISPATCHER', 'session:revoke:any')).toBe(false);
  });

  it('gives the DRRM admin READ-ONLY oversight but never dispatch (separation of duties)', () => {
    // Account/audit management.
    expect(can('ADMIN', 'responder:manage')).toBe(true);
    expect(can('ADMIN', 'audit:read')).toBe(true);
    expect(can('ADMIN', 'session:revoke:any')).toBe(true);
    expect(can('ADMIN', 'responder:read')).toBe(true);

    // Read-only oversight (live map + metrics).
    expect(can('ADMIN', 'incident:read:office')).toBe(true);
    expect(can('ADMIN', 'metrics:read')).toBe(true);

    // But NO ability to act on incidents - dispatching stays with dispatchers.
    expect(can('ADMIN', 'incident:assign')).toBe(false);
    expect(can('ADMIN', 'incident:status:any')).toBe(false);
    expect(can('ADMIN', 'incident:status:own')).toBe(false);
    expect(can('ADMIN', 'incident:read:own')).toBe(false);
    expect(can('ADMIN', 'incident:submit')).toBe(false);
  });

  it('lets every signed-in role change its own password', () => {
    for (const role of ROLES) {
      expect(can(role, 'account:change-password')).toBe(true);
      expect(can(role, 'session:revoke:own')).toBe(true);
    }
  });
});

describe('notification capabilities (R13.1, R15.1)', () => {
  // The literal is cast to Permission because task 24.2 is what adds
  // 'civilian-broadcast' to the Permission union / ROLE_PERMISSIONS. The cast keeps
  // the vitest run meaningful (runtime can() returns false until the grant exists);
  // typecheck remains the other red signal for 24.2 to resolve.
  const CIVILIAN_BROADCAST = 'civilian-broadcast' as Permission;

  it('grants civilian-broadcast to DISPATCHER and ADMIN only (R13.1)', () => {
    expect(can('DISPATCHER', CIVILIAN_BROADCAST)).toBe(true);
    expect(can('ADMIN', CIVILIAN_BROADCAST)).toBe(true);
  });

  it('denies civilian-broadcast to RESPONDER and CITIZEN (R13.1)', () => {
    expect(can('RESPONDER', CIVILIAN_BROADCAST)).toBe(false);
    expect(can(CITIZEN, CIVILIAN_BROADCAST)).toBe(false);
  });

  it('models system-notice as a documented platform-tier capability, not a responder permission (R15.1)', () => {
    // R15.1: the system-notice action is a Platform_Tier capability. It is NOT a
    // responder Role permission in ROLE_PERMISSIONS; it is a documented platform-tier
    // constant exported from rbac.ts.
    expect(PLATFORM_CAN_SYSTEM_NOTICE).toBe(true);
  });
});

describe('helpers', () => {
  it('recognises only the closed role enum', () => {
    expect(isRole('RESPONDER')).toBe(true);
    expect(isRole('DISPATCHER')).toBe(true);
    expect(isRole('ADMIN')).toBe(true);

    expect(isRole('CITIZEN')).toBe(false);
    expect(isRole('UNIT')).toBe(false);
    expect(isRole(null)).toBe(false);
  });

  it('sends admins to the admin console and everyone else to incidents', () => {
    expect(landingFor('ADMIN')).toBe('/admin');
    expect(landingFor('DISPATCHER')).toBe('/console');
    expect(landingFor('RESPONDER')).toBe('/console');
  });

  it('throws a typed error so callers cannot ignore a denial', () => {
    expect(() => assertPermission('RESPONDER', 'incident:assign')).toThrow(AccessDeniedError);
    expect(() => assertPermission('RESPONDER', 'incident:read:own')).not.toThrow();
  });
});
