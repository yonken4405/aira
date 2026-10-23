/**
 * Responder live-position service (SECURITY.md §9).
 *
 * Pure rules over an injected store + clock. Enforces the two hard properties:
 *   - coordinates are rounded to 4 dp before storage (§5.1);
 *   - a fix older than the TTL is "stale" and never served as a live position (§9.2).
 */

import { roundCoord } from '@aira/ui';

import type { PositionRow, TrackingStore } from './store';

export interface TrackingServiceDeps {
  readonly store: TrackingStore;
  readonly now: () => number;
}

/** A fix older than this is stale: shown muted / "last seen", never as live. */
export const POSITION_TTL_MS = 60_000;

export interface LivePosition {
  readonly lat: number;
  readonly lon: number;
  readonly updatedAt: number;
  /** True when the fix is within the TTL; false = show as a stale "last seen". */
  readonly fresh: boolean;
}

/** Records a responder's current fix for an incident (4 dp, latest-wins). */
export async function recordPosition(
  deps: TrackingServiceDeps,
  input: {
    readonly responderId: string;
    readonly incidentId: string;
    readonly lat: number;
    readonly lon: number;
  },
): Promise<void> {
  await deps.store.upsert({
    responderId: input.responderId,
    incidentId: input.incidentId,
    lat: roundCoord(input.lat),
    lon: roundCoord(input.lon),
    at: deps.now(),
  });
}

/** Reads the latest position for an incident and flags freshness against the TTL. */
export async function readLivePosition(
  deps: TrackingServiceDeps,
  incidentId: string,
): Promise<LivePosition | null> {
  const row: PositionRow | null = await deps.store.latestForIncident(incidentId);
  if (!row) {
    return null;
  }
  return {
    lat: row.lat,
    lon: row.lon,
    updatedAt: row.updatedAt,
    fresh: deps.now() - row.updatedAt <= POSITION_TTL_MS,
  };
}

export async function clearPosition(
  deps: TrackingServiceDeps,
  responderId: string,
  incidentId: string,
): Promise<void> {
  await deps.store.clear(responderId, incidentId);
}
