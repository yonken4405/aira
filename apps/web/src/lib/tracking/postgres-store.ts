/**
 * SQL adapter for responder positions (SECURITY.md §9). Latest fix per
 * (responder, incident); coordinates arrive already rounded to 4 dp.
 */

import { query, queryOne } from '../db';
import type { PositionRow, TrackingStore } from './store';

interface Row {
  responderId: string;
  incidentId: string;
  lat: number;
  lon: number;
  updatedAt: Date;
}

const map = (row: Row): PositionRow => ({
  responderId: row.responderId,
  incidentId: row.incidentId,
  lat: row.lat,
  lon: row.lon,
  updatedAt: row.updatedAt.getTime(),
});

export function createPostgresTrackingStore(): TrackingStore {
  return {
    async upsert(input) {
      await query(
        `insert into public.responder_positions (responder_id, incident_id, lat, lon, updated_at)
         values ($1, $2, $3, $4, $5)
         on conflict (responder_id, incident_id)
         do update set lat = excluded.lat, lon = excluded.lon, updated_at = excluded.updated_at`,
        [input.responderId, input.incidentId, input.lat, input.lon, new Date(input.at)],
      );
    },

    async latestForIncident(incidentId) {
      const row = await queryOne<Row>(
        `select responder_id as "responderId",
                incident_id as "incidentId",
                lat,
                lon,
                updated_at as "updatedAt"
           from public.responder_positions
          where incident_id = $1
          order by updated_at desc
          limit 1`,
        [incidentId],
      );
      return row ? map(row) : null;
    },

    async clear(responderId, incidentId) {
      await query(
        `delete from public.responder_positions where responder_id = $1 and incident_id = $2`,
        [responderId, incidentId],
      );
    },
  };
}
