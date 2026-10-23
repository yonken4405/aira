/**
 * In-memory `TrackingStore` for tests (TESTING.md §4.3). Latest fix per
 * (responder, incident).
 */

import type { PositionRow, TrackingStore } from '../../src/lib/tracking/store';

export interface MemoryTrackingStore extends TrackingStore {
  readonly positions: Map<string, PositionRow>;
}

const keyOf = (responderId: string, incidentId: string): string => `${responderId}::${incidentId}`;

export function createMemoryTrackingStore(): MemoryTrackingStore {
  const positions = new Map<string, PositionRow>();

  return {
    positions,

    async upsert(input) {
      positions.set(keyOf(input.responderId, input.incidentId), {
        responderId: input.responderId,
        incidentId: input.incidentId,
        lat: input.lat,
        lon: input.lon,
        updatedAt: input.at,
      });
    },

    async latestForIncident(incidentId) {
      let latest: PositionRow | null = null;
      for (const row of positions.values()) {
        if (row.incidentId !== incidentId) {
          continue;
        }
        if (!latest || row.updatedAt > latest.updatedAt) {
          latest = row;
        }
      }
      return latest;
    },

    async clear(responderId, incidentId) {
      positions.delete(keyOf(responderId, incidentId));
    },
  };
}
