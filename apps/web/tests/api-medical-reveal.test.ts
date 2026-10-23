/**
 * @vitest-environment node
 *
 * Online-enriched SOS + on-incident medical reveal (SECURITY.md §7/§8).
 *
 * Covers: a logged-in citizen's intake links the incident to them; the assigned
 * responder can reveal the minimised snapshot while the incident is active; the reveal
 * is denied to non-assignees and after RESOLVED (auto-revoke); every reveal is audited;
 * and the citizen link never leaks into the dispatcher queue response.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { handleCitizenRegister } from '../src/lib/api/citizen-handlers';
import { handlePutMedicalProfile } from '../src/lib/api/medical-handlers';
import { handleLogin } from '../src/lib/api/auth-handlers';
import {
  handleAssignIncident,
  handleIntake,
  handleListIncidents,
  handleMedicalReveal,
  handleUpdateStatus,
} from '../src/lib/api/incidents-handlers';
import { CITIZEN_SESSION_COOKIE } from '../src/lib/citizen/session';
import { createTestHarness, jsonBody, withSession } from './support/harness';
import { TEST_PASSWORD } from './support/fixtures';

const CITIZEN_PASSWORD = 'correct horse battery staple';

const PROFILE = {
  bloodType: 'O-',
  allergies: ['penicillin'],
  conditions: ['asthma'],
  contacts: [{ name: 'Ana', phone: '0917-000-0000', relation: 'spouse' }],
};

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
  // The dispatcher assigns to K9-01; make them assignable in the incidents store.
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

async function citizenWithProfile(email: string): Promise<string> {
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
  await handlePutMedicalProfile(
    new Request(
      'http://localhost/api/citizen/medical',
      jsonBody('PUT', PROFILE, { cookie: `${CITIZEN_SESSION_COOKIE}=${token}` }),
    ),
    world.deps,
  );
  return token;
}

/** Online intake carrying the citizen cookie; returns the created incident id. */
async function onlineIntake(citizenToken: string | null): Promise<string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (citizenToken) {
    headers.cookie = `${CITIZEN_SESSION_COOKIE}=${citizenToken}`;
  }
  const response = await handleIntake(
    new Request('http://localhost/api/incidents', {
      method: 'POST',
      headers,
      body: JSON.stringify(['MEDIKAL', 10.3157, 123.8854]),
    }),
    world.deps,
  );
  const payload = (await response.json()) as { incident: { id: string } };
  return payload.incident.id;
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

function reveal(token: string, incidentId: string): Promise<Response> {
  return handleMedicalReveal(
    withSession(`http://localhost/api/incidents/${incidentId}/medical`, token),
    world.deps,
    incidentId,
  );
}

describe('online-enriched intake', () => {
  it('links the incident to a logged-in citizen, and leaves anonymous intake unlinked', async () => {
    const citizen = await citizenWithProfile('juan@example.com');

    const linkedId = await onlineIntake(citizen);
    const anonId = await onlineIntake(null);

    const linked = world.incidents.incidents.find((i) => i.id === linkedId);
    const anon = world.incidents.incidents.find((i) => i.id === anonId);
    expect(linked?.reporterCitizenId).toBeTruthy();
    expect(anon?.reporterCitizenId).toBeNull();
  });

  it('never leaks the citizen link into the dispatcher queue response', async () => {
    const citizen = await citizenWithProfile('juan@example.com');
    await onlineIntake(citizen);

    const token = await responderToken('OPCEN-01');
    const response = await handleListIncidents(
      new Request('http://localhost/api/incidents', {
        headers: { cookie: `aira_session=${token}` },
      }),
      world.deps,
    );
    const payload = (await response.json()) as { incidents: Array<Record<string, unknown>> };
    for (const incident of payload.incidents) {
      expect(incident).not.toHaveProperty('reporterCitizenId');
    }
  });
});

describe('on-incident medical reveal', () => {
  it('reveals the snapshot to the assigned responder and audits the access', async () => {
    const citizen = await citizenWithProfile('juan@example.com');
    const incidentId = await onlineIntake(citizen);
    await assign(incidentId, 'responder-field');

    const response = await reveal(await responderToken('K9-01'), incidentId);
    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      snapshot: { bloodType: string; allergies: string[]; contacts: unknown[] } | null;
    };
    expect(payload.snapshot?.bloodType).toBe('O-');
    expect(payload.snapshot?.allergies).toEqual(['penicillin']);
    expect(payload.snapshot?.contacts).toHaveLength(1);

    // The reveal was audited (actor + incident, no profile body).
    expect(world.incidents.medicalAccesses).toEqual([{ incidentId, actorId: 'responder-field' }]);
  });

  it('denies a responder who is not the assignee (indistinguishable from missing)', async () => {
    const citizen = await citizenWithProfile('juan@example.com');
    const incidentId = await onlineIntake(citizen);
    await assign(incidentId, 'responder-field');

    const response = await reveal(await responderToken('K9-02'), incidentId);
    expect(response.status).toBe(404);
    expect(world.incidents.medicalAccesses).toHaveLength(0);
  });

  it('denies a dispatcher (no citizen health data by default)', async () => {
    const citizen = await citizenWithProfile('juan@example.com');
    const incidentId = await onlineIntake(citizen);
    await assign(incidentId, 'responder-field');

    const response = await reveal(await responderToken('OPCEN-01'), incidentId);
    expect(response.status).toBe(403);
  });

  it('auto-revokes on RESOLVED', async () => {
    const citizen = await citizenWithProfile('juan@example.com');
    const incidentId = await onlineIntake(citizen);
    await assign(incidentId, 'responder-field');

    const fieldToken = await responderToken('K9-01');
    // Responder resolves their own incident.
    await handleUpdateStatus(
      withSession(
        `http://localhost/api/incidents/${incidentId}/status`,
        fieldToken,
        jsonBody('POST', { status: 'RESOLVED' }),
      ),
      world.deps,
      incidentId,
    );

    const response = await reveal(fieldToken, incidentId);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: 'grant_expired' });
  });

  it('returns a null snapshot for an anonymous-reporter incident', async () => {
    const anonId = await onlineIntake(null);
    await assign(anonId, 'responder-field');

    const response = await reveal(await responderToken('K9-01'), anonId);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ snapshot: null });
  });

  it('rejects an anonymous caller', async () => {
    const citizen = await citizenWithProfile('juan@example.com');
    const incidentId = await onlineIntake(citizen);
    const response = await handleMedicalReveal(
      new Request(`http://localhost/api/incidents/${incidentId}/medical`),
      world.deps,
      incidentId,
    );
    expect(response.status).toBe(401);
  });
});
