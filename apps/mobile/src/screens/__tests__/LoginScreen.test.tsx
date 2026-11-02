import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { t } from '@aira/ui';

import type { CitizenApiClient } from '../../api/citizenClient';
import { LoginScreen } from '../LoginScreen';
import {
  TEST_CITIZEN,
  createTestClient,
  createTestStore,
  renderWithAuth,
} from '../../test-utils/citizen';

function failure(status: number, code: string, retryAfterSeconds?: number) {
  return retryAfterSeconds === undefined
    ? { ok: false as const, kind: 'http' as const, status, code }
    : { ok: false as const, kind: 'http' as const, status, code, retryAfterSeconds };
}

async function setup(client = createTestClient(), store = createTestStore()) {
  const onBack = jest.fn();
  const onSuccess = jest.fn();
  await renderWithAuth(<LoginScreen onBack={onBack} onSuccess={onSuccess} />, { client, store });
  return { client, store, onBack, onSuccess };
}

async function fill(email = 'juan@example.com', password = 'correct horse battery staple') {
  await fireEvent.changeText(screen.getByTestId('login-email'), email);
  await fireEvent.changeText(screen.getByTestId('login-password'), password);
}

describe('LoginScreen', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders the sign-in surface (R4.1)', async () => {
    await setup();
    expect(screen.getByText(t('citizenLoginTitle'))).toBeTruthy();
    expect(screen.getByText(t('citizenEmailLabel'))).toBeTruthy();
    expect(screen.getByText(t('citizenPasswordLabel'))).toBeTruthy();
  });

  it('signs in and persists the session token (R4.2)', async () => {
    const store = createTestStore();
    const client = createTestClient({
      login: jest.fn(async () => {
        await store.setSessionToken('session-token');
        return { ok: true as const, status: 200, data: TEST_CITIZEN };
      }) as unknown as CitizenApiClient['login'],
    });
    const { onSuccess } = await setup(client, store);

    await fill();
    await fireEvent.press(screen.getByTestId('login-submit'));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(client.login).toHaveBeenCalledWith('juan@example.com', 'correct horse battery staple');
    expect(store.secrets.token).toBe('session-token');
  });

  it('shows one generic message for a wrong email or password (R4.3)', async () => {
    const client = createTestClient({
      login: jest.fn(async () =>
        failure(401, 'invalid_credentials'),
      ) as unknown as CitizenApiClient['login'],
    });
    const { onSuccess } = await setup(client);

    await fill('juan@example.com', 'wrong-password');
    await fireEvent.press(screen.getByTestId('login-submit'));

    await waitFor(() =>
      expect(screen.getByTestId('login-error').props.children).toBe(t('citizenInvalidCredentials')),
    );
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.getByTestId('login-email').props.value).toBe('juan@example.com');
  });

  it('shows the lockout window and disables submit (R4.4)', async () => {
    jest.useFakeTimers();
    const client = createTestClient({
      login: jest.fn(async () =>
        failure(423, 'account_locked', 120),
      ) as unknown as CitizenApiClient['login'],
    });
    await setup(client);

    await fill();
    await fireEvent.press(screen.getByTestId('login-submit'));

    await waitFor(() =>
      expect(screen.getByTestId('login-error').props.children).toBe(
        t('citizenAccountLocked', { minutes: 2 }),
      ),
    );
    expect(screen.getByTestId('login-submit').props.accessibilityState).toEqual({ disabled: true });
  });

  it('offers the rate-limit countdown (R4.5)', async () => {
    jest.useFakeTimers();
    const client = createTestClient({
      login: jest.fn(async () =>
        failure(429, 'rate_limited', 3),
      ) as unknown as CitizenApiClient['login'],
    });
    await setup(client);

    await fill();
    await fireEvent.press(screen.getByTestId('login-submit'));

    await waitFor(() =>
      expect(screen.getByTestId('login-cooldown').props.children).toBe(
        t('citizenTryAgainIn', { seconds: 3 }),
      ),
    );
  });

  it('drops the password after the request resolves and never logs it (R4.6)', async () => {
    const logs: unknown[][] = [];
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logs.push(args);
      }),
    );
    try {
      const client = createTestClient({
        login: jest.fn(async () =>
          failure(401, 'invalid_credentials'),
        ) as unknown as CitizenApiClient['login'],
      });
      await setup(client);
      await fill('juan@example.com', 'super-secret-password');
      await fireEvent.press(screen.getByTestId('login-submit'));

      await waitFor(() => expect(screen.getByTestId('login-error')).toBeTruthy());
      expect(screen.getByTestId('login-password').props.value).toBe('');
      expect(logs.flat().map(String).join(' ')).not.toContain('super-secret-password');
    } finally {
      for (const spy of spies) {
        spy.mockRestore();
      }
    }
  });
});
