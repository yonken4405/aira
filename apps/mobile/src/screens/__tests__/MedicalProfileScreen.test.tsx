/**
 * Failing tests for `MedicalProfileScreen` + the emergency-contacts sub-editor
 * (mobile-citizen-account spec, task 17.1 — TDD RED; implementation is task 17.2).
 *
 * The module under test does NOT exist yet: `../MedicalProfileScreen` is the expected red.
 * These tests pin the exact component contract task 17.2 must satisfy (design §5
 * "Screens → MedicalProfileScreen"; the Medical draft model; `MEDICAL_BOUNDS`; the
 * Error → Copy_Catalog mapping; the API-client contract `getMedical`/`putMedical`/
 * `deleteMedical`).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════
 * ── PINNED CONTRACT FOR TASK 17.2 (design §5 "Screens → MedicalProfileScreen") ──
 * ══════════════════════════════════════════════════════════════════════════════════════
 *
 *   import { MedicalProfileScreen } from '../MedicalProfileScreen';
 *
 *   // Props — navigation is passed in as callbacks; connectivity comes from the hook;
 *   // the medical calls live on `CitizenApiClient` (NOT on the auth provider's
 *   // `CitizenAuth` interface), so the client is INJECTED as a prop. This keeps the
 *   // screen testable with a mock client returning `ApiResult` outcomes, mirroring the
 *   // Register/Login/AccountHub screens' injected-callback + mocked-hook pattern.
 *   interface MedicalProfileScreenProps {
 *     readonly client: Pick<CitizenApiClient, 'getMedical' | 'putMedical' | 'deleteMedical'>;
 *     readonly onBack: () => void;            // return to the account hub
 *     readonly onSessionExpired: () => void;  // 401 on load/PUT → drop session + go to login (R7.9)
 *   }
 *
 *   The screen reads `connectivity` from `useCitizenAuth()`
 *   (../../auth/CitizenAuthContext) for the Tier-2 offline treatment (R9.4/R11.5).
 *   It renders no literals: ALL copy goes through `t()` from `@aira/ui` (R12.5). Bounds +
 *   validation come from `@aira/ui`'s `MEDICAL_BOUNDS` / `BLOOD_TYPES` / `AGE_BANDS` /
 *   `validateMedicalDraft`; the draft types are `MedicalDraft` / `EmergencyContactDraft`.
 *   Icons (if any) come from `lucide-react-native` (R12.6); no voice/chat/AI affordance
 *   and NO device-contacts/mic/camera/media/SMS permission API (R7.12 / R12.7).
 *
 *   `getMedical` / `putMedical` return `ApiResult<MedicalProfile>`; `deleteMedical`
 *   returns `ApiResult<void>`. The screen reacts to the outcome kinds:
 *     - `{ok:true,...}`            → render the canonical returned profile / empty state
 *     - `{ok:false,kind:'http',status:401,...}` → `onSessionExpired()` (R7.9)
 *     - any other `ok:false`       → load-error (GET) / save-failure (PUT) / offline (DELETE)
 *
 * ── PINNED testIDs the implementation (17.2) MUST expose ──
 *
 *   Back:                                           testID="medical-back"
 *   First-load skeleton/loading:                    testID="medical-loading"
 *   Empty-profile state (absent profile = normal):  testID="medical-empty"
 *   Load error + retry control:                     testID="medical-load-error"
 *                                                   testID="medical-retry"
 *   Blood-type selectable options (closed set):     testID="medical-bloodtype-<value>"
 *       e.g. medical-bloodtype-A+, medical-bloodtype-O-, …
 *   Blood-type "unset" option:                      testID="medical-bloodtype-unset"
 *   Age-band selectable options (closed set):       testID="medical-ageband-<value>"
 *       e.g. medical-ageband-18-39, …
 *   Age-band "unset" option:                        testID="medical-ageband-unset"
 *   Editable text lists (R7.6) — each list has an add control, a per-row input + remove:
 *       allergies:    medical-allergies-add,   medical-allergies-input-<i>,   medical-allergies-remove-<i>
 *       conditions:   medical-conditions-add,  medical-conditions-input-<i>,  medical-conditions-remove-<i>
 *       medications:  medical-medications-add, medical-medications-input-<i>, medical-medications-remove-<i>
 *   Notes input:                                    testID="medical-notes"
 *   Save:                                           testID="medical-save"
 *   Validation error (shown; PUT NOT sent):         testID="medical-validation-error"
 *   Save-failure copy (edits preserved):            testID="medical-save-error"
 *   Contacts sub-editor (R8):
 *       Add contact:                                testID="medical-contact-add"
 *       Row i name input:                           testID="medical-contact-name-<i>"
 *       Row i phone input:                          testID="medical-contact-phone-<i>"
 *       Row i relation input (optional):            testID="medical-contact-relation-<i>"
 *       Row i remove:                               testID="medical-contact-remove-<i>"
 *       Contact validation error (empty name/phone):testID="medical-contact-error"
 *   Delete profile (confirm-first, R9):
 *       Delete entry:                               testID="medical-delete"
 *       Confirm:                                    testID="medical-delete-confirm"
 *       Cancel:                                     testID="medical-delete-cancel"
 *   Offline treatment (R9.4 delete offline / R11.5): testID="medical-offline"
 *
 * ── PINNED behaviour task 17.2 MUST satisfy ──
 *
 *   • On open: calls `client.getMedical()` exactly once; shows `medical-loading` until it
 *     resolves (R7.1). A `{ok:false,kind:'timeout'}` GET (the 10 s deadline fired in the
 *     client) resolves to `medical-load-error` + `medical-retry` (R7.1/R7.3).
 *   • An absent profile — a 200 with an all-empty profile — renders `medical-empty` and is
 *     treated as normal (no error) (R7.2).
 *   • A non-200 / non-401 load failure keeps the surface open and shows `medical-load-error`
 *     + `medical-retry`; pressing retry re-calls `getMedical` (R7.3).
 *   • `bloodType` is a selection limited to `BLOOD_TYPES ∪ {unset}` (R7.4); `ageBand` to
 *     `AGE_BANDS ∪ {unset}` (R7.5). There is no free-text blood-type / age-band input.
 *   • allergies / conditions / medications are editable text lists — add, edit, remove
 *     rows (R7.6).
 *   • Saving with ANY field over its bound shows `medical-validation-error`
 *     (`t('citizenMedicalInvalid')`) and does NOT call `putMedical` (R7.7); a contact issue
 *     shows `medical-contact-error` (`t('citizenContactInvalid')`) and blocks the PUT (R8.4).
 *   • A valid save calls `putMedical(draft)` and, on a 200, REPLACES the display with the
 *     canonical returned profile (R7.8).
 *   • A `401` on load OR on PUT calls `onSessionExpired()` (R7.9).
 *   • A non-200 / non-401 / timeout / network save failure preserves the in-progress edits
 *     and shows `medical-save-error` (`t('citizenMedicalSaveFailed')`) (R7.10/R11.5).
 *   • Delete profile is confirm-first (R9.1): the row does not call `deleteMedical` until
 *     `medical-delete-confirm`; a `204` shows `medical-empty` (R9.2/R9.3); an offline delete
 *     ({ok:false,kind:'offline'}) RETAINS the displayed profile and shows `medical-offline`
 *     (`t('citizenOfflineUnavailable')`) (R9.4).
 *   • Contacts sub-editor: add/edit/remove rows with name + phone + optional relation (R8.1);
 *     the next `putMedical` body's `contacts` reflects adds/removes EXACTLY (R8.2/R8.3);
 *     after a 200 the contacts render exactly as returned (R8.5).
 *   • A console spy confirms NO profile field value is ever logged (R7.11).
 *   • Static source assertion: `MedicalProfileScreen.tsx` imports NONE of
 *     expo-contacts / expo-camera / expo-av / expo-media-library / expo-image-picker /
 *     expo-sms / @react-native-community/* permission modules (R7.12).
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12,
 *               8.1, 8.2, 8.3, 8.4, 8.5, 11.5.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  AGE_BANDS,
  BLOOD_TYPES,
  MEDICAL_BOUNDS,
  t,
  type Connectivity,
  type MedicalDraft,
} from '@aira/ui';

import type { ApiResult, CitizenApiClient, MedicalProfile } from '../../api/citizenClient';
import type { AuthOutcome, CitizenAuth } from '../../auth/CitizenAuthContext';

// The module under test — does not exist until task 17.2 (expected TDD red).
import { MedicalProfileScreen } from '../MedicalProfileScreen';

// CommonJS handles used only by the R7.12 static-source assertion. `@types/node` is not in
// the mobile tsconfig `types`, so reach `require` / `__dirname` through narrow casts off the
// ambient globals (jest provides both at runtime under its CJS runtime).
const nodeRequire = (globalThis as unknown as { require: (id: string) => unknown }).require;
const nodeDirname = (globalThis as unknown as { __dirname: string }).__dirname;

// ── Fixtures ───────────────────────────────────────────────────────────────────────────

/** An all-empty profile — the canonical "absent profile is normal" shape (R7.2). */
const EMPTY_PROFILE: MedicalProfile = {
  bloodType: null,
  ageBand: null,
  allergies: [],
  conditions: [],
  medications: [],
  notes: null,
  contacts: [],
};

/** A populated profile the server echoes; used to assert canonical-replacement (R7.8/R8.5). */
const POPULATED_PROFILE: MedicalProfile = {
  bloodType: 'O+',
  ageBand: '18-39',
  allergies: ['penicillin'],
  conditions: ['asthma'],
  medications: ['ventolin'],
  notes: 'keep inhaler nearby',
  contacts: [{ name: 'Ana', phone: '09170000000', relation: 'sister' }],
};

const ok = <T,>(data: T, status = 200): ApiResult<T> => ({ ok: true, status, data });
const http = (status: number, code: string): ApiResult<never> => ({
  ok: false,
  kind: 'http',
  status,
  code,
});
const timeout = (): ApiResult<never> => ({ ok: false, kind: 'timeout' });
const offline = (): ApiResult<never> => ({ ok: false, kind: 'offline' });

// ── Mock client (injected prop) ──────────────────────────────────────────────────────────

const getMedical = jest.fn<CitizenApiClient['getMedical']>();
const putMedical = jest.fn<CitizenApiClient['putMedical']>();
const deleteMedical = jest.fn<CitizenApiClient['deleteMedical']>();

const client: Pick<CitizenApiClient, 'getMedical' | 'putMedical' | 'deleteMedical'> = {
  getMedical,
  putMedical,
  deleteMedical,
};

// ── Mock useCitizenAuth (connectivity only) ───────────────────────────────────────────────

let mockAuthValue: CitizenAuth;

jest.mock('../../auth/CitizenAuthContext', () => ({
  __esModule: true,
  useCitizenAuth: () => mockAuthValue,
}));

function setConnectivity(connectivity: Connectivity): void {
  mockAuthValue = {
    state: {
      kind: 'registered',
      citizen: { id: 'c-1', email: 'c@example.com', emailVerified: false },
    },
    connectivity,
    register: jest.fn(async () => ({ ok: true }) as AuthOutcome) as CitizenAuth['register'],
    login: jest.fn(async () => ({ ok: true }) as AuthOutcome) as CitizenAuth['login'],
    deviceAuth: jest.fn(async () => ({ ok: true }) as AuthOutcome) as CitizenAuth['deviceAuth'],
    restore: jest.fn(async () => undefined) as CitizenAuth['restore'],
    logout: jest.fn(async () => undefined) as CitizenAuth['logout'],
    deleteAccount: jest.fn(
      async () => ({ ok: true }) as AuthOutcome,
    ) as CitizenAuth['deleteAccount'],
  };
}

const onBack = jest.fn();
const onSessionExpired = jest.fn();

function renderScreen(): ReturnType<typeof render> {
  return render(
    <MedicalProfileScreen client={client} onBack={onBack} onSessionExpired={onSessionExpired} />,
  );
}

/** Flush the on-open GET so the editor is mounted with the resolved profile. */
async function renderLoaded(profile: MedicalProfile = EMPTY_PROFILE): Promise<void> {
  getMedical.mockResolvedValueOnce(ok(profile));
  await renderScreen();
  await waitFor(() => expect(screen.queryByTestId('medical-loading')).toBeNull());
}

/** Join every console sink's args for a leak assertion (R7.11). */
function allLogged(spies: ReturnType<typeof jest.spyOn>[]): string {
  return spies
    .flatMap((spy) => spy.mock.calls)
    .flat()
    .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
    .join('\n');
}

describe('MedicalProfileScreen', () => {
  let logSpy: ReturnType<typeof jest.spyOn>;
  let warnSpy: ReturnType<typeof jest.spyOn>;
  let errorSpy: ReturnType<typeof jest.spyOn>;
  let infoSpy: ReturnType<typeof jest.spyOn>;
  let debugSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    getMedical.mockReset();
    putMedical.mockReset();
    deleteMedical.mockReset();
    onBack.mockClear();
    onSessionExpired.mockClear();
    setConnectivity('online');
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

  // ── Load on open with a 10 s timeout (R7.1) ────────────────────────────────────────────

  it('calls getMedical exactly once on open and shows the loading state until it resolves', async () => {
    let resolveGet: (r: ApiResult<MedicalProfile>) => void = () => undefined;
    getMedical.mockReturnValueOnce(
      new Promise<ApiResult<MedicalProfile>>((resolve) => {
        resolveGet = resolve;
      }),
    );

    await renderScreen();

    // Loading surface is shown while the GET is in flight (R7.1).
    expect(screen.getByTestId('medical-loading')).toBeTruthy();
    expect(getMedical).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveGet(ok(EMPTY_PROFILE));
    });

    await waitFor(() => expect(screen.queryByTestId('medical-loading')).toBeNull());
  });

  describe('10 s GET timeout (fake timers)', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });
    afterEach(() => {
      jest.runOnlyPendingTimers();
      jest.useRealTimers();
    });

    it('a timeout GET outcome shows the load error + retry control (R7.1/R7.3)', async () => {
      // The client already enforces the 10 s AbortController deadline; here the screen just
      // reacts to the resulting {ok:false,kind:'timeout'} outcome.
      getMedical.mockResolvedValueOnce(timeout());
      await renderScreen();

      await waitFor(() => expect(screen.getByTestId('medical-load-error')).toBeTruthy());
      expect(screen.getByTestId('medical-retry')).toBeTruthy();
      expect(screen.getByText(t('citizenMedicalLoadFailed'))).toBeTruthy();
    });
  });

  // ── Empty-profile state is normal (R7.2) ───────────────────────────────────────────────

  it('treats an absent (all-empty) profile as normal: shows the empty state, not an error', async () => {
    await renderLoaded(EMPTY_PROFILE);

    expect(screen.getByTestId('medical-empty')).toBeTruthy();
    expect(screen.getByText(t('citizenMedicalEmpty'))).toBeTruthy();
    // No error / session-expiry on an empty profile.
    expect(screen.queryByTestId('medical-load-error')).toBeNull();
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  // ── Non-200 / non-401 load failure keeps the surface open + retry (R7.3) ───────────────

  it('a non-200/non-401 load failure keeps the surface open and shows a retry control', async () => {
    getMedical.mockResolvedValueOnce(http(500, 'service_unavailable'));
    await renderScreen();

    await waitFor(() => expect(screen.getByTestId('medical-load-error')).toBeTruthy());
    expect(screen.getByTestId('medical-retry')).toBeTruthy();
    expect(screen.getByText(t('citizenMedicalLoadFailed'))).toBeTruthy();
    // A load failure is NOT a session-loss.
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it('pressing retry re-calls getMedical and renders the resolved profile', async () => {
    getMedical.mockResolvedValueOnce(http(503, 'service_unavailable'));
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('medical-load-error')).toBeTruthy());

    getMedical.mockResolvedValueOnce(ok(POPULATED_PROFILE));
    await fireEvent.press(screen.getByTestId('medical-retry'));

    await waitFor(() => expect(getMedical).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId('medical-load-error')).toBeNull());
  });

  // ── 401 on load drops the session (R7.9) ───────────────────────────────────────────────

  it('a 401 on load calls onSessionExpired (R7.9)', async () => {
    getMedical.mockResolvedValueOnce(http(401, 'unauthenticated'));
    await renderScreen();

    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledTimes(1));
  });

  // ── bloodType / ageBand are closed-set selections (R7.4 / R7.5) ─────────────────────────

  it('bloodType is a selection limited to the closed set + unset (R7.4)', async () => {
    await renderLoaded(EMPTY_PROFILE);

    for (const value of BLOOD_TYPES) {
      expect(screen.getByTestId(`medical-bloodtype-${value}`)).toBeTruthy();
    }
    // An explicit "unset" option is offered — bloodType is nullable.
    expect(screen.getByTestId('medical-bloodtype-unset')).toBeTruthy();

    // There is no free-text blood-type entry; a bogus value has no option node.
    expect(screen.queryByTestId('medical-bloodtype-ZZ')).toBeNull();
  });

  it('ageBand is a selection limited to the closed set + unset (R7.5)', async () => {
    await renderLoaded(EMPTY_PROFILE);

    for (const value of AGE_BANDS) {
      expect(screen.getByTestId(`medical-ageband-${value}`)).toBeTruthy();
    }
    expect(screen.getByTestId('medical-ageband-unset')).toBeTruthy();
    expect(screen.queryByTestId('medical-ageband-200+')).toBeNull();
  });

  // ── Editable text lists (R7.6) ──────────────────────────────────────────────────────────

  it('allergies / conditions / medications are editable text lists (add + edit + remove)', async () => {
    await renderLoaded(EMPTY_PROFILE);

    for (const list of ['allergies', 'conditions', 'medications'] as const) {
      // Add a row, type into it, then remove it.
      await fireEvent.press(screen.getByTestId(`medical-${list}-add`));
      const input = screen.getByTestId(`medical-${list}-input-0`);
      fireEvent.changeText(input, 'entry-one');
      expect(screen.getByTestId(`medical-${list}-input-0`).props.value).toBe('entry-one');

      await fireEvent.press(screen.getByTestId(`medical-${list}-remove-0`));
      expect(screen.queryByTestId(`medical-${list}-input-0`)).toBeNull();
    }
  });

  // ── Over-bound save shows validation and does NOT PUT (R7.7) ────────────────────────────

  it('saving with a field over its bound shows the validation message and does NOT PUT (R7.7)', async () => {
    await renderLoaded(EMPTY_PROFILE);

    // One allergy entry longer than MAX_ITEM_LEN — an over-bound profile field.
    await fireEvent.press(screen.getByTestId('medical-allergies-add'));
    fireEvent.changeText(
      screen.getByTestId('medical-allergies-input-0'),
      'x'.repeat(MEDICAL_BOUNDS.MAX_ITEM_LEN + 1),
    );

    await fireEvent.press(screen.getByTestId('medical-save'));

    await waitFor(() => expect(screen.getByTestId('medical-validation-error')).toBeTruthy());
    expect(screen.getByText(t('citizenMedicalInvalid'))).toBeTruthy();
    // The PUT is gated by validateMedicalDraft (R7.7).
    expect(putMedical).not.toHaveBeenCalled();
  });

  // ── Valid save PUTs + replaces with the canonical returned profile (R7.8) ───────────────

  it('a valid save PUTs and replaces the display with the canonical returned profile (R7.8)', async () => {
    await renderLoaded(EMPTY_PROFILE);

    // Enter a single valid allergy.
    await fireEvent.press(screen.getByTestId('medical-allergies-add'));
    fireEvent.changeText(screen.getByTestId('medical-allergies-input-0'), 'penicillin');

    // The server canonicalises and echoes the populated profile.
    putMedical.mockResolvedValueOnce(ok(POPULATED_PROFILE));
    await fireEvent.press(screen.getByTestId('medical-save'));

    await waitFor(() => expect(putMedical).toHaveBeenCalledTimes(1));

    const draft = putMedical.mock.calls[0]?.[0] as MedicalDraft;
    expect(draft.allergies).toEqual(['penicillin']);

    // The display is replaced by the canonical returned profile (R7.8).
    await waitFor(() =>
      expect(screen.getByTestId('medical-allergies-input-0').props.value).toBe('penicillin'),
    );
    expect(screen.getByTestId('medical-conditions-input-0').props.value).toBe('asthma');
    expect(screen.getByTestId('medical-bloodtype-O+').props.accessibilityState?.selected).toBe(
      true,
    );
  });

  // ── 401 on PUT drops the session → login (R7.9) ─────────────────────────────────────────

  it('a 401 on PUT drops the session and returns to login (R7.9)', async () => {
    await renderLoaded(EMPTY_PROFILE);

    await fireEvent.press(screen.getByTestId('medical-allergies-add'));
    fireEvent.changeText(screen.getByTestId('medical-allergies-input-0'), 'penicillin');

    putMedical.mockResolvedValueOnce(http(401, 'unauthenticated'));
    await fireEvent.press(screen.getByTestId('medical-save'));

    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledTimes(1));
  });

  // ── Non-200/non-401/timeout/network save failure preserves edits (R7.10 / R11.5) ───────

  const saveFailureCases: ReadonlyArray<readonly [string, ApiResult<MedicalProfile>]> = [
    ['non-200 http', http(500, 'service_unavailable') as ApiResult<MedicalProfile>],
    ['timeout', timeout() as ApiResult<MedicalProfile>],
    ['network', offline() as ApiResult<MedicalProfile>],
  ];

  for (const [label, outcome] of saveFailureCases) {
    it(`a ${label} save failure preserves in-progress edits and shows the save-failure copy`, async () => {
      await renderLoaded(EMPTY_PROFILE);

      await fireEvent.press(screen.getByTestId('medical-allergies-add'));
      fireEvent.changeText(screen.getByTestId('medical-allergies-input-0'), 'keep-me');

      putMedical.mockResolvedValueOnce(outcome);
      await fireEvent.press(screen.getByTestId('medical-save'));

      await waitFor(() => expect(screen.getByTestId('medical-save-error')).toBeTruthy());
      expect(screen.getByText(t('citizenMedicalSaveFailed'))).toBeTruthy();

      // The in-progress edit survives the failed save (R7.10/R11.5).
      expect(screen.getByTestId('medical-allergies-input-0').props.value).toBe('keep-me');
      // A non-401 failure is NOT a session loss.
      expect(onSessionExpired).not.toHaveBeenCalled();
    });
  }

  // ── Delete profile: confirm-first → empty on 204 (R9.1–R9.3) ────────────────────────────

  it('delete profile is confirm-first and shows the empty state on a 204', async () => {
    await renderLoaded(POPULATED_PROFILE);

    // Tapping the row opens the confirm; deleteMedical is NOT called yet (R9.1).
    await fireEvent.press(screen.getByTestId('medical-delete'));
    expect(deleteMedical).not.toHaveBeenCalled();
    expect(screen.getByTestId('medical-delete-confirm')).toBeTruthy();
    expect(screen.getByText(t('citizenDeleteProfileConfirmTitle'))).toBeTruthy();

    deleteMedical.mockResolvedValueOnce(ok(undefined, 204));
    await fireEvent.press(screen.getByTestId('medical-delete-confirm'));

    await waitFor(() => expect(deleteMedical).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('medical-empty')).toBeTruthy());
  });

  it('cancelling the delete confirmation does NOT call deleteMedical', async () => {
    await renderLoaded(POPULATED_PROFILE);

    await fireEvent.press(screen.getByTestId('medical-delete'));
    await fireEvent.press(screen.getByTestId('medical-delete-cancel'));
    expect(deleteMedical).not.toHaveBeenCalled();
    // The populated profile is retained after cancelling.
    expect(screen.getByTestId('medical-allergies-input-0').props.value).toBe('penicillin');
  });

  // ── Offline delete retains the profile + offline message (R9.4) ─────────────────────────

  it('an offline delete retains the displayed profile and shows an offline message (R9.4)', async () => {
    await renderLoaded(POPULATED_PROFILE);

    deleteMedical.mockResolvedValueOnce(offline());
    await fireEvent.press(screen.getByTestId('medical-delete'));
    await fireEvent.press(screen.getByTestId('medical-delete-confirm'));

    await waitFor(() => expect(screen.getByTestId('medical-offline')).toBeTruthy());
    expect(screen.getByText(t('citizenOfflineUnavailable'))).toBeTruthy();

    // The displayed profile is retained — no empty state (R9.4).
    expect(screen.queryByTestId('medical-empty')).toBeNull();
    expect(screen.getByTestId('medical-allergies-input-0').props.value).toBe('penicillin');
  });

  // ── Contacts sub-editor (R8) ─────────────────────────────────────────────────────────────

  describe('emergency contacts sub-editor', () => {
    it('adds / edits / removes a contact with name + phone + optional relation (R8.1)', async () => {
      await renderLoaded(EMPTY_PROFILE);

      await fireEvent.press(screen.getByTestId('medical-contact-add'));
      fireEvent.changeText(screen.getByTestId('medical-contact-name-0'), 'Ana');
      fireEvent.changeText(screen.getByTestId('medical-contact-phone-0'), '09170000000');
      fireEvent.changeText(screen.getByTestId('medical-contact-relation-0'), 'sister');

      expect(screen.getByTestId('medical-contact-name-0').props.value).toBe('Ana');
      expect(screen.getByTestId('medical-contact-phone-0').props.value).toBe('09170000000');
      expect(screen.getByTestId('medical-contact-relation-0').props.value).toBe('sister');

      // Relation is optional — clearing it is still a valid contact.
      fireEvent.changeText(screen.getByTestId('medical-contact-relation-0'), '');
      await fireEvent.press(screen.getByTestId('medical-contact-remove-0'));
      expect(screen.queryByTestId('medical-contact-name-0')).toBeNull();
    });

    it('an empty name or phone blocks that contact with a copy message and no PUT (R8.4)', async () => {
      await renderLoaded(EMPTY_PROFILE);

      // Name present, phone empty → invalid contact.
      await fireEvent.press(screen.getByTestId('medical-contact-add'));
      fireEvent.changeText(screen.getByTestId('medical-contact-name-0'), 'Ana');
      // phone left empty

      await fireEvent.press(screen.getByTestId('medical-save'));

      await waitFor(() => expect(screen.getByTestId('medical-contact-error')).toBeTruthy());
      expect(screen.getByText(t('citizenContactInvalid'))).toBeTruthy();
      expect(putMedical).not.toHaveBeenCalled();
    });

    it('the next PUT body reflects adds/removes exactly (R8.2/R8.3)', async () => {
      await renderLoaded(EMPTY_PROFILE);

      // Add two contacts, then remove the first — only the second must reach the PUT body.
      await fireEvent.press(screen.getByTestId('medical-contact-add'));
      fireEvent.changeText(screen.getByTestId('medical-contact-name-0'), 'First');
      fireEvent.changeText(screen.getByTestId('medical-contact-phone-0'), '09171111111');

      await fireEvent.press(screen.getByTestId('medical-contact-add'));
      fireEvent.changeText(screen.getByTestId('medical-contact-name-1'), 'Second');
      fireEvent.changeText(screen.getByTestId('medical-contact-phone-1'), '09172222222');

      await fireEvent.press(screen.getByTestId('medical-contact-remove-0'));

      putMedical.mockResolvedValueOnce(ok(EMPTY_PROFILE));
      await fireEvent.press(screen.getByTestId('medical-save'));

      await waitFor(() => expect(putMedical).toHaveBeenCalledTimes(1));
      const draft = putMedical.mock.calls[0]?.[0] as MedicalDraft;
      expect(draft.contacts).toEqual([{ name: 'Second', phone: '09172222222', relation: null }]);
    });

    it('contacts render exactly as returned after a 200 (R8.5)', async () => {
      await renderLoaded(EMPTY_PROFILE);

      await fireEvent.press(screen.getByTestId('medical-contact-add'));
      fireEvent.changeText(screen.getByTestId('medical-contact-name-0'), 'Temp');
      fireEvent.changeText(screen.getByTestId('medical-contact-phone-0'), '09170000000');

      // The server echoes a single canonical contact.
      putMedical.mockResolvedValueOnce(ok(POPULATED_PROFILE));
      await fireEvent.press(screen.getByTestId('medical-save'));

      await waitFor(() => expect(putMedical).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(screen.getByTestId('medical-contact-name-0').props.value).toBe('Ana'),
      );
      expect(screen.getByTestId('medical-contact-phone-0').props.value).toBe('09170000000');
      expect(screen.getByTestId('medical-contact-relation-0').props.value).toBe('sister');
      // Exactly one contact rendered — no extras.
      expect(screen.queryByTestId('medical-contact-name-1')).toBeNull();
    });
  });

  // ── Navigation ───────────────────────────────────────────────────────────────────────────

  it('Back invokes the onBack navigation callback', async () => {
    await renderLoaded(EMPTY_PROFILE);

    await fireEvent.press(screen.getByTestId('medical-back'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  // ── No profile field ever leaks to logs (R7.11) ─────────────────────────────────────────

  it('never logs any profile field value across load / edit / save / delete (R7.11)', async () => {
    await renderLoaded(POPULATED_PROFILE);

    // Edit a field and save successfully.
    fireEvent.changeText(screen.getByTestId('medical-notes'), 'secret-note-value');
    putMedical.mockResolvedValueOnce(ok(POPULATED_PROFILE));
    await fireEvent.press(screen.getByTestId('medical-save'));
    await waitFor(() => expect(putMedical).toHaveBeenCalledTimes(1));

    const logged = allLogged([logSpy, warnSpy, errorSpy, infoSpy, debugSpy]);

    // No profile field value — blood type, conditions, notes, contact name/phone — leaks.
    for (const secret of [
      'secret-note-value',
      'keep inhaler nearby',
      'penicillin',
      'asthma',
      'ventolin',
      'Ana',
      '09170000000',
      'sister',
      'O+',
      '18-39',
    ]) {
      expect(logged).not.toContain(secret);
    }
  });

  // ── No device-contacts/mic/camera/media/SMS permission import (R7.12) ───────────────────

  it('does not import any device-contacts/mic/camera/media/SMS permission module (R7.12)', () => {
    // Static source assertion: the screen never pulls in a native permission surface.
    // `@types/node` is intentionally out of scope for the mobile tsconfig, so read the
    // source through jest's CommonJS runtime via the narrowly-declared globals above.
    const fs = nodeRequire('node:fs') as { readFileSync: (p: string, enc: string) => string };
    const path = nodeRequire('node:path') as { join: (...parts: string[]) => string };
    const source = fs.readFileSync(
      path.join(nodeDirname, '..', 'MedicalProfileScreen.tsx'),
      'utf8',
    );

    const forbidden = [
      'expo-contacts',
      'expo-camera',
      'expo-av',
      'expo-media-library',
      'expo-image-picker',
      'expo-sms',
      'expo-location',
      'expo-microphone',
      '@react-native-community/geolocation',
      'react-native-contacts',
      'react-native-permissions',
    ];

    for (const mod of forbidden) {
      expect(source).not.toContain(mod);
    }
  });
});
