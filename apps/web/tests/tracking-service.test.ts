/**
 * @vitest-environment node
 *
 * Responder live-position service (SECURITY.md §9): 4 dp rounding + TTL freshness.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  POSITION_TTL_MS,
  readLivePosition,
  recordPosition,
  type TrackingServiceDeps,
} from '../src/lib/tracking/service';
import { createTestClock } from './support/harness';
import {
  createMemoryTrackingStore,
  type MemoryTrackingStore,
} from './support/memory-tracking-store';

let clock: ReturnType<typeof createTestClock>;
let store: MemoryTrackingStore;
let deps: TrackingServiceDeps;

beforeEach(() => {
  clock = createTestClock();
  store = createMemoryTrackingStore();
  deps = { store, now: clock.now };
});

describe('recordPosition', () => {
  it('rounds coordinates to 4 dp before storing', async () => {
    await recordPosition(deps, {
      responderId: 'r1',
      incidentId: 'i1',
      lat: 10.315789,
      lon: 123.885432,
    });

    const row = await store.latestForIncident('i1');
    expect(row?.lat).toBe(10.3158);
    expect(row?.lon).toBe(123.8854);
  });

  it('keeps only the latest fix per responder+incident', async () => {
    await recordPosition(deps, { responderId: 'r1', incidentId: 'i1', lat: 10.3, lon: 123.8 });
    clock.advance(1000);
    await recordPosition(deps, { responderId: 'r1', incidentId: 'i1', lat: 10.4, lon: 123.9 });

    expect(store.positions.size).toBe(1);
    const row = await store.latestForIncident('i1');
    expect(row?.lat).toBe(10.4);
  });
});

describe('readLivePosition freshness', () => {
  it('flags a recent fix as fresh', async () => {
    await recordPosition(deps, { responderId: 'r1', incidentId: 'i1', lat: 10.3, lon: 123.8 });
    const live = await readLivePosition(deps, 'i1');
    expect(live?.fresh).toBe(true);
  });

  it('flags a fix older than the TTL as stale', async () => {
    await recordPosition(deps, { responderId: 'r1', incidentId: 'i1', lat: 10.3, lon: 123.8 });
    clock.advance(POSITION_TTL_MS + 1);
    const live = await readLivePosition(deps, 'i1');
    expect(live?.fresh).toBe(false);
    expect(live?.lat).toBe(10.3); // still returned, just marked stale
  });

  it('returns null when there is no position', async () => {
    expect(await readLivePosition(deps, 'nope')).toBeNull();
  });
});
