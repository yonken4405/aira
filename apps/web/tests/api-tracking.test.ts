/**
 * @vitest-environment node
 *
 * Live-tracking API (SECURITY.md §9): PUT position (assignee-only, active-only) and
 * GET tracking (dispatcher in scope + reporting citizen; denied otherwise).
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { handleCitizenRegister } from '../src/lib/api/citizen-handlers';
import { handleLogin } from '../src/lib/api/auth-handlers';
import {
  handleAssignIncident,
  handleIntake,
  handleUpdateStatus,
} from '../src/lib/api/incidents-handlers';
import { handleGetTracking, handlePutPosition } from '../src/lib/api/tracking-handlers';
import { CITIZEN_SESSION_COOKIE } from '../src/lib/citizen/session';
import { createTestHarness, jsonBody, withSession } from './support/harness';
import { TEST_PASSWORD } from './support/fixtures';

const CITIZEN_PASSWORD = 'correct horse battery staple';

let world: ReturnType<typeof createTestHarness>;

beforeEach(() => {
  world = createTestHarness();
  world.authStore.seedResponder({ id: 'responder-field', callsign: 'K9-01', role: 'RESPONDER' });
  world.authStore.seedResponder({ id: 'responder-field-2', callsign: 'K9-02', role: 'RESPONDER' });
  world.authStore.seedResponder({
    id: 'responder-dispatcher',
    callsign: 'OPCEN-01',
    role: 'DISPATCHER',
  });
  world.incidents.incidents.length = 0;
});

async function responderToken(callsign: string): Promise<string> {
  const response = await handleLogin(
    new Request(
      'http://localhost/api/auth/login',
      jsonBody('POST', { email: `${callsign.toLowerCase()}@aira.test`, password: TEST_PASSWORD }),
    ),
    world.deps,
  );
  const token = /aira_session=([A-Za-z0-9_-]+)/.exec(response.headers.get('set-cookie') ?? '')?.[1];
  if (!token) {
    throw new Error(`login_failed_${callsign}`);
  }
  return token;
}

async function citizenToken(email: string): Promise<string> {
  const reg = await handleCitizenRegister(
    new Request(
      'http://localhost/api/citizen/register',
      jsonBody('POST', { email, password: CITIZEN_PASSWORD }),
    ),
    world.deps,
  );
  const token = new RegExp(`${CITIZEN_SESSION_COOKIE}=([A-Za-z0-9_-]+)`).exec(
    reg.headers.get('set-cookie') ?? '',
  )?.[1];
  if (!token) {
    throw new Error('citizen_register_failed');
  }
  return token;
}

async function onlineIntake(citizen: string | null): Promise<string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (citizen) {
    headers.cookie = `${CITIZEN_SESSION_COOKIE}=${citizen}`;
  }
  const response = await handleIntake(
    new Request('http://localhost/api/incidents', {
      method: 'POST',
      headers,
      body: JSON.stringify(['MEDIKAL', 10.3157, 123.8854]),
    }),
    world.deps,
  );
  return ((await response.json()) as { incident: { id: string } }).incident.id;
}

async function assign(incidentId: string, responderId: string): Promise<void> {
  const token = await responderToken('OPCEN-01');
  await handleAssignIncident(
    withSession(
      `http://localhost/api/incidents/${incidentId}/assign`,
      token,
      jsonBody('POST', { responderId }),
    ),
    world.deps,
    incidentId,
  );
}

function putPosition(
  token: string,
  incidentId: string,
  lat: number,
  lon: number,
): Promise<Response> {
  return handlePutPosition(
    withSession(
      'http://localhost/api/responders/me/position',
      token,
      jsonBody('PUT', { incidentId, lat, lon }),
    ),
    world.deps,
  );
}

function getTracking(cookie: string | null, incidentId: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (cookie) {
    headers.cookie = cookie;
  }
  return handleGetTracking(
    new Request(`http://localhost/api/incidents/${incidentId}/tracking`, { headers }),
    world.deps,
    incidentId,
  );
}

describe('PUT /api/responders/me/position', () => {
  it('accepts a fix from the assigned responder and rounds to 4 dp', async () => {
    const id = await onlineIntake(null);
    await assign(id, 'responder-field');

    const response = await putPosition(await responderToken('K9-01'), id, 10.315789, 123.885432);
    expect(response.status).toBe(204);

    const stored = await world.trackingStore.latestForIncident(id);
    expect(stored?.lat).toBe(10.3158);
  });

  it('rejects a responder who is not the assignee', async () => {
    const id = await onlineIntake(null);
    await assign(id, 'responder-field');

    const response = await putPosition(await responderToken('K9-02'), id, 10.3, 123.8);
    expect(response.status).toBe(404);
  });

  it('rejects a dispatcher (field responders stream, not dispatchers)', async () => {
    const id = await onlineIntake(null);
    await assign(id, 'responder-field');

    const response = await putPosition(await responderToken('OPCEN-01'), id, 10.3, 123.8);
    expect(response.status).toBe(403);
  });

  it('rejects out-of-range coordinates', async () => {
    const id = await onlineIntake(null);
    await assign(id, 'responder-field');

    const response = await putPosition(await responderToken('K9-01'), id, 999, 123.8);
    expect(response.status).toBe(400);
  });

  it('refuses a position on a resolved incident', async () => {
    const id = await onlineIntake(null);
    await assign(id, 'responder-field');
    const field = await responderToken('K9-01');
    await handleUpdateStatus(
      withSession(
        `http://localhost/api/incidents/${id}/status`,
        field,
        jsonBody('POST', { status: 'RESOLVED' }),
      ),
      world.deps,
      id,
    );

    expect((await putPosition(field, id, 10.3, 123.8)).status).toBe(409);
  });
});

describe('GET /api/incidents/:id/tracking', () => {
  it('serves the live position to a dispatcher in the office scope', async () => {
    const id = await onlineIntake(null);
    await assign(id, 'responder-field');
    await putPosition(await responderToken('K9-01'), id, 10.33, 123.9);

    const response = await getTracking(`aira_session=${await responderToken('OPCEN-01')}`, id);
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      status: string;
      assignedToCallsign: string;
      position: { lat: number; fresh: boolean } | null;
    };
    expect(payload.assignedToCallsign).toBe('K9-01');
    expect(payload.position?.lat).toBe(10.33);
    expect(payload.position?.fresh).toBe(true);
  });

  it('serves the reporting citizen their own incident position', async () => {
    const citizen = await citizenToken('juan@example.com');
    const id = await onlineIntake(citizen);
    await assign(id, 'responder-field');
    await putPosition(await responderToken('K9-01'), id, 10.33, 123.9);

    const response = await getTracking(`${CITIZEN_SESSION_COOKIE}=${citizen}`, id);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { position: { lat: number } }).position.lat).toBe(10.33);
  });

  it('denies a citizen who is not the reporter', async () => {
    const reporter = await citizenToken('reporter@example.com');
    const other = await citizenToken('other@example.com');
    const id = await onlineIntake(reporter);
    await assign(id, 'responder-field');

    const response = await getTracking(`${CITIZEN_SESSION_COOKIE}=${other}`, id);
    expect(response.status).toBe(401);
  });

  it('rejects an anonymous caller', async () => {
    const id = await onlineIntake(null);
    expect((await getTracking(null, id)).status).toBe(401);
  });

  it('returns 404 for an unknown incident', async () => {
    expect(
      (await getTracking(`aira_session=${await responderToken('OPCEN-01')}`, 'nope')).status,
    ).toBe(404);
  });

  it('serves an anonymous reporter via their opaque tracking token', async () => {
    // Intake without a citizen cookie returns a one-time token.
    const intake = await handleIntake(
      new Request('http://localhost/api/incidents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(['MEDIKAL', 10.3157, 123.8854]),
      }),
      world.deps,
    );
    const { incident, trackingToken } = (await intake.json()) as {
      incident: { id: string };
      trackingToken: string;
    };
    expect(trackingToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await assign(incident.id, 'responder-field');

    const response = await handleGetTracking(
      new Request(`http://localhost/api/incidents/${incident.id}/tracking?token=${trackingToken}`),
      world.deps,
      incident.id,
    );
    expect(response.status).toBe(200);
    expect(((await response.json()) as { assignedToCallsign: string }).assignedToCallsign).toBe(
      'K9-01',
    );
  });

  it('rejects a token scoped to a different incident', async () => {
    const intakeA = await handleIntake(
      new Request('http://localhost/api/incidents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(['SUNOG', 10.3157, 123.8854]),
      }),
      world.deps,
    );
    const a = (await intakeA.json()) as { incident: { id: string }; trackingToken: string };

    const idB = await onlineIntake(null); // a second, different incident

    // Token for A must not unlock B.
    const response = await handleGetTracking(
      new Request(`http://localhost/api/incidents/${idB}/tracking?token=${a.trackingToken}`),
      world.deps,
      idB,
    );
    expect(response.status).toBe(401);
  });

  it('does not issue a token to a logged-in citizen (they use their session)', async () => {
    const citizen = await citizenToken('juan@example.com');
    const intake = await handleIntake(
      new Request('http://localhost/api/incidents', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: `${CITIZEN_SESSION_COOKIE}=${citizen}`,
        },
        body: JSON.stringify(['MEDIKAL', 10.3157, 123.8854]),
      }),
      world.deps,
    );
    expect(((await intake.json()) as { trackingToken: string | null }).trackingToken).toBeNull();
  });

  it('reports a null position before the responder streams anything', async () => {
    const id = await onlineIntake(null);
    await assign(id, 'responder-field');

    const response = await getTracking(`aira_session=${await responderToken('OPCEN-01')}`, id);
    expect(((await response.json()) as { position: unknown }).position).toBeNull();
  });
});
