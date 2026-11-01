import type { AgencyType, EmergencyCategoryId } from '@aira/ui';
import { AGENCY_TYPES } from '@aira/ui';
import { describe, expect, it } from 'vitest';

import type { CapabilityConfig } from '../src/lib/platform/types';
import {
  DEFAULT_CAPABILITY_CONFIG,
  bestSuggestion,
  isCapable,
  rankResponders,
  type RoutingCandidate,
} from '../src/lib/routing';

const incident = { lat: 10.3157, lon: 123.8854 };

const cfg: CapabilityConfig = DEFAULT_CAPABILITY_CONFIG;

function candidate(overrides: Partial<RoutingCandidate> & { id: string }): RoutingCandidate {
  return {
    callsign: overrides.id.toUpperCase(),
    role: 'RESPONDER',
    officeId: 'office-1',
    officeName: 'Cebu City DRRMO',
    agencyType: null,
    agencyName: null,
    base: null,
    ...overrides,
  };
}

/** The legacy hardcoded capability map, encoded inline (default-equals-legacy, R6.3/R9.6). */
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

describe('DEFAULT_CAPABILITY_CONFIG', () => {
  it('deep-equals the frozen default map (R6.3/R9.7)', () => {
    expect(DEFAULT_CAPABILITY_CONFIG).toEqual({
      SUNOG: ['FIRE'],
      MEDIKAL: ['MEDICAL'],
      KRIMEN: ['POLICE'],
      BAHA: [],
    });
  });
});

describe('isCapable', () => {
  it('matches agency types to categories under the default config', () => {
    expect(isCapable('SUNOG', 'FIRE', cfg)).toBe(true);
    expect(isCapable('MEDIKAL', 'MEDICAL', cfg)).toBe(true);
    expect(isCapable('KRIMEN', 'POLICE', cfg)).toBe(true);
  });

  it('rejects a mismatched agency type', () => {
    expect(isCapable('SUNOG', 'POLICE', cfg)).toBe(false);
    expect(isCapable('MEDIKAL', 'FIRE', cfg)).toBe(false);
  });

  it('treats a null type (DRRM generalist) as capable of anything', () => {
    expect(isCapable('SUNOG', null, cfg)).toBe(true);
    expect(isCapable('BAHA', null, cfg)).toBe(true);
    expect(isCapable('KRIMEN', null, cfg)).toBe(true);
  });

  it('treats a type absent from a category set as not capable (empty BAHA set)', () => {
    expect(isCapable('BAHA', 'FIRE', cfg)).toBe(false);
    expect(isCapable('BAHA', 'POLICE', cfg)).toBe(false);
    expect(isCapable('BAHA', 'MEDICAL', cfg)).toBe(false);
  });

  it('never throws on an unknown/empty capability set', () => {
    const empty: CapabilityConfig = { SUNOG: [], MEDIKAL: [], KRIMEN: [], BAHA: [] };
    expect(() => isCapable('SUNOG', 'FIRE', empty)).not.toThrow();
    expect(isCapable('SUNOG', 'FIRE', empty)).toBe(false);
    expect(isCapable('SUNOG', null, empty)).toBe(true);
  });

  it('under DEFAULT_CAPABILITY_CONFIG reproduces the legacy decision for every (category, type) pair (R6.3/R9.6)', () => {
    const types: readonly (AgencyType | null)[] = [...AGENCY_TYPES, null];
    for (const category of FROZEN_CATEGORIES) {
      for (const type of types) {
        expect(isCapable(category, type, DEFAULT_CAPABILITY_CONFIG)).toBe(
          legacyIsCapable(category, type),
        );
      }
    }
  });
});

describe('rankResponders', () => {
  it('ranks capable responders before incapable ones', () => {
    const ranked = rankResponders(
      'SUNOG',
      incident,
      [
        candidate({ id: 'cop', agencyType: 'POLICE', base: { lat: 10.3158, lon: 123.8855 } }),
        candidate({ id: 'fire', agencyType: 'FIRE', base: { lat: 10.33, lon: 123.9 } }),
      ],
      cfg,
    );

    expect(ranked.map((s) => s.candidate.id)).toEqual(['fire', 'cop']);
    expect(ranked[0]?.capable).toBe(true);
    expect(ranked[1]?.capable).toBe(false);
  });

  it('ranks nearer before farther within the same capability band', () => {
    const ranked = rankResponders(
      'SUNOG',
      incident,
      [
        candidate({ id: 'far', agencyType: 'FIRE', base: { lat: 10.4, lon: 123.95 } }),
        candidate({ id: 'near', agencyType: 'FIRE', base: { lat: 10.3158, lon: 123.8855 } }),
      ],
      cfg,
    );

    expect(ranked.map((s) => s.candidate.id)).toEqual(['near', 'far']);
    expect((ranked[0]?.distanceKm ?? Infinity) < (ranked[1]?.distanceKm ?? Infinity)).toBe(true);
  });

  it('sorts unknown-distance candidates last within their band', () => {
    const ranked = rankResponders(
      'SUNOG',
      incident,
      [
        candidate({ id: 'nobody', agencyType: 'FIRE', base: null }),
        candidate({ id: 'located', agencyType: 'FIRE', base: { lat: 10.316, lon: 123.886 } }),
      ],
      cfg,
    );

    expect(ranked.map((s) => s.candidate.id)).toEqual(['located', 'nobody']);
    expect(ranked[1]?.distanceKm).toBeNull();
  });

  it('breaks exact ties by callsign for determinism', () => {
    const base = { lat: 10.3157, lon: 123.8854 };
    const ranked = rankResponders(
      'BAHA',
      incident,
      [
        candidate({ id: 'bravo', callsign: 'BRAVO', base }),
        candidate({ id: 'alpha', callsign: 'ALPHA', base }),
      ],
      cfg,
    );

    expect(ranked.map((s) => s.candidate.callsign)).toEqual(['ALPHA', 'BRAVO']);
  });

  it('excludes non-responder roles (dispatchers/admins are not assignees)', () => {
    const ranked = rankResponders(
      'MEDIKAL',
      incident,
      [
        candidate({ id: 'dispatcher', role: 'DISPATCHER', agencyType: 'MEDICAL' }),
        candidate({ id: 'admin', role: 'ADMIN' }),
        candidate({ id: 'medic', agencyType: 'MEDICAL', base: { lat: 10.316, lon: 123.886 } }),
      ],
      cfg,
    );

    expect(ranked.map((s) => s.candidate.id)).toEqual(['medic']);
  });

  it('returns an empty list when there are no responders', () => {
    expect(rankResponders('SUNOG', incident, [], cfg)).toEqual([]);
  });

  it('BAHA (flood) prefers DRRM generalists over any mismatched agency', () => {
    const ranked = rankResponders(
      'BAHA',
      incident,
      [
        candidate({ id: 'cop', agencyType: 'POLICE', base: { lat: 10.316, lon: 123.886 } }),
        candidate({ id: 'rescue', agencyType: null, base: { lat: 10.35, lon: 123.92 } }),
      ],
      cfg,
    );

    // rescue (generalist) is capable; cop (POLICE) is not capable of BAHA.
    expect(ranked[0]?.candidate.id).toBe('rescue');
    expect(ranked[0]?.capable).toBe(true);
    expect(ranked[1]?.capable).toBe(false);
  });

  it('ranks a candidate whose type is not in the category set as non-capable, not a throw (R6.6)', () => {
    const ranked = rankResponders(
      'KRIMEN',
      incident,
      [candidate({ id: 'medic', agencyType: 'MEDICAL', base: { lat: 10.316, lon: 123.886 } })],
      cfg,
    );

    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.capable).toBe(false);
  });

  it('is pure: identical inputs yield identical output and inputs are not mutated (R6.7)', () => {
    const candidates: readonly RoutingCandidate[] = Object.freeze([
      candidate({ id: 'fire', agencyType: 'FIRE', base: { lat: 10.4, lon: 123.95 } }),
      candidate({ id: 'cop', agencyType: 'POLICE', base: { lat: 10.3158, lon: 123.8855 } }),
    ]);
    const frozenCfg: CapabilityConfig = Object.freeze({
      SUNOG: Object.freeze(['FIRE']),
      MEDIKAL: Object.freeze(['MEDICAL']),
      KRIMEN: Object.freeze(['POLICE']),
      BAHA: Object.freeze([]),
    }) as CapabilityConfig;

    const first = rankResponders('SUNOG', incident, candidates, frozenCfg);
    const second = rankResponders('SUNOG', incident, candidates, frozenCfg);

    expect(first.map((s) => s.candidate.id)).toEqual(second.map((s) => s.candidate.id));
    expect(first.map((s) => s.capable)).toEqual(second.map((s) => s.capable));
    expect(first.map((s) => s.distanceKm)).toEqual(second.map((s) => s.distanceKm));
    // Inputs untouched: the frozen array still has its original order.
    expect(candidates.map((c) => c.id)).toEqual(['fire', 'cop']);
  });
});

describe('bestSuggestion', () => {
  it('returns the top-ranked suggestion', () => {
    const best = bestSuggestion(
      'SUNOG',
      incident,
      [
        candidate({ id: 'far', agencyType: 'FIRE', base: { lat: 10.4, lon: 123.95 } }),
        candidate({ id: 'near', agencyType: 'FIRE', base: { lat: 10.3158, lon: 123.8855 } }),
      ],
      cfg,
    );

    expect(best?.candidate.id).toBe('near');
  });

  it('returns null when no candidate is rankable', () => {
    expect(
      bestSuggestion('SUNOG', incident, [candidate({ id: 'a', role: 'ADMIN' })], cfg),
    ).toBeNull();
  });
});
