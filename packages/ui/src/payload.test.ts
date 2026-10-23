import { describe, expect, it } from 'vitest';

import {
  MOCK_LOCATION,
  buildSosPayload,
  parseSosPayload,
  roundCoord,
  serializeSosPayload,
} from './payload';

describe('roundCoord', () => {
  it('rounds to 4 decimal places', () => {
    expect(roundCoord(10.31567)).toBe(10.3157);
    expect(roundCoord(123.88544)).toBe(123.8854);
    expect(roundCoord(10.3157)).toBe(10.3157);
  });
});

describe('buildSosPayload', () => {
  it('builds the positional payload from PRODUCT.md §4', () => {
    expect(buildSosPayload('SUNOG', MOCK_LOCATION.lat, MOCK_LOCATION.lon)).toEqual([
      'SUNOG',
      10.3157,
      123.8854,
    ]);
  });

  it('rounds raw GPS noise before it reaches the wire', () => {
    expect(buildSosPayload('BAHA', 10.3156712345, 123.8854499999)).toEqual([
      'BAHA',
      10.3157,
      123.8854,
    ]);
  });
});

describe('serializeSosPayload', () => {
  it('emits the exact compressed JSON string (no whitespace, single line)', () => {
    const payload = buildSosPayload('SUNOG', MOCK_LOCATION.lat, MOCK_LOCATION.lon);
    expect(serializeSosPayload(payload)).toBe('["SUNOG",10.3157,123.8854]');
  });

  it('stays well under the 64-byte mesh budget', () => {
    const payload = buildSosPayload('MEDIKAL', MOCK_LOCATION.lat, MOCK_LOCATION.lon);
    expect(serializeSosPayload(payload).length).toBeLessThanOrEqual(64);
  });
});

describe('parseSosPayload', () => {
  it('accepts a valid payload and normalizes coordinates', () => {
    const result = parseSosPayload(['MEDIKAL', 10.315671, 123.885449]);
    expect(result).toEqual({
      ok: true,
      payload: ['MEDIKAL', 10.3157, 123.8854],
    });
  });

  it('round-trips build → serialize → parse', () => {
    const payload = buildSosPayload('KRIMEN', MOCK_LOCATION.lat, MOCK_LOCATION.lon);
    const result = parseSosPayload(JSON.parse(serializeSosPayload(payload)));
    expect(result).toEqual({ ok: true, payload });
  });

  it('rejects non-arrays', () => {
    expect(parseSosPayload('["SUNOG",10.3,123.8]')).toEqual({
      ok: false,
      reason: 'payload_must_be_array',
    });
    expect(parseSosPayload(null)).toEqual({
      ok: false,
      reason: 'payload_must_be_array',
    });
  });

  it('rejects arrays with the wrong arity', () => {
    expect(parseSosPayload(['SUNOG', 10.3157])).toEqual({
      ok: false,
      reason: 'payload_must_have_3_elements',
    });
    expect(parseSosPayload(['SUNOG', 10.3157, 123.8854, 'extra'])).toEqual({
      ok: false,
      reason: 'payload_must_have_3_elements',
    });
  });

  it('rejects unknown categories (closed enum)', () => {
    expect(parseSosPayload(['FLOOD', 10.3157, 123.8854])).toEqual({
      ok: false,
      reason: 'unknown_category',
    });
    expect(parseSosPayload(['sunog', 10.3157, 123.8854])).toEqual({
      ok: false,
      reason: 'unknown_category',
    });
  });

  it('rejects non-numeric and non-finite coordinates', () => {
    expect(parseSosPayload(['BAHA', '10.3157', 123.8854])).toEqual({
      ok: false,
      reason: 'lat_must_be_finite_number',
    });
    expect(parseSosPayload(['BAHA', 10.3157, Number.NaN])).toEqual({
      ok: false,
      reason: 'lon_must_be_finite_number',
    });
    expect(parseSosPayload(['BAHA', Number.POSITIVE_INFINITY, 123.8854])).toEqual({
      ok: false,
      reason: 'lat_must_be_finite_number',
    });
  });

  it('rejects out-of-range coordinates', () => {
    expect(parseSosPayload(['BAHA', 91, 123.8854])).toEqual({
      ok: false,
      reason: 'lat_out_of_range',
    });
    expect(parseSosPayload(['BAHA', 10.3157, 181])).toEqual({
      ok: false,
      reason: 'lon_out_of_range',
    });
  });
});
