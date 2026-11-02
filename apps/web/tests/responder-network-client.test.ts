/**
 * @vitest-environment node
 *
 * Responder-network client parse-at-boundary helpers (mirrors `platform-client.test.ts`):
 *   - parseAgencies            → the operator agency roster (`{ agencies: [...] }` envelope)
 *   - parseCapabilityConfig    → the TOTAL four-key category→agency-type map (`{ capability }`)
 *   - parseProvisionResult     → the provision-responder success envelope (`{ responder, password }`)
 *
 * These helpers are added to `src/lib/platform-client.ts` by task 11.2; this `.1`
 * sub-task writes the FAILING (RED) tests only. Every expectation is aligned to the
 * REAL server envelope keys returned by the platform handlers and to the REAL domain
 * types (`AgencyRecord`, `CapabilityConfig`, `ResponderRecord`). Zero coordinates,
 * zero PII beyond identity — Agency_Type tokens are identifiers, never display text.
 */

import { describe, expect, it } from 'vitest';

import { AGENCY_TYPES, type AgencyType, type EmergencyCategoryId } from '@aira/ui';

import {
  parseAgencies,
  parseCapabilityConfig,
  parseProvisionResult,
} from '../src/lib/platform-client';

// ── Factory helpers (mirror the `pin()` factory in platform-client.test.ts) ─────

/** A well-formed `AgencyRecord` row as the server serializes it. */
function agencyRow(
  overrides: Partial<{
    id: string;
    tenantId: string;
    name: string;
    code: string;
    agencyType: AgencyType;
    active: boolean;
  }> & { readonly id: string },
): Record<string, unknown> {
  return {
    tenantId: 'tenant-1',
    name: 'Bureau of Fire',
    code: 'BFP',
    agencyType: 'FIRE',
    active: true,
    ...overrides,
  };
}

/** The four frozen emergency categories, in wire order. */
const CATEGORIES: readonly EmergencyCategoryId[] = ['SUNOG', 'MEDIKAL', 'KRIMEN', 'BAHA'];

// ═══════════════════════════════════════════════════════════════════════════════
// parseAgencies — `{ agencies: AgencyRecord[] }`
// ═══════════════════════════════════════════════════════════════════════════════

describe('parseAgencies', () => {
  it('parses valid agency rows and drops malformed ones', () => {
    const parsed = parseAgencies({
      agencies: [
        agencyRow({ id: 'a', name: 'Fire Dept', code: 'FD', agencyType: 'FIRE' }),
        agencyRow({
          id: 'b',
          name: 'Police Dept',
          code: 'PD',
          agencyType: 'POLICE',
          active: false,
        }),
        { id: 'missing-fields' }, // missing name/code/agencyType/tenantId
        { ...agencyRow({ id: 'bad-type' }), agencyType: 'NINJA' }, // type outside taxonomy
        'nope', // not an object
      ],
    });

    expect(parsed.map((a) => a.id)).toEqual(['a', 'b']);
  });

  it('returns a typed AgencyRecord with every field preserved', () => {
    const [agency] = parseAgencies({
      agencies: [
        agencyRow({ id: 'x', name: 'Fire X', code: 'FX', agencyType: 'MEDICAL', active: false }),
      ],
    });

    expect(agency).toEqual({
      id: 'x',
      tenantId: 'tenant-1',
      name: 'Fire X',
      code: 'FX',
      agencyType: 'MEDICAL',
      active: false,
    });
  });

  it('keeps every row that carries a taxonomy agencyType', () => {
    const parsed = parseAgencies({
      agencies: AGENCY_TYPES.map((agencyType, index) =>
        agencyRow({ id: `agency-${index}`, code: `C${index}`, agencyType }),
      ),
    });

    expect(parsed.map((a) => a.agencyType)).toEqual([...AGENCY_TYPES]);
  });

  it('returns an empty array when the tenant has no agencies', () => {
    expect(parseAgencies({ agencies: [] })).toEqual([]);
  });

  it('throws on a malformed envelope', () => {
    expect(() => parseAgencies({})).toThrow(/invalid_agencies_response/);
    expect(() => parseAgencies({ agencies: 'not-an-array' })).toThrow(/invalid_agencies_response/);
    expect(() => parseAgencies(null)).toThrow(/invalid_agencies_response/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// parseCapabilityConfig — `{ capability: CapabilityConfig }` (TOTAL four-key map)
// ═══════════════════════════════════════════════════════════════════════════════

describe('parseCapabilityConfig', () => {
  it('parses a full capability map keyed by the four frozen categories', () => {
    const config = parseCapabilityConfig({
      capability: {
        SUNOG: ['FIRE', 'DRRM'],
        MEDIKAL: ['MEDICAL'],
        KRIMEN: ['POLICE'],
        BAHA: ['DRRM'],
      },
    });

    expect(config.SUNOG).toEqual(['FIRE', 'DRRM']);
    expect(config.MEDIKAL).toEqual(['MEDICAL']);
    expect(config.KRIMEN).toEqual(['POLICE']);
    expect(config.BAHA).toEqual(['DRRM']);
  });

  it('guarantees a TOTAL four-key map, filling absent categories with []', () => {
    const config = parseCapabilityConfig({
      capability: { SUNOG: ['FIRE'] }, // only one category present
    });

    expect(Object.keys(config).sort()).toEqual([...CATEGORIES].sort());
    expect(config.SUNOG).toEqual(['FIRE']);
    expect(config.MEDIKAL).toEqual([]);
    expect(config.KRIMEN).toEqual([]);
    expect(config.BAHA).toEqual([]);
  });

  it('filters out non-taxonomy agency types within a category', () => {
    const config = parseCapabilityConfig({
      capability: {
        SUNOG: ['FIRE', 'NINJA', 'DRRM', 42, null],
        MEDIKAL: [],
        KRIMEN: [],
        BAHA: [],
      },
    });

    expect(config.SUNOG).toEqual(['FIRE', 'DRRM']);
  });

  it('every category value is an array of taxonomy agency types', () => {
    const config = parseCapabilityConfig({
      capability: {
        SUNOG: ['FIRE'],
        MEDIKAL: ['MEDICAL'],
        KRIMEN: ['POLICE'],
        BAHA: [],
      },
    });

    for (const category of CATEGORIES) {
      expect(Array.isArray(config[category])).toBe(true);
      for (const type of config[category]) {
        expect(AGENCY_TYPES).toContain(type);
      }
    }
  });

  it('throws on a malformed envelope', () => {
    expect(() => parseCapabilityConfig({})).toThrow(/invalid_capability_response/);
    expect(() => parseCapabilityConfig({ capability: 'nope' })).toThrow(
      /invalid_capability_response/,
    );
    expect(() => parseCapabilityConfig(null)).toThrow(/invalid_capability_response/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// parseProvisionResult — `{ responder: ResponderRecord, password: string }`
// ═══════════════════════════════════════════════════════════════════════════════

describe('parseProvisionResult', () => {
  /** A well-formed provision-success envelope as the handler serializes it. */
  function provisionEnvelope(
    overrides: Partial<{ responder: Record<string, unknown>; password: string }> = {},
  ): Record<string, unknown> {
    return {
      ok: true,
      email: 'responder@eta2.ph',
      password: 'one-time-secret',
      responder: {
        id: 'resp-1',
        email: 'responder@eta2.ph',
        callsign: 'ETA-1',
        agencyId: null,
      },
      ...overrides,
    };
  }

  it('parses the responder identity + one-time password', () => {
    const result = parseProvisionResult(provisionEnvelope());

    expect(result.password).toBe('one-time-secret');
    expect(result.responder.id).toBe('resp-1');
    expect(result.responder.email).toBe('responder@eta2.ph');
    expect(result.responder.callsign).toBe('ETA-1');
    expect(result.responder.agencyId).toBeNull();
  });

  it('accepts a null callsign (optional display label)', () => {
    const result = parseProvisionResult(
      provisionEnvelope({
        responder: { id: 'r2', email: 'x@y.ph', callsign: null, agencyId: null },
      }),
    );

    expect(result.responder.callsign).toBeNull();
  });

  it('throws when the password is missing or blank', () => {
    expect(() => parseProvisionResult({ ...provisionEnvelope(), password: '' })).toThrow(
      /invalid_provision_response/,
    );
    const noPassword = provisionEnvelope();
    delete noPassword.password;
    expect(() => parseProvisionResult(noPassword)).toThrow(/invalid_provision_response/);
  });

  it('throws when the responder identity is malformed', () => {
    expect(() =>
      parseProvisionResult({ ...provisionEnvelope(), responder: { id: 'only-id' } }),
    ).toThrow(/invalid_provision_response/);
  });

  it('throws on a malformed envelope', () => {
    expect(() => parseProvisionResult({})).toThrow(/invalid_provision_response/);
    expect(() => parseProvisionResult(null)).toThrow(/invalid_provision_response/);
  });

  it('carries no coordinates in the parsed identity', () => {
    const result = parseProvisionResult(provisionEnvelope());
    const serialized = JSON.stringify(result);
    expect(/\d{1,3}\.\d{4}/.test(serialized)).toBe(false);
  });
});
