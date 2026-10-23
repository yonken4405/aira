/**
 * Password policy and argon2id hashing (SECURITY.md §4.4).
 *
 * Server-only: `@node-rs/argon2` is a native module and must never reach a client
 * bundle. Hashes are produced with per-user salts by argon2 itself and are never
 * logged, returned by an API, or compared with `===`.
 */

import { hash, verify } from '@node-rs/argon2';
import { randomInt } from 'node:crypto';

/** OWASP baseline for argon2id (19 MiB, 2 passes, 1 lane); argon2id is the default. */
const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * A real argon2id hash of a password nobody can sign in with. Unknown callsigns are
 * verified against it so a failed login costs the same time whether or not the
 * account exists (no callsign-enumeration oracle).
 */
export const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$F00jcr7vgje4mBs6zSdmQA$BHfFRuIWbh3taX0vkjN4g7OhecJ5yQMp/AQXbJFYzY8';

/** No look-alike characters: passwords get read out over a radio or a phone. */
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export type PasswordProblem = 'too_short' | 'too_long' | 'same_as_callsign';

export function validatePassword(password: string, callsign: string): PasswordProblem | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return 'too_short';
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return 'too_long';
  }
  if (password.toUpperCase() === callsign.toUpperCase()) {
    return 'same_as_callsign';
  }
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/** Verification never throws: a malformed stored hash is simply a failed login. */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}

/** Burns the same time as a real verification for callsigns that do not exist. */
export async function equalizeVerificationTime(password: string): Promise<void> {
  await verifyPassword(DUMMY_PASSWORD_HASH, password);
}

/** One-time password shown once to the admin who created the account. */
export function generatePassword(length = 20): string {
  let password = '';
  for (let index = 0; index < length; index += 1) {
    password += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
  }
  return password;
}
