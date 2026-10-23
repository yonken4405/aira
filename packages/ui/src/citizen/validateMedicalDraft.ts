/**
 * Pure client-side validation of a citizen medical draft (R7.7, R8.4).
 *
 * This mirrors the server bounds in `./medicalBounds` so the mobile citizen UI can validate
 * a draft before it ever hits the network. `validateMedicalDraft` is a PURE function: it does
 * no I/O and never mutates its input. It returns a per-field error map plus a positional
 * per-contact array so the UI can highlight exactly which field(s) and which contact(s)
 * failed. A profile-field issue is reported as the copy key `citizenMedicalInvalid`; a
 * contact issue as `citizenContactInvalid`.
 */

import {
  AGE_BANDS,
  BLOOD_TYPES,
  MEDICAL_BOUNDS,
  type AgeBand,
  type BloodType,
} from './medicalBounds';

/** One emergency contact in a draft. `relation` is optional (null when unset). */
export interface EmergencyContactDraft {
  readonly name: string;
  readonly phone: string;
  readonly relation: string | null;
}

/** The full medical draft the citizen edits locally before persisting (R7.2). */
export interface MedicalDraft {
  readonly bloodType: BloodType | null;
  readonly ageBand: AgeBand | null;
  readonly allergies: string[];
  readonly conditions: string[];
  readonly medications: string[];
  readonly notes: string | null;
  readonly contacts: EmergencyContactDraft[];
}

/** Profile-level fields that `validateMedicalDraft` can flag. */
export type MedicalField =
  | 'bloodType'
  | 'ageBand'
  | 'allergies'
  | 'conditions'
  | 'medications'
  | 'notes'
  | 'contacts';

/** Result of validating a draft: a per-field error map + a positional per-contact array. */
export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: {
    readonly fields: Partial<Record<MedicalField, 'citizenMedicalInvalid'>>;
    readonly contacts: ReadonlyArray<'citizenContactInvalid' | null>;
  };
}

const {
  MAX_ITEMS,
  MAX_ITEM_LEN,
  MAX_NOTES_LEN,
  MAX_CONTACTS,
  MAX_NAME_LEN,
  MAX_PHONE_LEN,
  MAX_RELATION_LEN,
} = MEDICAL_BOUNDS;

/** A list is valid iff it has ≤ MAX_ITEMS entries, each ≤ MAX_ITEM_LEN chars. */
const isListValid = (list: readonly string[]): boolean =>
  list.length <= MAX_ITEMS && list.every((entry) => entry.length <= MAX_ITEM_LEN);

/** A single contact is valid iff name/phone are non-empty & within length and relation fits. */
const isContactValid = (c: EmergencyContactDraft): boolean =>
  c.name.length > 0 &&
  c.name.length <= MAX_NAME_LEN &&
  c.phone.length > 0 &&
  c.phone.length <= MAX_PHONE_LEN &&
  (c.relation === null || c.relation.length <= MAX_RELATION_LEN);

/**
 * Validate a medical draft against the mirrored bounds. Pure — never mutates `draft`.
 * `valid` is `true` iff `errors.fields` is empty AND every `errors.contacts` entry is `null`.
 */
export function validateMedicalDraft(draft: MedicalDraft): ValidationResult {
  const fields: Partial<Record<MedicalField, 'citizenMedicalInvalid'>> = {};

  if (draft.bloodType !== null && !BLOOD_TYPES.includes(draft.bloodType)) {
    fields.bloodType = 'citizenMedicalInvalid';
  }
  if (draft.ageBand !== null && !AGE_BANDS.includes(draft.ageBand)) {
    fields.ageBand = 'citizenMedicalInvalid';
  }
  if (!isListValid(draft.allergies)) {
    fields.allergies = 'citizenMedicalInvalid';
  }
  if (!isListValid(draft.conditions)) {
    fields.conditions = 'citizenMedicalInvalid';
  }
  if (!isListValid(draft.medications)) {
    fields.medications = 'citizenMedicalInvalid';
  }
  if (draft.notes !== null && draft.notes.length > MAX_NOTES_LEN) {
    fields.notes = 'citizenMedicalInvalid';
  }
  if (draft.contacts.length > MAX_CONTACTS) {
    fields.contacts = 'citizenMedicalInvalid';
  }

  const contacts: ReadonlyArray<'citizenContactInvalid' | null> = draft.contacts.map((c) =>
    isContactValid(c) ? null : 'citizenContactInvalid',
  );

  const valid =
    Object.keys(fields).length === 0 && contacts.every((entry) => entry === null);

  return { valid, errors: { fields, contacts } };
}
