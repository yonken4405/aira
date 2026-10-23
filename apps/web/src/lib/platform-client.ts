/**
 * Client access to the platform nationwide office pins. Office locations only - never
 * citizen data (SECURITY.md). Validated at the boundary.
 */

export interface OfficePinView {
  readonly id: string;
  readonly tenantId: string;
  readonly tenantName: string;
  readonly name: string;
  readonly kind: 'LGU' | 'BARANGAY';
  readonly region: string | null;
  readonly province: string | null;
  readonly lat: number | null;
  readonly lon: number | null;
  readonly status: 'active' | 'suspended';
}

function parsePin(raw: unknown): OfficePinView | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.tenantId !== 'string' || typeof r.name !== 'string') {
    return null;
  }
  if (r.kind !== 'LGU' && r.kind !== 'BARANGAY') {
    return null;
  }
  const lat = typeof r.lat === 'number' && Number.isFinite(r.lat) ? r.lat : null;
  const lon = typeof r.lon === 'number' && Number.isFinite(r.lon) ? r.lon : null;
  return {
    id: r.id,
    tenantId: r.tenantId,
    tenantName: typeof r.tenantName === 'string' ? r.tenantName : '',
    name: r.name,
    kind: r.kind,
    region: typeof r.region === 'string' ? r.region : null,
    province: typeof r.province === 'string' ? r.province : null,
    lat,
    lon,
    status: r.status === 'suspended' ? 'suspended' : 'active',
  };
}

export function parseOfficePins(raw: unknown): readonly OfficePinView[] {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('invalid_offices_response');
  }
  const list = (raw as Record<string, unknown>).offices;
  if (!Array.isArray(list)) {
    throw new Error('invalid_offices_response');
  }
  return list.map(parsePin).filter((p): p is OfficePinView => p !== null);
}

export async function loadOfficePins(): Promise<readonly OfficePinView[]> {
  const response = await fetch('/api/platform/offices', {
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`offices_request_failed_${response.status}`);
  }
  return parseOfficePins(await response.json());
}

/** Pure filter used by the map: region match + case-insensitive text search. */
export function filterPins(
  pins: readonly OfficePinView[],
  options: { readonly region?: string | null; readonly search?: string },
): readonly OfficePinView[] {
  const region = options.region ?? null;
  const search = (options.search ?? '').trim().toLowerCase();
  return pins.filter((pin) => {
    if (region && pin.region !== region) {
      return false;
    }
    if (search.length > 0) {
      const haystack = `${pin.name} ${pin.tenantName} ${pin.province ?? ''}`.toLowerCase();
      if (!haystack.includes(search)) {
        return false;
      }
    }
    return true;
  });
}

/** Distinct regions present in the pin set, sorted - drives the filter dropdown. */
export function regionsOf(pins: readonly OfficePinView[]): readonly string[] {
  const set = new Set<string>();
  for (const pin of pins) {
    if (pin.region) {
      set.add(pin.region);
    }
  }
  return [...set].sort();
}
