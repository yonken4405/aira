/**
 * Citizen medical profile domain (SECURITY.md §8).
 *
 * The profile is opt-in and owner-controlled. All fields are optional and bounded;
 * free text is length-capped and control characters are stripped (SECURITY.md §3.3)
 * before it is encrypted. The full profile is only ever returned to its owner; a
 * responder sees the minimised `MedicalSnapshot` on-incident (wired in Task 8).
 */

export const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
export type BloodType = (typeof BLOOD_TYPES)[number];

/** Coarse age band - never a birth date (data minimisation, SECURITY.md §1.2). */
export const AGE_BANDS = ['0-12', '13-17', '18-39', '40-64', '65+'] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

export interface EmergencyContact {
  readonly name: string;
  readonly phone: string;
  readonly relation: string | null;
}

export interface MedicalProfile {
  readonly bloodType: BloodType | null;
  readonly ageBand: AgeBand | null;
  readonly allergies: readonly string[];
  readonly conditions: readonly string[];
  readonly medications: readonly string[];
  readonly notes: string | null;
  readonly contacts: readonly EmergencyContact[];
}

/** Triage-relevant subset shown to an assigned responder on-incident (SECURITY.md §8.4). */
export interface MedicalSnapshot {
  readonly bloodType: BloodType | null;
  readonly ageBand: AgeBand | null;
  readonly allergies: readonly string[];
  readonly conditions: readonly string[];
  readonly medications: readonly string[];
  readonly notes: string | null;
  readonly contacts: readonly EmergencyContact[];
}

export const EMPTY_PROFILE: MedicalProfile = {
  bloodType: null,
  ageBand: null,
  allergies: [],
  conditions: [],
  medications: [],
  notes: null,
  contacts: [],
};

/**
 * The source-of-truth medical bounds (R7.7). Exported so the client (`@aira/ui`) can mirror
 * them exactly and cross-check that it never exceeds the server (Property 11). Values are
 * unchanged from the previous module-private consts; the local aliases below preserve the
 * existing sanitise behaviour verbatim.
 */
export const MEDICAL_BOUNDS = {
  MAX_ITEMS: 20,
  MAX_ITEM_LEN: 80,
  MAX_NOTES_LEN: 1000,
  MAX_CONTACTS: 5,
  MAX_NAME_LEN: 80,
  MAX_PHONE_LEN: 32,
  MAX_RELATION_LEN: 40,
} as const;

const {
  MAX_ITEMS,
  MAX_ITEM_LEN,
  MAX_NOTES_LEN,
  MAX_CONTACTS,
  MAX_NAME_LEN,
  MAX_PHONE_LEN,
  MAX_RELATION_LEN,
} = MEDICAL_BOUNDS;

/** Strips control characters and trims; the sole sanitiser for stored free text. */
function clean(value: string, maxLen: number): string {
  // eslint-disable-next-line no-control-regex
  return value
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLen);
}

function cleanList(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const items: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') {
      continue;
    }
    const cleaned = clean(entry, MAX_ITEM_LEN);
    if (cleaned.length > 0) {
      items.push(cleaned);
    }
    if (items.length >= MAX_ITEMS) {
      break;
    }
  }
  return items;
}

function isBloodType(value: unknown): value is BloodType {
  return typeof value === 'string' && (BLOOD_TYPES as readonly string[]).includes(value);
}

function isAgeBand(value: unknown): value is AgeBand {
  return typeof value === 'string' && (AGE_BANDS as readonly string[]).includes(value);
}

function cleanContacts(raw: unknown): EmergencyContact[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const contacts: EmergencyContact[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const name = typeof record.name === 'string' ? clean(record.name, MAX_NAME_LEN) : '';
    const phone = typeof record.phone === 'string' ? clean(record.phone, MAX_PHONE_LEN) : '';
    if (name.length === 0 || phone.length === 0) {
      continue; // a contact needs at least a name and a number
    }
    const relation =
      typeof record.relation === 'string' ? clean(record.relation, MAX_RELATION_LEN) : '';
    contacts.push({ name, phone, relation: relation.length > 0 ? relation : null });
    if (contacts.length >= MAX_CONTACTS) {
      break;
    }
  }
  return contacts;
}

/**
 * Reject-by-default normalisation of an untrusted profile body into the canonical
 * shape. Unknown/invalid fields are dropped, never trusted; the result is always a
 * well-formed `MedicalProfile` safe to encrypt and store.
 */
export function sanitizeProfile(raw: unknown): MedicalProfile {
  if (typeof raw !== 'object' || raw === null) {
    return EMPTY_PROFILE;
  }
  const record = raw as Record<string, unknown>;
  const notes = typeof record.notes === 'string' ? clean(record.notes, MAX_NOTES_LEN) : '';

  return {
    bloodType: isBloodType(record.bloodType) ? record.bloodType : null,
    ageBand: isAgeBand(record.ageBand) ? record.ageBand : null,
    allergies: cleanList(record.allergies),
    conditions: cleanList(record.conditions),
    medications: cleanList(record.medications),
    notes: notes.length > 0 ? notes : null,
    contacts: cleanContacts(record.contacts),
  };
}

/** Parses a decrypted profile document back to the canonical shape (reject-by-default). */
export function parseProfile(raw: unknown): MedicalProfile {
  return sanitizeProfile(raw);
}

/** Minimised, triage-relevant view for an assigned responder (SECURITY.md §8.4). */
export function toSnapshot(profile: MedicalProfile): MedicalSnapshot {
  return {
    bloodType: profile.bloodType,
    ageBand: profile.ageBand,
    allergies: profile.allergies,
    conditions: profile.conditions,
    medications: profile.medications,
    notes: profile.notes,
    contacts: profile.contacts,
  };
}
