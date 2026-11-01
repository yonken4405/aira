/**
 * Test doubles shared by the mobile component tests: an in-memory `SessionStore`, a
 * mocked `CitizenApiClient`, and a provider wrapper.
 */

import type { CitizenAuthState, CitizenView, Connectivity } from '@aira/ui';
import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import type { CitizenApiClient, MedicalProfile } from '../api/citizenClient';
import { CitizenAuthProvider } from '../auth/CitizenAuthContext';
import type { SessionStore } from '../storage/sessionStore';

export const TEST_CITIZEN: CitizenView = {
  id: 'citizen-1',
  email: 'juan@example.com',
  emailVerified: false,
};

export const EMPTY_TEST_PROFILE: MedicalProfile = {
  bloodType: null,
  ageBand: null,
  allergies: [],
  conditions: [],
  medications: [],
  notes: null,
  contacts: [],
};

export type TestStore = SessionStore & {
  readonly secrets: { token: string | null; deviceKey: string | null };
};

export function createTestStore(initial: { token?: string; deviceKey?: string } = {}): TestStore {
  const secrets = { token: initial.token ?? null, deviceKey: initial.deviceKey ?? null };
  return {
    secrets,
    getSessionToken: async () => secrets.token,
    setSessionToken: async (token) => {
      secrets.token = token;
    },
    clearSessionToken: async () => {
      secrets.token = null;
    },
    getDeviceKey: async () => secrets.deviceKey,
    setDeviceKey: async (key) => {
      secrets.deviceKey = key;
    },
    clearDeviceKey: async () => {
      secrets.deviceKey = null;
    },
  };
}

export function createTestClient(overrides: Partial<CitizenApiClient> = {}): CitizenApiClient {
  return {
    register: jest.fn(async () => ({ ok: true, status: 201, data: TEST_CITIZEN })),
    login: jest.fn(async () => ({ ok: true, status: 200, data: TEST_CITIZEN })),
    deviceAuth: jest.fn(async () => ({ ok: true, status: 200, data: TEST_CITIZEN })),
    getSession: jest.fn(async () => ({ ok: true, status: 200, data: TEST_CITIZEN })),
    logout: jest.fn(async () => ({ ok: true, status: 204, data: undefined })),
    getMedical: jest.fn(async () => ({ ok: true, status: 200, data: EMPTY_TEST_PROFILE })),
    putMedical: jest.fn(async () => ({ ok: true, status: 200, data: EMPTY_TEST_PROFILE })),
    deleteMedical: jest.fn(async () => ({ ok: true, status: 204, data: undefined })),
    deleteAccount: jest.fn(async () => ({ ok: true, status: 204, data: undefined })),
    ...overrides,
  } as CitizenApiClient;
}

export interface RenderWithAuthOptions {
  readonly client?: CitizenApiClient;
  readonly store?: SessionStore;
  readonly initialState?: CitizenAuthState;
  readonly initialConnectivity?: Connectivity;
  readonly generateKey?: () => string;
}

export function renderWithAuth(
  ui: ReactElement,
  options: RenderWithAuthOptions = {},
): ReturnType<typeof render> {
  return render(
    <CitizenAuthProvider
      client={options.client ?? createTestClient()}
      store={options.store ?? createTestStore()}
      initialState={options.initialState}
      initialConnectivity={options.initialConnectivity}
      generateKey={options.generateKey}
    >
      {ui}
    </CitizenAuthProvider>,
  );
}
