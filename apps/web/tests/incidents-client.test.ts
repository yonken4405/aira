/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MOCK_INCIDENTS } from './support/fixtures';
import {
  INCIDENTS_ENDPOINT,
  loadIncidents,
  parseIncidentsResponse,
  resetIncidentsCache,
} from '../src/lib/incidents-client';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const okResponse = (): Response => jsonResponse({ incidents: MOCK_INCIDENTS });

const stubFetch = (impl: () => Promise<Response>) => {
  const spy = vi.fn(impl);
  vi.stubGlobal('fetch', spy);
  return spy;
};

beforeEach(() => {
  resetIncidentsCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetIncidentsCache();
});

describe('parseIncidentsResponse', () => {
  it('accepts the API envelope', () => {
    expect(parseIncidentsResponse({ incidents: MOCK_INCIDENTS })).toHaveLength(
      MOCK_INCIDENTS.length,
    );
  });

  it('drops malformed rows but keeps valid ones', () => {
    const parsed = parseIncidentsResponse({
      incidents: [
        MOCK_INCIDENTS[0],
        {
          id: 'bad',
          category: 'FLOOD',
          lat: 1,
          lon: 2,
          reportedAt: '',
          source: 'mesh',
          status: 'QUEUED',
        },
        null,
        'nope',
      ],
    });

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.id).toBe(MOCK_INCIDENTS[0]?.id);
  });

  it('rejects a malformed envelope', () => {
    expect(() => parseIncidentsResponse(null)).toThrow('invalid_incidents_response');
    expect(() => parseIncidentsResponse({})).toThrow('invalid_incidents_response');
    expect(() => parseIncidentsResponse({ incidents: 'nope' })).toThrow(
      'invalid_incidents_response',
    );
  });
});

describe('loadIncidents', () => {
  it('fetches from the API then serves the TTL cache', async () => {
    const fetchSpy = stubFetch(async () => okResponse());

    const first = await loadIncidents();
    expect(first.source).toBe('network');
    expect(first.incidents).toHaveLength(MOCK_INCIDENTS.length);

    const second = await loadIncidents();
    expect(second.source).toBe('cache');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      INCIDENTS_ENDPOINT,
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('bypasses the cache when forced', async () => {
    const fetchSpy = stubFetch(async () => okResponse());

    await loadIncidents();
    await loadIncidents({ force: true });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('de-duplicates concurrent loads', async () => {
    const fetchSpy = stubFetch(async () => okResponse());

    const [a, b] = await Promise.all([loadIncidents(), loadIncidents()]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(a.incidents).toEqual(b.incidents);
  });

  it('rejects non-OK responses', async () => {
    stubFetch(async () => jsonResponse({}, 503));

    await expect(loadIncidents()).rejects.toThrow('incidents_request_failed_503');
  });

  it('rejects malformed envelopes instead of caching garbage', async () => {
    stubFetch(async () => jsonResponse({ nope: true }));

    await expect(loadIncidents()).rejects.toThrow('invalid_incidents_response');

    // Cache must stay empty, so a retry hits the network again.
    const fetchSpy = stubFetch(async () => okResponse());
    const result = await loadIncidents();
    expect(result.source).toBe('network');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
