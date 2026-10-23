/**
 * Deterministic fixtures for the web test suite.
 *
 * Incidents are shaped exactly like API rows so component tests exercise the same
 * contract the server produces (no mock-only fields).
 */

import type { EmergencyCategoryId } from '@aira/ui';

import type { Incident, IncidentSource, IncidentStatus } from '../../src/lib/incidents';
import type { Viewer } from '../../src/lib/auth/types';

export const OFFICE_ID = '0f100000-0000-4000-8000-000000000001';
export const AGENCY_ID = 'a1000000-0000-4000-8000-000000000001';
export const TENANT_ID = '7e000000-0000-4000-8000-000000000001';

/** Password whose argon2id hash is `DUMMY_PASSWORD_HASH`; safe to keep in tests. */
export const TEST_PASSWORD = 'aira-dummy-password-not-a-real-account';

export function makeIncident(overrides: Partial<Incident> & { readonly id: string }): Incident {
  return {
    category: 'SUNOG' as EmergencyCategoryId,
    lat: 10.3157,
    lon: 123.8854,
    reportedAt: '2026-10-22T08:00:00.000Z',
    source: 'mesh' as IncidentSource,
    status: 'QUEUED' as IncidentStatus,
    assignedToId: null,
    assignedToCallsign: null,
    officeId: OFFICE_ID,
    note: null,
    resolvedAt: null,
    reporterCitizenId: null,
    ...overrides,
  };
}

/** Mirrors the seeded demo queue (same ids/coords the console tests assert on). */
export const MOCK_INCIDENTS: readonly Incident[] = [
  makeIncident({ id: 'mesh-1001', category: 'SUNOG', reportedAt: '2026-10-22T08:00:00.000Z' }),
  makeIncident({
    id: 'mesh-1002',
    category: 'MEDIKAL',
    lat: 10.3312,
    lon: 123.8925,
    reportedAt: '2026-10-22T08:05:00.000Z',
  }),
  makeIncident({
    id: 'mesh-1003',
    category: 'KRIMEN',
    lat: 10.2965,
    lon: 123.902,
    reportedAt: '2026-10-22T08:10:00.000Z',
  }),
  makeIncident({
    id: 'mesh-1004',
    category: 'BAHA',
    lat: 10.305,
    lon: 123.875,
    reportedAt: '2026-10-22T08:15:00.000Z',
  }),
  makeIncident({
    id: 'mesh-1005',
    category: 'MEDIKAL',
    lat: 10.34,
    lon: 123.91,
    reportedAt: '2026-10-22T08:20:00.000Z',
  }),
];

export const DISPATCHER_VIEWER: Viewer = {
  id: 'responder-dispatcher',
  email: 'dispatcher@aira.test',
  callsign: 'OPCEN-01',
  displayName: 'OPCEN-01',
  role: 'DISPATCHER',
  tenantId: TENANT_ID,
  officeName: 'Cebu City DRRMO',
  mustChangePassword: false,
};

export const RESPONDER_VIEWER: Viewer = {
  id: 'responder-field',
  email: 'field@aira.test',
  callsign: 'K9-01',
  displayName: 'K9-01',
  role: 'RESPONDER',
  tenantId: TENANT_ID,
  officeName: 'Cebu City DRRMO',
  mustChangePassword: false,
};

export const ADMIN_VIEWER: Viewer = {
  id: 'responder-admin',
  email: 'admin@aira.test',
  callsign: 'ADMIN-1',
  displayName: 'ADMIN-1',
  role: 'ADMIN',
  tenantId: TENANT_ID,
  officeName: 'Cebu City DRRMO',
  mustChangePassword: false,
};
