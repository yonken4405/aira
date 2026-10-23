/**
 * @vitest-environment node
 *
 * Nationwide office-pin client: parsing + the pure filter/region helpers that drive the
 * operator map (region filter + name/tenant search).
 */

import { describe, expect, it } from 'vitest';

import {
  filterPins,
  parseOfficePins,
  regionsOf,
  type OfficePinView,
} from '../src/lib/platform-client';

function pin(overrides: Partial<OfficePinView> & { readonly id: string }): OfficePinView {
  return {
    tenantId: 'tenant-1',
    tenantName: 'Cebu City DRRMO',
    name: 'Cebu City DRRMO',
    kind: 'LGU',
    region: 'Region VII',
    province: 'Cebu',
    lat: 10.3157,
    lon: 123.8854,
    status: 'active',
    ...overrides,
  };
}

const PINS: readonly OfficePinView[] = [
  pin({ id: 'a', name: 'Cebu City DRRMO', region: 'Region VII', province: 'Cebu' }),
  pin({
    id: 'b',
    name: 'Davao City DRRMO',
    tenantName: 'Davao City DRRMO',
    region: 'Region XI',
    province: 'Davao del Sur',
  }),
  pin({
    id: 'c',
    name: 'Barangay Lahug',
    region: 'Region VII',
    province: 'Cebu',
    kind: 'BARANGAY',
  }),
];

describe('parseOfficePins', () => {
  it('parses valid pins and drops malformed ones', () => {
    const parsed = parseOfficePins({
      offices: [
        {
          id: 'x',
          tenantId: 't',
          tenantName: 'T',
          name: 'X',
          kind: 'LGU',
          region: 'R',
          province: 'P',
          lat: 1,
          lon: 2,
          status: 'active',
        },
        { id: 'bad' }, // missing required fields
        'nope',
      ],
    });
    expect(parsed.map((p) => p.id)).toEqual(['x']);
  });

  it('throws on a malformed envelope', () => {
    expect(() => parseOfficePins({})).toThrow(/invalid_offices_response/);
  });
});

describe('regionsOf', () => {
  it('returns distinct sorted regions', () => {
    expect(regionsOf(PINS)).toEqual(['Region VII', 'Region XI']);
  });
});

describe('filterPins', () => {
  it('filters by region', () => {
    expect(filterPins(PINS, { region: 'Region XI' }).map((p) => p.id)).toEqual(['b']);
  });

  it('searches by office name, tenant and province (case-insensitive)', () => {
    expect(filterPins(PINS, { search: 'davao' }).map((p) => p.id)).toEqual(['b']);
    expect(filterPins(PINS, { search: 'LAHUG' }).map((p) => p.id)).toEqual(['c']);
    expect(
      filterPins(PINS, { search: 'cebu' })
        .map((p) => p.id)
        .sort(),
    ).toEqual(['a', 'c']);
  });

  it('combines region + search', () => {
    expect(filterPins(PINS, { region: 'Region VII', search: 'barangay' }).map((p) => p.id)).toEqual(
      ['c'],
    );
  });

  it('returns all pins with no filter', () => {
    expect(filterPins(PINS, {})).toHaveLength(3);
  });
});
