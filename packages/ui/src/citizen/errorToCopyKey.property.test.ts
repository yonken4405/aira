// Feature: mobile-citizen-account, Property 7: Every known API error maps to a defined Copy_Catalog key
//
// **Validates: Requirements 2.4, 2.5, 2.6, 2.7, 4.3, 4.4, 7.3, 11.1**
//
// Totality property for the Error -> Copy_Catalog mapping (design "Error -> Copy_Catalog
// mapping" table). For ANY citizen route and ANY transport outcome -- including HTTP
// statuses and server codes the mapping does not recognise -- `errorToCopyKey` must return
// a `MessageKey` that `t()` renders to real, human copy. It must never leak a bare status
// number or echo a raw server token back to the citizen.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { t } from '../i18n';
import { errorToCopyKey, type ApiError, type CitizenRoute } from './errorToCopyKey';

/** All nine citizen routes the mapping must cover. */
const ROUTES: readonly CitizenRoute[] = [
  'register',
  'login',
  'device',
  'medicalGet',
  'medicalPut',
  'medicalDelete',
  'session',
  'medical',
  'account',
];

/** The documented server codes the mapping recognises (register/login + session loss). */
const DOCUMENTED_CODES: readonly string[] = [
  'invalid_email',
  'weak_password',
  'registration_unavailable',
  'rate_limited',
  'invalid_credentials',
  'account_locked',
  'unauthenticated',
];

/** A realistic spread of HTTP statuses the citizen surfaces actually see. */
const REALISTIC_STATUSES: readonly number[] = [400, 401, 403, 409, 423, 429, 500];

const routeArb: fc.Arbitrary<CitizenRoute> = fc.constantFrom(...ROUTES);

/**
 * Transport outcomes across the whole input space: HTTP (with varied status + code),
 * timeout, and offline. Status mixes the realistic set with random ints; code mixes the
 * documented codes with random strings, `undefined`, and `null`. This deliberately feeds
 * combinations the mapping has no explicit row for.
 */
const apiErrorArb: fc.Arbitrary<ApiError> = fc.record(
  {
    kind: fc.constantFrom<ApiError['kind']>('http', 'timeout', 'offline'),
    status: fc.oneof(fc.constantFrom(...REALISTIC_STATUSES), fc.integer()),
    code: fc.oneof(
      fc.constantFrom(...DOCUMENTED_CODES),
      fc.string(),
      fc.constant(null),
      fc.constant(undefined),
    ),
    afterRetry: fc.boolean(),
    clientValidation: fc.constantFrom<ApiError['clientValidation']>('medical', 'contact', undefined),
  },
  { requiredKeys: ['kind'] },
);

describe('errorToCopyKey — Property 7: every known API error maps to a defined copy key', () => {
  it('always resolves to real citizen copy, never a bare status number or raw code echo', () => {
    fc.assert(
      fc.property(routeArb, apiErrorArb, (route, error) => {
        const key = errorToCopyKey(route, error);

        // The key must render to a non-empty human string via the shipped dictionary.
        const rendered = t(key);
        expect(typeof rendered).toBe('string');
        expect(rendered.trim().length).toBeGreaterThan(0);

        // It must not be a bare number (leaked HTTP status) ...
        expect(rendered.trim()).not.toMatch(/^\d+$/);

        // ... nor echo a raw server token back to the citizen. The threat is a machine
        // token (e.g. `invalid_credentials`, `rate_limited`) leaking into user copy; those
        // read as snake_case identifiers and never appear in human sentences. A single
        // random character coinciding with a letter in real copy is not a leak.
        if (typeof error.code === 'string' && /[a-z]+_[a-z]/.test(error.code)) {
          expect(rendered).not.toContain(error.code);
        }
        if (error.status !== undefined) {
          expect(rendered).not.toContain(String(error.status));
        }
      }),
      { numRuns: 100 },
    );
  });
});
