/**
 * @vitest-environment node
 *
 * Metrics API (PRODUCT.md §5): metrics:read (ADMIN / DISPATCHER) only; never the
 * field responder or an anonymous caller.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { handleLogin } from '../src/lib/api/auth-handlers';
import { handleGetMetrics } from '../src/lib/api/metrics-handlers';
import { createMemoryIncidentsStore } from './support/memory-incidents-store';
import { createTestClock, createTestHarness, jsonBody, withSession } from './support/harness';
import { makeIncident, TEST_PASSWORD } from './support/fixtures';

const SEED = [
  makeIncident({ id: 'i-q', category: 'SUNOG', status: 'QUEUED' }),
  makeIncident({
    id: 'i-d',
    category: 'MEDIKAL',
    status: 'DISPATCHED',
    assignedToId: 'responder-field',
  }),
];

function createWorld() {
  const clock = createTestClock();
  const incidents = createMemoryIncidentsStore({ now: clock.now, incidents: SEED });
  const harness = createTestHarness({ clock, incidents });

  harness.authStore.seedResponder({ id: 'responder-field', callsign: 'K9-01', role: 'RESPONDER' });
  harness.authStore.seedResponder({
    id: 'responder-dispatcher',
    callsign: 'OPCEN-01',
    role: 'DISPATCHER',
  });
  harness.authStore.seedResponder({ id: 'responder-admin', callsign: 'ADMIN-1', role: 'ADMIN' });

  async function tokenFor(callsign: string): Promise<string> {
    const response = await handleLogin(
      new Request(
        'http://localhost/api/auth/login',
        jsonBody('POST', { email: `${callsign.toLowerCase()}@aira.test`, password: TEST_PASSWORD }),
      ),
      harness.deps,
    );
    const token = /aira_session=([A-Za-z0-9_-]+)/.exec(
      response.headers.get('set-cookie') ?? '',
    )?.[1];
    if (!token) {
      throw new Error(`login_failed_${callsign}`);
    }
    return token;
  }

  return { ...harness, tokenFor };
}

let world: ReturnType<typeof createWorld>;

beforeEach(() => {
  world = createWorld();
});

const getMetrics = (token: string): Promise<Response> =>
  handleGetMetrics(withSession('http://localhost/api/metrics', token), world.deps);

describe('GET /api/metrics', () => {
  it('serves aggregate metrics to the DRRM admin', async () => {
    const response = await getMetrics(await world.tokenFor('ADMIN-1'));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { metrics: { total: number; active: number } };
    expect(payload.metrics.total).toBe(2);
    expect(payload.metrics.active).toBe(2);
  });

  it('serves metrics to a dispatcher', async () => {
    const response = await getMetrics(await world.tokenFor('OPCEN-01'));
    expect(response.status).toBe(200);
  });

  it('denies a field responder', async () => {
    const response = await getMetrics(await world.tokenFor('K9-01'));
    expect(response.status).toBe(403);
  });

  it('rejects an anonymous caller', async () => {
    const response = await handleGetMetrics(
      new Request('http://localhost/api/metrics'),
      world.deps,
    );
    expect(response.status).toBe(401);
  });

  it('never exposes coordinates in the metrics payload', async () => {
    const response = await getMetrics(await world.tokenFor('ADMIN-1'));
    const body = await response.text();
    expect(body).not.toContain('10.31');
    expect(body).not.toContain('123.88');
  });
});
