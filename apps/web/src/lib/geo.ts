/** Geographic helpers for the responder dashboard (routing panel, queue distances). */

export interface GeoPoint {
  readonly lat: number;
  readonly lon: number;
}

const EARTH_RADIUS_KM = 6371;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Great-circle distance in kilometers. */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const deltaLat = toRadians(b.lat - a.lat);
  const deltaLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** Compact distance label: meters under 1 km, one decimal above (DESIGN.md §5). */
export function formatDistance(kilometers: number): string {
  if (kilometers < 1) {
    return `${Math.max(0, Math.round(kilometers * 1000))} m`;
  }
  return `${kilometers.toFixed(1)} km`;
}

/**
 * Straight-line ETA estimate at an assumed urban response speed.
 * Mock routing only - no road-network routing exists yet (PRODUCT.md §5).
 */
export function estimateEtaMinutes(kilometers: number, speedKmh = 40): number {
  if (kilometers <= 0) {
    return 1;
  }
  return Math.max(1, Math.round((kilometers / speedKmh) * 60));
}
