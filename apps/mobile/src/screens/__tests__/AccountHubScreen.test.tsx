/**
 * Failing tests for `AccountHubScreen` (mobile-citizen-account spec, task 14.1 — TDD RED;
 * implementation is task 14.2).
 *
 * The module under test does NOT exist yet: `../AccountHubScreen` is the expected red.
 * These tests pin the exact component contract task 14.2 must satisfy (design §5 "Screens"
 * — AccountHubScreen).
 *
 * ── PINNED CONTRACT FOR TASK 14.2 (design §5 "Screens → AccountHubScreen") ──
 *
 *   import { AccountHubScreen } from '../AccountHubScreen';
 *
 *   // Props — navigation is passed in as callbacks; auth state/actions come from the hook.
 *   interface AccountHubScreenProps {
 *     readonly onOpenRegister: () => void; // anonymous: open the register Secondary_Surface
 *     readonly onOpenLogin: () => void;    // anonymous: open the login Secondary_Surface
 *     readonly onOpenMedical: () => void;  // registered: open the medical Secondary_Surface
 *     readonly onBack: () => void;         // always: return to the SOS grid (never gated, R1.5)
 *   }
 *
 *   The screen reads auth from `useCitizenAuth()` (../../auth/CitizenAuthContext):
 *     { state: CitizenAuthState, connectivity: Connectivity,
 *       deviceAuth(), logout(), deleteAccount() }.
 *   It renders no literals: ALL copy goes through `t()` from `@aira/ui` (R12.5).
 *   Icons come from `lucide-react-native` (R12.6); no voice/chat/AI affordance (R12.7).
 *
 * ── PINNED testIDs the implementation (14.2) MUST expose ──
 *
 *   Back (always available, never gated):        testID="account-hub-back"
 *
 *   Anonymous state (R1.3/R2.1):
 *     Register entry:                             testID="account-row-register"
 *     Login entry:                                testID="account-row-login"
 *     Device-key entry:                           testID="account-row-device-key"
 *
 *   Registered state:
 *     Citizen email (only when non-null):         testID="account-email"
 *     Medical-profile entry (R7/R1.3):            testID="account-row-medical"
 *     Sign out entry (R5):                        testID="account-row-signout"
 *     Delete account entry (R10.6):               testID="account-row-delete"
 *
 *   Confirm-first affordances (an in-screen ConfirmDialog-equivalent for RN):
 *     Sign out  — opening shows a confirm dialog with:
 *                   testID="account-signout-confirm"  (confirm button → calls logout)
 *                   testID="account-signout-cancel"   (dismiss, no logout)
 *     Delete    — opening shows a confirm dialog with:
 *                   testID="account-delete-confirm"   (confirm button → calls deleteAccount)
 *                   testID="account-delete-cancel"    (dismiss, no deleteAccount)
 *     Neither action calls its auth method until the user confirms (R5.5/R10.6).
 *
 *   Tier-2 offline treatment (R11.1/R11.2) — WHILE connectivity === 'offline', EVERY Tier-2
 *   row (register, login, device-key, medical, delete-account) renders an honest
 *   "unavailable offline" treatment. The treatment is detectable by a sibling offline node
 *   per row, testID="<row-testID>-offline" (e.g. "account-row-medical-offline"), carrying
 *   the `t('citizenOfflineTitle')` / `t('citizenOfflineUnavailable')` copy, AND the row's
 *   action is inert (does not navigate / does not call its auth method). The offline
 *   treatment must be present on first synchronous render (within the 1 s budget, R11.2).
 *   The back/grid return is ALWAYS available offline (never a Tier-2 row).
 *
 * Requirements: 1.3, 5.1, 5.2, 5.4, 5.5, 10.6, 11.1, 11.2.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { t } from '@aira/ui';
import type { CitizenAuthState, CitizenView, Connectivity } from '@aira/ui';

import type { AuthOutcome, CitizenAuth } from '../../auth/CitizenAuthContext';

// The module under test — does not exist until task 14.2 (expected TDD red).
import { AccountHubScreen } from '../AccountHubScreen';

const CITIZEN: CitizenView = { id: 'c-1', email: 'c@example.com', emailVerified: false };
const DEVICE_CITIZEN: CitizenView = { id: 'c-2', email: null, emailVerified: false };

const ANON: CitizenAuthState = { kind: 'anonymous' };
const REGISTERED: CitizenAuthState = { kind: 'registered', citizen: CITIZEN };
const REGISTERED_NO_EMAIL: CitizenAuthState = { kind: 'registered', citizen: DEVICE_CITIZEN };

/**
 * Mock `useCitizenAuth` so each test can drive the full (state × connectivity) matrix
 * deterministically — including `registered + offline`, which the real provider cannot
 * reach through its action API. This pins the screen's only auth dependency: the
 * `useCitizenAuth()` hook (state, connectivity, logout, deleteAccount).
 */
const logout = jest.fn<CitizenAuth['logout']>(async () => undefined);
const deleteAccount = jest.fn<CitizenAuth['deleteAccount']>(
  async () => ({ ok: true }) as AuthOutcome,
);
const deviceAuth = jest.fn<CitizenAuth['deviceAuth']>(async () => ({ ok: true }) as AuthOutcome);

// `mock`-prefixed so Jest's hoisted `jest.mock` factory may reference it (the factory is
// hoisted above the declarations; only `mock*` names are allowed inside it).
let mockAuthValue: CitizenAuth;

jest.mock('../../auth/CitizenAuthContext', () => ({
  __esModule: true,
  useCitizenAuth: () => mockAuthValue,
}));

function setAuth(state: CitizenAuthState, connectivity: Connectivity): void {
  mockAuthValue = {
    state,
    connectivity,
    register: jest.fn(async () => ({ ok: true }) as AuthOutcome) as CitizenAuth['register'],
    login: jest.fn(async () => ({ ok: true }) as AuthOutcome) as CitizenAuth['login'],
    deviceAuth,
    restore: jest.fn(async () => undefined) as CitizenAuth['restore'],
    logout,
    deleteAccount,
  };
}

const onOpenRegister = jest.fn();
const onOpenLogin = jest.fn();
const onOpenMedical = jest.fn();
const onBack = jest.fn();

/** Render the hub with the standard navigation-callback props. */
function renderHub(): ReturnType<typeof render> {
  return render(
    <AccountHubScreen
      onOpenRegister={onOpenRegister}
      onOpenLogin={onOpenLogin}
      onOpenMedical={onOpenMedical}
      onBack={onBack}
    />,
  );
}

describe('AccountHubScreen', () => {
  let logSpy: ReturnType<typeof jest.spyOn>;
  let warnSpy: ReturnType<typeof jest.spyOn>;
  let errorSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    logout.mockClear();
    deleteAccount.mockClear();
    deviceAuth.mockClear();
    onOpenRegister.mockClear();
    onOpenLogin.mockClear();
    onOpenMedical.mockClear();
    onBack.mockClear();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  // ── Anonymous state (R1.3 / R2.1) ───────────────────────────────────────────────────

  describe('anonymous state', () => {
    beforeEach(() => setAuth(ANON, 'online'));

    it('offers Register, Login, and device-key entries, all with t() copy', async () => {
      await renderHub();

      expect(screen.getByTestId('account-row-register')).toBeTruthy();
      expect(screen.getByTestId('account-row-login')).toBeTruthy();
      expect(screen.getByTestId('account-row-device-key')).toBeTruthy();

      // Copy resolves through t() (R12.5) — no literals.
      expect(screen.getByText(t('citizenRegister'))).toBeTruthy();
      expect(screen.getByText(t('citizenLogin'))).toBeTruthy();
      expect(screen.getByText(t('citizenUseDeviceKey'))).toBeTruthy();
    });

    it('does NOT show the registered-only rows', async () => {
      await renderHub();

      expect(screen.queryByTestId('account-row-medical')).toBeNull();
      expect(screen.queryByTestId('account-row-signout')).toBeNull();
      expect(screen.queryByTestId('account-row-delete')).toBeNull();
      expect(screen.queryByTestId('account-email')).toBeNull();
    });

    it('Register / Login rows invoke their navigation callbacks', async () => {
      await renderHub();

      await fireEvent.press(screen.getByTestId('account-row-register'));
      expect(onOpenRegister).toHaveBeenCalledTimes(1);

      await fireEvent.press(screen.getByTestId('account-row-login'));
      expect(onOpenLogin).toHaveBeenCalledTimes(1);
    });

    it('the device-key row triggers deviceAuth()', async () => {
      await renderHub();

      await fireEvent.press(screen.getByTestId('account-row-device-key'));
      expect(deviceAuth).toHaveBeenCalledTimes(1);
    });

    it('Back returns to the grid and is never gated (R1.5)', async () => {
      await renderHub();

      await fireEvent.press(screen.getByTestId('account-hub-back'));
      expect(onBack).toHaveBeenCalledTimes(1);
    });
  });

  // ── Registered state (R5 / R10.6) ────────────────────────────────────────────────────

  describe('registered state', () => {
    beforeEach(() => setAuth(REGISTERED, 'online'));

    it('shows the citizen email, Medical-profile, Sign out, and Delete account rows', async () => {
      await renderHub();

      expect(screen.getByTestId('account-email').props.children).toBe('c@example.com');
      expect(screen.getByTestId('account-row-medical')).toBeTruthy();
      expect(screen.getByTestId('account-row-signout')).toBeTruthy();
      expect(screen.getByTestId('account-row-delete')).toBeTruthy();

      // Registered hides the anonymous entries.
      expect(screen.queryByTestId('account-row-register')).toBeNull();
      expect(screen.queryByTestId('account-row-login')).toBeNull();

      // Copy via t() (R12.5).
      expect(screen.getByText(t('citizenMedicalTitle'))).toBeTruthy();
      expect(screen.getByText(t('citizenSignOut'))).toBeTruthy();
      expect(screen.getByText(t('citizenDeleteAccount'))).toBeTruthy();
    });

    it('omits the email node for a device-key citizen with no email', async () => {
      setAuth(REGISTERED_NO_EMAIL, 'online');
      await renderHub();

      expect(screen.queryByTestId('account-email')).toBeNull();
      // The registered rows still render.
      expect(screen.getByTestId('account-row-medical')).toBeTruthy();
      expect(screen.getByTestId('account-row-signout')).toBeTruthy();
    });

    it('the Medical-profile row invokes onOpenMedical', async () => {
      await renderHub();

      await fireEvent.press(screen.getByTestId('account-row-medical'));
      expect(onOpenMedical).toHaveBeenCalledTimes(1);
    });

    // ── Sign out: confirm-first (R5.5) ──────────────────────────────────────────────────

    it('sign out is confirm-first: tapping the row does NOT call logout until confirmed', async () => {
      await renderHub();

      await fireEvent.press(screen.getByTestId('account-row-signout'));
      // The confirm affordance appears; logout is NOT called yet (R5.5).
      expect(logout).not.toHaveBeenCalled();
      expect(screen.getByTestId('account-signout-confirm')).toBeTruthy();
      expect(screen.getByText(t('citizenSignOutConfirmTitle'))).toBeTruthy();

      await fireEvent.press(screen.getByTestId('account-signout-confirm'));
      expect(logout).toHaveBeenCalledTimes(1);
    });

    it('cancelling the sign-out confirmation does NOT call logout', async () => {
      await renderHub();

      await fireEvent.press(screen.getByTestId('account-row-signout'));
      await fireEvent.press(screen.getByTestId('account-signout-cancel'));
      expect(logout).not.toHaveBeenCalled();
    });

    // ── Delete account: confirm-first (R10.6) ───────────────────────────────────────────

    it('delete account is confirm-first: tapping the row does NOT call deleteAccount until confirmed', async () => {
      await renderHub();

      await fireEvent.press(screen.getByTestId('account-row-delete'));
      expect(deleteAccount).not.toHaveBeenCalled();
      expect(screen.getByTestId('account-delete-confirm')).toBeTruthy();
      expect(screen.getByText(t('citizenDeleteAccountConfirmTitle'))).toBeTruthy();

      await fireEvent.press(screen.getByTestId('account-delete-confirm'));
      expect(deleteAccount).toHaveBeenCalledTimes(1);
    });

    it('cancelling the delete confirmation does NOT call deleteAccount', async () => {
      await renderHub();

      await fireEvent.press(screen.getByTestId('account-row-delete'));
      await fireEvent.press(screen.getByTestId('account-delete-cancel'));
      expect(deleteAccount).not.toHaveBeenCalled();
    });
  });

  // ── Tier-2 offline degradation (R11.1 / R11.2) ───────────────────────────────────────

  describe('offline treatment on every Tier-2 row', () => {
    it('anonymous + offline: register/login/device-key rows render the offline treatment and are inert', async () => {
      setAuth(ANON, 'offline');
      await renderHub();

      // Offline treatment present on first synchronous render for every Tier-2 row (R11.2).
      for (const row of ['register', 'login', 'device-key']) {
        expect(screen.getByTestId(`account-row-${row}-offline`)).toBeTruthy();
      }
      // Honest "unavailable offline" copy via t() (R11.1).
      expect(screen.getAllByText(t('citizenOfflineTitle')).length).toBeGreaterThan(0);

      // Rows are inert offline — no navigation, no deviceAuth.
      await fireEvent.press(screen.getByTestId('account-row-register'));
      await fireEvent.press(screen.getByTestId('account-row-login'));
      await fireEvent.press(screen.getByTestId('account-row-device-key'));
      expect(onOpenRegister).not.toHaveBeenCalled();
      expect(onOpenLogin).not.toHaveBeenCalled();
      expect(deviceAuth).not.toHaveBeenCalled();

      // Back / grid return is NEVER a Tier-2 row — it is always available offline (R11.3).
      expect(screen.queryByTestId('account-hub-back-offline')).toBeNull();
      await fireEvent.press(screen.getByTestId('account-hub-back'));
      expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('registered + offline: medical and delete-account rows render the offline treatment and are inert', async () => {
      setAuth(REGISTERED, 'offline');
      await renderHub();

      // Every Tier-2 registered row carries the offline treatment on first render (R11.1/R11.2).
      expect(screen.getByTestId('account-row-medical-offline')).toBeTruthy();
      expect(screen.getByTestId('account-row-delete-offline')).toBeTruthy();

      // Medical row is inert offline — opening it does not navigate.
      await fireEvent.press(screen.getByTestId('account-row-medical'));
      expect(onOpenMedical).not.toHaveBeenCalled();

      // Delete is inert offline — it never opens the confirm nor calls deleteAccount.
      await fireEvent.press(screen.getByTestId('account-row-delete'));
      expect(screen.queryByTestId('account-delete-confirm')).toBeNull();
      expect(deleteAccount).not.toHaveBeenCalled();

      // Back / grid return stays available offline (R11.3).
      await fireEvent.press(screen.getByTestId('account-hub-back'));
      expect(onBack).toHaveBeenCalledTimes(1);
    });
  });
});
