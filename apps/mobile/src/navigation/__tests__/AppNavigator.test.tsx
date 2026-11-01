import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { t } from '@aira/ui';

import { AppNavigator } from '../AppNavigator';
import type { CitizenApiClient } from '../../api/citizenClient';
import { TEST_CITIZEN, createTestClient, createTestStore } from '../../test-utils/citizen';

async function setup(overrides: Parameters<typeof createTestClient>[0] = {}) {
  const client = createTestClient(overrides);
  const store = createTestStore();
  await render(<AppNavigator client={client} store={store} />);
  return { client, store };
}

describe('AppNavigator', () => {
  it('opens on the SOS grid, never on a login wall (R1.1/R1.2)', async () => {
    await setup();

    expect(screen.getByTestId('sos-SUNOG')).toBeTruthy();
    expect(screen.getByTestId('sos-MEDIKAL')).toBeTruthy();
    expect(screen.getByTestId('sos-KRIMEN')).toBeTruthy();
    expect(screen.getByTestId('sos-BAHA')).toBeTruthy();
    expect(screen.queryByText(t('citizenRegisterTitle'))).toBeNull();
  });

  it('reaches the account hub from the grid affordance and returns with Back (R1.3/R1.4)', async () => {
    await setup();

    await fireEvent.press(screen.getByTestId('open-account'));
    expect(screen.getByText(t('citizenAccountTitle'))).toBeTruthy();

    await fireEvent.press(screen.getByTestId('screen-back'));
    expect(screen.getByTestId('sos-SUNOG')).toBeTruthy();
    expect(screen.queryByText(t('citizenAccountTitle'))).toBeNull();
  });

  it('navigates hub -> register -> hub and hub -> login -> hub', async () => {
    await setup();
    await fireEvent.press(screen.getByTestId('open-account'));

    await fireEvent.press(screen.getByTestId('account-register'));
    expect(screen.getByText(t('citizenRegisterTitle'))).toBeTruthy();
    await fireEvent.press(screen.getByTestId('screen-back'));
    expect(screen.getByText(t('citizenAccountTitle'))).toBeTruthy();

    await fireEvent.press(screen.getByTestId('account-login'));
    expect(screen.getByText(t('citizenLoginTitle'))).toBeTruthy();
    await fireEvent.press(screen.getByTestId('screen-back'));
    expect(screen.getByText(t('citizenAccountTitle'))).toBeTruthy();
  });

  it('keeps the grid interactive while the launch restore is offline (R6.4)', async () => {
    const store = createTestStore({ token: 'tok' });
    const client = createTestClient({
      getSession: jest.fn(async () => ({
        ok: false as const,
        kind: 'offline' as const,
      })) as unknown as CitizenApiClient['getSession'],
    });
    await render(<AppNavigator client={client} store={store} />);

    await fireEvent.press(screen.getByTestId('sos-BAHA'));
    await waitFor(() => expect(screen.getByTestId('last-payload')).toBeTruthy());
    expect(store.secrets.token).toBe('tok');
  });

  it('returns to the grid anonymous after account deletion', async () => {
    const client = createTestClient();
    const store = createTestStore({ token: 'tok', deviceKey: 'key' });
    await render(
      <AppNavigator
        client={client}
        store={store}
        initialState={{ kind: 'registered', citizen: TEST_CITIZEN }}
      />,
    );

    await fireEvent.press(screen.getByTestId('open-account'));
    await fireEvent.press(screen.getByTestId('account-delete'));
    await fireEvent.press(screen.getByTestId('confirm-delete-account-confirm'));

    await waitFor(() => expect(client.deleteAccount).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('sos-SUNOG')).toBeTruthy());
    expect(store.secrets.token).toBeNull();
    expect(store.secrets.deviceKey).toBeNull();
  });
});
