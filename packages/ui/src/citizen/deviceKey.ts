/**
 * Device-key generation for the mobile citizen account (R3.1, DESIGN.md §6).
 *
 * DOM-free and platform-neutral: the randomness source is injected, so this is
 * a pure function of its input and works identically under `vitest` and React
 * Native. The encoder is hand-rolled base64url (no `Buffer`, no `btoa`) so it
 * does not depend on any Node- or DOM-only global.
 */

/** base64url alphabet (RFC 4648 §5): '+' → '-', '/' → '_', no '=' padding. */
const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Number of random bytes the server's DEVICE_KEY_PATTERN expects (43 base64url chars). */
const DEVICE_KEY_BYTES = 32;

/**
 * Encode a byte array as base64url without padding.
 *
 * Processes the input in 3-byte groups → 4 output chars; a trailing group of 1
 * or 2 bytes emits 2 or 3 chars respectively (and no '=' padding).
 */
function toBase64Url(bytes: Uint8Array): string {
  let out = '';

  for (let index = 0; index < bytes.length; index += 3) {
    // `index < bytes.length` guarantees byte0 exists; `?? 0` satisfies
    // noUncheckedIndexedAccess without changing behaviour.
    const byte0 = bytes[index] ?? 0;
    const byte1 = bytes[index + 1];
    const byte2 = bytes[index + 2];

    const hasByte1 = byte1 !== undefined;
    const hasByte2 = byte2 !== undefined;

    out += BASE64URL_ALPHABET[byte0 >> 2];
    out += BASE64URL_ALPHABET[((byte0 & 0b11) << 4) | (hasByte1 ? byte1 >> 4 : 0)];

    if (hasByte1) {
      out += BASE64URL_ALPHABET[((byte1 & 0b1111) << 2) | (hasByte2 ? byte2 >> 6 : 0)];
    }
    if (hasByte2) {
      out += BASE64URL_ALPHABET[byte2 & 0b111111];
    }
  }

  return out;
}

/**
 * Generate a device key: 32 bytes from the injected `randomBytes` source encoded
 * as a 43-char base64url string matching the server's `DEVICE_KEY_PATTERN`
 * (`/^[A-Za-z0-9_-]{43}$/`).
 *
 * @param randomBytes - CSPRNG source (e.g. `expo-crypto.getRandomBytes` in the app).
 */
export function generateDeviceKey(randomBytes: (n: number) => Uint8Array): string {
  const bytes = randomBytes(DEVICE_KEY_BYTES);
  return toBase64Url(bytes);
}
