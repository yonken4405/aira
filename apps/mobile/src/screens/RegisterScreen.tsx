import { useEffect, useState, type ReactElement } from 'react';
import { Text, View } from 'react-native';

import { t, type MessageKey } from '@aira/ui';

import { useCitizenAuth } from '../auth/CitizenAuthContext';
import { ActionButton } from '../components/ActionButton';
import { OfflineNotice } from '../components/OfflineNotice';
import { ScreenShell } from '../components/ScreenShell';
import { TextField } from '../components/TextField';

export interface RegisterScreenProps {
  readonly onBack: () => void;
  readonly onSuccess: () => void;
}

/** Optional email registration (R2). Never a gate in front of the SOS grid. */
export function RegisterScreen({ onBack, onSuccess }: RegisterScreenProps): ReactElement {
  const { register, connectivity } = useCitizenAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) {
      return;
    }
    const timer = setTimeout(() => setCooldown((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function submit(): Promise<void> {
    if (busy || cooldown > 0) {
      return;
    }
    setBusy(true);
    setError(null);
    const outcome = await register(email, password);
    // The password is dropped as soon as the request resolves (R2.8).
    setPassword('');
    setBusy(false);

    if (outcome.ok) {
      onSuccess();
      return;
    }
    setError(outcome.copyKey);
    if (outcome.retryAfterSeconds !== undefined && outcome.retryAfterSeconds > 0) {
      setCooldown(outcome.retryAfterSeconds);
    }
  }

  return (
    <ScreenShell
      title={t('citizenRegisterTitle')}
      subtitle={t('citizenRegisterSubtitle')}
      onBack={onBack}
    >
      {connectivity === 'offline' ? <OfflineNotice /> : null}
      <TextField
        testID="register-email"
        label={t('citizenEmailLabel')}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      <TextField
        testID="register-password"
        label={t('citizenPasswordLabel')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
      />
      {error ? (
        <Text testID="register-error" className="text-sm text-status-error">
          {t(error)}
        </Text>
      ) : null}
      {cooldown > 0 ? (
        <Text testID="register-cooldown" className="text-xs text-muted">
          {t('citizenTryAgainIn', { seconds: cooldown })}
        </Text>
      ) : null}
      <View className="gap-2">
        <ActionButton
          testID="register-submit"
          label={t('citizenRegister')}
          disabled={busy || cooldown > 0 || email.length === 0 || password.length === 0}
          onPress={() => {
            void submit();
          }}
        />
      </View>
    </ScreenShell>
  );
}
