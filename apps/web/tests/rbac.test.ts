/**
 * @vitest-environment node
 *
 * Authorisation matrix (SECURITY.md §4, single-lgu-agency-network §3). These assertions
 * are the contract: if a role gains or loses a permission, this file must change with it.
 */

import { describe, expect, it } from 'vitest';

import {
  AccessDeniedError,
  CITIZEN,
  PLATFORM_CAN_SYSTEM_NOTICE,
  PERMISSIONS,
  type Permission,
  ROLES,
  assertPermission,
  can,
  isRole,
  landingFor,
  permissionsFor,
} from '../src/lib/auth/rbac';

describe('role matrix', () => {
  it('closes the role enum over the four responder roles', () => {
    expect([...ROLES]).toEqual(['RESPONDER', 'DISPATCHER', 'AGENCY_ADMIN', 'ADMIN']);
  });

  it('grants the citizen exactly one permission: intake', () => {
    expect(permissionsFor(CITIZEN)).toEqual(['incident:submit']);
    expect(can(CITIZEN, 'incident:submit')).toBe(true);
    expect(can(CITIZEN, 'incident:read:own')).toBe(false);
  });

  it('scopes responders to their own assignments', () => {
    expect(can('RESPONDER', 'incident:read:own')).toBe(true);
    expect(can('RESPONDER', 'incident:status:own')).toBe(true);

    expect(can('RESPONDER', 'incident:read:office')).toBe(false);
    expect(can('RESPONDER', 'incident:read:agency')).toBe(false);
    expect(can('RESPONDER', 'incident:assign:agency')).toBe(false);
    expect(can('RESPONDER', 'incident:status:any')).toBe(false);
    expect(can('RESPONDER', 'responder:manage')).toBe(false);
    expect(can('RESPONDER', 'audit:read')).toBe(false);
  });

  it('scopes dispatchers to their AGENCY queue + agency-scoped assign + metrics', () => {
    // Agency-scoped incident access (replaces the bare office/assign permissions).
    expect(can('DISPATCHER', 'incident:read:agency')).toBe(true);
    expect(can('DISPATCHER', 'incident:assign:agency')).toBe(true);
    expect(can('DISPATCHER', 'incident:status:any')).toBe(true);
    expect(can('DISPATCHER', 'responder:read')).toBe(true);
    expect(can('DISPATCHER', 'metrics:read')).toBe(true);

    // The bare, LGU-wide office read is NOT granted to a dispatcher anymore (the former
    // bare `incident:assign` permission has been removed from the union entirely).
    expect(can('DISPATCHER', 'incident:read:office')).toBe(false);

    expect(can('DISPATCHER', 'incident:read:own')).toBe(false);
    expect(can('DISPATCHER', 'responder:manage')).toBe(false);
    expect(can('DISPATCHER', 'audit:read')).toBe(false);
    expect(can('DISPATCHER', 'session:revoke:any')).toBe(false);
    expect(can('DISPATCHER', 'agency:manage')).toBe(false);
    expect(can('DISPATCHER', 'coverage:manage')).toBe(false);
  });

  it('scopes the AGENCY_ADMIN to its own agency: manage accounts + coverage, read-only incidents', () => {
    expect(can('AGENCY_ADMIN', 'agency:manage')).toBe(true);
    expect(can('AGENCY_ADMIN', 'coverage:manage')).toBe(true);
    expect(can('AGENCY_ADMIN', 'responder:read')).toBe(true);
    expect(can('AGENCY_ADMIN', 'incident:read:agency')).toBe(true);
    expect(can('AGENCY_ADMIN', 'metrics:read')).toBe(true);
    expect(can('AGENCY_ADMIN', 'audit:read')).toBe(true);
    expect(can('AGENCY_ADMIN', 'account:change-password')).toBe(true);
    expect(can('AGENCY_ADMIN', 'session:revoke:own')).toBe(true);

    // An agency admin never dispatches and never acts LGU-wide.
    expect(can('AGENCY_ADMIN', 'incident:assign:agency')).toBe(false);
    expect(can('AGENCY_ADMIN', 'incident:status:any')).toBe(false);
    expect(can('AGENCY_ADMIN', 'incident:read:office')).toBe(false);
    expect(can('AGENCY_ADMIN', 'agency:read:all')).toBe(false);
    expect(can('AGENCY_ADMIN', 'coordination:nudge')).toBe(false);
    expect(can('AGENCY_ADMIN', 'responder:manage')).toBe(false);
  });

  it('gives the LDRRMO coordinator (ADMIN) LGU-wide read-only oversight + coordination, never dispatch', () => {
    // Account/audit management + LGU-wide coordination.
    expect(can('ADMIN', 'responder:manage')).toBe(true);
    expect(can('ADMIN', 'audit:read')).toBe(true);
    expect(can('ADMIN', 'session:revoke:any')).toBe(true);
    expect(can('ADMIN', 'responder:read')).toBe(true);
    expect(can('ADMIN', 'agency:read:all')).toBe(true);
    expect(can('ADMIN', 'coordination:nudge')).toBe(true);

    // Read-only oversight across the whole LGU (live map + metrics).
    expect(can('ADMIN', 'incident:read:office')).toBe(true);
    expect(can('ADMIN', 'metrics:read')).toBe(true);

    // But NO ability to act on incidents - dispatching stays with agency dispatchers.
    expect(can('ADMIN', 'incident:assign:agency')).toBe(false);
    expect(can('ADMIN', 'incident:status:any')).toBe(false);
    expect(can('ADMIN', 'incident:status:own')).toBe(false);
    expect(can('ADMIN', 'incident:read:own')).toBe(false);
    expect(can('ADMIN', 'incident:submit')).toBe(false);

    // The LDRRMO coordinator is not an agency admin and manages no single agency.
    expect(can('ADMIN', 'agency:manage')).toBe(false);
    expect(can('ADMIN', 'coverage:manage')).toBe(false);
  });

  it('lets every signed-in role change its own password', () => {
    for (const role of ROLES) {
      expect(can(role, 'account:change-password')).toBe(true);
      expect(can(role, 'session:revoke:own')).toBe(true);
    }
  });

  it('exposes the new agency-scoped permissions in the PERMISSIONS union', () => {
    const expected: readonly Permission[] = [
      'incident:read:agency',
      'incident:assign:agency',
      'agency:manage',
      'coverage:manage',
      'agency:read:all',
      'coordination:nudge',
    ];
    for (const permission of expected) {
      expect(PERMISSIONS).toContain(permission);
    }
  });
});

describe('notification capabilities (R13.1, R15.1)', () => {
  it('grants civilian-broadcast to DISPATCHER and ADMIN only (R13.1)', () => {
    expect(can('DISPATCHER', 'civilian-broadcast')).toBe(true);
    expect(can('ADMIN', 'civilian-broadcast')).toBe(true);
  });

  it('denies civilian-broadcast to RESPONDER, AGENCY_ADMIN and CITIZEN (R13.1)', () => {
    expect(can('RESPONDER', 'civilian-broadcast')).toBe(false);
    expect(can('AGENCY_ADMIN', 'civilian-broadcast')).toBe(false);
    expect(can(CITIZEN, 'civilian-broadcast')).toBe(false);
  });

  it('models system-notice as a documented platform-tier capability, not a responder permission (R15.1)', () => {
    expect(PLATFORM_CAN_SYSTEM_NOTICE).toBe(true);
  });
});

describe('helpers', () => {
  it('recognises only the closed role enum', () => {
    expect(isRole('RESPONDER')).toBe(true);
    expect(isRole('DISPATCHER')).toBe(true);
    expect(isRole('AGENCY_ADMIN')).toBe(true);
    expect(isRole('ADMIN')).toBe(true);

    expect(isRole('CITIZEN')).toBe(false);
    expect(isRole('UNIT')).toBe(false);
    expect(isRole(null)).toBe(false);
  });

  it('sends admins and agency admins to the admin console, dispatch/field to the console', () => {
    expect(landingFor('ADMIN')).toBe('/admin');
    expect(landingFor('AGENCY_ADMIN')).toBe('/admin');
    expect(landingFor('DISPATCHER')).toBe('/console');
    expect(landingFor('RESPONDER')).toBe('/console');
  });

  it('throws a typed error so callers cannot ignore a denial', () => {
    expect(() => assertPermission('RESPONDER', 'incident:assign:agency')).toThrow(
      AccessDeniedError,
    );
    expect(() => assertPermission('RESPONDER', 'incident:read:own')).not.toThrow();
  });
});
