import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { validateMedicalDraft, type MedicalDraft } from './validateMedicalDraft';
import { MEDICAL_BOUNDS, BLOOD_TYPES, AGE_BANDS } from './medicalBounds';

// Feature: mobile-citizen-account, Property 10: Client validation accepts a draft iff within the
// mirrored bounds, and rejection blocks the PUT
//
// Validates: Requirements 7.4, 7.5, 7.7, 8.4
//
// `validateMedicalDraft` is the sole client-side gate before `PUT /api/citizen/medical`: the UI
// sends the PUT only when `valid === true` (R7.7 / R8.4). So proving the function accepts a draft
// *exactly* when it is within every mirrored bound proves both halves of Property 10 — acceptance
// iff in-bounds, and that any out-of-bounds draft is rejected (and therefore the PUT is blocked).
//
// Strategy: generate `MedicalDraft` values that span BOTH within-bounds and out-of-bounds in every
// dimension — blood type / age band drawn from the valid closed set plus an invalid sentinel; each
// list length 0..MAX_ITEMS+2 with entries around MAX_ITEM_LEN; notes around MAX_NOTES_LEN; contacts
// 0..MAX_CONTACTS+2 with names / phones / relations around their limits and sometimes empty. Then we
// assert the function's `valid` verdict equals an independent reference predicate computed straight
// from MEDICAL_BOUNDS (the spec rules), never from the implementation.

const {
  MAX_ITEMS,
  MAX_ITEM_LEN,
  MAX_NOTES_LEN,
  MAX_CONTACTS,
  MAX_NAME_LEN,
  MAX_PHONE_LEN,
  MAX_RELATION_LEN,
} = MEDICAL_BOUNDS;

// An invalid blood-type / age-band sentinel that is guaranteed not in the closed set.
const INVALID_BLOOD = 'XYZ';
const INVALID_AGE = '999';

/** A string whose length straddles `limit`: sometimes within, sometimes over by a little. */
const strAround = (limit: number): fc.Arbitrary<string> =>
  fc.integer({ min: 0, max: limit + 3 }).map((len) => 'x'.repeat(len));

/** A non-empty-biased string that straddles `limit` and can also be empty. */
const fieldAround = (limit: number): fc.Arbitrary<string> =>
  fc.oneof(fc.constant(''), strAround(limit));

const listAround = (): fc.Arbitrary<string[]> =>
  fc.array(strAround(MAX_ITEM_LEN), { minLength: 0, maxLength: MAX_ITEMS + 2 });

const contactAround = (): fc.Arbitrary<MedicalDraft['contacts'][number]> =>
  fc.record({
    name: fieldAround(MAX_NAME_LEN),
    phone: fieldAround(MAX_PHONE_LEN),
    relation: fc.oneof(fc.constant(null), strAround(MAX_RELATION_LEN)),
  });

const draftArb: fc.Arbitrary<MedicalDraft> = fc.record({
  bloodType: fc.constantFrom<string | null>(...BLOOD_TYPES, INVALID_BLOOD, null) as fc.Arbitrary<
    MedicalDraft['bloodType']
  >,
  ageBand: fc.constantFrom<string | null>(...AGE_BANDS, INVALID_AGE, null) as fc.Arbitrary<
    MedicalDraft['ageBand']
  >,
  allergies: listAround(),
  conditions: listAround(),
  medications: listAround(),
  notes: fc.oneof(fc.constant(null), strAround(MAX_NOTES_LEN)),
  contacts: fc.array(contactAround(), { minLength: 0, maxLength: MAX_CONTACTS + 2 }),
});

// Reference predicate derived straight from MEDICAL_BOUNDS / the closed enums — mirrors the spec
// rules (R7.7, R8.4), independent of the implementation.
const listInBounds = (list: readonly string[]): boolean =>
  list.length <= MAX_ITEMS && list.every((e) => e.length <= MAX_ITEM_LEN);

const contactInBounds = (c: MedicalDraft['contacts'][number]): boolean =>
  c.name.length > 0 &&
  c.name.length <= MAX_NAME_LEN &&
  c.phone.length > 0 &&
  c.phone.length <= MAX_PHONE_LEN &&
  (c.relation === null || c.relation.length <= MAX_RELATION_LEN);

const referenceValid = (d: MedicalDraft): boolean =>
  (d.bloodType === null || (BLOOD_TYPES as readonly string[]).includes(d.bloodType)) &&
  (d.ageBand === null || (AGE_BANDS as readonly string[]).includes(d.ageBand)) &&
  listInBounds(d.allergies) &&
  listInBounds(d.conditions) &&
  listInBounds(d.medications) &&
  (d.notes === null || d.notes.length <= MAX_NOTES_LEN) &&
  d.contacts.length <= MAX_CONTACTS &&
  d.contacts.every(contactInBounds);

describe('Property 10: validation accepts iff within bounds, and gates the PUT (R7.4, R7.5, R7.7, R8.4)', () => {
  it('validateMedicalDraft(draft).valid equals the in-bounds reference predicate for every draft', () => {
    fc.assert(
      fc.property(draftArb, (draft) => {
        expect(validateMedicalDraft(draft).valid).toBe(referenceValid(draft));
      }),
      { numRuns: 100 },
    );
  });
});
