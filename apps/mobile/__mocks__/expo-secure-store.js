// Jest manual mock for expo-secure-store (jest-expo does not provide one).
// An in-memory, stateful stand-in for the Keychain/Keystore-backed store so
// SessionStore round-trips (set/get/delete) can be asserted in tests without
// native code. Reset between tests with `__resetStore()`.
const store = new Map();

const setItemAsync = jest.fn(async (key, value) => {
  store.set(key, String(value));
});

const getItemAsync = jest.fn(async (key) => (store.has(key) ? store.get(key) : null));

const deleteItemAsync = jest.fn(async (key) => {
  store.delete(key);
});

const isAvailableAsync = jest.fn(async () => true);

// Test helper: wipe the in-memory store and call history.
function __resetStore() {
  store.clear();
  setItemAsync.mockClear();
  getItemAsync.mockClear();
  deleteItemAsync.mockClear();
  isAvailableAsync.mockClear();
}

module.exports = {
  setItemAsync,
  getItemAsync,
  deleteItemAsync,
  isAvailableAsync,
  __resetStore,
  // Match the real module's keychain-accessibility export surface (constants only).
  WHEN_UNLOCKED: 'WHEN_UNLOCKED',
  AFTER_FIRST_UNLOCK: 'AFTER_FIRST_UNLOCK',
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
  WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: 'WHEN_PASSCODE_SET_THIS_DEVICE_ONLY',
};
