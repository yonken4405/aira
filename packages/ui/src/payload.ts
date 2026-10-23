/**
 * Offline mesh payload (PRODUCT.md §4).
 *
 * Frozen wire format - hyper-compressed positional JSON array, ≤ 64 bytes, zero PII:
 *
 *   ["SUNOG", 10.3157, 123.8854]
 *   ["<CATEGORY>", <latitude>, <longitude>]
 *
 * Rules: exactly 3 elements, coordinates rounded to 4 dp (~11 m), category is a closed enum,
 * ASCII/UTF-8, single line. Future transport: Bluetooth/LoRa mesh (SECURITY.md §2).
 *
 * Both apps MUST use these helpers - never re-implement the format.
 */

import { isEmergencyCategoryId, type EmergencyCategoryId } from './categories';

export type SosPayload = [EmergencyCategoryId, number, number];

/**
 * Mock GPS fix (Cebu City). Placeholder until real location services are implemented -
 * must never be presented as a live fix (PRODUCT.md §5, SECURITY.md §1).
 */
export const MOCK_LOCATION = { lat: 10.3157, lon: 123.8854 } as const;

/** Coordinates are truncated to 4 decimal places (~11 m) before hitting the wire. */
export function roundCoord(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

export function buildSosPayload(
  category: EmergencyCategoryId,
  lat: number,
  lon: number,
): SosPayload {
  return [category, roundCoord(lat), roundCoord(lon)];
}

/** Serializes to the exact wire form: `["SUNOG",10.3157,123.8854]`. */
export function serializeSosPayload(payload: SosPayload): string {
  return JSON.stringify(payload);
}

export type ParsedSosPayload =
  | { readonly ok: true; readonly payload: SosPayload }
  | { readonly ok: false; readonly reason: string };

/**
 * Reject-by-default validation of an inbound payload (SECURITY.md §3).
 * Used by the intake API and safe to run on untrusted input.
 */
export function parseSosPayload(raw: unknown): ParsedSosPayload {
  if (!Array.isArray(raw)) {
    return { ok: false, reason: 'payload_must_be_array' };
  }
  if (raw.length !== 3) {
    return { ok: false, reason: 'payload_must_have_3_elements' };
  }

  const elements = raw as [unknown, unknown, unknown];
  const category = elements[0];
  const lat = elements[1];
  const lon = elements[2];

  if (!isEmergencyCategoryId(category)) {
    return { ok: false, reason: 'unknown_category' };
  }
  if (typeof lat !== 'number' || !Number.isFinite(lat)) {
    return { ok: false, reason: 'lat_must_be_finite_number' };
  }
  if (typeof lon !== 'number' || !Number.isFinite(lon)) {
    return { ok: false, reason: 'lon_must_be_finite_number' };
  }
  if (lat < -90 || lat > 90) {
    return { ok: false, reason: 'lat_out_of_range' };
  }
  if (lon < -180 || lon > 180) {
    return { ok: false, reason: 'lon_out_of_range' };
  }

  return { ok: true, payload: [category, roundCoord(lat), roundCoord(lon)] };
}
