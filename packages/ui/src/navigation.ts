/**
 * External navigation deep-link (SECURITY.md §11, PRODUCT.md §5).
 *
 * AIRA does not build turn-by-turn navigation. A responder taps "Navigate" and we hand
 * off to Google Maps with ONLY the incident's destination coordinates - no name, no
 * medical field, no citizen id, no token, no PII. Coordinates are rounded to 4 dp (the
 * same precision as the mesh payload and everything at rest, SECURITY.md §5.1).
 *
 * This is an outbound hand-off, not a data channel: nothing comes back through it, and
 * no Google SDK/key/telemetry is embedded in the apps.
 */

import { roundCoord } from './payload';

export type TravelMode = 'driving' | 'walking' | 'bicycling' | 'transit';

/**
 * Builds a Google Maps directions URL to the given destination. Latitude/longitude are
 * validated and 4-dp-rounded; an out-of-range coordinate throws rather than emitting a
 * malformed link.
 */
export function googleMapsDirectionsUrl(
  lat: number,
  lon: number,
  options: { readonly travelMode?: TravelMode } = {},
): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error('invalid_destination');
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new Error('destination_out_of_range');
  }

  const destination = `${roundCoord(lat)},${roundCoord(lon)}`;
  const params = new URLSearchParams({
    api: '1',
    destination,
    travelmode: options.travelMode ?? 'driving',
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
