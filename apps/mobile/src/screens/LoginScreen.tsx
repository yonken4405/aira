import { useEffect, useState, type ReactElement } from 'react';
import { Text } from 'react-native';

import { t, type MessageKey } from '@aira/ui';

import { useCitizenAuth } from '../auth/CitizenAuthContext';
import { ActionButton } from '../components/ActionButton';
import { OfflineNotice } from '../components/OfflineNotice';
import { ScreenShell } from '../components/ScreenShell';
import { TextField } from '../components/TextField';

export interface LoginScreenProps {
  readonly onBack: () => void;
  readonly onSuccess: () => void;
}

/** Email sign-in (R4). One message for a wrong email or password (R4.3). */
export function LoginScreen({ onBack, onSuccess }: LoginScreenProps): ReactElement {
  const { login, connectivity } = useCitizenAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<MessageKey | null>(null);
  const [minutes, setMinutes] = useState<number | null>(null);
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
    setMinutes(null);
    const outcome = await login(email, password);
    // The password is dropped as soon as the request resolves (R4.6).
    setPassword('');
    setBusy(false);

    if (outcome.ok) {
      onSuccess();
      return;
    }
    setError(outcome.copyKey);
    if (outcome.copyKey === 'citizenAccountLocked') {
      setMinutes(Math.max(1, Math.ceil((outcome.retryAfterSeconds ?? 0) / 60)));
    }
    if (outcome.retryAfterSeconds !== undefined && outcome.retryAfterSeconds > 0) {
      setCooldown(outcome.retryAfterSeconds);
    }
  }

  const errorText =
    error === 'citizenAccountLocked' && minutes !== null
      ? t('citizenAccountLocked', { minutes })
      : error
        ? t(error)
        : null;

  return (
    <ScreenShell
      title={t('citizenLoginTitle')}
      subtitle={t('citizenLoginSubtitle')}
      onBack={onBack}
    >
      {connectivity === 'offline' ? <OfflineNotice /> : null}
      <TextField
        testID="login-email"
        label={t('citizenEmailLabel')}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      <TextField
        testID="login-password"
        label={t('citizenPasswordLabel')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
      />
      {errorText ? (
        <Text testID="login-error" className="text-sm text-status-error">
          {errorText}
        </Text>
      ) : null}
      {cooldown > 0 ? (
        <Text testID="login-cooldown" className="text-xs text-muted">
          {t('citizenTryAgainIn', { seconds: cooldown })}
        </Text>
      ) : null}
      <ActionButton
        testID="login-submit"
        label={t('citizenLogin')}
        disabled={busy || cooldown > 0 || email.length === 0 || password.length === 0}
        onPress={() => {
          void submit();
        }}
      />
    </ScreenShell>
  );
}
