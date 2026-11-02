/**
 * @vitest-environment node
 *
 * Store-layer coverage + agency-scoped reads (single-lgu-agency-network R5, R6, R7.5),
 * exercised against the in-memory adapters (TESTING.md §4.3). These assert the new
 * store contract the Postgres adapter mirrors byte-for-byte.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { createMemoryAuthStore, type MemoryAuthStore } from './support/memory-auth-store';
import {
  createMemoryPlatformStore,
  type MemoryPlatformStore,
} from './support/memory-platform-store';
import {
  createMemoryIncidentsStore,
  type MemoryIncidentsStore,
} from './support/memory-incidents-store';
import { OFFICE_ID, TENANT_ID } from './support/fixtures';

const BARANGAY_A = 'office-brgy-a';
const BARANGAY_B = 'office-brgy-b';
const AGENCY_FIRE = 'agency-fire';
const AGENCY_POLICE = 'agency-police';

describe('agency_coverage store (PlatformStore)', () => {
  let store: MemoryPlatformStore;

  beforeEach(() => {
    store = createMemoryPlatformStore();
  });

  it('listCoverage returns an empty list for an agency with no coverage', async () => {
    expect(await store.listCoverage(AGENCY_FIRE)).toEqual([]);
  });

  it('setCoverage replaces the full set and listCoverage reads it back (sorted/stable)', async () => {
    await store.setCoverage(AGENCY_FIRE, [BARANGAY_A, BARANGAY_B]);
    expect([...(await store.listCoverage(AGENCY_FIRE))].sort()).toEqual(
      [BARANGAY_A, BARANGAY_B].sort(),
    );

    // Full replace: a second set wipes the prior links.
    await store.setCoverage(AGENCY_FIRE, [BARANGAY_B]);
    expect(await store.listCoverage(AGENCY_FIRE)).toEqual([BARANGAY_B]);
  });

  it('setCoverage de-duplicates office ids', async () => {
    await store.setCoverage(AGENCY_FIRE, [BARANGAY_A, BARANGAY_A, BARANGAY_B, BARANGAY_A]);
    expect([...(await store.listCoverage(AGENCY_FIRE))].sort()).toEqual(
      [BARANGAY_A, BARANGAY_B].sort(),
    );
  });

  it('setCoverage of one agency does not affect another agency', async () => {
    await store.setCoverage(AGENCY_FIRE, [BARANGAY_A]);
    await store.setCoverage(AGENCY_POLICE, [BARANGAY_B]);
    expect(await store.listCoverage(AGENCY_FIRE)).toEqual([BARANGAY_A]);
    expect(await store.listCoverage(AGENCY_POLICE)).toEqual([BARANGAY_B]);
  });

  it('coversOffice reflects the current links', async () => {
    await store.setCoverage(AGENCY_FIRE, [BARANGAY_A]);
    expect(await store.coversOffice(AGENCY_FIRE, BARANGAY_A)).toBe(true);
    expect(await store.coversOffice(AGENCY_FIRE, BARANGAY_B)).toBe(false);
    expect(await store.coversOffice(AGENCY_POLICE, BARANGAY_A)).toBe(false);
  });

  it('setCoverage to an empty set clears coverage', async () => {
    await store.setCoverage(AGENCY_FIRE, [BARANGAY_A, BARANGAY_B]);
    await store.setCoverage(AGENCY_FIRE, []);
    expect(await store.listCoverage(AGENCY_FIRE)).toEqual([]);
    expect(await store.coversOffice(AGENCY_FIRE, BARANGAY_A)).toBe(false);
  });
});

describe('auth store: agency-filtered roster + tenant-filtered agencies (R7.1/R7.5)', () => {
  let store: MemoryAuthStore;

  beforeEach(() => {
    store = createMemoryAuthStore({ now: () => 0 });
    store.seedResponder({
      id: 'r-fire-1',
      email: 'fire1@aira.test',
      role: 'RESPONDER',
      agencyId: AGENCY_FIRE,
      agencyName: 'BFP',
    });
    store.seedResponder({
      id: 'r-police-1',
      email: 'police1@aira.test',
      role: 'DISPATCHER',
      agencyId: AGENCY_POLICE,
      agencyName: 'PNP',
    });
    store.seedResponder({
      id: 'r-coordinator',
      email: 'ldrrmo@aira.test',
      role: 'ADMIN',
      agencyId: null,
      agencyName: null,
    });
  });

  it('listResponders(tenantId) returns the whole LGU roster when no agency filter is given', async () => {
    const rows = await store.listResponders(TENANT_ID);
    expect(rows.map((r) => r.id).sort()).toEqual(['r-coordinator', 'r-fire-1', 'r-police-1']);
  });

  it('listResponders(tenantId, { agencyId }) scopes to one agency (R7.1)', async () => {
    const rows = await store.listResponders(TENANT_ID, { agencyId: AGENCY_FIRE });
    expect(rows.map((r) => r.id)).toEqual(['r-fire-1']);
  });

  it('listAgencies(tenantId) is tenant-filtered (R7.5 bug fix)', async () => {
    const own = await store.listAgencies(TENANT_ID);
    expect(own.length).toBeGreaterThan(0);
    for (const agency of own) {
      expect(agency).toHaveProperty('id');
      expect(agency).toHaveProperty('code');
    }
    // A different tenant sees none of this tenant's seeded agencies.
    const other = await store.listAgencies('tenant-other');
    expect(other).toEqual([]);
  });
});

describe('incidents store: agency-scoped candidates + coverage projection (R5.3/R6.3)', () => {
  let incidents: MemoryIncidentsStore;

  beforeEach(() => {
    incidents = createMemoryIncidentsStore({
      now: () => 0,
      candidates: [
        {
          id: 'fire-covers',
          callsign: 'FIRE-1',
          role: 'RESPONDER',
          officeId: BARANGAY_A,
          officeName: 'Barangay A',
          agencyType: 'FIRE',
          agencyName: 'BFP',
          agencyId: AGENCY_FIRE,
          base: { lat: 10.3, lon: 123.9 },
          coversIncidentOffice: false,
        },
        {
          id: 'fire-outside',
          callsign: 'FIRE-2',
          role: 'RESPONDER',
          officeId: BARANGAY_B,
          officeName: 'Barangay B',
          agencyType: 'FIRE',
          agencyName: 'BFP',
          agencyId: AGENCY_FIRE,
          base: { lat: 10.4, lon: 123.95 },
          coversIncidentOffice: false,
        },
        {
          id: 'police-1',
          callsign: 'PNP-1',
          role: 'RESPONDER',
          officeId: BARANGAY_A,
          officeName: 'Barangay A',
          agencyType: 'POLICE',
          agencyName: 'PNP',
          agencyId: AGENCY_POLICE,
          base: { lat: 10.3, lon: 123.9 },
          coversIncidentOffice: false,
        },
      ],
      coverage: { [AGENCY_FIRE]: [OFFICE_ID] },
    });
  });

  it('listRoutingCandidates with an agency filter returns only that agency', async () => {
    const candidates = await incidents.listRoutingCandidates(OFFICE_ID, { agencyId: AGENCY_FIRE });
    expect(candidates.map((c) => c.id).sort()).toEqual(['fire-covers', 'fire-outside']);
  });

  it('projects coversIncidentOffice=true when the agency covers the incident office', async () => {
    const candidates = await incidents.listRoutingCandidates(OFFICE_ID, { agencyId: AGENCY_FIRE });
    for (const c of candidates) {
      expect(c.coversIncidentOffice).toBe(true);
    }
  });

  it('without an agency filter returns every candidate (coverage still projected)', async () => {
    const candidates = await incidents.listRoutingCandidates(OFFICE_ID);
    expect(candidates).toHaveLength(3);
    const fireCovering = candidates.filter((c) => c.agencyId === AGENCY_FIRE);
    for (const c of fireCovering) {
      expect(c.coversIncidentOffice).toBe(true);
    }
    const police = candidates.find((c) => c.id === 'police-1');
    expect(police?.coversIncidentOffice).toBe(false);
  });
});
