import type { AgencyType, EmergencyCategoryId } from '@aira/ui';
import { AGENCY_TYPES } from '@aira/ui';
import { describe, expect, it } from 'vitest';

import {
  CATEGORY_AGENCY_DEFAULT,
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
    agencyId: null,
    agencyType: null,
    agencyName: null,
    base: null,
    coversIncidentOffice: false,
    ...overrides,
  };
}

/** The legacy hardcoded capability map, encoded inline (default-equals-legacy, R6.3/R9.3). */
const LEGACY_CAPABILITY: Readonly<Record<EmergencyCategoryId, readonly AgencyType[]>> = {
  SUNOG: ['FIRE'],
  MEDIKAL: ['MEDICAL'],
  KRIMEN: ['POLICE'],
  BAHA: [],
};

const FROZEN_CATEGORIES: readonly EmergencyCategoryId[] = ['SUNOG', 'MEDIKAL', 'KRIMEN', 'BAHA'];

/** The legacy decision: null is always capable; otherwise the type must be in the set. */
function legacyIsCapable(category: EmergencyCategoryId, type: AgencyType | null): boolean {
  if (type === null) {
    return true;
  }
  return LEGACY_CAPABILITY[category].includes(type);
}

describe('CATEGORY_AGENCY_DEFAULT', () => {
  it('deep-equals the frozen default map (R6.2/R9.3)', () => {
    expect(CATEGORY_AGENCY_DEFAULT).toEqual({
      SUNOG: ['FIRE'],
      MEDIKAL: ['MEDICAL'],
      KRIMEN: ['POLICE'],
      BAHA: [],
    });
  });
});

describe('isCapable', () => {
  it('matches agency types to categories under the fixed map', () => {
    expect(isCapable('SUNOG', 'FIRE')).toBe(true);
    expect(isCapable('MEDIKAL', 'MEDICAL')).toBe(true);
    expect(isCapable('KRIMEN', 'POLICE')).toBe(true);
  });

  it('rejects a mismatched agency type', () => {
    expect(isCapable('SUNOG', 'POLICE')).toBe(false);
    expect(isCapable('MEDIKAL', 'FIRE')).toBe(false);
  });

  it('treats a null type (DRRM generalist) as capable of anything', () => {
    expect(isCapable('SUNOG', null)).toBe(true);
    expect(isCapable('BAHA', null)).toBe(true);
    expect(isCapable('KRIMEN', null)).toBe(true);
  });

  it('treats a type absent from a category set as not capable (empty BAHA set)', () => {
    expect(isCapable('BAHA', 'FIRE')).toBe(false);
    expect(isCapable('BAHA', 'POLICE')).toBe(false);
    expect(isCapable('BAHA', 'MEDICAL')).toBe(false);
  });

  it('never throws on an empty category set', () => {
    expect(() => isCapable('BAHA', 'FIRE')).not.toThrow();
    expect(isCapable('BAHA', 'FIRE')).toBe(false);
    expect(isCapable('BAHA', null)).toBe(true);
  });

  it('reproduces the legacy decision for every (category, type) pair (R6.2/R9.3)', () => {
    const types: readonly (AgencyType | null)[] = [...AGENCY_TYPES, null];
    for (const category of FROZEN_CATEGORIES) {
      for (const type of types) {
        expect(isCapable(category, type)).toBe(legacyIsCapable(category, type));
      }
    }
  });
});

describe('rankResponders', () => {
  it('ranks capable responders before incapable ones', () => {
    const ranked = rankResponders('SUNOG', incident, [
      candidate({ id: 'cop', agencyType: 'POLICE', base: { lat: 10.3158, lon: 123.8855 } }),
      candidate({ id: 'fire', agencyType: 'FIRE', base: { lat: 10.33, lon: 123.9 } }),
    ]);

    expect(ranked.map((s) => s.candidate.id)).toEqual(['fire', 'cop']);
    expect(ranked[0]?.capable).toBe(true);
    expect(ranked[1]?.capable).toBe(false);
  });

  it('ranks nearer before farther within the same capability band', () => {
    const ranked = rankResponders('SUNOG', incident, [
      candidate({ id: 'far', agencyType: 'FIRE', base: { lat: 10.4, lon: 123.95 } }),
      candidate({ id: 'near', agencyType: 'FIRE', base: { lat: 10.3158, lon: 123.8855 } }),
    ]);

    expect(ranked.map((s) => s.candidate.id)).toEqual(['near', 'far']);
    expect((ranked[0]?.distanceKm ?? Infinity) < (ranked[1]?.distanceKm ?? Infinity)).toBe(true);
  });

  it('sorts unknown-distance candidates last within their band', () => {
    const ranked = rankResponders('SUNOG', incident, [
      candidate({ id: 'nobody', agencyType: 'FIRE', base: null }),
      candidate({ id: 'located', agencyType: 'FIRE', base: { lat: 10.316, lon: 123.886 } }),
    ]);

    expect(ranked.map((s) => s.candidate.id)).toEqual(['located', 'nobody']);
    expect(ranked[1]?.distanceKm).toBeNull();
  });

  it('ranks a covering candidate before an equally-distant non-covering one (R5.3/R5.4)', () => {
    const base = { lat: 10.3157, lon: 123.8854 };
    const ranked = rankResponders('SUNOG', incident, [
      candidate({ id: 'outside', agencyType: 'FIRE', base, coversIncidentOffice: false }),
      candidate({ id: 'covers', agencyType: 'FIRE', base, coversIncidentOffice: true }),
    ]);

    expect(ranked.map((s) => s.candidate.id)).toEqual(['covers', 'outside']);
  });

  it('still includes non-covering candidates, ranked below covering ones (R5.4)', () => {
    const near = { lat: 10.3158, lon: 123.8855 };
    const far = { lat: 10.4, lon: 123.95 };
    const ranked = rankResponders('SUNOG', incident, [
      candidate({
        id: 'near-outside',
        agencyType: 'FIRE',
        base: near,
        coversIncidentOffice: false,
      }),
      candidate({ id: 'far-covers', agencyType: 'FIRE', base: far, coversIncidentOffice: true }),
    ]);

    // Covering wins over nearer: coverage is a higher sort tier than distance.
    expect(ranked.map((s) => s.candidate.id)).toEqual(['far-covers', 'near-outside']);
    expect(ranked).toHaveLength(2);
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
      candidate({ id: 'dispatcher', role: 'DISPATCHER', agencyType: 'MEDICAL' }),
      candidate({ id: 'admin', role: 'ADMIN' }),
      candidate({ id: 'agencyAdmin', role: 'AGENCY_ADMIN', agencyType: 'MEDICAL' }),
      candidate({ id: 'medic', agencyType: 'MEDICAL', base: { lat: 10.316, lon: 123.886 } }),
    ]);

    expect(ranked.map((s) => s.candidate.id)).toEqual(['medic']);
  });

  it('returns an empty list when there are no responders', () => {
    expect(rankResponders('SUNOG', incident, [])).toEqual([]);
  });

  it('BAHA (flood) prefers DRRM generalists over any mismatched agency', () => {
    const ranked = rankResponders('BAHA', incident, [
      candidate({ id: 'cop', agencyType: 'POLICE', base: { lat: 10.316, lon: 123.886 } }),
      candidate({ id: 'rescue', agencyType: null, base: { lat: 10.35, lon: 123.92 } }),
    ]);

    // rescue (generalist) is capable; cop (POLICE) is not capable of BAHA.
    expect(ranked[0]?.candidate.id).toBe('rescue');
    expect(ranked[0]?.capable).toBe(true);
    expect(ranked[1]?.capable).toBe(false);
  });

  it('ranks a candidate whose type is not in the category set as non-capable, not a throw (R6.7)', () => {
    const ranked = rankResponders('KRIMEN', incident, [
      candidate({ id: 'medic', agencyType: 'MEDICAL', base: { lat: 10.316, lon: 123.886 } }),
    ]);

    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.capable).toBe(false);
  });

  it('is pure: identical inputs yield identical output and inputs are not mutated (R6.7)', () => {
    const candidates: readonly RoutingCandidate[] = Object.freeze([
      candidate({ id: 'fire', agencyType: 'FIRE', base: { lat: 10.4, lon: 123.95 } }),
      candidate({ id: 'cop', agencyType: 'POLICE', base: { lat: 10.3158, lon: 123.8855 } }),
    ]);

    const first = rankResponders('SUNOG', incident, candidates);
    const second = rankResponders('SUNOG', incident, candidates);

    expect(first.map((s) => s.candidate.id)).toEqual(second.map((s) => s.candidate.id));
    expect(first.map((s) => s.capable)).toEqual(second.map((s) => s.capable));
    expect(first.map((s) => s.distanceKm)).toEqual(second.map((s) => s.distanceKm));
    // Inputs untouched: the frozen array still has its original order.
    expect(candidates.map((c) => c.id)).toEqual(['fire', 'cop']);
  });
});

describe('bestSuggestion', () => {
  it('returns the top-ranked suggestion', () => {
    const best = bestSuggestion('SUNOG', incident, [
      candidate({ id: 'far', agencyType: 'FIRE', base: { lat: 10.4, lon: 123.95 } }),
      candidate({ id: 'near', agencyType: 'FIRE', base: { lat: 10.3158, lon: 123.8855 } }),
    ]);

    expect(best?.candidate.id).toBe('near');
  });

  it('returns null when no candidate is rankable', () => {
    expect(bestSuggestion('SUNOG', incident, [candidate({ id: 'a', role: 'ADMIN' })])).toBeNull();
  });
});
