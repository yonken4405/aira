import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { t } from '@aira/ui';

import type { CitizenApiClient } from '../../api/citizenClient';
import { RegisterScreen } from '../RegisterScreen';
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

async function setup(client = createTestClient()) {
  const onBack = jest.fn();
  const onSuccess = jest.fn();
  await renderWithAuth(<RegisterScreen onBack={onBack} onSuccess={onSuccess} />, {
    client,
  });
  return { client, onBack, onSuccess };
}

async function fill(email = 'juan@example.com', password = 'correct horse battery staple') {
  await fireEvent.changeText(screen.getByTestId('register-email'), email);
  await fireEvent.changeText(screen.getByTestId('register-password'), password);
}

describe('RegisterScreen', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders email and password fields with catalog labels (R2.1)', async () => {
    await setup();
    expect(screen.getByText(t('citizenRegisterTitle'))).toBeTruthy();
    expect(screen.getByText(t('citizenEmailLabel'))).toBeTruthy();
    expect(screen.getByText(t('citizenPasswordLabel'))).toBeTruthy();
  });

  it('submits email and password and persists the session on 201 (R2.2/R2.3)', async () => {
    const store = createTestStore();
    const client = createTestClient({
      register: jest.fn(async () => {
        await store.setSessionToken('session-token');
        return { ok: true as const, status: 201, data: TEST_CITIZEN };
      }) as unknown as CitizenApiClient['register'],
    });
    const onSuccess = jest.fn();
    await renderWithAuth(<RegisterScreen onBack={jest.fn()} onSuccess={onSuccess} />, {
      client,
      store,
    });

    await fill();
    await fireEvent.press(screen.getByTestId('register-submit'));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(client.register).toHaveBeenCalledWith(
      'juan@example.com',
      'correct horse battery staple',
    );
    expect(store.secrets.token).toBe('session-token');
  });

  it('shows invalid-email copy and retains the entered email (R2.4)', async () => {
    const client = createTestClient({
      register: jest.fn(async () =>
        failure(400, 'invalid_email'),
      ) as unknown as CitizenApiClient['register'],
    });
    await setup(client);
    await fill('not-an-email');
    await fireEvent.press(screen.getByTestId('register-submit'));

    await waitFor(() =>
      expect(screen.getByTestId('register-error').props.children).toBe(t('citizenInvalidEmail')),
    );
    expect(screen.getByTestId('register-email').props.value).toBe('not-an-email');
  });

  it('maps weak_password and registration_unavailable (R2.5/R2.6)', async () => {
    const weak = createTestClient({
      register: jest.fn(async () =>
        failure(400, 'weak_password'),
      ) as unknown as CitizenApiClient['register'],
    });
    const first = await setup(weak);
    await fill();
    await fireEvent.press(screen.getByTestId('register-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('register-error').props.children).toBe(t('citizenWeakPassword')),
    );
    expect(first.onSuccess).not.toHaveBeenCalled();

    const conflict = createTestClient({
      register: jest.fn(async () =>
        failure(409, 'registration_unavailable'),
      ) as unknown as CitizenApiClient['register'],
    });
    const second = await setup(conflict);
    await fill();
    await fireEvent.press(screen.getByTestId('register-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('register-error').props.children).toBe(
        t('citizenRegistrationUnavailable'),
      ),
    );
    expect(second.onSuccess).not.toHaveBeenCalled();
  });

  it('disables submit during the rate-limit window then re-enables it (R2.7)', async () => {
    jest.useFakeTimers();
    const client = createTestClient({
      register: jest.fn(async () =>
        failure(429, 'rate_limited', 2),
      ) as unknown as CitizenApiClient['register'],
    });
    await setup(client);
    await fill();
    await fireEvent.press(screen.getByTestId('register-submit'));

    await waitFor(() =>
      expect(screen.getByTestId('register-cooldown').props.children).toBe(
        t('citizenTryAgainIn', { seconds: 2 }),
      ),
    );
    expect(screen.getByTestId('register-submit').props.accessibilityState).toMatchObject({
      disabled: true,
    });

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    // The password is cleared on submit for security (R2.8), so a real user re-types it
    // before the retry window closes. Once the cooldown elapses, submission re-enables (R2.7).
    await fill();

    await waitFor(() =>
      expect(screen.getByTestId('register-submit').props.accessibilityState).toMatchObject({
        disabled: false,
      }),
    );
  });

  it('never keeps or logs the password after the request resolves (R2.8)', async () => {
    const logs: unknown[][] = [];
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logs.push(args);
      }),
    );
    try {
      const client = createTestClient({
        register: jest.fn(async () =>
          failure(400, 'weak_password'),
        ) as unknown as CitizenApiClient['register'],
      });
      await setup(client);
      await fill('juan@example.com', 'super-secret-password');
      await fireEvent.press(screen.getByTestId('register-submit'));

      await waitFor(() => expect(screen.getByTestId('register-error')).toBeTruthy());
      expect(screen.getByTestId('register-password').props.value).toBe('');
      expect(logs.flat().map(String).join(' ')).not.toContain('super-secret-password');
    } finally {
      for (const spy of spies) {
        spy.mockRestore();
      }
    }
  });
});
