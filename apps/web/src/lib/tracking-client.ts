/**
 * Client access to live incident tracking (SECURITY.md §9). Fetches the assigned
 * responder's latest position + incident status for one incident; validated and
 * polled on a short interval by the console/civilian map.
 */

export interface LivePositionView {
  readonly lat: number;
  readonly lon: number;
  readonly updatedAt: number;
  readonly fresh: boolean;
}

export interface IncidentTrackingView {
  readonly incidentId: string;
  readonly status: string;
  readonly assignedToCallsign: string | null;
  readonly position: LivePositionView | null;
}

/** Short poll cadence for live markers (DESIGN.md §5a; SECURITY.md §9). */
export const TRACKING_POLL_MS = 10_000;

function parsePosition(raw: unknown): LivePositionView | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const { lat, lon, updatedAt, fresh } = raw as Record<string, unknown>;
  if (
    typeof lat !== 'number' ||
    !Number.isFinite(lat) ||
    typeof lon !== 'number' ||
    !Number.isFinite(lon) ||
    typeof updatedAt !== 'number' ||
    typeof fresh !== 'boolean'
  ) {
    return null;
  }
  return { lat, lon, updatedAt, fresh };
}

export function parseTracking(raw: unknown): IncidentTrackingView | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const { incidentId, status, assignedToCallsign, position } = raw as Record<string, unknown>;
  if (typeof incidentId !== 'string' || typeof status !== 'string') {
    return null;
  }
  if (assignedToCallsign !== null && typeof assignedToCallsign !== 'string') {
    return null;
  }
  return {
    incidentId,
    status,
    assignedToCallsign: assignedToCallsign ?? null,
    position: position === null || position === undefined ? null : parsePosition(position),
  };
}

export async function loadIncidentTracking(
  incidentId: string,
  options: { readonly token?: string | null } = {},
): Promise<IncidentTrackingView | null> {
  const base = `/api/incidents/${encodeURIComponent(incidentId)}/tracking`;
  const url = options.token ? `${base}?token=${encodeURIComponent(options.token)}` : base;
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`tracking_request_failed_${response.status}`);
  }
  return parseTracking(await response.json());
}

/** Thrown statuses callers use to render an "expired link" state vs a transient error. */
export class TrackingRequestError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`tracking_request_failed_${status}`);
    this.name = 'TrackingRequestError';
    this.status = status;
  }
}
