/**
 * Assignee list for the dispatcher routing panel.
 *
 * Returns only active responders inside the caller's office subtree (server-side
 * scoping); the client validates shapes and caches briefly like the queue.
 */

import { createInFlightTracker, createTtlCache } from './cache';
import { isRole, type Role } from './auth/rbac';

export const RESPONDERS_ENDPOINT = '/api/responders';
export const RESPONDERS_CACHE_TTL_MS = 30_000;

export interface AssignableResponder {
  readonly id: string;
  readonly callsign: string;
  readonly role: Role;
  readonly officeName: string;
  readonly agencyName: string | null;
}

const CACHE_KEY = 'assignable-responders';

const cache = createTtlCache<readonly AssignableResponder[]>(RESPONDERS_CACHE_TTL_MS);
const inFlight = createInFlightTracker();

function parseResponder(raw: unknown): AssignableResponder | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }

  const { id, callsign, role, officeName, agencyName } = raw as Record<string, unknown>;

  if (typeof id !== 'string' || typeof callsign !== 'string' || !isRole(role)) {
    return null;
  }
  if (typeof officeName !== 'string') {
    return null;
  }
  if (agencyName !== null && typeof agencyName !== 'string') {
    return null;
  }

  return { id, callsign, role, officeName, agencyName };
}

export function parseAssignableResponders(raw: unknown): readonly AssignableResponder[] {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('invalid_responders_response');
  }

  const list = (raw as Record<string, unknown>).responders;
  if (!Array.isArray(list)) {
    throw new Error('invalid_responders_response');
  }

  return list.map(parseResponder).filter((row): row is AssignableResponder => row !== null);
}

export async function loadAssignableResponders(
  options: { readonly force?: boolean } = {},
): Promise<readonly AssignableResponder[]> {
  if (!options.force) {
    const cached = cache.get(CACHE_KEY);
    if (cached) {
      return cached;
    }
  }

  return inFlight.run(CACHE_KEY, async () => {
    const response = await fetch(RESPONDERS_ENDPOINT, {
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`responders_request_failed_${response.status}`);
    }

    const parsed = parseAssignableResponders(await response.json());
    cache.set(CACHE_KEY, parsed);
    return parsed;
  });
}

export function resetRespondersCache(): void {
  cache.clear();
  inFlight.reset();
}
