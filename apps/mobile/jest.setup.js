/**
 * Jest setup for the mobile app.
 *
 * Native Expo modules are replaced with deterministic in-memory doubles so component
 * tests never touch a real Keychain/Keystore or CSPRNG.
 */

jest.mock('expo-secure-store', () => {
  const store = new Map();
  return {
    setItemAsync: async (key, value) => {
      store.set(key, String(value));
    },
    getItemAsync: async (key) => (store.has(key) ? store.get(key) : null),
    deleteItemAsync: async (key) => {
      store.delete(key);
    },
    __reset: () => {
      store.clear();
    },
    __dump: () => Object.fromEntries(store),
  };
});

jest.mock('expo-crypto', () => ({
  getRandomBytes: (length) => {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) {
      bytes[i] = (i * 31 + 7) % 256;
    }
    return bytes;
  },
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: {} } },
}));
