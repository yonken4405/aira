/**
 * Client mirror of the server medical bounds and closed enums (R7.7, R8.5).
 *
 * The server in `apps/web/src/lib/medical/profile.ts` is the source of truth for every
 * bound and for the closed blood-type / age-band sets (SECURITY.md §8). This module holds
 * the DOM-free, platform-neutral copy consumed by the mobile citizen UI so the client can
 * validate a draft before it ever hits the network. The values here MUST equal the server's
 * and can never exceed them (Property 11); `medicalBounds.test.ts` cross-checks both sides
 * so the two can never drift.
 */

/** Numeric bounds, mirrored byte-for-byte from the server `MEDICAL_BOUNDS` (R7.7). */
export const MEDICAL_BOUNDS = {
  MAX_ITEMS: 20,
  MAX_ITEM_LEN: 80,
  MAX_NOTES_LEN: 1000,
  MAX_CONTACTS: 5,
  MAX_NAME_LEN: 80,
  MAX_PHONE_LEN: 32,
  MAX_RELATION_LEN: 40,
} as const;

/** Closed blood-type set, in server order (R8.5). */
export const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
export type BloodType = (typeof BLOOD_TYPES)[number];

/** Closed, coarse age-band set — never a birth date (data minimisation, R8.5). */
export const AGE_BANDS = ['0-12', '13-17', '18-39', '40-64', '65+'] as const;
export type AgeBand = (typeof AGE_BANDS)[number];
