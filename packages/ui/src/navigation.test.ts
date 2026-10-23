import { describe, expect, it } from 'vitest';

import { googleMapsDirectionsUrl } from './navigation';

describe('googleMapsDirectionsUrl', () => {
  it('builds a driving directions URL with a 4 dp destination', () => {
    const url = googleMapsDirectionsUrl(10.315789, 123.885432);
    const parsed = new URL(url);

    expect(parsed.origin + parsed.pathname).toBe('https://www.google.com/maps/dir/');
    expect(parsed.searchParams.get('api')).toBe('1');
    expect(parsed.searchParams.get('destination')).toBe('10.3158,123.8854');
    expect(parsed.searchParams.get('travelmode')).toBe('driving');
  });

  it('honours an explicit travel mode', () => {
    const url = googleMapsDirectionsUrl(10.3157, 123.8854, { travelMode: 'walking' });
    expect(new URL(url).searchParams.get('travelmode')).toBe('walking');
  });

  it('carries ONLY the destination coordinates - no other params (no PII)', () => {
    const url = googleMapsDirectionsUrl(10.3157, 123.8854);
    const keys = [...new URL(url).searchParams.keys()].sort();
    expect(keys).toEqual(['api', 'destination', 'travelmode']);
  });

  it('rejects non-finite and out-of-range coordinates', () => {
    expect(() => googleMapsDirectionsUrl(Number.NaN, 123.8)).toThrow(/invalid_destination/);
    expect(() => googleMapsDirectionsUrl(91, 123.8)).toThrow(/out_of_range/);
    expect(() => googleMapsDirectionsUrl(10.3, 181)).toThrow(/out_of_range/);
  });
});
