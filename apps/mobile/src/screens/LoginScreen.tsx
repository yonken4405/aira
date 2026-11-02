/**
 * `LoginScreen` — the citizen login Secondary_Surface (mobile-citizen-account spec,
 * task 16.2; design §5 "Screens → LoginScreen").
 *
 * Reached from the account hub (anonymous state). It collects an email + password and
 * calls `login(email, password)` from `useCitizenAuth()`. The provider's `login` already
 * maps every API error to a `copyKey` (via the pure `errorToCopyKey`), so this screen
 * simply renders `t(outcome.copyKey)` on failure — it never re-derives the mapping.
 *
 * Behaviour (design §5; the Error → Copy_Catalog mapping table):
 *   - `{ok:true}` (200)                               → call `onSuccess?.()` (R4.2).
 *   - `{ok:false, copyKey:'citizenInvalidCredentials'}` (401) → show a SINGLE
 *     non-distinguishing message; never reveal whether the email or the password was
 *     wrong, never echo either value (R4.3).
 *   - `{ok:false, copyKey:'citizenAccountLocked', retryAfterSeconds:N}` (423) → show the
 *     locked message with the retry window derived from `retryAfterSeconds`; the screen
 *     computes `minutes = Math.ceil(N / 60)` and renders
 *     `t('citizenAccountLocked', { minutes })` (R4.4).
 *   - `{ok:false, copyKey:'citizenRateLimited', retryAfterSeconds:N}` (429) → show the
 *     message, DISABLE submit for N seconds, then re-enable via a self-cleaning countdown
 *     (R4.5).
 *
 * Secrets discipline (R4.6): the password is held in local state only to drive the
 * controlled input and is passed straight to `login`; it is never written to a log, the
 * store, or the error surface. Nothing on this screen logs the form.
 *
 * Operate Mode (DESIGN.md): tokens via NativeWind, Lucide icons via `lucide-react-native`,
 * no gradients/glow/bounce, no voice/chat/AI affordance (R12.6/R12.7). All copy goes
 * through `t()` from `@aira/ui` — no string literals (R12.5).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { ChevronLeft } from 'lucide-react-native';
import { t, type MessageKey } from '@aira/ui';

import { useCitizenAuth } from '../auth/CitizenAuthContext';

export interface LoginScreenProps {
  /** Called after a 200 (login resolves `{ok:true}`). */
  readonly onSuccess?: () => void;
  /** Return to the previous Secondary_Surface / grid (never gated). */
  readonly onBack: () => void;
}

/** Icon tint used for Lucide glyphs — the muted token value (DESIGN.md §2). */
const ICON_TINT = '#9FB0C0';

export function LoginScreen(props: LoginScreenProps): JSX.Element {
  const { onSuccess, onBack } = props;
  const { login } = useCitizenAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<MessageKey | null>(null);
  /** Minutes to display for the account-locked message; 0 when not locked. */
  const [lockMinutes, setLockMinutes] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  /** Seconds remaining on the rate-limit window; 0 means not rate-limited. */
  const [retryRemaining, setRetryRemaining] = useState(0);

  // Latest typed values mirrored into refs so `onSubmit` reads the current input even
  // between renders — the display `value` stays state-driven.
  const emailRef = useRef('');
  const passwordRef = useRef('');

  const onChangeEmail = useCallback((value: string): void => {
    emailRef.current = value;
    setEmail(value);
  }, []);

  const onChangePassword = useCallback((value: string): void => {
    passwordRef.current = value;
    setPassword(value);
  }, []);

  // Self-cleaning retry-after countdown. A single interval ticks the remaining seconds
  // down to 0; it is cleared on unmount and whenever the window changes (R4.5).
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearCountdown = useCallback((): void => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => clearCountdown, [clearCountdown]);

  const startCountdown = useCallback(
    (seconds: number): void => {
      clearCountdown();
      setRetryRemaining(seconds);
      intervalRef.current = setInterval(() => {
        setRetryRemaining((prev) => {
          if (prev <= 1) {
            clearCountdown();
            return 0;
          }
          return prev - 1;
        });
      }, 1_000);
    },
    [clearCountdown],
  );

  const rateLimited = retryRemaining > 0;
  const disabled = submitting || rateLimited;

  const onSubmit = useCallback(async (): Promise<void> => {
    // While disabled (in-flight or inside the retry-after window) the press is a no-op —
    // no extra login call (R4.5).
    if (disabled) {
      return;
    }
    setSubmitting(true);
    const outcome = await login(emailRef.current, passwordRef.current);
    setSubmitting(false);

    if (outcome.ok) {
      setError(null);
      setLockMinutes(0);
      onSuccess?.();
      return;
    }

    // The provider already resolved the copy key; just render it (R4.3–R4.5).
    setError(outcome.copyKey);
    if (outcome.copyKey === 'citizenAccountLocked' && outcome.retryAfterSeconds !== undefined) {
      // The screen computes whole minutes, rounding up (R4.4).
      setLockMinutes(Math.ceil(outcome.retryAfterSeconds / 60));
    } else {
      setLockMinutes(0);
    }
    if (outcome.copyKey === 'citizenRateLimited' && outcome.retryAfterSeconds !== undefined) {
      startCountdown(outcome.retryAfterSeconds);
    }
  }, [disabled, login, onSuccess, startCountdown]);

  // Resolve the error copy — `citizenAccountLocked` interpolates the computed `{minutes}`.
  const errorText =
    error === null
      ? null
      : error === 'citizenAccountLocked'
        ? t('citizenAccountLocked', { minutes: lockMinutes })
        : t(error);

  return (
    <View className="absolute inset-0 bg-ink">
      {/* Header — the back affordance is always available, never auth-gated (R1.5). */}
      <View className="border-b border-line bg-surface px-5 pb-4 pt-14">
        <View className="flex-row items-center gap-3">
          <Pressable
            testID="login-back"
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel={t('citizenBack')}
            className="h-10 w-10 items-center justify-center border border-line bg-raised active:opacity-75"
          >
            <ChevronLeft size={22} color={ICON_TINT} />
          </Pressable>
          <Text className="text-lg font-extrabold text-fg">{t('citizenLoginTitle')}</Text>
        </View>
      </View>

      <View className="flex-1 gap-4 p-4">
        <View className="gap-1.5">
          <Text className="text-[11px] font-bold uppercase text-muted">
            {t('citizenEmailLabel')}
          </Text>
          <TextInput
            testID="login-email"
            value={email}
            onChangeText={onChangeEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel={t('citizenEmailLabel')}
            className="border border-line bg-raised px-4 py-3 text-base text-fg"
          />
        </View>

        <View className="gap-1.5">
          <Text className="text-[11px] font-bold uppercase text-muted">
            {t('citizenPasswordLabel')}
          </Text>
          <TextInput
            testID="login-password"
            value={password}
            onChangeText={onChangePassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel={t('citizenPasswordLabel')}
            className="border border-line bg-raised px-4 py-3 text-base text-fg"
          />
        </View>

        {errorText !== null ? (
          <View testID="login-error" className="border border-status-error bg-raised px-4 py-3">
            <Text className="text-sm font-bold text-status-error">{errorText}</Text>
          </View>
        ) : null}

        <Pressable
          testID="login-submit"
          onPress={() => {
            void onSubmit();
          }}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          accessibilityLabel={t('citizenLogin')}
          className={`items-center border border-line bg-raised px-4 py-4 active:opacity-75 ${
            disabled ? 'opacity-50' : ''
          }`}
        >
          <Text className="text-base font-bold text-fg">{t('citizenLogin')}</Text>
        </Pressable>
      </View>
    </View>
  );
}
