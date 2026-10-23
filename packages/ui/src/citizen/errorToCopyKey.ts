/**
 * Maps a citizen-surface API error to a single copy key (mobile-citizen-account spec,
 * task 3.2 / design "Error → Copy_Catalog mapping" table).
 *
 * The UI never renders a raw server token or HTTP status: every (route, outcome) resolves
 * to a `MessageKey` whose English copy lives in `../i18n`. Anything unrecognised falls back
 * to `citizenGenericError` rather than leaking a code or status number.
 *
 * Requirements: R2.4/2.5/2.6/2.7 (register/login mapping), R4.3/4.4 (device setup retry),
 * R7.3 (medical load/save + client validation), R11.1 (Tier-2 offline + 401 session loss).
 */

import type { MessageKey } from '../i18n';

/** The citizen request whose failure is being translated to copy. */
export type CitizenRoute =
  | 'register'
  | 'login'
  | 'device'
  | 'medicalGet'
  | 'medicalPut'
  | 'medicalDelete'
  | 'session'
  | 'medical'
  | 'account';

/**
 * Transport outcome for a citizen request. An HTTP response carries a numeric `status`
 * (and optional server `code`); a timeout or network failure carries no status and is
 * flagged by `kind`.
 */
export interface ApiError {
  readonly kind: 'http' | 'timeout' | 'offline';
  /** Present when `kind === 'http'`. */
  readonly status?: number;
  /** Server error code when `kind === 'http'`. */
  readonly code?: string | null;
  /** Device route only: the single automatic retry already happened (R4.4). */
  readonly afterRetry?: boolean;
  /** Client-side validation failure before the request was sent (R7.3). */
  readonly clientValidation?: 'medical' | 'contact';
}

/**
 * Tier-2 routes that go unavailable offline with the "SOS grid still works" message (R11.1).
 * `medicalGet`/`medicalPut` are deliberately excluded: they keep their own load/save copy even
 * offline so the citizen's edits-are-kept guarantee still reads clearly.
 */
const TIER2_OFFLINE_ROUTES: ReadonlySet<CitizenRoute> = new Set([
  'medicalDelete',
  'session',
  'medical',
  'account',
]);

export function errorToCopyKey(route: CitizenRoute, error: ApiError): MessageKey {
  // 1. Client-side validation fails before any request is sent, so it wins regardless
  //    of transport kind (R7.3).
  if (error.clientValidation === 'medical') {
    return 'citizenMedicalInvalid';
  }
  if (error.clientValidation === 'contact') {
    return 'citizenContactInvalid';
  }

  // 2. An unauthenticated 401 means the session is gone — one consistent message everywhere
  //    (R11.1). A 401 carrying a login-specific code (e.g. invalid_credentials) is handled
  //    with the register/login codes below, not treated as session loss.
  if (error.kind === 'http' && error.status === 401 && error.code === 'unauthenticated') {
    return 'citizenSessionExpired';
  }

  // 3. Device setup has its own messaging. A failure after the one automatic retry is
  //    terminal; everything else (other HTTP, timeout, offline) is "try again" (R4.3/4.4).
  if (route === 'device') {
    if (error.kind === 'http' && error.afterRetry) {
      return 'citizenDeviceRetryFailed';
    }
    return 'citizenDeviceUnavailable';
  }

  // 4. Medical load / save keep their own copy for every non-401 outcome — HTTP, timeout, or
  //    offline — so this is resolved before the generic Tier-2 offline message (R7.3).
  if (route === 'medicalGet') {
    return 'citizenMedicalLoadFailed';
  }
  if (route === 'medicalPut') {
    return 'citizenMedicalSaveFailed';
  }

  // 5. Any remaining Tier-2 surface offline degrades to the SOS-grid-still-works message (R11.1).
  if (error.kind === 'offline' && TIER2_OFFLINE_ROUTES.has(route)) {
    return 'citizenOfflineUnavailable';
  }

  // 6. Register / login: known server codes map to specific copy (R2.4/2.5/2.6/2.7).
  if (error.kind === 'http') {
    switch (error.code) {
      case 'invalid_email':
        return 'citizenInvalidEmail';
      case 'weak_password':
        return 'citizenWeakPassword';
      case 'registration_unavailable':
        return 'citizenRegistrationUnavailable';
      case 'rate_limited':
        return 'citizenRateLimited';
      case 'invalid_credentials':
        return 'citizenInvalidCredentials';
      case 'account_locked':
        return 'citizenAccountLocked';
      default:
        break;
    }
  }

  // 7. Unknown / unexpected outcome — never echo a raw code or status.
  return 'citizenGenericError';
}
