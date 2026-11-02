import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { MEDICAL_BOUNDS, t } from '@aira/ui';

import type { CitizenApiClient, MedicalProfile } from '../../api/citizenClient';
import { MedicalProfileScreen } from '../MedicalProfileScreen';
import { clearPreservedDraft } from '../../medical/draft';
import {
  EMPTY_TEST_PROFILE,
  TEST_CITIZEN,
  createTestClient,
  createTestStore,
  renderWithAuth,
} from '../../test-utils/citizen';

const PROFILE: MedicalProfile = {
  bloodType: 'O-',
  ageBand: '18-39',
  allergies: ['penicillin'],
  conditions: ['asthma'],
  medications: [],
  notes: 'Carries an inhaler.',
  contacts: [{ name: 'Ben', phone: '0917-000-0000', relation: 'Brother' }],
};

async function setup(client = createTestClient(), store = createTestStore()) {
  const onBack = jest.fn();
  const onSessionExpired = jest.fn();
  await renderWithAuth(
    <MedicalProfileScreen onBack={onBack} onSessionExpired={onSessionExpired} />,
    {
      client,
      store,
      initialState: { kind: 'registered', citizen: TEST_CITIZEN },
    },
  );
  return { client, store, onBack, onSessionExpired };
}

describe('MedicalProfileScreen', () => {
  beforeEach(() => {
    clearPreservedDraft();
  });

  it('loads the owner profile once on open (R7.1/R7.5)', async () => {
    const client = createTestClient({
      getMedical: jest.fn(async () => ({
        ok: true as const,
        status: 200,
        data: PROFILE,
      })) as unknown as CitizenApiClient['getMedical'],
    });
    await setup(client);

    await waitFor(() => expect(screen.getByTestId('blood-type-O-')).toBeTruthy());
    expect(client.getMedical).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('medical-notes').props.value).toBe('Carries an inhaler.');
    expect(screen.getByTestId('contact-0-name').props.value).toBe('Ben');
    expect(screen.getByTestId('contact-0-phone').props.value).toBe('0917-000-0000');
    expect(screen.getByTestId('contact-0-relation').props.value).toBe('Brother');
  });

  it('treats an absent profile as a normal empty state (R7.4)', async () => {
    await setup();
    await waitFor(() => expect(screen.getByTestId('medical-empty')).toBeTruthy());
    expect(screen.getByTestId('medical-empty').props.children).toBe(t('citizenMedicalEmpty'));
    expect(screen.getByTestId('medical-save')).toBeTruthy();
  });

  it('shows a load failure with a retry control and recovers (R7.3/R11.4)', async () => {
    const getMedical = jest
      .fn()
      .mockResolvedValueOnce({ ok: false as const, kind: 'offline' as const })
      .mockResolvedValueOnce({ ok: true as const, status: 200, data: EMPTY_TEST_PROFILE });
    const client = createTestClient({
      getMedical: getMedical as unknown as CitizenApiClient['getMedical'],
    });
    await setup(client);

    await waitFor(() => expect(screen.getByTestId('medical-load-error')).toBeTruthy());
    expect(screen.getByTestId('medical-load-error').props.children).toBe(
      t('citizenMedicalLoadFailed'),
    );
    expect(screen.getByTestId('offline-notice')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('medical-retry'));
    await waitFor(() => expect(screen.getByTestId('medical-save')).toBeTruthy());
    expect(getMedical).toHaveBeenCalledTimes(2);
  });

  it('treats a 401 on load as session loss and leaves for sign-in (R7.9)', async () => {
    const store = createTestStore({ token: 'tok' });
    const client = createTestClient({
      getMedical: jest.fn(async () => ({
        ok: false as const,
        kind: 'http' as const,
        status: 401,
        code: 'unauthenticated',
      })) as unknown as CitizenApiClient['getMedical'],
    });
    const { onSessionExpired } = await setup(client, store);

    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledTimes(1));
    expect(store.secrets.token).toBeNull();
  });

  it('validates before saving and never PUTs an invalid draft (R7.7)', async () => {
    const client = createTestClient();
    await setup(client);
    await waitFor(() => expect(screen.getByTestId('medical-save')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('medical-allergies-add'));
    await fireEvent.changeText(
      screen.getByTestId('medical-allergies-0'),
      'a'.repeat(MEDICAL_BOUNDS.MAX_ITEM_LEN + 1),
    );
    await fireEvent.press(screen.getByTestId('medical-save'));

    await waitFor(() =>
      expect(screen.getByTestId('medical-save-error').props.children).toBe(
        t('citizenMedicalInvalid'),
      ),
    );
    expect(client.putMedical).not.toHaveBeenCalled();
  });

  it('rejects a contact without a name or phone (R8.4)', async () => {
    const client = createTestClient();
    await setup(client);
    await waitFor(() => expect(screen.getByTestId('contact-add')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('contact-add'));
    await fireEvent.press(screen.getByTestId('medical-save'));

    await waitFor(() =>
      expect(screen.getByTestId('medical-save-error').props.children).toBe(
        t('citizenContactInvalid'),
      ),
    );
    expect(client.putMedical).not.toHaveBeenCalled();
  });

  it('PUTs the exact draft and replaces it with the canonical response (R7.6/R7.8)', async () => {
    const canonical: MedicalProfile = {
      ...EMPTY_TEST_PROFILE,
      bloodType: 'A+',
      contacts: [{ name: 'Ana', phone: '0918-222-3333', relation: null }],
    };
    const putMedical = jest.fn(async () => ({
      ok: true as const,
      status: 200,
      data: canonical,
    }));
    const client = createTestClient({
      putMedical: putMedical as unknown as CitizenApiClient['putMedical'],
    });
    await setup(client);
    await waitFor(() => expect(screen.getByTestId('blood-type-unset')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('blood-type-A+'));
    await fireEvent.press(screen.getByTestId('contact-add'));
    await fireEvent.changeText(screen.getByTestId('contact-0-name'), 'Ana');
    await fireEvent.changeText(screen.getByTestId('contact-0-phone'), '0918-222-3333');
    await fireEvent.press(screen.getByTestId('medical-save'));

    await waitFor(() => expect(putMedical).toHaveBeenCalledTimes(1));
    expect(putMedical).toHaveBeenCalledWith(
      expect.objectContaining({
        bloodType: 'A+',
        contacts: [{ name: 'Ana', phone: '0918-222-3333', relation: null }],
      }),
    );
    // Canonical response wins after a successful save.
    await waitFor(() => expect(screen.getByTestId('medical-saved')).toBeTruthy());
    expect(screen.getByTestId('medical-saved').props.children).toBe(t('citizenProfileSaved'));
  });

  it('keeps edits when a save fails and reuses them on the retry (R7.10/R11.5)', async () => {
    const putMedical = jest
      .fn()
      .mockResolvedValueOnce({ ok: false as const, kind: 'offline' as const })
      .mockResolvedValueOnce({ ok: true as const, status: 200, data: EMPTY_TEST_PROFILE });
    const client = createTestClient({
      putMedical: putMedical as unknown as CitizenApiClient['putMedical'],
    });
    await setup(client);
    await waitFor(() => expect(screen.getByTestId('medical-allergies-add')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('medical-allergies-add'));
    await fireEvent.changeText(screen.getByTestId('medical-allergies-0'), 'peanuts');
    await fireEvent.press(screen.getByTestId('medical-save'));

    await waitFor(() =>
      expect(screen.getByTestId('medical-save-error').props.children).toBe(
        t('citizenMedicalSaveFailed'),
      ),
    );
    // The edit is still on screen and survives a remount.
    expect(screen.getByTestId('medical-allergies-0').props.value).toBe('peanuts');
    await waitFor(() => expect(screen.getByTestId('offline-notice')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('medical-save'));
    await waitFor(() => expect(putMedical).toHaveBeenCalledTimes(2));
    expect(putMedical).toHaveBeenLastCalledWith(
      expect.objectContaining({ allergies: ['peanuts'] }),
    );
  });

  it('leaves for sign-in when a save returns 401 (R7.9)', async () => {
    const store = createTestStore({ token: 'tok' });
    const client = createTestClient({
      putMedical: jest.fn(async () => ({
        ok: false as const,
        kind: 'http' as const,
        status: 401,
        code: 'unauthenticated',
      })) as unknown as CitizenApiClient['putMedical'],
    });
    const { onSessionExpired } = await setup(client, store);
    await waitFor(() => expect(screen.getByTestId('medical-save')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('medical-save'));
    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledTimes(1));
    expect(store.secrets.token).toBeNull();
  });

  it('confirms before deleting the profile, then shows the empty state (R9.1/R9.2)', async () => {
    const client = createTestClient({
      getMedical: jest.fn(async () => ({
        ok: true as const,
        status: 200,
        data: PROFILE,
      })) as unknown as CitizenApiClient['getMedical'],
    });
    await setup(client);
    await waitFor(() => expect(screen.getByTestId('medical-delete')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('medical-delete'));
    expect(screen.getByTestId('confirm-delete-profile')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('confirm-delete-profile-cancel'));
    expect(client.deleteMedical).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('medical-delete'));
    await fireEvent.press(screen.getByTestId('confirm-delete-profile-confirm'));

    await waitFor(() => expect(client.deleteMedical).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('medical-empty')).toBeTruthy());
  });

  it('retains the displayed profile when a delete is offline (R9.4/R11.1)', async () => {
    const client = createTestClient({
      getMedical: jest.fn(async () => ({
        ok: true as const,
        status: 200,
        data: PROFILE,
      })) as unknown as CitizenApiClient['getMedical'],
      deleteMedical: jest.fn(async () => ({
        ok: false as const,
        kind: 'offline' as const,
      })) as unknown as CitizenApiClient['deleteMedical'],
    });
    await setup(client);
    await waitFor(() => expect(screen.getByTestId('medical-delete')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('medical-delete'));
    await fireEvent.press(screen.getByTestId('confirm-delete-profile-confirm'));

    await waitFor(() =>
      expect(screen.getByTestId('medical-save-error').props.children).toBe(
        t('citizenOfflineUnavailable'),
      ),
    );
    expect(screen.getByTestId('medical-notes').props.value).toBe('Carries an inhaler.');
    expect(screen.getByTestId('offline-notice')).toBeTruthy();
  });
});
