/**
 * Nearest-responder suggestions for the dispatcher routing panel.
 *
 * Fetches ranked suggestions for one incident and validates the shape. Suggestions
 * carry a distance, never a base coordinate (SECURITY.md §5); the server already
 * stripped positions.
 */

export interface RoutingSuggestionView {
  readonly id: string;
  readonly callsign: string;
  readonly agencyName: string | null;
  readonly officeName: string;
  readonly capable: boolean;
  readonly distanceKm: number | null;
}

function parseSuggestion(raw: unknown): RoutingSuggestionView | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const { id, callsign, agencyName, officeName, capable, distanceKm } = raw as Record<
    string,
    unknown
  >;

  if (typeof id !== 'string' || typeof callsign !== 'string' || typeof officeName !== 'string') {
    return null;
  }
  if (typeof capable !== 'boolean') {
    return null;
  }
  if (agencyName !== null && typeof agencyName !== 'string') {
    return null;
  }
  if (distanceKm !== null && (typeof distanceKm !== 'number' || !Number.isFinite(distanceKm))) {
    return null;
  }

  return { id, callsign, agencyName, officeName, capable, distanceKm };
}

export function parseRoutingSuggestions(raw: unknown): readonly RoutingSuggestionView[] {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('invalid_routing_response');
  }
  const list = (raw as Record<string, unknown>).suggestions;
  if (!Array.isArray(list)) {
    throw new Error('invalid_routing_response');
  }
  return list.map(parseSuggestion).filter((row): row is RoutingSuggestionView => row !== null);
}

export async function loadRoutingSuggestions(
  incidentId: string,
): Promise<readonly RoutingSuggestionView[]> {
  const response = await fetch(`/api/incidents/${encodeURIComponent(incidentId)}/routing`, {
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`routing_request_failed_${response.status}`);
  }

  return parseRoutingSuggestions(await response.json());
}
