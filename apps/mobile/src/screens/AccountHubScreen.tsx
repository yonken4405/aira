import { HeartPulse, ShieldCheck, UserRound } from 'lucide-react-native';
import { useState, type ReactElement } from 'react';
import { Text, View } from 'react-native';

import { t, type MessageKey } from '@aira/ui';

import { useCitizenAuth } from '../auth/CitizenAuthContext';
import { ActionButton } from '../components/ActionButton';
import { InlineConfirm } from '../components/InlineConfirm';
import { OfflineNotice } from '../components/OfflineNotice';
import { ScreenShell } from '../components/ScreenShell';
import { ICON_MUTED_COLOR } from '../theme';

export interface AccountHubScreenProps {
  readonly onClose: () => void;
  readonly onRegister: () => void;
  readonly onLogin: () => void;
  readonly onMedical: () => void;
  /** After account deletion the citizen returns to the SOS grid anonymous. */
  readonly onDeleted: () => void;
}

type Confirm = 'signOut' | 'deleteAccount' | null;

/**
 * Secondary_Surface entry point (R1.3/R5/R10). Anonymous: register / login / device key.
 * Registered: email, medical profile, sign out, delete account. Tier-2 actions degrade
 * to an honest offline state (R11.1/R11.2).
 */
export function AccountHubScreen({
  onClose,
  onRegister,
  onLogin,
  onMedical,
  onDeleted,
}: AccountHubScreenProps): ReactElement {
  const { state, connectivity, deviceAuth, logout, deleteAccount } = useCitizenAuth();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [error, setError] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);

  const offline = connectivity === 'offline';
  const registered = state.kind === 'registered';
  const citizen = state.kind === 'registered' ? state.citizen : null;

  async function handleDeviceAuth(): Promise<void> {
    setBusy(true);
    setError(null);
    const outcome = await deviceAuth();
    if (!outcome.ok) {
      setError(outcome.copyKey);
    }
    setBusy(false);
  }

  async function handleSignOut(): Promise<void> {
    setBusy(true);
    await logout();
    setBusy(false);
    setConfirm(null);
    onClose();
  }

  async function handleDeleteAccount(): Promise<void> {
    setBusy(true);
    setError(null);
    const outcome = await deleteAccount();
    setBusy(false);
    setConfirm(null);
    if (outcome.ok) {
      onDeleted();
      return;
    }
    setError(outcome.copyKey);
  }

  return (
    <ScreenShell
      title={t('citizenAccountTitle')}
      subtitle={t('citizenAccountSubtitle')}
      onBack={onClose}
    >
      {offline ? <OfflineNotice /> : null}
      {error ? <Text className="text-sm text-status-error">{t(error)}</Text> : null}

      {!registered ? (
        <View className="gap-3">
          <View className="flex-row items-center gap-2">
            <UserRound size={18} color={ICON_MUTED_COLOR} />
            <Text className="text-sm text-muted">{t('citizenAccountAnonymous')}</Text>
          </View>
          <ActionButton
            testID="account-register"
            label={t('citizenRegister')}
            disabled={offline || busy}
            onPress={onRegister}
          />
          <ActionButton
            testID="account-login"
            label={t('citizenLogin')}
            tone="secondary"
            disabled={offline || busy}
            onPress={onLogin}
          />
          <ActionButton
            testID="account-device-auth"
            label={t('citizenUseDeviceKey')}
            tone="secondary"
            disabled={offline || busy}
            onPress={() => {
              void handleDeviceAuth();
            }}
          />
          <Text className="text-xs text-muted">{t('citizenDeviceHint')}</Text>
        </View>
      ) : (
        <View className="gap-3">
          <View className="flex-row items-center gap-2">
            <ShieldCheck size={18} color={ICON_MUTED_COLOR} />
            <Text testID="account-identity" className="flex-1 text-sm text-fg">
              {citizen?.email ?? t('citizenNoEmail')}
            </Text>
          </View>
          <ActionButton
            testID="account-medical"
            label={t('citizenMedicalTitle')}
            disabled={offline || busy}
            onPress={onMedical}
          />
          <View className="flex-row items-center gap-2">
            <HeartPulse size={16} color={ICON_MUTED_COLOR} />
            <Text className="text-xs text-muted">{t('citizenMedicalSubtitle')}</Text>
          </View>
          <ActionButton
            testID="account-sign-out"
            label={t('citizenSignOut')}
            tone="secondary"
            disabled={busy}
            onPress={() => setConfirm('signOut')}
          />
          <ActionButton
            testID="account-delete"
            label={t('citizenDeleteAccount')}
            tone="danger"
            disabled={offline || busy}
            onPress={() => setConfirm('deleteAccount')}
          />
        </View>
      )}

      {confirm === 'signOut' ? (
        <InlineConfirm
          testID="confirm-sign-out"
          title={t('citizenSignOutConfirmTitle')}
          body={t('citizenSignOutConfirmBody')}
          confirmLabel={t('citizenSignOut')}
          onConfirm={() => {
            void handleSignOut();
          }}
          onCancel={() => setConfirm(null)}
        />
      ) : null}

      {confirm === 'deleteAccount' ? (
        <InlineConfirm
          testID="confirm-delete-account"
          title={t('citizenDeleteAccountConfirmTitle')}
          body={t('citizenDeleteAccountConfirmBody')}
          confirmLabel={t('citizenDeleteAccount')}
          tone="danger"
          onConfirm={() => {
            void handleDeleteAccount();
          }}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
    </ScreenShell>
  );
}
