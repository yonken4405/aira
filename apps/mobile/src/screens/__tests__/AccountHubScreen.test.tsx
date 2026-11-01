import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { t } from '@aira/ui';

import type { CitizenApiClient } from '../../api/citizenClient';
import { AccountHubScreen } from '../AccountHubScreen';
import {
  TEST_CITIZEN,
  createTestClient,
  createTestStore,
  renderWithAuth,
} from '../../test-utils/citizen';

async function setup(overrides: Parameters<typeof renderWithAuth>[1] = {}) {
  const handlers = {
    onClose: jest.fn(),
    onRegister: jest.fn(),
    onLogin: jest.fn(),
    onMedical: jest.fn(),
    onDeleted: jest.fn(),
  };
  await renderWithAuth(<AccountHubScreen {...handlers} />, overrides);
  return handlers;
}

describe('AccountHubScreen', () => {
  it('offers register, login, and device-key entries when anonymous (R1.3/R2.1)', async () => {
    const handlers = await setup();

    expect(screen.getByText(t('citizenAccountTitle'))).toBeTruthy();
    expect(screen.getByTestId('account-register')).toBeTruthy();
    expect(screen.getByTestId('account-login')).toBeTruthy();
    expect(screen.getByTestId('account-device-auth')).toBeTruthy();
    expect(screen.queryByTestId('account-medical')).toBeNull();

    await fireEvent.press(screen.getByTestId('account-register'));
    await fireEvent.press(screen.getByTestId('account-login'));
    expect(handlers.onRegister).toHaveBeenCalledTimes(1);
    expect(handlers.onLogin).toHaveBeenCalledTimes(1);
  });

  it('provisions a device-key account in place', async () => {
    const client = createTestClient();
    await setup({ client });
    await fireEvent.press(screen.getByTestId('account-device-auth'));
    await waitFor(() => expect(client.deviceAuth).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('account-identity')).toBeTruthy());
  });

  it('shows the citizen email, medical entry, sign-out, and delete when registered', async () => {
    const handlers = await setup({ initialState: { kind: 'registered', citizen: TEST_CITIZEN } });

    expect(screen.getByTestId('account-identity').props.children).toBe('juan@example.com');
    await fireEvent.press(screen.getByTestId('account-medical'));
    expect(handlers.onMedical).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('account-sign-out')).toBeTruthy();
    expect(screen.getByTestId('account-delete')).toBeTruthy();
  });

  it('shows a device account without an email', async () => {
    await setup({
      initialState: {
        kind: 'registered',
        citizen: { id: 'c', email: null, emailVerified: false },
      },
    });
    expect(screen.getByTestId('account-identity').props.children).toBe(t('citizenNoEmail'));
  });

  it('confirms before signing out, then clears the session and returns to the grid (R5.5)', async () => {
    const store = createTestStore({ token: 'tok' });
    const client = createTestClient();
    const handlers = await setup({
      client,
      store,
      initialState: { kind: 'registered', citizen: TEST_CITIZEN },
    });

    await fireEvent.press(screen.getByTestId('account-sign-out'));
    expect(screen.getByTestId('confirm-sign-out')).toBeTruthy();

    // Cancel: nothing happens.
    await fireEvent.press(screen.getByTestId('confirm-sign-out-cancel'));
    expect(client.logout).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('account-sign-out'));
    await fireEvent.press(screen.getByTestId('confirm-sign-out-confirm'));

    await waitFor(() => expect(client.logout).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(store.secrets.token).toBeNull());
    await waitFor(() => expect(handlers.onClose).toHaveBeenCalledTimes(1));
  });

  it('confirms before deleting the account, then returns to the grid anonymous (R10.6)', async () => {
    const store = createTestStore({ token: 'tok', deviceKey: 'key' });
    const client = createTestClient();
    const handlers = await setup({
      client,
      store,
      initialState: { kind: 'registered', citizen: TEST_CITIZEN },
    });

    await fireEvent.press(screen.getByTestId('account-delete'));
    expect(screen.getByTestId('confirm-delete-account')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('confirm-delete-account-cancel'));
    expect(client.deleteAccount).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('account-delete'));
    await fireEvent.press(screen.getByTestId('confirm-delete-account-confirm'));

    await waitFor(() => expect(client.deleteAccount).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(store.secrets.token).toBeNull());
    expect(store.secrets.deviceKey).toBeNull();
    await waitFor(() => expect(handlers.onDeleted).toHaveBeenCalledTimes(1));
  });

  it('renders the offline treatment and disables Tier-2 entries when offline (R11.1/R11.2)', async () => {
    await setup({ initialConnectivity: 'offline' });

    expect(screen.getByTestId('offline-notice')).toBeTruthy();
    expect(screen.getByTestId('account-register').props.accessibilityState).toEqual({
      disabled: true,
    });
    expect(screen.getByTestId('account-device-auth').props.accessibilityState).toEqual({
      disabled: true,
    });
  });

  it('shows a device error copy without leaving the surface (R3.6)', async () => {
    const client = createTestClient({
      deviceAuth: jest.fn(async () => ({
        ok: false as const,
        kind: 'offline' as const,
      })) as unknown as CitizenApiClient['deviceAuth'],
    });
    await setup({ client });
    await fireEvent.press(screen.getByTestId('account-device-auth'));

    await waitFor(() => expect(screen.getByText(t('citizenDeviceUnavailable'))).toBeTruthy());
  });
});
