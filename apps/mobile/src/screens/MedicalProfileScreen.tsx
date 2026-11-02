/**
 * `MedicalProfileScreen` + emergency-contacts sub-editor (mobile-citizen-account spec,
 * task 17.2; design §5 "Screens → MedicalProfileScreen").
 *
 * The owner-only medical profile editor, reached from the account hub (registered state).
 * It is a Tier-2 surface: it loads on open through the injected `CitizenApiClient`, edits a
 * local `MedicalDraft` buffer, and persists through PUT/DELETE. The draft is the in-progress
 * edit buffer PRESERVED for the app session across failed / offline saves (R7.10/R11.5); it
 * is only replaced by the canonical server profile on a `200` GET/PUT.
 *
 * Behaviour (design §5; the Error → Copy_Catalog mapping; `MEDICAL_BOUNDS` +
 * `validateMedicalDraft`):
 *   - On open: calls `client.getMedical()` exactly once; shows `medical-loading` until it
 *     resolves (R7.1). `{ok:false,kind:'timeout'}` or a non-200/non-401 http → load error +
 *     retry (R7.1/R7.3); `401` → `onSessionExpired()` (R7.9); a 200 with an all-empty
 *     profile is normal → the editor plus a `medical-empty` banner (R7.2); a 200 with data
 *     → the editor seeded from the profile.
 *   - `bloodType` / `ageBand` are closed-set selections (`BLOOD_TYPES`/`AGE_BANDS` ∪ unset,
 *     R7.4/R7.5) — never free text. allergies / conditions / medications are editable text
 *     lists (R7.6). notes is a single text field.
 *   - Save: runs `validateMedicalDraft(draft)` first. A profile-field issue shows
 *     `medical-validation-error` (`citizenMedicalInvalid`, R7.7); a contact issue shows
 *     `medical-contact-error` (`citizenContactInvalid`, R8.4); either blocks the PUT. A
 *     valid draft PUTs; a `200` REPLACES the display with the canonical returned profile
 *     (R7.8/R8.5); a `401` → `onSessionExpired()` (R7.9); any other failure shows
 *     `medical-save-error` (`citizenMedicalSaveFailed`) and PRESERVES the edits (R7.10/R11.5).
 *   - Delete is confirm-first (R9.1): `deleteMedical` is not called until the confirm; a
 *     `204` shows the empty state (R9.2/R9.3); an offline delete retains the displayed
 *     profile and shows `medical-offline` (`citizenOfflineUnavailable`, R9.4).
 *
 * Secrets discipline (R7.11): no profile field value is ever written to a log. This screen
 * requests NO device-contacts / mic / camera / media / SMS permission and imports no such
 * module (R7.12/R12.7); it has no voice/chat/AI affordance. Icons come from
 * `lucide-react-native` (R12.6); all copy goes through `t()` from `@aira/ui` — no string
 * literals (R12.5).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ChevronLeft, Plus, Trash2, X } from 'lucide-react-native';
import {
  AGE_BANDS,
  BLOOD_TYPES,
  t,
  validateMedicalDraft,
  type AgeBand,
  type BloodType,
  type EmergencyContactDraft,
  type MedicalDraft,
  type MessageKey,
} from '@aira/ui';

import type { ApiResult, CitizenApiClient, MedicalProfile } from '../api/citizenClient';
import { useCitizenAuth } from '../auth/CitizenAuthContext';

export interface MedicalProfileScreenProps {
  /** The medical calls live on `CitizenApiClient`; the client is injected for testability. */
  readonly client: Pick<CitizenApiClient, 'getMedical' | 'putMedical' | 'deleteMedical'>;
  /** Return to the account hub. */
  readonly onBack: () => void;
  /** A `401` on load/PUT drops the session and routes to login (R7.9). */
  readonly onSessionExpired: () => void;
}

/** Icon tint used for Lucide glyphs — the muted token value (DESIGN.md §2). */
const ICON_TINT = '#9FB0C0';
/** Destructive tint (error token) for the delete-profile row. */
const DANGER_TINT = '#F2555A';

/** The editable text lists, keyed by their draft field + testID prefix. */
const TEXT_LISTS = ['allergies', 'conditions', 'medications'] as const;
type TextListKey = (typeof TEXT_LISTS)[number];

/** Label copy key per text list. */
const LIST_LABEL: Record<TextListKey, MessageKey> = {
  allergies: 'citizenAllergies',
  conditions: 'citizenConditions',
  medications: 'citizenMedications',
};

/** Build a fresh draft from a server profile (used on load + after a 200 PUT). */
function draftFromProfile(profile: MedicalProfile): MedicalDraft {
  return {
    bloodType: profile.bloodType as BloodType | null,
    ageBand: profile.ageBand as AgeBand | null,
    allergies: [...profile.allergies],
    conditions: [...profile.conditions],
    medications: [...profile.medications],
    notes: profile.notes,
    contacts: profile.contacts.map((c) => ({
      name: c.name,
      phone: c.phone,
      relation: c.relation,
    })),
  };
}

/** True when a profile carries no data — the "absent profile is normal" shape (R7.2). */
function isEmptyProfile(profile: MedicalProfile): boolean {
  return (
    profile.bloodType === null &&
    profile.ageBand === null &&
    profile.allergies.length === 0 &&
    profile.conditions.length === 0 &&
    profile.medications.length === 0 &&
    (profile.notes === null || profile.notes.length === 0) &&
    profile.contacts.length === 0
  );
}

/** The load phase of the screen. */
type LoadPhase = 'loading' | 'error' | 'ready';

export function MedicalProfileScreen(props: MedicalProfileScreenProps): JSX.Element {
  const { client, onBack, onSessionExpired } = props;
  // Subscribe to the auth context so the screen re-renders with connectivity changes; the
  // offline treatment here is outcome-derived (a `{kind:'offline'}` DELETE), matching the
  // client's connectivity model, so no field is destructured off the context.
  useCitizenAuth();

  const [phase, setPhase] = useState<LoadPhase>('loading');
  const [draft, setDraft] = useState<MedicalDraft | null>(null);
  /** Whether the loaded/saved profile was empty — drives the `medical-empty` banner (R7.2). */
  const [empty, setEmpty] = useState(false);

  const [validationError, setValidationError] = useState(false);
  const [contactError, setContactError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [offlineError, setOfflineError] = useState(false);

  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Guard the session-expiry callback so a repeated 401 can't fire it twice.
  const expiredRef = useRef(false);

  /** Apply a successfully loaded/saved profile: re-seed the draft, clear transient errors. */
  const applyProfile = useCallback((profile: MedicalProfile): void => {
    setDraft(draftFromProfile(profile));
    setEmpty(isEmptyProfile(profile));
    setPhase('ready');
    setValidationError(false);
    setContactError(false);
    setSaveError(false);
    setOfflineError(false);
  }, []);

  /** Load (or reload) the profile via GET; reacts to the resolved outcome kind. */
  const load = useCallback(async (): Promise<void> => {
    setPhase('loading');
    const result = await client.getMedical();
    if (result.ok) {
      applyProfile(result.data);
      return;
    }
    if (result.kind === 'http' && result.status === 401) {
      if (!expiredRef.current) {
        expiredRef.current = true;
        onSessionExpired();
      }
      return;
    }
    // A timeout / network / non-401 http failure keeps the surface open with a retry (R7.3).
    setPhase('error');
  }, [client, applyProfile, onSessionExpired]);

  // On open: load exactly once (R7.1).
  useEffect(() => {
    void load();
  }, [load]);

  // ── Draft mutators (never mutate the previous draft object) ──────────────────────────────

  const updateDraft = useCallback((mutate: (prev: MedicalDraft) => MedicalDraft): void => {
    setDraft((prev) => (prev === null ? prev : mutate(prev)));
  }, []);

  const setBloodType = useCallback(
    (value: BloodType | null): void => {
      updateDraft((prev) => ({ ...prev, bloodType: value }));
    },
    [updateDraft],
  );

  const setAgeBand = useCallback(
    (value: AgeBand | null): void => {
      updateDraft((prev) => ({ ...prev, ageBand: value }));
    },
    [updateDraft],
  );

  const addListItem = useCallback(
    (list: TextListKey): void => {
      updateDraft((prev) => ({ ...prev, [list]: [...prev[list], ''] }));
    },
    [updateDraft],
  );

  const changeListItem = useCallback(
    (list: TextListKey, index: number, value: string): void => {
      updateDraft((prev) => {
        const next = [...prev[list]];
        next[index] = value;
        return { ...prev, [list]: next };
      });
    },
    [updateDraft],
  );

  const removeListItem = useCallback(
    (list: TextListKey, index: number): void => {
      updateDraft((prev) => ({
        ...prev,
        [list]: prev[list].filter((_, i) => i !== index),
      }));
    },
    [updateDraft],
  );

  const setNotes = useCallback(
    (value: string): void => {
      updateDraft((prev) => ({ ...prev, notes: value }));
    },
    [updateDraft],
  );

  const addContact = useCallback((): void => {
    updateDraft((prev) => ({
      ...prev,
      contacts: [...prev.contacts, { name: '', phone: '', relation: null }],
    }));
  }, [updateDraft]);

  const changeContact = useCallback(
    (index: number, field: keyof EmergencyContactDraft, value: string): void => {
      updateDraft((prev) => {
        const next = prev.contacts.map((c, i) => {
          if (i !== index) {
            return c;
          }
          if (field === 'relation') {
            // Relation is optional — an empty string normalises to null (R8.1).
            return { ...c, relation: value.length === 0 ? null : value };
          }
          return { ...c, [field]: value };
        });
        return { ...prev, contacts: next };
      });
    },
    [updateDraft],
  );

  const removeContact = useCallback(
    (index: number): void => {
      updateDraft((prev) => ({
        ...prev,
        contacts: prev.contacts.filter((_, i) => i !== index),
      }));
    },
    [updateDraft],
  );

  // ── Save (validate → PUT → canonical replace / preserve on failure) ──────────────────────

  const onSave = useCallback(async (): Promise<void> => {
    if (draft === null) {
      return;
    }

    // Normalise notes to null when empty so an empty editor stays within bounds / empty.
    const candidate: MedicalDraft = {
      ...draft,
      notes: draft.notes !== null && draft.notes.length === 0 ? null : draft.notes,
    };

    const validation = validateMedicalDraft(candidate);
    if (!validation.valid) {
      // Distinguish a profile-field issue from a contact issue (R7.7 vs R8.4).
      const hasFieldIssue = Object.keys(validation.errors.fields).length > 0;
      const hasContactIssue = validation.errors.contacts.some((entry) => entry !== null);
      setValidationError(hasFieldIssue);
      setContactError(hasContactIssue);
      setSaveError(false);
      setOfflineError(false);
      // The PUT is gated by validation (R7.7/R8.4).
      return;
    }

    setValidationError(false);
    setContactError(false);
    setSaveError(false);
    setOfflineError(false);

    const result: ApiResult<MedicalProfile> = await client.putMedical(candidate);
    if (result.ok) {
      // Replace the display with the canonical returned profile (R7.8/R8.5).
      applyProfile(result.data);
      return;
    }
    if (result.kind === 'http' && result.status === 401) {
      if (!expiredRef.current) {
        expiredRef.current = true;
        onSessionExpired();
      }
      return;
    }
    // Any other failure preserves the in-progress edits and shows the save-failure copy
    // (R7.10/R11.5): the draft is left untouched.
    setSaveError(true);
  }, [draft, client, applyProfile, onSessionExpired]);

  // ── Delete (confirm-first → empty on 204 / retain on offline) ────────────────────────────

  const onConfirmDelete = useCallback(async (): Promise<void> => {
    setConfirmingDelete(false);
    const result = await client.deleteMedical();
    if (result.ok) {
      // A 204 clears the profile to the empty state (R9.2/R9.3).
      applyProfile({
        bloodType: null,
        ageBand: null,
        allergies: [],
        conditions: [],
        medications: [],
        notes: null,
        contacts: [],
      });
      return;
    }
    if (result.kind === 'http' && result.status === 401) {
      if (!expiredRef.current) {
        expiredRef.current = true;
        onSessionExpired();
      }
      return;
    }
    // Offline / other failure retains the displayed profile and shows the offline copy (R9.4).
    setOfflineError(true);
  }, [client, applyProfile, onSessionExpired]);

  // ── Render ───────────────────────────────────────────────────────────────────────────────

  function renderHeader(): JSX.Element {
    return (
      <View className="border-b border-line bg-surface px-5 pb-4 pt-14">
        <View className="flex-row items-center gap-3">
          <Pressable
            testID="medical-back"
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel={t('citizenBack')}
            className="h-10 w-10 items-center justify-center border border-line bg-raised active:opacity-75"
          >
            <ChevronLeft size={22} color={ICON_TINT} />
          </Pressable>
          <Text className="text-lg font-extrabold text-fg">{t('citizenMedicalTitle')}</Text>
        </View>
      </View>
    );
  }

  if (phase === 'loading') {
    return (
      <View className="absolute inset-0 bg-ink">
        {renderHeader()}
        <View testID="medical-loading" className="flex-1 gap-3 p-4">
          <View className="h-12 bg-raised" />
          <View className="h-12 bg-raised" />
          <View className="h-24 bg-raised" />
        </View>
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View className="absolute inset-0 bg-ink">
        {renderHeader()}
        <View testID="medical-load-error" className="flex-1 items-center justify-center gap-4 p-6">
          <Text className="text-center text-sm font-bold text-status-error">
            {t('citizenMedicalLoadFailed')}
          </Text>
          <Pressable
            testID="medical-retry"
            onPress={() => {
              void load();
            }}
            accessibilityRole="button"
            accessibilityLabel={t('citizenRetry')}
            className="items-center border border-line bg-raised px-6 py-3 active:opacity-75"
          >
            <Text className="text-base font-bold text-fg">{t('citizenRetry')}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // phase === 'ready' — the editor is always rendered once loaded (even for an empty profile).
  const current = draft;
  if (current === null) {
    // Unreachable in practice: a ready phase always has a draft. Keep the type honest.
    return <View className="absolute inset-0 bg-ink">{renderHeader()}</View>;
  }

  return (
    <View className="absolute inset-0 bg-ink">
      {renderHeader()}

      <ScrollView className="flex-1" contentContainerClassName="gap-5 p-4">
        {empty ? (
          <View testID="medical-empty" className="border border-line bg-raised px-4 py-3">
            <Text className="text-sm text-muted">{t('citizenMedicalEmpty')}</Text>
          </View>
        ) : null}

        {/* Blood type — closed-set selection ∪ unset (R7.4). */}
        <View className="gap-2">
          <Text className="text-[11px] font-bold uppercase text-muted">
            {t('citizenBloodType')}
          </Text>
          <View className="flex-row flex-wrap gap-2">
            <SelectOption
              testID="medical-bloodtype-unset"
              label={t('citizenUnset')}
              selected={current.bloodType === null}
              onPress={() => setBloodType(null)}
            />
            {BLOOD_TYPES.map((value) => (
              <SelectOption
                key={value}
                testID={`medical-bloodtype-${value}`}
                label={value}
                selected={current.bloodType === value}
                onPress={() => setBloodType(value)}
              />
            ))}
          </View>
        </View>

        {/* Age band — closed-set selection ∪ unset (R7.5). */}
        <View className="gap-2">
          <Text className="text-[11px] font-bold uppercase text-muted">{t('citizenAgeBand')}</Text>
          <View className="flex-row flex-wrap gap-2">
            <SelectOption
              testID="medical-ageband-unset"
              label={t('citizenUnset')}
              selected={current.ageBand === null}
              onPress={() => setAgeBand(null)}
            />
            {AGE_BANDS.map((value) => (
              <SelectOption
                key={value}
                testID={`medical-ageband-${value}`}
                label={value}
                selected={current.ageBand === value}
                onPress={() => setAgeBand(value)}
              />
            ))}
          </View>
        </View>

        {/* Editable text lists: allergies / conditions / medications (R7.6). */}
        {TEXT_LISTS.map((list) => (
          <View key={list} className="gap-2">
            <Text className="text-[11px] font-bold uppercase text-muted">
              {t(LIST_LABEL[list])}
            </Text>
            {current[list].map((value, index) => (
              <View key={`${list}-${index}`} className="flex-row items-center gap-2">
                <TextInput
                  testID={`medical-${list}-input-${index}`}
                  value={value}
                  onChangeText={(next) => changeListItem(list, index, next)}
                  accessibilityLabel={t(LIST_LABEL[list])}
                  className="flex-1 border border-line bg-raised px-4 py-3 text-base text-fg"
                />
                <Pressable
                  testID={`medical-${list}-remove-${index}`}
                  onPress={() => removeListItem(list, index)}
                  accessibilityRole="button"
                  accessibilityLabel={t('citizenRemoveItem')}
                  className="h-10 w-10 items-center justify-center border border-line bg-raised active:opacity-75"
                >
                  <X size={18} color={ICON_TINT} />
                </Pressable>
              </View>
            ))}
            <Pressable
              testID={`medical-${list}-add`}
              onPress={() => addListItem(list)}
              accessibilityRole="button"
              accessibilityLabel={t('citizenAddItem')}
              className="flex-row items-center gap-2 border border-line bg-raised px-4 py-3 active:opacity-75"
            >
              <Plus size={18} color={ICON_TINT} />
              <Text className="text-sm font-bold text-fg">{t('citizenAddItem')}</Text>
            </Pressable>
          </View>
        ))}

        {/* Notes — a single free-text field. */}
        <View className="gap-2">
          <Text className="text-[11px] font-bold uppercase text-muted">{t('citizenNotes')}</Text>
          <TextInput
            testID="medical-notes"
            value={current.notes ?? ''}
            onChangeText={setNotes}
            multiline
            accessibilityLabel={t('citizenNotes')}
            className="min-h-20 border border-line bg-raised px-4 py-3 text-base text-fg"
          />
        </View>

        {/* Emergency contacts sub-editor (R8). */}
        <View className="gap-2">
          <Text className="text-[11px] font-bold uppercase text-muted">{t('citizenContacts')}</Text>
          {current.contacts.map((contact, index) => (
            <View key={`contact-${index}`} className="gap-2 border border-line bg-raised p-3">
              <View className="flex-row items-center gap-2">
                <TextInput
                  testID={`medical-contact-name-${index}`}
                  value={contact.name}
                  onChangeText={(next) => changeContact(index, 'name', next)}
                  accessibilityLabel={t('citizenContactName')}
                  className="flex-1 border border-line bg-ink px-4 py-3 text-base text-fg"
                />
                <Pressable
                  testID={`medical-contact-remove-${index}`}
                  onPress={() => removeContact(index)}
                  accessibilityRole="button"
                  accessibilityLabel={t('citizenRemoveContact')}
                  className="h-10 w-10 items-center justify-center border border-line bg-ink active:opacity-75"
                >
                  <X size={18} color={ICON_TINT} />
                </Pressable>
              </View>
              <TextInput
                testID={`medical-contact-phone-${index}`}
                value={contact.phone}
                onChangeText={(next) => changeContact(index, 'phone', next)}
                keyboardType="phone-pad"
                accessibilityLabel={t('citizenContactPhone')}
                className="border border-line bg-ink px-4 py-3 text-base text-fg"
              />
              <TextInput
                testID={`medical-contact-relation-${index}`}
                value={contact.relation ?? ''}
                onChangeText={(next) => changeContact(index, 'relation', next)}
                accessibilityLabel={t('citizenContactRelation')}
                className="border border-line bg-ink px-4 py-3 text-base text-fg"
              />
            </View>
          ))}
          <Pressable
            testID="medical-contact-add"
            onPress={addContact}
            accessibilityRole="button"
            accessibilityLabel={t('citizenAddContact')}
            className="flex-row items-center gap-2 border border-line bg-raised px-4 py-3 active:opacity-75"
          >
            <Plus size={18} color={ICON_TINT} />
            <Text className="text-sm font-bold text-fg">{t('citizenAddContact')}</Text>
          </Pressable>
        </View>

        {/* Validation / save / offline error surfaces. */}
        {validationError ? (
          <View
            testID="medical-validation-error"
            className="border border-status-error bg-raised px-4 py-3"
          >
            <Text className="text-sm font-bold text-status-error">
              {t('citizenMedicalInvalid')}
            </Text>
          </View>
        ) : null}

        {contactError ? (
          <View
            testID="medical-contact-error"
            className="border border-status-error bg-raised px-4 py-3"
          >
            <Text className="text-sm font-bold text-status-error">
              {t('citizenContactInvalid')}
            </Text>
          </View>
        ) : null}

        {saveError ? (
          <View
            testID="medical-save-error"
            className="border border-status-error bg-raised px-4 py-3"
          >
            <Text className="text-sm font-bold text-status-error">
              {t('citizenMedicalSaveFailed')}
            </Text>
          </View>
        ) : null}

        {offlineError ? (
          <View testID="medical-offline" className="border border-line bg-raised px-4 py-3">
            <Text className="text-[11px] font-bold uppercase text-muted">
              {t('citizenOfflineTitle')}
            </Text>
            <Text className="mt-0.5 text-xs text-muted">{t('citizenOfflineUnavailable')}</Text>
          </View>
        ) : null}

        {/* Save. */}
        <Pressable
          testID="medical-save"
          onPress={() => {
            void onSave();
          }}
          accessibilityRole="button"
          accessibilityLabel={t('citizenSave')}
          className="items-center border border-line bg-raised px-4 py-4 active:opacity-75"
        >
          <Text className="text-base font-bold text-fg">{t('citizenSave')}</Text>
        </Pressable>

        {/* Delete profile — confirm-first (R9.1). */}
        <Pressable
          testID="medical-delete"
          onPress={() => setConfirmingDelete(true)}
          accessibilityRole="button"
          accessibilityLabel={t('citizenDeleteProfile')}
          className="flex-row items-center justify-center gap-2 border border-status-error bg-raised px-4 py-4 active:opacity-75"
        >
          <Trash2 size={18} color={DANGER_TINT} />
          <Text className="text-base font-bold text-status-error">{t('citizenDeleteProfile')}</Text>
        </Pressable>
      </ScrollView>

      {confirmingDelete ? (
        <View className="absolute inset-0 items-center justify-center bg-ink/80 px-6">
          <View className="w-full border border-line bg-surface p-5">
            <Text className="text-lg font-extrabold text-fg">
              {t('citizenDeleteProfileConfirmTitle')}
            </Text>
            <Text className="mt-2 text-sm text-muted">{t('citizenDeleteProfileConfirmBody')}</Text>
            <View className="mt-5 flex-row justify-end gap-3">
              <Pressable
                testID="medical-delete-cancel"
                onPress={() => setConfirmingDelete(false)}
                accessibilityRole="button"
                accessibilityLabel={t('cancelAction')}
                className="border border-line bg-raised px-4 py-3 active:opacity-75"
              >
                <Text className="text-sm font-bold text-fg">{t('cancelAction')}</Text>
              </Pressable>
              <Pressable
                testID="medical-delete-confirm"
                onPress={() => {
                  void onConfirmDelete();
                }}
                accessibilityRole="button"
                accessibilityLabel={t('citizenDeleteProfile')}
                className="border border-status-error bg-raised px-4 py-3 active:opacity-75"
              >
                <Text className="text-sm font-bold text-status-error">
                  {t('citizenDeleteProfile')}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

interface SelectOptionProps {
  readonly testID: string;
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
}

/**
 * A single closed-set option chip. The selected chip exposes
 * `accessibilityState.selected === true` so the test can assert the current value (R7.4).
 */
function SelectOption(props: SelectOptionProps): JSX.Element {
  const { testID, label, selected, onPress } = props;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      className={`border px-3 py-2 active:opacity-75 ${
        selected ? 'border-fg bg-fg/10' : 'border-line bg-raised'
      }`}
    >
      <Text className={`text-sm font-bold ${selected ? 'text-fg' : 'text-muted'}`}>{label}</Text>
    </Pressable>
  );
}
