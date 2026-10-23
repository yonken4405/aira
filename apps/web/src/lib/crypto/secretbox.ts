/**
 * Authenticated symmetric encryption for data at rest (SECURITY.md §2/§8).
 *
 * AES-256-GCM with a random 96-bit nonce per message. The ciphertext envelope is
 * `v1.<nonce>.<tag>.<ciphertext>` (all base64url), so the nonce is never reused and a
 * tampered payload fails the auth tag on decrypt. Server-only: the key comes from the
 * environment and must never reach a client bundle or a log.
 *
 * Used for the citizen medical profile, which is sensitive health PII and must be
 * unreadable at rest to anyone without the key (SECURITY.md §8.2).
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = 'v1';

const b64 = (buf: Buffer): string => buf.toString('base64url');
const unb64 = (value: string): Buffer => Buffer.from(value, 'base64url');

/**
 * Loads and validates the 32-byte key from a base64/base64url/hex env value. Throws a
 * generic error (never echoing the value) when it is missing or the wrong length, so a
 * misconfiguration fails closed rather than encrypting with a weak key.
 */
export function loadKeyFromEnv(raw: string | undefined): Buffer {
  if (!raw || raw.length === 0) {
    throw new Error('encryption_key_not_configured');
  }

  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, 'hex');
  } else {
    key = Buffer.from(raw, 'base64');
    if (key.length !== KEY_BYTES) {
      key = Buffer.from(raw, 'base64url');
    }
  }

  if (key.length !== KEY_BYTES) {
    throw new Error('encryption_key_invalid_length');
  }
  return key;
}

/** Encrypts UTF-8 plaintext into the versioned envelope string. */
export function encryptString(plaintext: string, key: Buffer): string {
  if (key.length !== KEY_BYTES) {
    throw new Error('encryption_key_invalid_length');
  }
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, b64(nonce), b64(tag), b64(ciphertext)].join('.');
}

/**
 * Decrypts an envelope produced by `encryptString`. Returns null for any malformed or
 * tampered envelope (reject-by-default) instead of throwing, so a bad row degrades to
 * "no profile" rather than a crash.
 */
export function decryptString(envelope: string, key: Buffer): string | null {
  if (key.length !== KEY_BYTES) {
    return null;
  }
  const parts = envelope.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    return null;
  }

  try {
    const nonce = unb64(parts[1] as string);
    const tag = unb64(parts[2] as string);
    const ciphertext = unb64(parts[3] as string);
    if (nonce.length !== NONCE_BYTES || tag.length !== TAG_BYTES) {
      return null;
    }

    const decipher = createDecipheriv(ALGORITHM, key, nonce);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString('utf8');
  } catch {
    // Wrong key, tampered ciphertext, or corrupt envelope - all fail the auth tag.
    return null;
  }
}

/** Convenience for JSON documents: encrypts a value, decrypts back to `unknown`. */
export function encryptJson(value: unknown, key: Buffer): string {
  return encryptString(JSON.stringify(value), key);
}

export function decryptJson(envelope: string, key: Buffer): unknown {
  const plaintext = decryptString(envelope, key);
  if (plaintext === null) {
    return null;
  }
  try {
    return JSON.parse(plaintext) as unknown;
  } catch {
    return null;
  }
}
