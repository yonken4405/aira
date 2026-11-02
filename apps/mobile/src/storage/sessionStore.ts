import * as SecureStore from 'expo-secure-store';

/**
 * The two secrets owned by the citizen client, keyed exactly as the design specifies.
 * This is the ONLY module allowed to read/write them (design §4, R6.5/R6.6).
 */
const SESSION_KEY = 'aira.citizen.session';
const DEVICE_KEY = 'aira.citizen.deviceKey';

/**
 * Thin wrapper over `expo-secure-store` (Keychain/Keystore-backed).
 *
 * Neither the session token nor the device key is ever passed to `console`,
 * analytics, or a URL (R6.5, R12). The values are written only with
 * `SecureStore.setItemAsync` and read back only with `getItemAsync`.
 */
export interface SessionStore {
  getSessionToken(): Promise<string | null>;
  setSessionToken(token: string): Promise<void>;
  clearSessionToken(): Promise<void>;
  getDeviceKey(): Promise<string | null>;
  setDeviceKey(key: string): Promise<void>;
  clearDeviceKey(): Promise<void>;
}

export const SessionStore: SessionStore = {
  getSessionToken(): Promise<string | null> {
    return SecureStore.getItemAsync(SESSION_KEY);
  },
  setSessionToken(token: string): Promise<void> {
    return SecureStore.setItemAsync(SESSION_KEY, token);
  },
  clearSessionToken(): Promise<void> {
    return SecureStore.deleteItemAsync(SESSION_KEY);
  },
  getDeviceKey(): Promise<string | null> {
    return SecureStore.getItemAsync(DEVICE_KEY);
  },
  setDeviceKey(key: string): Promise<void> {
    return SecureStore.setItemAsync(DEVICE_KEY, key);
  },
  clearDeviceKey(): Promise<void> {
    return SecureStore.deleteItemAsync(DEVICE_KEY);
  },
};
