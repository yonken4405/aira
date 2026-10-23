import { describe, expect, it } from 'vitest';

import { t, type MessageKey } from '../i18n';

// TDD (red): `./errorToCopyKey` does not exist yet — task 3.2 implements it to this contract.
//
// Pinned signature (design §Data Models: `errorToCopyKey(route, status, code): MessageKey`,
// made precise here so task 3.2 implements exactly this surface):
//
//   type CitizenRoute =
//     | 'register' | 'login' | 'device'
//     | 'medicalGet' | 'medicalPut' | 'medicalDelete'
//     | 'session' | 'medical' | 'account';
//
//   // Transport outcome for the request. A concrete HTTP response carries a numeric
//   // `status`; a timeout/network failure carries no status and is flagged by `kind`.
//   interface ApiError {
//     readonly kind: 'http' | 'timeout' | 'offline';
//     readonly status?: number;        // present when kind === 'http'
//     readonly code?: string | null;   // server error code when kind === 'http'
//     readonly afterRetry?: boolean;    // device route only: the single retry already happened (R3.5)
//     readonly clientValidation?: 'medical' | 'contact'; // client-side validation failure (R7.7/R8.4)
//   }
//
//   errorToCopyKey(route: CitizenRoute, error: ApiError): MessageKey
//
// The error→copy table in the design is the source of truth; every documented
// (route, outcome) maps to the exact listed MessageKey, and an unknown/unexpected
// code falls back to `citizenGenericError` (never a raw token or status number).
import { errorToCopyKey } from './errorToCopyKey';

type CitizenRoute =
  | 'register'
  | 'login'
  | 'device'
  | 'medicalGet'
  | 'medicalPut'
  | 'medicalDelete'
  | 'session'
  | 'medical'
  | 'account';

interface ApiError {
  readonly kind: 'http' | 'timeout' | 'offline';
  readonly status?: number;
  readonly code?: string | null;
  readonly afterRetry?: boolean;
  readonly clientValidation?: 'medical' | 'contact';
}

interface Case {
  readonly name: string;
  readonly route: CitizenRoute;
  readonly error: ApiError;
  readonly expected: MessageKey;
}

/**
 * Every documented (route, status, code) triple from the design's
 * "Error → Copy_Catalog mapping" table, plus the generic fallback.
 */
const CASES: readonly Case[] = [
  // register
  {
    name: 'register 400 invalid_email → citizenInvalidEmail',
    route: 'register',
    error: { kind: 'http', status: 400, code: 'invalid_email' },
    expected: 'citizenInvalidEmail',
  },
  {
    name: 'register 400 weak_password → citizenWeakPassword',
    route: 'register',
    error: { kind: 'http', status: 400, code: 'weak_password' },
    expected: 'citizenWeakPassword',
  },
  {
    name: 'register 409 registration_unavailable → citizenRegistrationUnavailable',
    route: 'register',
    error: { kind: 'http', status: 409, code: 'registration_unavailable' },
    expected: 'citizenRegistrationUnavailable',
  },
  {
    name: 'register 429 rate_limited → citizenRateLimited',
    route: 'register',
    error: { kind: 'http', status: 429, code: 'rate_limited' },
    expected: 'citizenRateLimited',
  },

  // login
  {
    name: 'login 429 rate_limited → citizenRateLimited',
    route: 'login',
    error: { kind: 'http', status: 429, code: 'rate_limited' },
    expected: 'citizenRateLimited',
  },
  {
    name: 'login 401 invalid_credentials → citizenInvalidCredentials',
    route: 'login',
    error: { kind: 'http', status: 401, code: 'invalid_credentials' },
    expected: 'citizenInvalidCredentials',
  },
  {
    name: 'login 423 account_locked → citizenAccountLocked',
    route: 'login',
    error: { kind: 'http', status: 423, code: 'account_locked' },
    expected: 'citizenAccountLocked',
  },

  // device
  {
    name: 'device 400 invalid_device_key after retry → citizenDeviceRetryFailed',
    route: 'device',
    error: { kind: 'http', status: 400, code: 'invalid_device_key', afterRetry: true },
    expected: 'citizenDeviceRetryFailed',
  },
  {
    name: 'device other http → citizenDeviceUnavailable',
    route: 'device',
    error: { kind: 'http', status: 500, code: 'service_unavailable' },
    expected: 'citizenDeviceUnavailable',
  },
  {
    name: 'device timeout → citizenDeviceUnavailable',
    route: 'device',
    error: { kind: 'timeout' },
    expected: 'citizenDeviceUnavailable',
  },
  {
    name: 'device network/offline → citizenDeviceUnavailable',
    route: 'device',
    error: { kind: 'offline' },
    expected: 'citizenDeviceUnavailable',
  },

  // medical GET — non-200 / timeout / network (not 401)
  {
    name: 'medical GET non-200 (not 401) → citizenMedicalLoadFailed',
    route: 'medicalGet',
    error: { kind: 'http', status: 500, code: 'service_unavailable' },
    expected: 'citizenMedicalLoadFailed',
  },
  {
    name: 'medical GET timeout → citizenMedicalLoadFailed',
    route: 'medicalGet',
    error: { kind: 'timeout' },
    expected: 'citizenMedicalLoadFailed',
  },
  {
    name: 'medical GET network → citizenMedicalLoadFailed',
    route: 'medicalGet',
    error: { kind: 'offline' },
    expected: 'citizenMedicalLoadFailed',
  },

  // medical PUT — non-200 / timeout / network (not 401)
  {
    name: 'medical PUT non-200 (not 401) → citizenMedicalSaveFailed',
    route: 'medicalPut',
    error: { kind: 'http', status: 500, code: 'service_unavailable' },
    expected: 'citizenMedicalSaveFailed',
  },
  {
    name: 'medical PUT timeout → citizenMedicalSaveFailed',
    route: 'medicalPut',
    error: { kind: 'timeout' },
    expected: 'citizenMedicalSaveFailed',
  },
  {
    name: 'medical PUT network → citizenMedicalSaveFailed',
    route: 'medicalPut',
    error: { kind: 'offline' },
    expected: 'citizenMedicalSaveFailed',
  },

  // medical — client validation
  {
    name: 'medical client validation (profile) → citizenMedicalInvalid',
    route: 'medical',
    error: { kind: 'http', clientValidation: 'medical' },
    expected: 'citizenMedicalInvalid',
  },
  {
    name: 'medical client validation (contact) → citizenContactInvalid',
    route: 'medical',
    error: { kind: 'http', clientValidation: 'contact' },
    expected: 'citizenContactInvalid',
  },

  // medical DELETE offline + any Tier-2 network error
  {
    name: 'medical DELETE offline → citizenOfflineUnavailable',
    route: 'medicalDelete',
    error: { kind: 'offline' },
    expected: 'citizenOfflineUnavailable',
  },
  {
    name: 'any Tier-2 network error (account) → citizenOfflineUnavailable',
    route: 'account',
    error: { kind: 'offline' },
    expected: 'citizenOfflineUnavailable',
  },

  // session / medical / account — 401 unauthenticated → session loss everywhere
  {
    name: 'session 401 unauthenticated → citizenSessionExpired',
    route: 'session',
    error: { kind: 'http', status: 401, code: 'unauthenticated' },
    expected: 'citizenSessionExpired',
  },
  {
    name: 'medical 401 unauthenticated → citizenSessionExpired',
    route: 'medical',
    error: { kind: 'http', status: 401, code: 'unauthenticated' },
    expected: 'citizenSessionExpired',
  },
  {
    name: 'medicalPut 401 unauthenticated → citizenSessionExpired',
    route: 'medicalPut',
    error: { kind: 'http', status: 401, code: 'unauthenticated' },
    expected: 'citizenSessionExpired',
  },
  {
    name: 'account 401 unauthenticated → citizenSessionExpired',
    route: 'account',
    error: { kind: 'http', status: 401, code: 'unauthenticated' },
    expected: 'citizenSessionExpired',
  },

  // fallback — unknown / unexpected code
  {
    name: 'unknown code → citizenGenericError',
    route: 'register',
    error: { kind: 'http', status: 418, code: 'i_am_a_teapot' },
    expected: 'citizenGenericError',
  },
];

describe('errorToCopyKey', () => {
  for (const { name, route, error, expected } of CASES) {
    it(`maps ${name}`, () => {
      expect(errorToCopyKey(route, error)).toBe(expected);
    });
  }

  it('resolves every mapped key to a non-empty string via t() (never a raw token/status)', () => {
    for (const { route, error, expected } of CASES) {
      const key = errorToCopyKey(route, error);
      const rendered = t(key);

      expect(key).toBe(expected);
      expect(typeof rendered).toBe('string');
      expect(rendered.trim().length).toBeGreaterThan(0);
      // never a raw token or bare status number leaking through
      expect(rendered).not.toMatch(/^\s*\d+\s*$/);
    }
  });

  it('falls back to citizenGenericError for any unrecognised code rather than echoing it', () => {
    const key = errorToCopyKey('login', {
      kind: 'http',
      status: 599,
      code: 'totally_unexpected_code',
    });

    expect(key).toBe('citizenGenericError');
    expect(t(key)).not.toContain('totally_unexpected_code');
    expect(t(key)).not.toContain('599');
  });
});
