import { describe, expect, it } from 'vitest';

// TDD red (task 2.4): this module does not exist yet. Task 2.5 creates
// `packages/ui/src/citizen/validateMedicalDraft.ts` exporting the `MedicalDraft` /
// `EmergencyContactDraft` types, the `ValidationResult` shape, and the pure
// `validateMedicalDraft(draft)` function. Until then this import fails to resolve and the
// whole suite is red — which is the intended failure for this task.
import {
  validateMedicalDraft,
  type MedicalDraft,
  type EmergencyContactDraft,
  type ValidationResult,
} from './validateMedicalDraft';

// Bounds + closed enums are already implemented (task 2.2). Boundary cases below are DERIVED
// from these constants so the test can never drift from the mirrored bounds (R7.7, R8.5).
import { MEDICAL_BOUNDS, BLOOD_TYPES, AGE_BANDS } from './medicalBounds';

/**
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * PINNED CONTRACT — task 2.5 MUST implement `validateMedicalDraft` to exactly this shape.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 *
 * Signature:
 *   validateMedicalDraft(draft: MedicalDraft): ValidationResult
 *
 * `validateMedicalDraft` is a PURE function (no I/O, no mutation of `draft`). It returns a
 * `ValidationResult` whose `valid` flag is `true` **iff** the draft is within every mirrored
 * bound (Property 10). On failure it returns per-field copy keys so the UI can highlight the
 * offending field(s) — a profile-field issue uses `citizenMedicalInvalid`, a contact issue
 * uses `citizenContactInvalid` (R7.7, R8.4).
 *
 * ValidationResult shape (per-field error map + positional per-contact array):
 *
 *   type MedicalField = 'bloodType' | 'ageBand' | 'allergies' | 'conditions'
 *                     | 'medications' | 'notes' | 'contacts';
 *
 *   interface ValidationResult {
 *     readonly valid: boolean;
 *     readonly errors: {
 *       // Present only for profile fields that failed. Each value is the copy key
 *       // `citizenMedicalInvalid`. Absent keys mean that field is OK. For a fully valid
 *       // draft `fields` is an empty object `{}`.
 *       readonly fields: Partial<Record<MedicalField, 'citizenMedicalInvalid'>>;
 *       // One entry PER contact in `draft.contacts`, in order. `null` means that contact is
 *       // OK; `'citizenContactInvalid'` means that contact failed (empty/over-long name,
 *       // empty/over-long phone, or over-long relation). Length === draft.contacts.length.
 *       // An over-count of contacts (> MAX_CONTACTS) ALSO sets fields.contacts.
 *       readonly contacts: ReadonlyArray<'citizenContactInvalid' | null>;
 *     };
 *   }
 *
 * Validity rules (a draft is VALID iff ALL hold):
 *   - bloodType ∈ BLOOD_TYPES ∪ {null}; any other value ⇒ fields.bloodType.
 *   - ageBand   ∈ AGE_BANDS   ∪ {null}; any other value ⇒ fields.ageBand.
 *   - allergies / conditions / medications: ≤ MAX_ITEMS entries, each entry ≤ MAX_ITEM_LEN
 *     chars. Over-count or any over-length entry ⇒ fields.<list>.
 *   - notes: null OR length ≤ MAX_NOTES_LEN. Over ⇒ fields.notes.
 *   - contacts: ≤ MAX_CONTACTS entries. Each contact: non-empty name ≤ MAX_NAME_LEN,
 *     non-empty phone ≤ MAX_PHONE_LEN, relation (if non-null) ≤ MAX_RELATION_LEN. A bad
 *     contact ⇒ its positional entry = 'citizenContactInvalid'. Over-count ⇒ fields.contacts.
 *   - The empty/default draft (all null / empty lists / no contacts) is VALID (R7.2).
 *
 * `valid === true` ⟺ `errors.fields` is empty AND every `errors.contacts` entry is `null`.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 */

const { MAX_ITEMS, MAX_ITEM_LEN, MAX_NOTES_LEN, MAX_CONTACTS, MAX_NAME_LEN, MAX_PHONE_LEN, MAX_RELATION_LEN } =
  MEDICAL_BOUNDS;

/** The empty/default draft — everything null / empty. Must be VALID (R7.2). */
const EMPTY_DRAFT: MedicalDraft = {
  bloodType: null,
  ageBand: null,
  allergies: [],
  conditions: [],
  medications: [],
  notes: null,
  contacts: [],
};

/** A typed, fully-valid baseline we can clone and perturb one field at a time. */
const VALID_DRAFT: MedicalDraft = {
  bloodType: BLOOD_TYPES[0],
  ageBand: AGE_BANDS[0],
  allergies: ['peanuts'],
  conditions: ['asthma'],
  medications: ['salbutamol'],
  notes: 'no known reactions',
  contacts: [{ name: 'Ana', phone: '09170000000', relation: 'mother' }],
};

const draftWith = (overrides: Partial<MedicalDraft>): MedicalDraft => ({ ...VALID_DRAFT, ...overrides });

const contact = (overrides: Partial<EmergencyContactDraft> = {}): EmergencyContactDraft => ({
  name: 'Ana',
  phone: '09170000000',
  relation: 'mother',
  ...overrides,
});

/** `'x'` repeated n times. */
const str = (n: number): string => 'x'.repeat(n);

/** A list of n valid, within-length entries. */
const list = (n: number): string[] => Array.from({ length: n }, (_, i) => `item-${i}`);

const expectValid = (result: ValidationResult): void => {
  expect(result.valid).toBe(true);
  expect(result.errors.fields).toEqual({});
  expect(result.errors.contacts.every((c) => c === null)).toBe(true);
};

const expectInvalid = (result: ValidationResult): void => {
  expect(result.valid).toBe(false);
};

describe('validateMedicalDraft — valid drafts (R7.2, R7.7, R8.4)', () => {
  it('accepts the empty/default draft (an empty profile is normal, R7.2)', () => {
    expectValid(validateMedicalDraft(EMPTY_DRAFT));
  });

  it('accepts a fully-populated, within-bounds draft', () => {
    expectValid(validateMedicalDraft(VALID_DRAFT));
  });

  it('accepts every blood type in the closed set, and null', () => {
    for (const bt of BLOOD_TYPES) {
      expectValid(validateMedicalDraft(draftWith({ bloodType: bt })));
    }
    expectValid(validateMedicalDraft(draftWith({ bloodType: null })));
  });

  it('accepts every age band in the closed set, and null', () => {
    for (const ab of AGE_BANDS) {
      expectValid(validateMedicalDraft(draftWith({ ageBand: ab })));
    }
    expectValid(validateMedicalDraft(draftWith({ ageBand: null })));
  });
});

describe('validateMedicalDraft — blood type / age band enums (R7.4, R7.5)', () => {
  it('rejects a blood type outside the closed set and flags fields.bloodType', () => {
    // Cast through unknown: the whole point is a value the closed type would forbid.
    const result = validateMedicalDraft(draftWith({ bloodType: 'C+' as unknown as MedicalDraft['bloodType'] }));
    expectInvalid(result);
    expect(result.errors.fields.bloodType).toBe('citizenMedicalInvalid');
  });

  it('rejects an age band outside the closed set and flags fields.ageBand', () => {
    const result = validateMedicalDraft(draftWith({ ageBand: '100+' as unknown as MedicalDraft['ageBand'] }));
    expectInvalid(result);
    expect(result.errors.fields.ageBand).toBe('citizenMedicalInvalid');
  });
});

describe('validateMedicalDraft — list bounds: count (R7.6, R7.7)', () => {
  for (const field of ['allergies', 'conditions', 'medications'] as const) {
    it(`accepts exactly MAX_ITEMS (${MAX_ITEMS}) ${field}`, () => {
      expectValid(validateMedicalDraft(draftWith({ [field]: list(MAX_ITEMS) } as Partial<MedicalDraft>)));
    });

    it(`rejects MAX_ITEMS + 1 (${MAX_ITEMS + 1}) ${field} and flags fields.${field}`, () => {
      const result = validateMedicalDraft(draftWith({ [field]: list(MAX_ITEMS + 1) } as Partial<MedicalDraft>));
      expectInvalid(result);
      expect(result.errors.fields[field]).toBe('citizenMedicalInvalid');
    });
  }
});

describe('validateMedicalDraft — list bounds: entry length (R7.6, R7.7)', () => {
  for (const field of ['allergies', 'conditions', 'medications'] as const) {
    it(`accepts a ${field} entry at exactly MAX_ITEM_LEN (${MAX_ITEM_LEN})`, () => {
      expectValid(validateMedicalDraft(draftWith({ [field]: [str(MAX_ITEM_LEN)] } as Partial<MedicalDraft>)));
    });

    it(`rejects a ${field} entry one over MAX_ITEM_LEN (${MAX_ITEM_LEN + 1}) and flags fields.${field}`, () => {
      const result = validateMedicalDraft(
        draftWith({ [field]: [str(MAX_ITEM_LEN + 1)] } as Partial<MedicalDraft>),
      );
      expectInvalid(result);
      expect(result.errors.fields[field]).toBe('citizenMedicalInvalid');
    });
  }
});

describe('validateMedicalDraft — notes bound (R7.6, R7.7)', () => {
  it('accepts null notes', () => {
    expectValid(validateMedicalDraft(draftWith({ notes: null })));
  });

  it(`accepts notes at exactly MAX_NOTES_LEN (${MAX_NOTES_LEN})`, () => {
    expectValid(validateMedicalDraft(draftWith({ notes: str(MAX_NOTES_LEN) })));
  });

  it(`rejects notes one over MAX_NOTES_LEN (${MAX_NOTES_LEN + 1}) and flags fields.notes`, () => {
    const result = validateMedicalDraft(draftWith({ notes: str(MAX_NOTES_LEN + 1) }));
    expectInvalid(result);
    expect(result.errors.fields.notes).toBe('citizenMedicalInvalid');
  });
});

describe('validateMedicalDraft — contact count (R8.4)', () => {
  it(`accepts exactly MAX_CONTACTS (${MAX_CONTACTS}) valid contacts`, () => {
    const contacts = Array.from({ length: MAX_CONTACTS }, (_, i) => contact({ name: `C${i}` }));
    expectValid(validateMedicalDraft(draftWith({ contacts })));
  });

  it(`rejects MAX_CONTACTS + 1 (${MAX_CONTACTS + 1}) contacts and flags fields.contacts`, () => {
    const contacts = Array.from({ length: MAX_CONTACTS + 1 }, (_, i) => contact({ name: `C${i}` }));
    const result = validateMedicalDraft(draftWith({ contacts }));
    expectInvalid(result);
    expect(result.errors.fields.contacts).toBe('citizenMedicalInvalid');
  });
});

describe('validateMedicalDraft — per-contact validity (R8.4)', () => {
  it('returns one positional entry per contact, all null when every contact is valid', () => {
    const contacts = [contact({ name: 'A' }), contact({ name: 'B' })];
    const result = validateMedicalDraft(draftWith({ contacts }));
    expectValid(result);
    expect(result.errors.contacts).toHaveLength(2);
    expect(result.errors.contacts).toEqual([null, null]);
  });

  it('rejects a contact with an empty name and flags only that contact (R8.4)', () => {
    const contacts = [contact({ name: 'A' }), contact({ name: '' })];
    const result = validateMedicalDraft(draftWith({ contacts }));
    expectInvalid(result);
    expect(result.errors.contacts).toEqual([null, 'citizenContactInvalid']);
  });

  it('rejects a contact with an empty phone and flags only that contact (R8.4)', () => {
    const contacts = [contact({ phone: '' }), contact({ name: 'B' })];
    const result = validateMedicalDraft(draftWith({ contacts }));
    expectInvalid(result);
    expect(result.errors.contacts).toEqual(['citizenContactInvalid', null]);
  });

  it('accepts a contact name at exactly MAX_NAME_LEN but rejects one over', () => {
    expectValid(validateMedicalDraft(draftWith({ contacts: [contact({ name: str(MAX_NAME_LEN) })] })));
    const result = validateMedicalDraft(draftWith({ contacts: [contact({ name: str(MAX_NAME_LEN + 1) })] }));
    expectInvalid(result);
    expect(result.errors.contacts).toEqual(['citizenContactInvalid']);
  });

  it('accepts a contact phone at exactly MAX_PHONE_LEN but rejects one over', () => {
    expectValid(validateMedicalDraft(draftWith({ contacts: [contact({ phone: str(MAX_PHONE_LEN) })] })));
    const result = validateMedicalDraft(draftWith({ contacts: [contact({ phone: str(MAX_PHONE_LEN + 1) })] }));
    expectInvalid(result);
    expect(result.errors.contacts).toEqual(['citizenContactInvalid']);
  });

  it('accepts a null relation and a relation at exactly MAX_RELATION_LEN but rejects one over', () => {
    expectValid(validateMedicalDraft(draftWith({ contacts: [contact({ relation: null })] })));
    expectValid(validateMedicalDraft(draftWith({ contacts: [contact({ relation: str(MAX_RELATION_LEN) })] })));
    const result = validateMedicalDraft(
      draftWith({ contacts: [contact({ relation: str(MAX_RELATION_LEN + 1) })] }),
    );
    expectInvalid(result);
    expect(result.errors.contacts).toEqual(['citizenContactInvalid']);
  });
});

describe('validateMedicalDraft — purity', () => {
  it('does not mutate the input draft', () => {
    const contacts = [contact({ name: '' })];
    const draft = draftWith({ contacts, allergies: [str(MAX_ITEM_LEN + 1)] });
    const snapshot = JSON.stringify(draft);
    validateMedicalDraft(draft);
    expect(JSON.stringify(draft)).toBe(snapshot);
  });
});
