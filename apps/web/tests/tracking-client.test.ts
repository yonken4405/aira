/**
 * @vitest-environment node
 *
 * Tracking client parsing + fetch (SECURITY.md §9). The live map polls this; it must
 * reject malformed envelopes and tolerate a null position.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadIncidentTracking, parseTracking } from '../src/lib/tracking-client';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseTracking', () => {
  it('parses a tracking view with a fresh position', () => {
    const view = parseTracking({
      incidentId: 'i1',
      status: 'EN_ROUTE',
      assignedToCallsign: 'K9-01',
      position: { lat: 10.33, lon: 123.9, updatedAt: 1000, fresh: true },
    });
    expect(view?.incidentId).toBe('i1');
    expect(view?.position?.fresh).toBe(true);
  });

  it('tolerates a null position', () => {
    const view = parseTracking({
      incidentId: 'i1',
      status: 'DISPATCHED',
      assignedToCallsign: 'K9-01',
      position: null,
    });
    expect(view?.position).toBeNull();
  });

  it('drops a malformed position but keeps the view', () => {
    const view = parseTracking({
      incidentId: 'i1',
      status: 'DISPATCHED',
      assignedToCallsign: null,
      position: { lat: 'nope', lon: 123.9, updatedAt: 1, fresh: true },
    });
    expect(view?.position).toBeNull();
    expect(view?.assignedToCallsign).toBeNull();
  });

  it('rejects a malformed envelope', () => {
    expect(parseTracking(null)).toBeNull();
    expect(parseTracking({ status: 'EN_ROUTE' })).toBeNull();
  });
});

describe('loadIncidentTracking', () => {
  it('fetches and parses the tracking endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              incidentId: 'i1',
              status: 'EN_ROUTE',
              assignedToCallsign: 'K9-01',
              position: { lat: 10.33, lon: 123.9, updatedAt: 1000, fresh: true },
            }),
            { status: 200 },
          ),
      ),
    );

    const view = await loadIncidentTracking('i1');
    expect(view?.position?.lat).toBe(10.33);
  });

  it('throws on a non-OK response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 403 })),
    );
    await expect(loadIncidentTracking('i1')).rejects.toThrow(/tracking_request_failed_403/);
  });
});
