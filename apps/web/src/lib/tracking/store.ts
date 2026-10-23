/**
 * Responder live-position persistence port (SECURITY.md §9). Positions are ephemeral,
 * incident-scoped, and stored at 4 dp. The store keeps only the latest fix per
 * (responder, incident).
 */

export interface PositionRow {
  readonly responderId: string;
  readonly incidentId: string;
  readonly lat: number;
  readonly lon: number;
  readonly updatedAt: number;
}

export interface TrackingStore {
  /** Insert or replace the responder's latest fix for an incident. */
  upsert(input: {
    readonly responderId: string;
    readonly incidentId: string;
    readonly lat: number;
    readonly lon: number;
    readonly at: number;
  }): Promise<void>;
  /** The latest position for an incident, or null when none exists. */
  latestForIncident(incidentId: string): Promise<PositionRow | null>;
  /** Drop a responder's position for an incident (e.g. on resolve/reassign). */
  clear(responderId: string, incidentId: string): Promise<void>;
}
