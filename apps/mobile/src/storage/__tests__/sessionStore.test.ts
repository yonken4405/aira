import * as SecureStore from 'expo-secure-store';

import { DEVICE_KEY_KEY, SESSION_TOKEN_KEY, createSessionStore } from '../sessionStore';

const secureStore = SecureStore as unknown as {
  __reset: () => void;
  __dump: () => Record<string, string>;
};

describe('SessionStore', () => {
  let store: ReturnType<typeof createSessionStore>;
  const logs: unknown[][] = [];
  const spies: Array<{ mockRestore: () => void }> = [];

  beforeEach(() => {
    secureStore.__reset();
    logs.length = 0;
    store = createSessionStore();
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      spies.push(
        jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
          logs.push(args);
        }),
      );
    }
  });

  afterEach(() => {
    for (const spy of spies.splice(0)) {
      spy.mockRestore();
    }
  });

  it('returns null for absent values', async () => {
    await expect(store.getSessionToken()).resolves.toBeNull();
    await expect(store.getDeviceKey()).resolves.toBeNull();
  });

  it('round-trips the session token and device key under fixed secure keys', async () => {
    await store.setSessionToken('session-token-value');
    await store.setDeviceKey('device-key-value');

    expect(secureStore.__dump()).toEqual({
      [SESSION_TOKEN_KEY]: 'session-token-value',
      [DEVICE_KEY_KEY]: 'device-key-value',
    });

    await expect(store.getSessionToken()).resolves.toBe('session-token-value');
    await expect(store.getDeviceKey()).resolves.toBe('device-key-value');

    await store.clearSessionToken();
    await expect(store.getSessionToken()).resolves.toBeNull();
    await expect(store.getDeviceKey()).resolves.toBe('device-key-value');

    await store.clearDeviceKey();
    await expect(store.getDeviceKey()).resolves.toBeNull();
  });

  it('never logs either secret', async () => {
    await store.setSessionToken('secret-session-token');
    await store.setDeviceKey('secret-device-key');
    await store.getSessionToken();
    await store.getDeviceKey();
    await store.clearSessionToken();
    await store.clearDeviceKey();

    const output = logs.flat().map(String).join(' ');
    expect(output).not.toContain('secret-session-token');
    expect(output).not.toContain('secret-device-key');
  });
});
