import { describe, expect, it } from 'vitest';

import { EMERGENCY_CATEGORIES, getCategory, isEmergencyCategoryId } from './categories';

describe('emergency categories', () => {
  it('defines exactly the four frozen wire ids (PRODUCT.md §4)', () => {
    expect(EMERGENCY_CATEGORIES.map((category) => category.id)).toEqual([
      'SUNOG',
      'MEDIKAL',
      'KRIMEN',
      'BAHA',
    ]);
  });

  it('uses English as the primary display label', () => {
    expect(EMERGENCY_CATEGORIES.map((category) => category.label)).toEqual([
      'Fire',
      'Medical',
      'Crime',
      'Flood',
    ]);
  });

  it('keeps Bisaya as the secondary label for the later localization phase', () => {
    expect(EMERGENCY_CATEGORIES.map((category) => category.localizedLabel)).toEqual([
      'Sunog',
      'Medikal',
      'Krimen',
      'Baha',
    ]);
  });

  it('assigns one lucide icon per category', () => {
    expect(EMERGENCY_CATEGORIES.map((category) => category.icon)).toEqual([
      'flame',
      'heart-pulse',
      'shield-alert',
      'waves',
    ]);
    expect(new Set(EMERGENCY_CATEGORIES.map((category) => category.icon)).size).toBe(4);
  });

  it('narrows ids with isEmergencyCategoryId', () => {
    expect(isEmergencyCategoryId('SUNOG')).toBe(true);
    expect(isEmergencyCategoryId('FLOOD')).toBe(false);
    expect(isEmergencyCategoryId(42)).toBe(false);
    expect(isEmergencyCategoryId(undefined)).toBe(false);
  });

  it('resolves category metadata', () => {
    expect(getCategory('BAHA').label).toBe('Flood');
    expect(getCategory('KRIMEN').color).toBe('#FFC53D');
  });
});
