import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as SecureStore from 'expo-secure-store';

import { SessionStore } from '../sessionStore';

// Stateful in-memory stand-in for the Keychain/Keystore-backed secure store.
jest.mock('expo-secure-store');

// The two secrets this store owns, keyed exactly as the design specifies.
const SESSION_KEY = 'aira.citizen.session';
const DEVICE_KEY = 'aira.citizen.deviceKey';

describe('SessionStore', () => {
  // Console spies: neither the session token nor the device key may ever be logged.
  let logSpies: ReturnType<typeof jest.spyOn>[];

  beforeEach(() => {
    (SecureStore as unknown as { __resetStore(): void }).__resetStore();
    logSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      jest.spyOn(console, method).mockImplementation(() => undefined),
    );
  });

  afterEach(() => {
    for (const spy of logSpies) spy.mockRestore();
  });

  function expectNeverLogged(...secrets: string[]): void {
    for (const spy of logSpies) {
      for (const call of spy.mock.calls) {
        const line = call.map((arg: unknown) => String(arg)).join(' ');
        for (const secret of secrets) {
          expect(line.includes(secret)).toBe(false);
        }
      }
    }
  }

  describe('session token', () => {
    it('round-trips set -> get', async () => {
      const token = 'session-token-abc123';
      await SessionStore.setSessionToken(token);

      await expect(SessionStore.getSessionToken()).resolves.toBe(token);
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith(SESSION_KEY, token);
    });

    it('returns null when absent', async () => {
      await expect(SessionStore.getSessionToken()).resolves.toBeNull();
    });

    it('clear removes the token so a later get returns null', async () => {
      await SessionStore.setSessionToken('session-token-xyz');
      await SessionStore.clearSessionToken();

      await expect(SessionStore.getSessionToken()).resolves.toBeNull();
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(SESSION_KEY);
    });

    it('never logs the session token', async () => {
      const token = 'super-secret-session-token';
      await SessionStore.setSessionToken(token);
      await SessionStore.getSessionToken();
      await SessionStore.clearSessionToken();

      expectNeverLogged(token);
    });
  });

  describe('device key', () => {
    it('round-trips set -> get', async () => {
      const key = 'device-key-base64url-value';
      await SessionStore.setDeviceKey(key);

      await expect(SessionStore.getDeviceKey()).resolves.toBe(key);
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith(DEVICE_KEY, key);
    });

    it('returns null when absent', async () => {
      await expect(SessionStore.getDeviceKey()).resolves.toBeNull();
    });

    it('clear removes the device key so a later get returns null', async () => {
      await SessionStore.setDeviceKey('device-key-to-clear');
      await SessionStore.clearDeviceKey();

      await expect(SessionStore.getDeviceKey()).resolves.toBeNull();
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(DEVICE_KEY);
    });

    it('never logs the device key', async () => {
      const key = 'super-secret-device-key';
      await SessionStore.setDeviceKey(key);
      await SessionStore.getDeviceKey();
      await SessionStore.clearDeviceKey();

      expectNeverLogged(key);
    });
  });

  it('keeps the session token and device key in independent slots', async () => {
    const token = 'independent-session-token';
    const key = 'independent-device-key';

    await SessionStore.setSessionToken(token);
    await SessionStore.setDeviceKey(key);

    await expect(SessionStore.getSessionToken()).resolves.toBe(token);
    await expect(SessionStore.getDeviceKey()).resolves.toBe(key);

    // Clearing one secret leaves the other intact.
    await SessionStore.clearSessionToken();
    await expect(SessionStore.getSessionToken()).resolves.toBeNull();
    await expect(SessionStore.getDeviceKey()).resolves.toBe(key);

    expectNeverLogged(token, key);
  });
});
