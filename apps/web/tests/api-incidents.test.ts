/**
 * @vitest-environment node
 *
 * Incident API: public intake, role-scoped reads, dispatcher assignment and field
 * status reporting. Handlers are invoked directly with memory stores (TESTING.md §4.3).
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { handleLogin } from '../src/lib/api/auth-handlers';
import {
  handleAssignIncident,
  handleIntake,
  handleListAssignableResponders,
  handleListIncidents,
  handleRoutingSuggestions,
  handleUpdateStatus,
} from '../src/lib/api/incidents-handlers';
import { createMemoryIncidentsStore } from './support/memory-incidents-store';
import type { RoutingCandidate } from '../src/lib/routing';
import { createTestClock, createTestHarness, jsonBody, withSession } from './support/harness';
import { OFFICE_ID, TEST_PASSWORD, makeIncident } from './support/fixtures';

const SEED = [
  makeIncident({ id: 'i-queued', category: 'SUNOG' }),
  makeIncident({
    id: 'i-assigned',
    category: 'MEDIKAL',
    status: 'DISPATCHED',
    assignedToId: 'responder-field',
    assignedToCallsign: 'K9-01',
  }),
  makeIncident({
    id: 'i-resolved',
    category: 'BAHA',
    status: 'RESOLVED',
    assignedToId: 'responder-field',
    assignedToCallsign: 'K9-01',
    resolvedAt: '2026-10-22T07:00:00.000Z',
  }),
];

const RESPONDERS = { 'responder-field': 'K9-01', 'responder-dispatcher': 'OPCEN-01' };

function candidate(overrides: Partial<RoutingCandidate> & { id: string }): RoutingCandidate {
  return {
    callsign: overrides.id.toUpperCase(),
    role: 'RESPONDER',
    officeId: OFFICE_ID,
    officeName: 'Cebu City DRRMO',
    agencyCode: null,
    agencyName: null,
    base: null,
    ...overrides,
  };
}

const CANDIDATES: readonly RoutingCandidate[] = [
  candidate({
    id: 'far-fire',
    callsign: 'FIRE-FAR',
    agencyCode: 'BFP',
    agencyName: 'Bureau of Fire Protection',
    base: { lat: 10.4, lon: 123.95 },
  }),
  candidate({
    id: 'near-fire',
    callsign: 'FIRE-NEAR',
    agencyCode: 'BFP',
    agencyName: 'Bureau of Fire Protection',
    base: { lat: 10.3158, lon: 123.8855 },
  }),
  candidate({
    id: 'cop',
    callsign: 'PNP-01',
    agencyCode: 'PNP',
    agencyName: 'Philippine National Police',
    base: { lat: 10.316, lon: 123.886 },
  }),
];

function createWorld() {
  const clock = createTestClock();
  const incidents = createMemoryIncidentsStore({
    now: clock.now,
    incidents: SEED,
    responders: RESPONDERS,
    candidates: CANDIDATES,
  });
  const harness = createTestHarness({ clock, incidents });

  harness.authStore.seedResponder({ id: 'responder-field', callsign: 'K9-01', role: 'RESPONDER' });
  harness.authStore.seedResponder({
    id: 'responder-dispatcher',
    callsign: 'OPCEN-01',
    role: 'DISPATCHER',
  });
  harness.authStore.seedResponder({ id: 'responder-admin', callsign: 'ADMIN-1', role: 'ADMIN' });

  const tokens = new Map<string, string>();

  async function tokenFor(callsign: string): Promise<string> {
    const cached = tokens.get(callsign);
    if (cached) {
      return cached;
    }

    const response = await handleLogin(
      new Request(
        'http://localhost/api/auth/login',
        jsonBody('POST', { email: `${callsign.toLowerCase()}@aira.test`, password: TEST_PASSWORD }),
      ),
      harness.deps,
    );

    const cookie = response.headers.get('set-cookie') ?? '';
    const token = /aira_session=([A-Za-z0-9_-]+)/.exec(cookie)?.[1];
    if (!token) {
      throw new Error(`login_failed_${callsign}`);
    }

    tokens.set(callsign, token);
    return token;
  }

  return { ...harness, clock, tokenFor };
}

let world: ReturnType<typeof createWorld>;

beforeEach(() => {
  world = createWorld();
});

describe('GET /api/incidents', () => {
  it('rejects anonymous reads', async () => {
    const response = await handleListIncidents(
      new Request('http://localhost/api/incidents'),
      world.deps,
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: 'unauthenticated' });
  });

  it('serves the office queue to a dispatcher', async () => {
    const token = await world.tokenFor('OPCEN-01');
    const response = await handleListIncidents(
      withSession('http://localhost/api/incidents', token),
      world.deps,
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { incidents: Array<{ id: string }> };
    expect(payload.incidents.map((incident) => incident.id)).toEqual([
      'i-queued',
      'i-assigned',
      'i-resolved',
    ]);
  });

  it('restricts a responder to their own assignments', async () => {
    const token = await world.tokenFor('K9-01');
    const response = await handleListIncidents(
      withSession('http://localhost/api/incidents', token),
      world.deps,
    );

    const payload = (await response.json()) as { incidents: Array<{ id: string }> };
    expect(payload.incidents.map((incident) => incident.id)).toEqual(['i-assigned', 'i-resolved']);
  });

  it('never shows a dispatcher an incident outside their tenant office scope', async () => {
    // Seed an incident owned by a DIFFERENT tenant's office; the dispatcher is scoped to
    // OFFICE_ID, so this row must never appear in their queue (cross-tenant isolation).
    world.incidents.incidents.push(
      makeIncident({ id: 'other-tenant', category: 'SUNOG', officeId: 'office-other-tenant' }),
    );

    const token = await world.tokenFor('OPCEN-01');
    const response = await handleListIncidents(
      withSession('http://localhost/api/incidents', token),
      world.deps,
    );

    const payload = (await response.json()) as { incidents: Array<{ id: string }> };
    expect(payload.incidents.map((incident) => incident.id)).not.toContain('other-tenant');
  });

  it('refuses to assign an incident outside the tenant office scope (404, not leaked)', async () => {
    world.incidents.incidents.push(
      makeIncident({ id: 'other-tenant', category: 'SUNOG', officeId: 'office-other-tenant' }),
    );

    const token = await world.tokenFor('OPCEN-01');
    const response = await handleAssignIncident(
      withSession(
        'http://localhost/api/incidents/other-tenant/assign',
        token,
        jsonBody('POST', { responderId: 'responder-field' }),
      ),
      world.deps,
      'other-tenant',
    );

    // Out-of-scope rows are indistinguishable from missing ones.
    expect(response.status).toBe(404);
  });

  it('lets the DRRM admin read the office queue (read-only oversight)', async () => {
    const token = await world.tokenFor('ADMIN-1');
    const response = await handleListIncidents(
      withSession('http://localhost/api/incidents', token),
      world.deps,
    );

    // ADMIN now holds incident:read:office for oversight, but still cannot dispatch
    // (assign/status denials are covered below and in rbac.test.ts).
    expect(response.status).toBe(200);
  });

  it('caches privately and varies on the session cookie', async () => {
    const token = await world.tokenFor('OPCEN-01');
    const response = await handleListIncidents(
      withSession('http://localhost/api/incidents', token),
      world.deps,
    );

    const cacheControl = response.headers.get('cache-control') ?? '';
    expect(cacheControl).toContain('private');
    expect(cacheControl).toContain('max-age=5');
    expect(cacheControl).toContain('stale-while-revalidate=25');
    expect(cacheControl).not.toContain('public');
    expect(response.headers.get('vary')).toBe('Cookie');
  });
});

describe('POST /api/incidents (citizen intake)', () => {
  const post = (body: unknown, deps = world.deps): Promise<Response> =>
    handleIntake(new Request('http://localhost/api/incidents', jsonBody('POST', body)), deps);

  it('accepts a valid mesh payload without a session', async () => {
    const response = await post(['SUNOG', 10.3157, 123.8854]);
    expect(response.status).toBe(201);

    const payload = (await response.json()) as {
      ok: boolean;
      incident: { category: string; lat: number; lon: number; status: string; source: string };
    };

    expect(payload.ok).toBe(true);
    expect(payload.incident).toMatchObject({
      category: 'SUNOG',
      lat: 10.3157,
      lon: 123.8854,
      status: 'QUEUED',
      source: 'mesh',
    });
    expect(world.incidents.incidents).toHaveLength(SEED.length + 1);
  });

  it('never caches intake responses', async () => {
    const response = await post(['SUNOG', 10.3157, 123.8854]);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects malformed JSON', async () => {
    const response = await handleIntake(
      new Request('http://localhost/api/incidents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not json',
      }),
      world.deps,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: 'invalid_json' });
  });

  it('rejects an unknown category (closed enum)', async () => {
    const response = await post(['FLOOD', 10.3157, 123.8854]);
    expect(await response.json()).toEqual({ ok: false, error: 'unknown_category' });
  });

  it('rejects out-of-range coordinates', async () => {
    const response = await post(['BAHA', 91, 123.8854]);
    expect(await response.json()).toEqual({ ok: false, error: 'lat_out_of_range' });
  });

  it('rejects non-array payloads', async () => {
    const response = await post({ category: 'SUNOG' });
    expect(await response.json()).toEqual({ ok: false, error: 'payload_must_be_array' });
  });

  it('rate-limits a flood of alerts per client', async () => {
    let last: Response | null = null;
    for (let attempt = 0; attempt < 31; attempt += 1) {
      last = await post(['BAHA', 10.3157, 123.8854]);
    }

    expect(last?.status).toBe(429);
    expect(last?.headers.get('retry-after')).toBeTruthy();
  });

  it('answers 503 when no LGU office is configured', async () => {
    const incidents = createMemoryIncidentsStore({ now: world.clock.now });
    const deps = {
      ...world.deps,
      incidents: { ...incidents, getDefaultOfficeId: async () => null },
    };

    const response = await handleIntake(
      new Request('http://localhost/api/incidents', jsonBody('POST', ['BAHA', 10.3157, 123.8854])),
      deps,
    );

    expect(response.status).toBe(503);
  });
});

describe('POST /api/incidents/:id/assign', () => {
  const assign = (token: string, incidentId: string, responderId: string): Promise<Response> =>
    handleAssignIncident(
      withSession(
        `http://localhost/api/incidents/${incidentId}/assign`,
        token,
        jsonBody('POST', { responderId }),
      ),
      world.deps,
      incidentId,
    );

  it('lets a dispatcher assign a queued incident', async () => {
    const token = await world.tokenFor('OPCEN-01');
    const response = await assign(token, 'i-queued', 'responder-field');

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      incident: { status: string; assignedToCallsign: string };
    };
    expect(payload.incident).toMatchObject({
      status: 'DISPATCHED',
      assignedToCallsign: 'K9-01',
    });
  });

  it('denies responders and admins', async () => {
    const responder = await assign(await world.tokenFor('K9-01'), 'i-queued', 'responder-field');
    expect(responder.status).toBe(403);

    const admin = await assign(await world.tokenFor('ADMIN-1'), 'i-queued', 'responder-field');
    expect(admin.status).toBe(403);
  });

  it('rejects unknown incidents and assignees', async () => {
    const token = await world.tokenFor('OPCEN-01');

    expect((await assign(token, 'nope', 'responder-field')).status).toBe(404);
    expect((await assign(token, 'i-queued', 'ghost')).status).toBe(400);
  });

  it('refuses to reassign a resolved incident', async () => {
    const token = await world.tokenFor('OPCEN-01');
    const response = await assign(token, 'i-resolved', 'responder-dispatcher');

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, error: 'incident_final' });
  });
});

describe('POST /api/incidents/:id/status', () => {
  const setStatus = (token: string, incidentId: string, status: string): Promise<Response> =>
    handleUpdateStatus(
      withSession(
        `http://localhost/api/incidents/${incidentId}/status`,
        token,
        jsonBody('POST', { status }),
      ),
      world.deps,
      incidentId,
    );

  it('lets the assigned responder move their incident forward', async () => {
    const token = await world.tokenFor('K9-01');
    const response = await setStatus(token, 'i-assigned', 'EN_ROUTE');

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { incident: { status: string } };
    expect(payload.incident.status).toBe('EN_ROUTE');
  });

  it('denies a responder who is not the assignee', async () => {
    const token = await world.tokenFor('K9-01');
    expect((await setStatus(token, 'i-queued', 'EN_ROUTE')).status).toBe(403);
  });

  it('denies responders dispatch-only transitions', async () => {
    const token = await world.tokenFor('K9-01');
    expect((await setStatus(token, 'i-assigned', 'DISPATCHED')).status).toBe(403);
  });

  it('lets a dispatcher resolve any queued incident', async () => {
    const token = await world.tokenFor('OPCEN-01');
    const response = await setStatus(token, 'i-queued', 'RESOLVED');

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      incident: { status: string; resolvedAt: string | null };
    };
    expect(payload.incident.status).toBe('RESOLVED');
    expect(payload.incident.resolvedAt).not.toBeNull();
  });

  it('rejects invalid status values and illegal transitions', async () => {
    const token = await world.tokenFor('OPCEN-01');

    expect((await setStatus(token, 'i-queued', 'TELEPORTED')).status).toBe(400);
    expect((await setStatus(token, 'i-resolved', 'EN_ROUTE')).status).toBe(409);
  });
});

describe('GET /api/responders (assignee picker)', () => {
  it('lists active responders for dispatchers', async () => {
    const token = await world.tokenFor('OPCEN-01');
    const response = await handleListAssignableResponders(
      withSession('http://localhost/api/responders', token),
      world.deps,
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { responders: Array<{ callsign: string }> };
    expect(payload.responders.map((row) => row.callsign).sort()).toEqual([
      'ADMIN-1',
      'K9-01',
      'OPCEN-01',
    ]);
  });

  it('denies responders', async () => {
    const token = await world.tokenFor('K9-01');
    const response = await handleListAssignableResponders(
      withSession('http://localhost/api/responders', token),
      world.deps,
    );

    expect(response.status).toBe(403);
  });
});

describe('GET /api/incidents/:id/routing (nearest-responder suggestions)', () => {
  const routing = (token: string, incidentId: string): Promise<Response> =>
    handleRoutingSuggestions(
      withSession(`http://localhost/api/incidents/${incidentId}/routing`, token),
      world.deps,
      incidentId,
    );

  it('ranks capable, nearest responders first for a dispatcher', async () => {
    const token = await world.tokenFor('OPCEN-01');
    const response = await routing(token, 'i-queued'); // SUNOG incident

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      suggestions: Array<{ callsign: string; capable: boolean; distanceKm: number | null }>;
    };

    // Both BFP units are capable (nearest first), then the non-capable PNP unit.
    expect(payload.suggestions.map((s) => s.callsign)).toEqual(['FIRE-NEAR', 'FIRE-FAR', 'PNP-01']);
    expect(payload.suggestions[0]?.capable).toBe(true);
    expect(payload.suggestions[2]?.capable).toBe(false);
  });

  it('never leaks responder base coordinates (distance only)', async () => {
    const token = await world.tokenFor('OPCEN-01');
    const response = await routing(token, 'i-queued');
    const payload = (await response.json()) as { suggestions: Array<Record<string, unknown>> };

    for (const suggestion of payload.suggestions) {
      expect(suggestion).not.toHaveProperty('base');
      expect(suggestion).not.toHaveProperty('lat');
      expect(suggestion).not.toHaveProperty('lon');
    }
  });

  it('denies responders and admins (dispatch-only action)', async () => {
    expect((await routing(await world.tokenFor('K9-01'), 'i-queued')).status).toBe(403);
    expect((await routing(await world.tokenFor('ADMIN-1'), 'i-queued')).status).toBe(403);
  });

  it('rejects an anonymous caller', async () => {
    const response = await handleRoutingSuggestions(
      new Request('http://localhost/api/incidents/i-queued/routing'),
      world.deps,
      'i-queued',
    );
    expect(response.status).toBe(401);
  });

  it('returns 404 for an unknown incident', async () => {
    const token = await world.tokenFor('OPCEN-01');
    expect((await routing(token, 'does-not-exist')).status).toBe(404);
  });
});
