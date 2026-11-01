/**
 * Medical draft helpers + the app-session edit buffer (R7.8/R7.10/R11.4/R11.5).
 *
 * The buffer lives only in memory for the app session: a failed/offline save never
 * discards what the citizen typed, and it is never presented as current server data.
 */

import type { MedicalDraft } from '@aira/ui';

import type { MedicalProfile } from '../api/citizenClient';

export const EMPTY_DRAFT: MedicalDraft = {
  bloodType: null,
  ageBand: null,
  allergies: [],
  conditions: [],
  medications: [],
  notes: null,
  contacts: [],
};

function clone(draft: MedicalDraft): MedicalDraft {
  return {
    bloodType: draft.bloodType,
    ageBand: draft.ageBand,
    allergies: [...draft.allergies],
    conditions: [...draft.conditions],
    medications: [...draft.medications],
    notes: draft.notes,
    contacts: draft.contacts.map((contact) => ({ ...contact })),
  };
}

export function draftFromProfile(profile: MedicalProfile): MedicalDraft {
  return {
    bloodType: profile.bloodType,
    ageBand: profile.ageBand,
    allergies: [...profile.allergies],
    conditions: [...profile.conditions],
    medications: [...profile.medications],
    notes: profile.notes,
    contacts: profile.contacts.map((contact) => ({
      name: contact.name,
      phone: contact.phone,
      relation: contact.relation,
    })),
  };
}

export function isDraftEmpty(draft: MedicalDraft): boolean {
  return (
    draft.bloodType === null &&
    draft.ageBand === null &&
    draft.allergies.length === 0 &&
    draft.conditions.length === 0 &&
    draft.medications.length === 0 &&
    (draft.notes === null || draft.notes.trim().length === 0) &&
    draft.contacts.length === 0
  );
}

let preserved: MedicalDraft | null = null;

export function preserveDraft(draft: MedicalDraft): void {
  preserved = clone(draft);
}

export function readPreservedDraft(): MedicalDraft | null {
  return preserved ? clone(preserved) : null;
}

export function clearPreservedDraft(): void {
  preserved = null;
}
