import { describe, expect, it } from 'vitest';

// TDD (red): `./deviceKey` does not exist yet — task 1.3 implements it.
// `generateDeviceKey` takes an injected `randomBytes(n)` source so it stays a
// pure function of its input and is deterministic under test (DESIGN.md §6, R3.1).
import { generateDeviceKey } from './deviceKey';

/** The server's DEVICE_KEY_PATTERN: base64url of 32 bytes is 43 chars, no padding. */
const DEVICE_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * A deterministic `randomBytes(n)` that returns the first `n` bytes of a fixed
 * repeating pattern. Deterministic so the same injection always yields the same key.
 */
function fixedRandomBytes(seed: number): (n: number) => Uint8Array {
  return (n: number) => Uint8Array.from({ length: n }, (_unused, index) => (seed + index) % 256);
}

describe('generateDeviceKey', () => {
  it('produces a 43-char base64url string matching the server DEVICE_KEY_PATTERN', () => {
    const key = generateDeviceKey(fixedRandomBytes(0));

    expect(key).toMatch(DEVICE_KEY_PATTERN);
    expect(key).toHaveLength(43);
  });

  it('emits pure base64url with no "+", "/", or "=" padding characters', () => {
    const key = generateDeviceKey(fixedRandomBytes(7));

    expect(key).not.toContain('+');
    expect(key).not.toContain('/');
    expect(key).not.toContain('=');
  });

  it('is a pure function of the injected bytes: identical bytes give an identical key', () => {
    const first = generateDeviceKey(fixedRandomBytes(42));
    const second = generateDeviceKey(fixedRandomBytes(42));

    expect(second).toBe(first);
  });

  it('maps different byte patterns to different keys', () => {
    const a = generateDeviceKey(fixedRandomBytes(1));
    const b = generateDeviceKey(fixedRandomBytes(2));

    expect(a).not.toBe(b);
  });

  it('requests exactly 32 bytes from the injected randomBytes source', () => {
    const requested: number[] = [];
    const recordingRandomBytes = (n: number): Uint8Array => {
      requested.push(n);
      return Uint8Array.from({ length: n }, (_unused, index) => index % 256);
    };

    generateDeviceKey(recordingRandomBytes);

    expect(requested).toEqual([32]);
  });
});
