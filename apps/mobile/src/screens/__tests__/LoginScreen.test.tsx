/**
 * Failing tests for `LoginScreen` (mobile-citizen-account spec, task 16.1 — TDD RED;
 * implementation is task 16.2).
 *
 * The module under test does NOT exist yet: `../LoginScreen` is the expected red.
 * These tests pin the exact component contract task 16.2 must satisfy (design §5
 * "Screens → LoginScreen"; the Error → Copy_Catalog mapping table).
 *
 * ── PINNED CONTRACT FOR TASK 16.2 (design §5 "Screens → LoginScreen") ──
 *
 *   import { LoginScreen } from '../LoginScreen';
 *
 *   // Props — navigation is passed in as callbacks; auth state/actions come from the hook.
 *   interface LoginScreenProps {
 *     readonly onSuccess?: () => void; // called after a 200 (login resolves {ok:true})
 *     readonly onBack: () => void;     // return to the previous Secondary_Surface / grid
 *   }
 *
 *   The screen reads `login` + `connectivity` from `useCitizenAuth()`
 *   (../../auth/CitizenAuthContext):
 *     login(email, password): Promise<AuthOutcome>
 *       where AuthOutcome =
 *         | { ok: true }
 *         | { ok: false; copyKey: MessageKey; retryAfterSeconds?: number }.
 *   It renders no literals: ALL copy goes through `t()` from `@aira/ui` (R12.5).
 *   Icons (if any) come from `lucide-react-native` (R12.6); no voice/chat/AI affordance (R12.7).
 *
 * ── PINNED testIDs the implementation (16.2) MUST expose ──
 *
 *   Email input:                 testID="login-email"
 *   Password input:              testID="login-password"
 *   Submit button:               testID="login-submit"
 *   Error message (when shown):  testID="login-error"
 *   Back:                        testID="login-back"
 *
 * ── PINNED behaviour task 16.2 MUST satisfy ──
 *
 *   • Email + password fields render with `t('citizenEmailLabel')` / `t('citizenPasswordLabel')`
 *     labels and the submit CTA uses `t('citizenLogin')` (R4.1).
 *   • Submitting posts the entered email + password to `login(email, password)` (R4.1).
 *   • On `{ok:true}` (200): calls `onSuccess` (the provider persists the Citizen_Session and
 *     flips to the Registered_Citizen state; the screen's job is to signal success) (R4.2).
 *   • On `{ok:false, copyKey:'citizenInvalidCredentials'}` (401 invalid_credentials): shows
 *     `t('citizenInvalidCredentials')` — a SINGLE non-distinguishing message that never reveals
 *     whether the email or the password was wrong (R4.3).
 *   • On `{ok:false, copyKey:'citizenAccountLocked', retryAfterSeconds:N}` (423 account_locked):
 *     shows the locked message with the retry window derived from `retryAfterSeconds`. The screen
 *     computes `minutes = Math.ceil(retryAfterSeconds / 60)` and renders
 *     `t('citizenAccountLocked', { minutes })` (R4.4). (The `{minutes}` interpolation of
 *     `citizenAccountLocked` is verified by task 1.1's i18n test.)
 *   • On `{ok:false, copyKey:'citizenRateLimited', retryAfterSeconds:N}` (429 rate_limited): shows
 *     `t('citizenRateLimited')`, DISABLES submit, and RE-ENABLES it after N seconds
 *     (fake timers, R4.5). Disabled state is exposed via `accessibilityState.disabled`;
 *     pressing while disabled does not re-call `login`.
 *   • The entered password never appears in logs after the request resolves — on BOTH the
 *     success and failure paths (console spy, R4.6).
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { t } from '@aira/ui';
import type { Connectivity } from '@aira/ui';

import type { AuthOutcome, CitizenAuth } from '../../auth/CitizenAuthContext';

// The module under test — does not exist until task 16.2 (expected TDD red).
import { LoginScreen } from '../LoginScreen';

const EMAIL = 'existing@example.com';
const PASSWORD = 'sup3r-secret-pw';

/**
 * Mock `useCitizenAuth` so each test drives `login()` deterministically. `login` is a
 * `jest.fn` whose per-case outcome is set with `mockResolvedValueOnce`. This pins the
 * screen's only auth dependency: the `useCitizenAuth()` hook (`login`, `connectivity`).
 */
const login = jest.fn<CitizenAuth['login']>();

let mockAuthValue: CitizenAuth;

jest.mock('../../auth/CitizenAuthContext', () => ({
  __esModule: true,
  useCitizenAuth: () => mockAuthValue,
}));

function setAuth(connectivity: Connectivity): void {
  mockAuthValue = {
    state: { kind: 'anonymous' },
    connectivity,
    register: jest.fn(async () => ({ ok: true }) as AuthOutcome) as CitizenAuth['register'],
    login,
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
  return render(<LoginScreen onSuccess={onSuccess} onBack={onBack} />);
}

/** Type the email + password into the pinned inputs. */
function fillForm(email = EMAIL, password = PASSWORD): void {
  fireEvent.changeText(screen.getByTestId('login-email'), email);
  fireEvent.changeText(screen.getByTestId('login-password'), password);
}

describe('LoginScreen', () => {
  let logSpy: ReturnType<typeof jest.spyOn>;
  let warnSpy: ReturnType<typeof jest.spyOn>;
  let errorSpy: ReturnType<typeof jest.spyOn>;
  let infoSpy: ReturnType<typeof jest.spyOn>;
  let debugSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    login.mockReset();
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

  // ── Fields render with t() labels + login CTA (R4.1) ─────────────────────────────────

  it('renders email + password fields and a submit button with t() copy', async () => {
    await renderScreen();

    expect(screen.getByTestId('login-email')).toBeTruthy();
    expect(screen.getByTestId('login-password')).toBeTruthy();
    expect(screen.getByTestId('login-submit')).toBeTruthy();
    expect(screen.getByTestId('login-back')).toBeTruthy();

    // Copy resolves through t() (R12.5) — no literals.
    expect(screen.getByText(t('citizenEmailLabel'))).toBeTruthy();
    expect(screen.getByText(t('citizenPasswordLabel'))).toBeTruthy();
    expect(screen.getByText(t('citizenLogin'))).toBeTruthy();
  });

  it('Back invokes the onBack navigation callback', async () => {
    await renderScreen();

    await fireEvent.press(screen.getByTestId('login-back'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  // ── Submit posts to login (R4.1) ─────────────────────────────────────────────────────

  it('submitting posts the entered email + password to login()', async () => {
    login.mockResolvedValueOnce({ ok: true } as AuthOutcome);
    await renderScreen();

    fillForm();
    await fireEvent.press(screen.getByTestId('login-submit'));

    await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
    expect(login).toHaveBeenCalledWith(EMAIL, PASSWORD);
  });

  // ── 200 success persists session + registered state → onSuccess (R4.2) ───────────────

  it('on a 200 (login resolves {ok:true}) calls onSuccess', async () => {
    login.mockResolvedValueOnce({ ok: true } as AuthOutcome);
    await renderScreen();

    fillForm();
    await fireEvent.press(screen.getByTestId('login-submit'));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    // No error surface on success.
    expect(screen.queryByTestId('login-error')).toBeNull();
  });

  // ── 401 invalid_credentials — single non-distinguishing message (R4.3) ────────────────

  it('on 401 invalid_credentials shows a single non-distinguishing message', async () => {
    login.mockResolvedValueOnce({
      ok: false,
      copyKey: 'citizenInvalidCredentials',
    } as AuthOutcome);
    await renderScreen();

    fillForm();
    await fireEvent.press(screen.getByTestId('login-submit'));

    await waitFor(() => expect(screen.getByTestId('login-error')).toBeTruthy());
    expect(screen.getByText(t('citizenInvalidCredentials'))).toBeTruthy();

    // The message must NOT distinguish email from password: neither value is echoed.
    expect(screen.queryByText(EMAIL)).toBeNull();
    expect(screen.queryByText(PASSWORD)).toBeNull();
    // onSuccess is NOT fired on an error.
    expect(onSuccess).not.toHaveBeenCalled();
  });

  // ── 423 account_locked — retry window derived from retryAfterSeconds as {minutes} (R4.4)

  it('on 423 account_locked shows the retry window derived from retryAfterSeconds as {minutes}', async () => {
    // 300s → ceil(300/60) = 5 minutes (unambiguous).
    const retryAfterSeconds = 300;
    login.mockResolvedValueOnce({
      ok: false,
      copyKey: 'citizenAccountLocked',
      retryAfterSeconds,
    } as AuthOutcome);
    await renderScreen();

    fillForm();
    await fireEvent.press(screen.getByTestId('login-submit'));

    const expectedMinutes = Math.ceil(retryAfterSeconds / 60); // 5
    await waitFor(() =>
      expect(
        screen.getByText(t('citizenAccountLocked', { minutes: expectedMinutes })),
      ).toBeTruthy(),
    );
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('rounds the account-locked retry window up to whole minutes (ceil)', async () => {
    // 90s → ceil(90/60) = 2 minutes (exercises the rounding-up rule).
    const retryAfterSeconds = 90;
    login.mockResolvedValueOnce({
      ok: false,
      copyKey: 'citizenAccountLocked',
      retryAfterSeconds,
    } as AuthOutcome);
    await renderScreen();

    fillForm();
    await fireEvent.press(screen.getByTestId('login-submit'));

    const expectedMinutes = Math.ceil(retryAfterSeconds / 60); // 2
    await waitFor(() =>
      expect(
        screen.getByText(t('citizenAccountLocked', { minutes: expectedMinutes })),
      ).toBeTruthy(),
    );
  });

  // ── 429 rate_limited disables submit, re-enables after retry-after (R4.5) ─────────────

  describe('429 rate_limited (fake timers)', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });
    afterEach(() => {
      jest.runOnlyPendingTimers();
      jest.useRealTimers();
    });

    it('shows the rate-limited message, disables submit, then re-enables after retry-after seconds', async () => {
      login.mockResolvedValueOnce({
        ok: false,
        copyKey: 'citizenRateLimited',
        retryAfterSeconds: 30,
      } as AuthOutcome);
      await renderScreen();

      fillForm();
      await fireEvent.press(screen.getByTestId('login-submit'));

      // Message shown + submit disabled during the window.
      await waitFor(() => expect(screen.getByText(t('citizenRateLimited'))).toBeTruthy());
      expect(screen.getByTestId('login-submit').props.accessibilityState?.disabled).toBe(true);

      // Still disabled before the window elapses.
      await act(async () => {
        jest.advanceTimersByTime(29_000);
      });
      expect(screen.getByTestId('login-submit').props.accessibilityState?.disabled).toBe(true);

      // Re-enabled once the full retry-after window elapses (R4.5).
      await act(async () => {
        jest.advanceTimersByTime(1_000);
      });
      await waitFor(() =>
        expect(screen.getByTestId('login-submit').props.accessibilityState?.disabled).toBe(false),
      );
    });

    it('does not call login again while the retry-after window is active', async () => {
      login.mockResolvedValueOnce({
        ok: false,
        copyKey: 'citizenRateLimited',
        retryAfterSeconds: 10,
      } as AuthOutcome);
      await renderScreen();

      fillForm();
      await fireEvent.press(screen.getByTestId('login-submit'));
      await waitFor(() => expect(login).toHaveBeenCalledTimes(1));

      // Pressing again while disabled is a no-op.
      await fireEvent.press(screen.getByTestId('login-submit'));
      expect(login).toHaveBeenCalledTimes(1);
    });
  });

  // ── Password never leaks to logs after the request resolves (R4.6) ───────────────────

  it('never logs the entered password after a successful login', async () => {
    login.mockResolvedValueOnce({ ok: true } as AuthOutcome);
    await renderScreen();

    fillForm();
    await fireEvent.press(screen.getByTestId('login-submit'));
    await waitFor(() => expect(login).toHaveBeenCalledTimes(1));

    const everyLoggedArg = [logSpy, warnSpy, errorSpy, infoSpy, debugSpy]
      .flatMap((spy) => spy.mock.calls)
      .flat()
      .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
      .join('\n');

    expect(everyLoggedArg).not.toContain(PASSWORD);
  });

  it('never logs the entered password even when login fails', async () => {
    login.mockResolvedValueOnce({
      ok: false,
      copyKey: 'citizenInvalidCredentials',
    } as AuthOutcome);
    await renderScreen();

    fillForm();
    await fireEvent.press(screen.getByTestId('login-submit'));
    await waitFor(() => expect(screen.getByText(t('citizenInvalidCredentials'))).toBeTruthy());

    const everyLoggedArg = [logSpy, warnSpy, errorSpy, infoSpy, debugSpy]
      .flatMap((spy) => spy.mock.calls)
      .flat()
      .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
      .join('\n');

    expect(everyLoggedArg).not.toContain(PASSWORD);
  });
});
