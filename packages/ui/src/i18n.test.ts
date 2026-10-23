import { describe, expect, it } from 'vitest';

import {
  AVAILABLE_LOCALES,
  DEFAULT_LOCALE,
  type MessageKey,
  PLANNED_LOCALES,
  categoryLabel,
  isLocale,
  t,
} from './i18n';

describe('i18n', () => {
  it('ships only English as available (Bisaya/Tagalog are later phases)', () => {
    expect(DEFAULT_LOCALE).toBe('en');
    expect(AVAILABLE_LOCALES).toEqual(['en']);
    expect(PLANNED_LOCALES).toContain('ceb');
    expect(PLANNED_LOCALES).toContain('tl');
  });

  it('resolves English copy by default', () => {
    expect(t('emergencyPrompt')).toBe('What is your emergency?');
    expect(t('incomingQueue')).toBe('Incoming queue');
  });

  it('interpolates params without touching unknown placeholders', () => {
    expect(t('toastAssignedBody', { unit: 'UNIT-01', id: 'mesh-1003' })).toBe(
      'UNIT-01 assigned to mesh-1003.',
    );
    expect(t('toastAssignedBody', { unit: 'UNIT-01' })).toContain('{id}');
  });

  it('falls back to English for untranslated Bisaya keys', () => {
    expect(t('emergencyPrompt', undefined, 'ceb')).toBe('Unsa ang imong emerhensya?');
    expect(t('incomingQueue', undefined, 'ceb')).toBe('Incoming queue');
  });

  it('narrows locale values', () => {
    expect(isLocale('en')).toBe(true);
    expect(isLocale('ceb')).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(isLocale(42)).toBe(false);
  });

  it('labels categories in English by default and Bisaya when locale is ceb', () => {
    expect(categoryLabel('SUNOG')).toBe('Fire');
    expect(categoryLabel('SUNOG', 'ceb')).toBe('Sunog');
    expect(categoryLabel('BAHA', 'tl')).toBe('Flood');
  });

  describe('mobile-citizen-account copy keys', () => {
    const citizenKeys = [
      // Error -> copy mapping
      'citizenInvalidEmail',
      'citizenWeakPassword',
      'citizenRegistrationUnavailable',
      'citizenRateLimited',
      'citizenInvalidCredentials',
      'citizenAccountLocked',
      'citizenDeviceRetryFailed',
      'citizenDeviceUnavailable',
      'citizenMedicalLoadFailed',
      'citizenMedicalSaveFailed',
      'citizenMedicalInvalid',
      'citizenContactInvalid',
      'citizenOfflineUnavailable',
      'citizenSessionExpired',
      'citizenGenericError',
      // Account hub + register/login
      'citizenAccountTitle',
      'citizenRegister',
      'citizenLogin',
      'citizenUseDeviceKey',
      'citizenEmailLabel',
      'citizenPasswordLabel',
      'citizenSignOut',
      'citizenSignOutConfirmTitle',
      'citizenSignOutConfirmBody',
      'citizenDeleteAccount',
      'citizenDeleteAccountConfirmTitle',
      'citizenDeleteAccountConfirmBody',
      // Offline treatment
      'citizenOfflineTitle',
      // Medical profile screen
      'citizenMedicalTitle',
      'citizenMedicalEmpty',
      'citizenBloodType',
      'citizenAgeBand',
      'citizenAllergies',
      'citizenConditions',
      'citizenMedications',
      'citizenNotes',
      'citizenContacts',
      'citizenContactName',
      'citizenContactPhone',
      'citizenContactRelation',
      'citizenAddContact',
      'citizenRemoveContact',
      'citizenDeleteProfile',
      'citizenDeleteProfileConfirmTitle',
      'citizenDeleteProfileConfirmBody',
    ] as const satisfies readonly MessageKey[];

    it.each(citizenKeys)('resolves %s to a non-empty string', (key) => {
      const value = t(key);
      expect(typeof value).toBe('string');
      expect(value.trim().length).toBeGreaterThan(0);
      // No unresolved placeholder tokens should survive for a bare lookup except
      // keys that intentionally interpolate params (asserted separately below).
    });

    it('interpolates {minutes} in citizenAccountLocked', () => {
      const value = t('citizenAccountLocked', { minutes: 5 });
      expect(value).toContain('5');
      expect(value).not.toContain('{minutes}');
    });
  });
});
