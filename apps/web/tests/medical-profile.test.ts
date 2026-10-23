/**
 * @vitest-environment node
 *
 * Medical profile sanitisation (SECURITY.md §3.3/§8): bounded, control-char-stripped,
 * reject-by-default normalisation of untrusted input.
 */

import { describe, expect, it } from 'vitest';

import { EMPTY_PROFILE, sanitizeProfile, toSnapshot } from '../src/lib/medical/profile';

describe('sanitizeProfile', () => {
  it('returns the empty profile for non-object input', () => {
    expect(sanitizeProfile(null)).toEqual(EMPTY_PROFILE);
    expect(sanitizeProfile('nope')).toEqual(EMPTY_PROFILE);
    expect(sanitizeProfile(42)).toEqual(EMPTY_PROFILE);
  });

  it('keeps valid blood type and age band, drops invalid ones', () => {
    expect(sanitizeProfile({ bloodType: 'O-', ageBand: '18-39' })).toMatchObject({
      bloodType: 'O-',
      ageBand: '18-39',
    });
    expect(sanitizeProfile({ bloodType: 'Z+', ageBand: 'ancient' })).toMatchObject({
      bloodType: null,
      ageBand: null,
    });
  });

  it('cleans and caps list items, dropping empties and non-strings', () => {
    const profile = sanitizeProfile({
      allergies: ['  penicillin  ', '', 42, 'pollen'],
    });
    expect(profile.allergies).toEqual(['penicillin', 'pollen']);
  });

  it('strips control characters from free text', () => {
    const profile = sanitizeProfile({ notes: 'has a\u0000 pacemaker\u0007' });
    expect(profile.notes).toBe('has a pacemaker');
  });

  it('requires a name and phone on each emergency contact', () => {
    const profile = sanitizeProfile({
      contacts: [
        { name: 'Ana', phone: '0917' },
        { name: '', phone: '0918' },
        { name: 'Bea', phone: '' },
        { name: 'Cris', phone: '0919', relation: 'sister' },
      ],
    });
    expect(profile.contacts).toEqual([
      { name: 'Ana', phone: '0917', relation: null },
      { name: 'Cris', phone: '0919', relation: 'sister' },
    ]);
  });

  it('caps the number of items and contacts', () => {
    const many = Array.from({ length: 50 }, (_, i) => `item-${i}`);
    const contacts = Array.from({ length: 50 }, (_, i) => ({ name: `n${i}`, phone: `${i}` }));
    const profile = sanitizeProfile({ conditions: many, contacts });
    expect(profile.conditions.length).toBeLessThanOrEqual(20);
    expect(profile.contacts.length).toBeLessThanOrEqual(5);
  });
});

describe('toSnapshot', () => {
  it('carries the triage-relevant fields', () => {
    const profile = sanitizeProfile({
      bloodType: 'A+',
      allergies: ['aspirin'],
      contacts: [{ name: 'Ana', phone: '0917' }],
    });
    const snapshot = toSnapshot(profile);
    expect(snapshot.bloodType).toBe('A+');
    expect(snapshot.allergies).toEqual(['aspirin']);
    expect(snapshot.contacts).toHaveLength(1);
  });
});
