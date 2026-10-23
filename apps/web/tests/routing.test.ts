import { describe, expect, it } from 'vitest';

import {
  bestSuggestion,
  isCapable,
  rankResponders,
  type RoutingCandidate,
} from '../src/lib/routing';

const incident = { lat: 10.3157, lon: 123.8854 };

function candidate(overrides: Partial<RoutingCandidate> & { id: string }): RoutingCandidate {
  return {
    callsign: overrides.id.toUpperCase(),
    role: 'RESPONDER',
    officeId: 'office-1',
    officeName: 'Cebu City DRRMO',
    agencyCode: null,
    agencyName: null,
    base: null,
    ...overrides,
  };
}

describe('isCapable', () => {
  it('matches agency codes to categories', () => {
    expect(isCapable('SUNOG', 'BFP')).toBe(true);
    expect(isCapable('MEDIKAL', 'EMS')).toBe(true);
    expect(isCapable('KRIMEN', 'PNP')).toBe(true);
  });

  it('rejects a mismatched agency', () => {
    expect(isCapable('SUNOG', 'PNP')).toBe(false);
    expect(isCapable('MEDIKAL', 'BFP')).toBe(false);
  });

  it('treats an agency-less (DRRM generalist) responder as capable of anything', () => {
    expect(isCapable('SUNOG', null)).toBe(true);
    expect(isCapable('BAHA', null)).toBe(true);
    expect(isCapable('KRIMEN', null)).toBe(true);
  });
});

describe('rankResponders', () => {
  it('ranks capable responders before incapable ones', () => {
    const ranked = rankResponders('SUNOG', incident, [
      candidate({ id: 'cop', agencyCode: 'PNP', base: { lat: 10.3158, lon: 123.8855 } }),
      candidate({ id: 'fire', agencyCode: 'BFP', base: { lat: 10.33, lon: 123.9 } }),
    ]);

    expect(ranked.map((s) => s.candidate.id)).toEqual(['fire', 'cop']);
    expect(ranked[0]?.capable).toBe(true);
    expect(ranked[1]?.capable).toBe(false);
  });

  it('ranks nearer before farther within the same capability band', () => {
    const ranked = rankResponders('SUNOG', incident, [
      candidate({ id: 'far', agencyCode: 'BFP', base: { lat: 10.4, lon: 123.95 } }),
      candidate({ id: 'near', agencyCode: 'BFP', base: { lat: 10.3158, lon: 123.8855 } }),
    ]);

    expect(ranked.map((s) => s.candidate.id)).toEqual(['near', 'far']);
    expect((ranked[0]?.distanceKm ?? Infinity) < (ranked[1]?.distanceKm ?? Infinity)).toBe(true);
  });

  it('sorts unknown-distance candidates last within their band', () => {
    const ranked = rankResponders('SUNOG', incident, [
      candidate({ id: 'nobody', agencyCode: 'BFP', base: null }),
      candidate({ id: 'located', agencyCode: 'BFP', base: { lat: 10.316, lon: 123.886 } }),
    ]);

    expect(ranked.map((s) => s.candidate.id)).toEqual(['located', 'nobody']);
    expect(ranked[1]?.distanceKm).toBeNull();
  });

  it('breaks exact ties by callsign for determinism', () => {
    const base = { lat: 10.3157, lon: 123.8854 };
    const ranked = rankResponders('BAHA', incident, [
      candidate({ id: 'bravo', callsign: 'BRAVO', base }),
      candidate({ id: 'alpha', callsign: 'ALPHA', base }),
    ]);

    expect(ranked.map((s) => s.candidate.callsign)).toEqual(['ALPHA', 'BRAVO']);
  });

  it('excludes non-responder roles (dispatchers/admins are not assignees)', () => {
    const ranked = rankResponders('MEDIKAL', incident, [
      candidate({ id: 'dispatcher', role: 'DISPATCHER', agencyCode: 'EMS' }),
      candidate({ id: 'admin', role: 'ADMIN' }),
      candidate({ id: 'medic', agencyCode: 'EMS', base: { lat: 10.316, lon: 123.886 } }),
    ]);

    expect(ranked.map((s) => s.candidate.id)).toEqual(['medic']);
  });

  it('returns an empty list when there are no responders', () => {
    expect(rankResponders('SUNOG', incident, [])).toEqual([]);
  });

  it('BAHA (flood) prefers DRRM generalists over any mismatched agency', () => {
    const ranked = rankResponders('BAHA', incident, [
      candidate({ id: 'cop', agencyCode: 'PNP', base: { lat: 10.316, lon: 123.886 } }),
      candidate({ id: 'rescue', agencyCode: null, base: { lat: 10.35, lon: 123.92 } }),
    ]);

    // rescue (generalist) is capable; cop (PNP) is not capable of BAHA.
    expect(ranked[0]?.candidate.id).toBe('rescue');
    expect(ranked[0]?.capable).toBe(true);
    expect(ranked[1]?.capable).toBe(false);
  });
});

describe('bestSuggestion', () => {
  it('returns the top-ranked suggestion', () => {
    const best = bestSuggestion('SUNOG', incident, [
      candidate({ id: 'far', agencyCode: 'BFP', base: { lat: 10.4, lon: 123.95 } }),
      candidate({ id: 'near', agencyCode: 'BFP', base: { lat: 10.3158, lon: 123.8855 } }),
    ]);

    expect(best?.candidate.id).toBe('near');
  });

  it('returns null when no candidate is rankable', () => {
    expect(bestSuggestion('SUNOG', incident, [candidate({ id: 'a', role: 'ADMIN' })])).toBeNull();
  });
});
