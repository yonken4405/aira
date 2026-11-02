/**
 * @vitest-environment node
 *
 * single-lgu-agency-network (Task 7.1): agency-scoped dispatch + the coverage / org /
 * nudge management surfaces, exercised against the in-memory harness.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  handleAdminGetCoverage,
  handleAdminSetCoverage,
  handleAdminOrg,
  handleAdminNudge,
} from '../src/lib/api/admin-handlers';
import { handleAssignIncident } from '../src/lib/api/incidents-handlers';
import { handleLogin } from '../src/lib/api/auth-handlers';
import { createTestClock, createTestHarness, jsonBody, withSession } from './support/harness';
import { createMemoryIncidentsStore } from './support/memory-incidents-store';
import { createMemoryAuthStore } from './support/memory-auth-store';
import { OFFICE_ID, TENANT_ID, TEST_PASSWORD, makeIncident } from './support/fixtures';

const BASE = 'http://localhost';
const FIRE = 'agency-fire';
const POLICE = 'agency-police';

function seedPlatformOrg(harness: ReturnType<typeof createTestHarness>, now: () => number): void {
  harness.platformStore.tenants.set(TENANT_ID, {
    id: TENANT_ID,
    name: 'Cebu City DRRMO',
    region: 'Region VII',
    province: 'Cebu',
    status: 'active',
    createdAt: now(),
  });
  harness.platformStore.offices.push({
    id: OFFICE_ID,
    tenantId: TENANT_ID,
    tenantName: 'Cebu City DRRMO',
    name: 'Cebu City DRRMO',
    kind: 'LGU',
    region: 'Region VII',
    province: 'Cebu',
    lat: null,
    lon: null,
    status: 'active',
  });
  for (const [id, code, type] of [
    [FIRE, 'BFP', 'FIRE'],
    [POLICE, 'PNP', 'POLICE'],
  ] as const) {
    harness.platformStore.agencies.set(id, {
      id,
      tenantId: TENANT_ID,
      name: `Agency ${code}`,
      code,
      agencyType: type,
      active: true,
    });
  }
}

function createWorld() {
  const clock = createTestClock();
  const incidents = createMemoryWithFireIncident(clock.now);
  // The org-view agency list comes from the AuthStore (same tenant as the roster), so
  // seed FIRE + POLICE there to match the PlatformStore agencies used for dispatch.
  const authStore = createMemoryAuthStore({
    now: clock.now,
    agencies: [
      { id: FIRE, name: 'Agency BFP', code: 'BFP' },
      { id: POLICE, name: 'Agency PNP', code: 'PNP' },
    ],
  });
  const harness = createTestHarness({ clock, incidents, authStore });
  seedPlatformOrg(harness, clock.now);

  // A FIRE dispatcher + a FIRE responder + a POLICE responder, all in the one LGU.
  harness.authStore.seedResponder({
    id: 'disp-fire',
    callsign: 'BFP-OPCEN',
    role: 'DISPATCHER',
    agencyId: FIRE,
    agencyName: 'Agency BFP',
  });
  harness.authStore.seedResponder({
    id: 'fire-1',
    callsign: 'BFP-01',
    role: 'RESPONDER',
    agencyId: FIRE,
    agencyName: 'Agency BFP',
  });
  harness.authStore.seedResponder({
    id: 'police-1',
    callsign: 'PNP-01',
    role: 'RESPONDER',
    agencyId: POLICE,
    agencyName: 'Agency PNP',
  });
  // An agency admin (FIRE) and the LDRRMO coordinator.
  harness.authStore.seedResponder({
    id: 'fire-admin',
    callsign: 'BFP-ADMIN',
    role: 'AGENCY_ADMIN',
    agencyId: FIRE,
    agencyName: 'Agency BFP',
  });
  harness.authStore.seedResponder({
    id: 'ldrrmo',
    callsign: 'LDRRMO',
    role: 'ADMIN',
    agencyId: null,
    agencyName: null,
  });

  async function tokenFor(callsign: string): Promise<string> {
    const response = await handleLogin(
      new Request(
        `${BASE}/api/auth/login`,
        jsonBody('POST', { email: `${callsign.toLowerCase()}@aira.test`, password: TEST_PASSWORD }),
      ),
      harness.deps,
    );
    const token = /aira_session=([A-Za-z0-9_-]+)/.exec(
      response.headers.get('set-cookie') ?? '',
    )?.[1];
    if (!token) throw new Error(`login_failed_${callsign}:${response.status}`);
    return token;
  }

  return { ...harness, clock, tokenFor };
}

function createMemoryWithFireIncident(now: () => number) {
  return createMemoryIncidentsStore({
    now,
    incidents: [makeIncident({ id: 'fire-incident', category: 'SUNOG', officeId: OFFICE_ID })],
    responders: { 'fire-1': 'BFP-01', 'police-1': 'PNP-01' },
  });
}

let world: ReturnType<typeof createWorld>;

beforeEach(() => {
  world = createWorld();
});

describe('agency-scoped dispatch (R6.4)', () => {
  it('a FIRE dispatcher may assign its OWN agency unit', async () => {
    const token = await world.tokenFor('BFP-OPCEN');
    const response = await handleAssignIncident(
      withSession(
        `${BASE}/api/incidents/fire-incident/assign`,
        token,
        jsonBody('POST', { responderId: 'fire-1' }),
      ),
      world.deps,
      'fire-incident',
    );
    expect(response.status).toBe(200);
  });

  it('a FIRE dispatcher may NOT assign a POLICE unit (403)', async () => {
    const token = await world.tokenFor('BFP-OPCEN');
    const response = await handleAssignIncident(
      withSession(
        `${BASE}/api/incidents/fire-incident/assign`,
        token,
        jsonBody('POST', { responderId: 'police-1' }),
      ),
      world.deps,
      'fire-incident',
    );
    expect(response.status).toBe(403);
  });
});

describe('agency coverage management (R5.2 / R7.3)', () => {
  it('an AGENCY_ADMIN sets + reads its own agency coverage', async () => {
    const token = await world.tokenFor('BFP-ADMIN');

    const put = await handleAdminSetCoverage(
      withSession(
        `${BASE}/api/admin/agencies/${FIRE}/coverage`,
        token,
        jsonBody('PUT', {
          officeIds: [OFFICE_ID],
        }),
      ),
      world.deps,
      FIRE,
    );
    expect(put.status).toBe(200);

    const get = await handleAdminGetCoverage(
      withSession(`${BASE}/api/admin/agencies/${FIRE}/coverage`, token),
      world.deps,
      FIRE,
    );
    expect(get.status).toBe(200);
    expect(((await get.json()) as { officeIds: string[] }).officeIds).toEqual([OFFICE_ID]);
  });

  it('an AGENCY_ADMIN editing ANOTHER agency gets 403', async () => {
    const token = await world.tokenFor('BFP-ADMIN');
    const put = await handleAdminSetCoverage(
      withSession(
        `${BASE}/api/admin/agencies/${POLICE}/coverage`,
        token,
        jsonBody('PUT', {
          officeIds: [OFFICE_ID],
        }),
      ),
      world.deps,
      POLICE,
    );
    expect(put.status).toBe(403);
  });

  it('the LDRRMO coordinator may READ any agency coverage but not write it', async () => {
    const token = await world.tokenFor('LDRRMO');
    const get = await handleAdminGetCoverage(
      withSession(`${BASE}/api/admin/agencies/${FIRE}/coverage`, token),
      world.deps,
      FIRE,
    );
    expect(get.status).toBe(200);

    const put = await handleAdminSetCoverage(
      withSession(
        `${BASE}/api/admin/agencies/${FIRE}/coverage`,
        token,
        jsonBody('PUT', {
          officeIds: [OFFICE_ID],
        }),
      ),
      world.deps,
      FIRE,
    );
    expect(put.status).toBe(403);
  });
});

describe('org view (R8)', () => {
  it('an AGENCY_ADMIN sees only its own agency members', async () => {
    const token = await world.tokenFor('BFP-ADMIN');
    const response = await handleAdminOrg(withSession(`${BASE}/api/admin/org`, token), world.deps);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      members: Array<{ agencyName: string | null }>;
      agencies: Array<{ id: string }>;
    };
    expect(body.agencies.map((a) => a.id)).toEqual([FIRE]);
    for (const member of body.members) {
      expect(member.agencyName).toBe('Agency BFP');
    }
  });

  it('the LDRRMO coordinator sees all agencies', async () => {
    const token = await world.tokenFor('LDRRMO');
    const response = await handleAdminOrg(withSession(`${BASE}/api/admin/org`, token), world.deps);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { agencies: Array<{ id: string }> };
    expect(body.agencies.map((a) => a.id).sort()).toEqual([FIRE, POLICE].sort());
  });
});

describe('LDRRMO coordination nudge (R4.4)', () => {
  it('the coordinator nudges a target agency; a dispatcher cannot', async () => {
    const coord = await world.tokenFor('LDRRMO');
    const ok = await handleAdminNudge(
      withSession(
        `${BASE}/api/admin/coordination/nudge`,
        coord,
        jsonBody('POST', {
          agencyId: FIRE,
        }),
      ),
      world.deps,
    );
    expect(ok.status).toBe(200);

    const disp = await world.tokenFor('BFP-OPCEN');
    const denied = await handleAdminNudge(
      withSession(
        `${BASE}/api/admin/coordination/nudge`,
        disp,
        jsonBody('POST', {
          agencyId: FIRE,
        }),
      ),
      world.deps,
    );
    expect(denied.status).toBe(403);
  });
});
