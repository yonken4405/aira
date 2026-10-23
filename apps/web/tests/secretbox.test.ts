/**
 * @vitest-environment node
 *
 * AES-256-GCM envelope crypto for data at rest (SECURITY.md §2/§8).
 */

import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  decryptJson,
  decryptString,
  encryptJson,
  encryptString,
  loadKeyFromEnv,
} from '../src/lib/crypto/secretbox';

const key = randomBytes(32);

describe('encryptString / decryptString', () => {
  it('round-trips plaintext', () => {
    const envelope = encryptString('allergic to penicillin', key);
    expect(decryptString(envelope, key)).toBe('allergic to penicillin');
  });

  it('produces the versioned 4-part envelope and hides the plaintext', () => {
    const envelope = encryptString('type O-, asthma', key);
    expect(envelope.startsWith('v1.')).toBe(true);
    expect(envelope.split('.')).toHaveLength(4);
    expect(envelope).not.toContain('asthma');
  });

  it('uses a fresh nonce each time (no deterministic ciphertext)', () => {
    expect(encryptString('same input', key)).not.toBe(encryptString('same input', key));
  });

  it('fails to decrypt with the wrong key (returns null, never throws)', () => {
    const envelope = encryptString('secret', key);
    expect(decryptString(envelope, randomBytes(32))).toBeNull();
  });

  it('rejects a tampered ciphertext', () => {
    const envelope = encryptString('secret', key);
    const parts = envelope.split('.');
    const tampered = `${parts[0]}.${parts[1]}.${parts[2]}.${Buffer.from('evil').toString('base64url')}`;
    expect(decryptString(tampered, key)).toBeNull();
  });

  it('rejects a malformed envelope', () => {
    expect(decryptString('garbage', key)).toBeNull();
    expect(decryptString('v2.a.b.c', key)).toBeNull();
  });
});

describe('encryptJson / decryptJson', () => {
  it('round-trips a document', () => {
    const doc = {
      bloodType: 'O-',
      allergies: ['penicillin'],
      contacts: [{ name: 'Ana', phone: '0917' }],
    };
    const envelope = encryptJson(doc, key);
    expect(decryptJson(envelope, key)).toEqual(doc);
  });

  it('returns null for a tampered or wrong-key document', () => {
    const envelope = encryptJson({ a: 1 }, key);
    expect(decryptJson(envelope, randomBytes(32))).toBeNull();
  });
});

describe('loadKeyFromEnv', () => {
  it('accepts a 64-char hex key', () => {
    expect(loadKeyFromEnv(key.toString('hex'))).toHaveLength(32);
  });

  it('accepts a base64 key', () => {
    expect(loadKeyFromEnv(key.toString('base64'))).toHaveLength(32);
  });

  it('throws when missing or the wrong length', () => {
    expect(() => loadKeyFromEnv(undefined)).toThrow(/not_configured/);
    expect(() => loadKeyFromEnv('')).toThrow(/not_configured/);
    expect(() => loadKeyFromEnv('too-short')).toThrow(/invalid_length/);
  });
});
