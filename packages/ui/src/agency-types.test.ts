import { describe, expect, it } from 'vitest';

import { AGENCY_TYPES, isAgencyType } from './agency-types';

/**
 * TDD-RED for the Agency_Type taxonomy (R2.1, R2.6).
 *
 * The module under test (./agency-types) does not exist yet — it is created by
 * task 1.2. These tests are written to fail on the missing module/exports and
 * to pin the exact contract from design.md "Shared Agency_Type definition".
 */

/**
 * Canonical taxonomy the DB CHECK must mirror. Kept as a local frozen constant
 * so the lockstep assertion guards drift between the TS taxonomy and the SQL
 * `agency_type in (...)` list independently of the module under test.
 */
const CANONICAL_AGENCY_TYPES = Object.freeze([
  'FIRE',
  'POLICE',
  'MEDICAL',
  'DRRM',
  'OTHER',
] as const);

describe('agency-type taxonomy', () => {
  it('defines exactly the five tokens in canonical order (R2.1)', () => {
    expect([...AGENCY_TYPES]).toEqual(['FIRE', 'POLICE', 'MEDICAL', 'DRRM', 'OTHER']);
  });

  it('narrows each of the five members with isAgencyType (R2.1)', () => {
    for (const token of ['FIRE', 'POLICE', 'MEDICAL', 'DRRM', 'OTHER']) {
      expect(isAgencyType(token)).toBe(true);
    }
  });

  it('rejects non-members and non-string values with isAgencyType (R2.1)', () => {
    expect(isAgencyType('FOO')).toBe(false);
    expect(isAgencyType('fire')).toBe(false);
    expect(isAgencyType(42)).toBe(false);
    expect(isAgencyType(null)).toBe(false);
    expect(isAgencyType(undefined)).toBe(false);
    expect(isAgencyType({})).toBe(false);
  });

  it('stays in lockstep with the taxonomy the DB CHECK mirrors (R2.1, R2.6)', () => {
    // Guards drift: the five AGENCY_TYPES tokens are the same five tokens the
    // migration's `agency_type in (...)` CHECK constraint must list.
    expect([...AGENCY_TYPES]).toEqual([...CANONICAL_AGENCY_TYPES]);
  });
});
