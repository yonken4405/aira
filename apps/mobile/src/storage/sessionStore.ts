/**
 * On-device secure storage for the citizen session token and device key (R6.5/R6.6).
 *
 * This is the ONLY module allowed to read or write the two secrets. Values live in the
 * device's Keychain/Keystore via `expo-secure-store`; they are never passed to `console`,
 * analytics, or a URL.
 */

import * as SecureStore from 'expo-secure-store';

/** Secure-store key for the opaque citizen session token. */
export const SESSION_TOKEN_KEY = 'aira.citizen.session';

/** Secure-store key for the URL-safe device key. */
export const DEVICE_KEY_KEY = 'aira.citizen.deviceKey';

/** The two-secret persistence port used by the API client and auth provider. */
export interface SessionStore {
  getSessionToken(): Promise<string | null>;
  setSessionToken(token: string): Promise<void>;
  clearSessionToken(): Promise<void>;
  getDeviceKey(): Promise<string | null>;
  setDeviceKey(key: string): Promise<void>;
  clearDeviceKey(): Promise<void>;
}

/** Real implementation backed by the device secure storage facility. */
export function createSessionStore(): SessionStore {
  return {
    getSessionToken: () => SecureStore.getItemAsync(SESSION_TOKEN_KEY),
    setSessionToken: (token) => SecureStore.setItemAsync(SESSION_TOKEN_KEY, token),
    clearSessionToken: () => SecureStore.deleteItemAsync(SESSION_TOKEN_KEY),
    getDeviceKey: () => SecureStore.getItemAsync(DEVICE_KEY_KEY),
    setDeviceKey: (key) => SecureStore.setItemAsync(DEVICE_KEY_KEY, key),
    clearDeviceKey: () => SecureStore.deleteItemAsync(DEVICE_KEY_KEY),
  };
}
