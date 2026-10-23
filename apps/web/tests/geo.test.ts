import { describe, expect, it } from 'vitest';

import { estimateEtaMinutes, formatDistance, haversineKm } from '../src/lib/geo';

describe('haversineKm', () => {
  it('returns 0 for identical points', () => {
    expect(haversineKm({ lat: 10.3157, lon: 123.8854 }, { lat: 10.3157, lon: 123.8854 })).toBe(0);
  });

  it('matches the known 1° longitude distance at the equator', () => {
    const km = haversineKm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
    expect(km).toBeCloseTo(111.19, 1);
  });

  it('computes a plausible intra-city distance in Cebu', () => {
    const km = haversineKm({ lat: 10.3157, lon: 123.8854 }, { lat: 10.3233, lon: 123.9017 });
    expect(km).toBeGreaterThan(0.5);
    expect(km).toBeLessThan(5);
  });

  it('is symmetric', () => {
    const a = { lat: 10.3157, lon: 123.8854 };
    const b = { lat: 10.2965, lon: 123.902 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 10);
  });
});

describe('formatDistance', () => {
  it('formats sub-kilometer distances in whole meters', () => {
    expect(formatDistance(0.456)).toBe('456 m');
    expect(formatDistance(0)).toBe('0 m');
  });

  it('formats kilometer distances with one decimal', () => {
    expect(formatDistance(2.34)).toBe('2.3 km');
    expect(formatDistance(11.05)).toBe('11.1 km');
  });
});

describe('estimateEtaMinutes', () => {
  it('converts distance to minutes at 40 km/h', () => {
    expect(estimateEtaMinutes(20)).toBe(30);
    expect(estimateEtaMinutes(40)).toBe(60);
  });

  it('never returns less than one minute', () => {
    expect(estimateEtaMinutes(0.1)).toBe(1);
    expect(estimateEtaMinutes(0)).toBe(1);
  });
});
