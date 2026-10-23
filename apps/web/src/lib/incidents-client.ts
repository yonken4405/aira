/**
 * Client data access for incidents: TTL cache + in-flight de-duplication + strict
 * response validation (SECURITY.md §3 - never trust the boundary).
 *
 * The browser cache is memory-only, private and short-lived; the server scopes rows
 * by role, so this module never filters for security - only for display.
 */

import { isEmergencyCategoryId } from '@aira/ui';

import { createInFlightTracker, createTtlCache } from './cache';
import {
  isIncidentSource,
  isIncidentStatus,
  type Incident,
  type IncidentStatus,
} from './incidents';

export const INCIDENTS_ENDPOINT = '/api/incidents';

/** Short, private, in-memory TTL - coordinates must not linger (SECURITY.md §1/§5). */
export const INCIDENTS_CACHE_TTL_MS = 10_000;

const CACHE_KEY = 'incidents';

const cache = createTtlCache<readonly Incident[]>(INCIDENTS_CACHE_TTL_MS);
const inFlight = createInFlightTracker();

/** Raised for non-OK responses so callers can distinguish 401 from a broken queue. */
export class IncidentsRequestError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`incidents_request_failed_${status}`);
    this.name = 'IncidentsRequestError';
    this.status = status;
  }
}

function parseIncident(raw: unknown): Incident | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const {
    id,
    category,
    lat,
    lon,
    reportedAt,
    source,
    status,
    assignedToId,
    assignedToCallsign,
    officeId,
    note,
    resolvedAt,
  } = record;

  if (typeof id !== 'string' || id.length === 0) {
    return null;
  }
  if (!isEmergencyCategoryId(category)) {
    return null;
  }
  if (typeof lat !== 'number' || !Number.isFinite(lat)) {
    return null;
  }
  if (typeof lon !== 'number' || !Number.isFinite(lon)) {
    return null;
  }
  if (typeof reportedAt !== 'string') {
    return null;
  }
  if (!isIncidentSource(source)) {
    return null;
  }
  if (!isIncidentStatus(status)) {
    return null;
  }
  if (assignedToId !== null && typeof assignedToId !== 'string') {
    return null;
  }
  if (assignedToCallsign !== null && typeof assignedToCallsign !== 'string') {
    return null;
  }
  if (typeof officeId !== 'string') {
    return null;
  }
  if (note !== null && typeof note !== 'string') {
    return null;
  }
  if (resolvedAt !== null && typeof resolvedAt !== 'string') {
    return null;
  }

  return {
    id,
    category,
    lat,
    lon,
    reportedAt,
    source,
    status: status as IncidentStatus,
    assignedToId,
    assignedToCallsign,
    officeId,
    note,
    resolvedAt,
  };
}

/** Validates `{ incidents: [...] }`; drops malformed rows, rejects a malformed envelope. */
export function parseIncidentsResponse(raw: unknown): readonly Incident[] {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('invalid_incidents_response');
  }

  const list = (raw as Record<string, unknown>).incidents;
  if (!Array.isArray(list)) {
    throw new Error('invalid_incidents_response');
  }

  return list.map(parseIncident).filter((incident): incident is Incident => incident !== null);
}

export interface LoadIncidentsOptions {
  /** Skip the TTL cache and hit the network. */
  readonly force?: boolean;
}

export interface LoadIncidentsResult {
  readonly incidents: readonly Incident[];
  readonly source: 'network' | 'cache';
}

export async function loadIncidents(
  options: LoadIncidentsOptions = {},
): Promise<LoadIncidentsResult> {
  if (!options.force) {
    const cached = cache.get(CACHE_KEY);
    if (cached) {
      return { incidents: cached, source: 'cache' };
    }
  }

  const incidents = await inFlight.run(CACHE_KEY, async () => {
    // `no-store` here: the browser cache is managed by our TTL layer, not HTTP heuristics.
    const response = await fetch(INCIDENTS_ENDPOINT, {
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new IncidentsRequestError(response.status);
    }

    const parsed = parseIncidentsResponse(await response.json());
    cache.set(CACHE_KEY, parsed);
    return parsed;
  });

  return { incidents, source: 'network' };
}

/** Test/reset hook - also called on sign-in and sign-out so caches never cross sessions. */
export function resetIncidentsCache(): void {
  cache.clear();
  inFlight.reset();
}
