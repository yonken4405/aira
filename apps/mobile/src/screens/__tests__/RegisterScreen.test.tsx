/**
 * Failing tests for `RegisterScreen` (mobile-citizen-account spec, task 15.1 — TDD RED;
 * implementation is task 15.2).
 *
 * The module under test does NOT exist yet: `../RegisterScreen` is the expected red.
 * These tests pin the exact component contract task 15.2 must satisfy (design §5
 * "Screens → RegisterScreen"; the Error → Copy_Catalog mapping table).
 *
 * ── PINNED CONTRACT FOR TASK 15.2 (design §5 "Screens → RegisterScreen") ──
 *
 *   import { RegisterScreen } from '../RegisterScreen';
 *
 *   // Props — navigation is passed in as callbacks; auth state/actions come from the hook.
 *   interface RegisterScreenProps {
 *     readonly onSuccess?: () => void; // called after a 201 (register resolves {ok:true})
 *     readonly onBack: () => void;     // return to the previous Secondary_Surface / grid
 *   }
 *
 *   The screen reads `register` + `connectivity` from `useCitizenAuth()`
 *   (../../auth/CitizenAuthContext):
 *     register(email, password): Promise<AuthOutcome>
 *       where AuthOutcome =
 *         | { ok: true }
 *         | { ok: false; copyKey: MessageKey; retryAfterSeconds?: number }.
 *   It renders no literals: ALL copy goes through `t()` from `@aira/ui` (R12.5).
 *   Icons (if any) come from `lucide-react-native` (R12.6); no voice/chat/AI affordance (R12.7).
 *
 * ── PINNED testIDs the implementation (15.2) MUST expose ──
 *
 *   Email input:                 testID="register-email"
 *   Password input:              testID="register-password"
 *   Submit button:               testID="register-submit"
 *   Error message (when shown):  testID="register-error"
 *   Back:                        testID="register-back"
 *
 * ── PINNED behaviour task 15.2 MUST satisfy ──
 *
 *   • Email + password fields render with `t('citizenEmailLabel')` / `t('citizenPasswordLabel')`
 *     labels (R2.1).
 *   • Submitting posts the entered email + password to `register(email, password)` (R2.2).
 *   • On `{ok:true}` (201): calls `onSuccess` (the provider flips to the Registered_Citizen
 *     state; the screen's job is to signal success) (R2.3).
 *   • On `{ok:false, copyKey:'citizenInvalidEmail'}` (400 invalid_email): shows
 *     `t('citizenInvalidEmail')` in the error node AND the email input RETAINS the entered
 *     value (R2.4).
 *   • On `{ok:false, copyKey:'citizenWeakPassword'}` (400 weak_password): shows
 *     `t('citizenWeakPassword')` (R2.5).
 *   • On `{ok:false, copyKey:'citizenRegistrationUnavailable'}` (409): shows the generic
 *     `t('citizenRegistrationUnavailable')` — no enumeration (R2.6).
 *   • On `{ok:false, copyKey:'citizenRateLimited', retryAfterSeconds:N}` (429): shows
 *     `t('citizenRateLimited')`, DISABLES submit, and RE-ENABLES it after N seconds
 *     (fake timers, R2.7). Disabled state is exposed via `accessibilityState.disabled`.
 *   • The entered password never appears in logs after the request resolves (console spy,
 *     R2.8).
 *
 * Requirements: 2.1, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { t } from '@aira/ui';
import type { Connectivity } from '@aira/ui';

import type { AuthOutcome, CitizenAuth } from '../../auth/CitizenAuthContext';

// The module under test — does not exist until task 15.2 (expected TDD red).
import { RegisterScreen } from '../RegisterScreen';

const EMAIL = 'new@example.com';
const PASSWORD = 'sup3r-secret-pw';

/**
 * Mock `useCitizenAuth` so each test drives `register()` deterministically. `register` is a
 * `jest.fn` whose per-case outcome is set with `mockResolvedValueOnce`. This pins the
 * screen's only auth dependency: the `useCitizenAuth()` hook (`register`, `connectivity`).
 */
const register = jest.fn<CitizenAuth['register']>();

let mockAuthValue: CitizenAuth;

jest.mock('../../auth/CitizenAuthContext', () => ({
  __esModule: true,
  useCitizenAuth: () => mockAuthValue,
}));

function setAuth(connectivity: Connectivity): void {
  mockAuthValue = {
    state: { kind: 'anonymous' },
    connectivity,
    register,
    login: jest.fn(async () => ({ ok: true }) as AuthOutcome) as CitizenAuth['login'],
    deviceAuth: jest.fn(async () => ({ ok: true }) as AuthOutcome) as CitizenAuth['deviceAuth'],
    restore: jest.fn(async () => undefined) as CitizenAuth['restore'],
    logout: jest.fn(async () => undefined) as CitizenAuth['logout'],
    deleteAccount: jest.fn(
      async () => ({ ok: true }) as AuthOutcome,
    ) as CitizenAuth['deleteAccount'],
  };
}

const onSuccess = jest.fn();
const onBack = jest.fn();

/** Render the screen with the standard navigation-callback props. */
function renderScreen(): ReturnType<typeof render> {
  return render(<RegisterScreen onSuccess={onSuccess} onBack={onBack} />);
}

/** Type the email + password into the pinned inputs. */
function fillForm(email = EMAIL, password = PASSWORD): void {
  fireEvent.changeText(screen.getByTestId('register-email'), email);
  fireEvent.changeText(screen.getByTestId('register-password'), password);
}

describe('RegisterScreen', () => {
  let logSpy: ReturnType<typeof jest.spyOn>;
  let warnSpy: ReturnType<typeof jest.spyOn>;
  let errorSpy: ReturnType<typeof jest.spyOn>;
  let infoSpy: ReturnType<typeof jest.spyOn>;
  let debugSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    register.mockReset();
    onSuccess.mockClear();
    onBack.mockClear();
    setAuth('online');
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    infoSpy.mockRestore();
    debugSpy.mockRestore();
  });

  // ── Fields render with t() labels (R2.1) ─────────────────────────────────────────────

  it('renders email + password fields and a submit button with t() copy', async () => {
    await renderScreen();

    expect(screen.getByTestId('register-email')).toBeTruthy();
    expect(screen.getByTestId('register-password')).toBeTruthy();
    expect(screen.getByTestId('register-submit')).toBeTruthy();
    expect(screen.getByTestId('register-back')).toBeTruthy();

    // Copy resolves through t() (R12.5) — no literals.
    expect(screen.getByText(t('citizenEmailLabel'))).toBeTruthy();
    expect(screen.getByText(t('citizenPasswordLabel'))).toBeTruthy();
    expect(screen.getByText(t('citizenRegister'))).toBeTruthy();
  });

  it('Back invokes the onBack navigation callback', async () => {
    await renderScreen();

    await fireEvent.press(screen.getByTestId('register-back'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  // ── Submit posts to register (R2.2) ──────────────────────────────────────────────────

  it('submitting posts the entered email + password to register()', async () => {
    register.mockResolvedValueOnce({ ok: true } as AuthOutcome);
    await renderScreen();

    fillForm();
    await fireEvent.press(screen.getByTestId('register-submit'));

    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    expect(register).toHaveBeenCalledWith(EMAIL, PASSWORD);
  });

  // ── 201 success persists session + registered state (R2.3) ───────────────────────────

  it('on a 201 (register resolves {ok:true}) calls onSuccess', async () => {
    register.mockResolvedValueOnce({ ok: true } as AuthOutcome);
    await renderScreen();

    fillForm();
    await fireEvent.press(screen.getByTestId('register-submit'));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    // No error surface on success.
    expect(screen.queryByTestId('register-error')).toBeNull();
  });

  // ── 400 invalid_email shows the message AND retains the email (R2.4) ──────────────────

  it('on 400 invalid_email shows the message and RETAINS the entered email', async () => {
    register.mockResolvedValueOnce({ ok: false, copyKey: 'citizenInvalidEmail' } as AuthOutcome);
    await renderScreen();

    fillForm();
    await fireEvent.press(screen.getByTestId('register-submit'));

    await waitFor(() => expect(screen.getByTestId('register-error')).toBeTruthy());
    expect(screen.getByText(t('citizenInvalidEmail'))).toBeTruthy();

    // The email input still holds the entered value (R2.4).
    expect(screen.getByTestId('register-email').props.value).toBe(EMAIL);

    // onSuccess is NOT fired on an error.
    expect(onSuccess).not.toHaveBeenCalled();
  });

  // ── 400 weak_password (R2.5) ─────────────────────────────────────────────────────────

  it('on 400 weak_password shows the weak-password message', async () => {
    register.mockResolvedValueOnce({ ok: false, copyKey: 'citizenWeakPassword' } as AuthOutcome);
    await renderScreen();

    fillForm();
    await fireEvent.press(screen.getByTestId('register-submit'));

    await waitFor(() => expect(screen.getByText(t('citizenWeakPassword'))).toBeTruthy());
    expect(onSuccess).not.toHaveBeenCalled();
  });

  // ── 409 registration_unavailable — generic, no enumeration (R2.6) ─────────────────────

  it('on 409 registration_unavailable shows the generic message (no enumeration)', async () => {
    register.mockResolvedValueOnce({
      ok: false,
      copyKey: 'citizenRegistrationUnavailable',
    } as AuthOutcome);
    await renderScreen();

    fillForm();
    await fireEvent.press(screen.getByTestId('register-submit'));

    await waitFor(() => expect(screen.getByText(t('citizenRegistrationUnavailable'))).toBeTruthy());
    // Generic copy must not reveal the email is already in use.
    expect(screen.queryByText(EMAIL)).toBeNull();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  // ── 429 rate_limited disables submit, re-enables after retry-after (R2.7) ─────────────

  describe('429 rate_limited (fake timers)', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });
    afterEach(() => {
      jest.runOnlyPendingTimers();
      jest.useRealTimers();
    });

    it('shows the rate-limited message, disables submit, then re-enables after retry-after seconds', async () => {
      register.mockResolvedValueOnce({
        ok: false,
        copyKey: 'citizenRateLimited',
        retryAfterSeconds: 30,
      } as AuthOutcome);
      await renderScreen();

      fillForm();
      await fireEvent.press(screen.getByTestId('register-submit'));

      // Message shown + submit disabled during the window.
      await waitFor(() => expect(screen.getByText(t('citizenRateLimited'))).toBeTruthy());
      expect(screen.getByTestId('register-submit').props.accessibilityState?.disabled).toBe(true);

      // Still disabled before the window elapses.
      await act(async () => {
        jest.advanceTimersByTime(29_000);
      });
      expect(screen.getByTestId('register-submit').props.accessibilityState?.disabled).toBe(true);

      // Re-enabled once the full retry-after window elapses (R2.7).
      await act(async () => {
        jest.advanceTimersByTime(1_000);
      });
      await waitFor(() =>
        expect(screen.getByTestId('register-submit').props.accessibilityState?.disabled).toBe(
          false,
        ),
      );
    });

    it('does not call register again while the retry-after window is active', async () => {
      register.mockResolvedValueOnce({
        ok: false,
        copyKey: 'citizenRateLimited',
        retryAfterSeconds: 10,
      } as AuthOutcome);
      await renderScreen();

      fillForm();
      await fireEvent.press(screen.getByTestId('register-submit'));
      await waitFor(() => expect(register).toHaveBeenCalledTimes(1));

      // Pressing again while disabled is a no-op.
      await fireEvent.press(screen.getByTestId('register-submit'));
      expect(register).toHaveBeenCalledTimes(1);
    });
  });

  // ── Password never leaks to logs after the request resolves (R2.8) ───────────────────

  it('never logs the entered password after the request resolves', async () => {
    register.mockResolvedValueOnce({ ok: true } as AuthOutcome);
    await renderScreen();

    fillForm();
    await fireEvent.press(screen.getByTestId('register-submit'));
    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));

    const everyLoggedArg = [logSpy, warnSpy, errorSpy, infoSpy, debugSpy]
      .flatMap((spy) => spy.mock.calls)
      .flat()
      .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
      .join('\n');

    expect(everyLoggedArg).not.toContain(PASSWORD);
  });

  it('never logs the entered password even when registration fails', async () => {
    register.mockResolvedValueOnce({ ok: false, copyKey: 'citizenWeakPassword' } as AuthOutcome);
    await renderScreen();

    fillForm();
    await fireEvent.press(screen.getByTestId('register-submit'));
    await waitFor(() => expect(screen.getByText(t('citizenWeakPassword'))).toBeTruthy());

    const everyLoggedArg = [logSpy, warnSpy, errorSpy, infoSpy, debugSpy]
      .flatMap((spy) => spy.mock.calls)
      .flat()
      .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
      .join('\n');

    expect(everyLoggedArg).not.toContain(PASSWORD);
  });
});
