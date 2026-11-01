import {
  AGE_BANDS,
  BLOOD_TYPES,
  MEDICAL_BOUNDS,
  errorToCopyKey,
  t,
  validateMedicalDraft,
  type EmergencyContactDraft,
  type MedicalDraft,
  type MessageKey,
} from '@aira/ui';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Text, View } from 'react-native';

import { failureToApiError } from '../api/apiError';
import { useCitizenAuth } from '../auth/CitizenAuthContext';
import { ActionButton } from '../components/ActionButton';
import { ChipSelect } from '../components/ChipSelect';
import { InlineConfirm } from '../components/InlineConfirm';
import { ListEditor } from '../components/ListEditor';
import { OfflineNotice } from '../components/OfflineNotice';
import { ScreenShell } from '../components/ScreenShell';
import { TextField } from '../components/TextField';
import {
  EMPTY_DRAFT,
  clearPreservedDraft,
  draftFromProfile,
  isDraftEmpty,
  preserveDraft,
  readPreservedDraft,
} from '../medical/draft';

export interface MedicalProfileScreenProps {
  readonly onBack: () => void;
  readonly onSessionExpired: () => void;
}

const LIST_CONFIG = [
  { key: 'allergies', labelKey: 'citizenAllergies' },
  { key: 'conditions', labelKey: 'citizenConditions' },
  { key: 'medications', labelKey: 'citizenMedications' },
] as const;

/**
 * Owner-only medical profile editor (R7/R8/R9). Loads on open with a 10 s deadline,
 * validates before saving, preserves in-progress edits on every non-success save, and
 * never requests device contacts/camera/mic/media/SMS permissions (R7.12).
 */
export function MedicalProfileScreen({
  onBack,
  onSessionExpired,
}: MedicalProfileScreenProps): ReactElement {
  const { client, connectivity, noteConnectivity, sessionExpired } = useCitizenAuth();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [draft, setDraft] = useState<MedicalDraft>(EMPTY_DRAFT);
  const [hasProfile, setHasProfile] = useState(false);
  const [hasPreserved, setHasPreserved] = useState(false);
  const [loadError, setLoadError] = useState<MessageKey | null>(null);
  const [saveError, setSaveError] = useState<MessageKey | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setStatus('loading');
    setLoadError(null);
    const preserved = readPreservedDraft();
    if (preserved) {
      setDraft(preserved);
      setHasPreserved(true);
    }

    const result = await client.getMedical();
    if (result.ok) {
      noteConnectivity('online');
      const serverProfile = draftFromProfile(result.data);
      setHasProfile(!isDraftEmpty(serverProfile));
      // A preserved in-progress draft wins over server data (R11.4/R11.5).
      if (!preserved) {
        setDraft(serverProfile);
      }
      setStatus('ready');
      return;
    }

    if (result.kind === 'http' && result.status === 401) {
      await sessionExpired();
      onSessionExpired();
      return;
    }

    noteConnectivity(result.kind === 'http' ? 'online' : 'offline');
    setLoadError(errorToCopyKey('medicalGet', failureToApiError(result)));
    setStatus('error');
  }, [client, noteConnectivity, onSessionExpired, sessionExpired]);

  useEffect(() => {
    void load();
  }, [load]);

  const update = (patch: Partial<MedicalDraft>): void => {
    setDraft((current) => ({ ...current, ...patch }));
  };

  const updateContact = (index: number, patch: Partial<EmergencyContactDraft>): void => {
    setDraft((current) => ({
      ...current,
      contacts: current.contacts.map((contact, i) =>
        i === index ? { ...contact, ...patch } : contact,
      ),
    }));
  };

  const removeContact = (index: number): void => {
    setDraft((current) => ({
      ...current,
      contacts: current.contacts.filter((_contact, i) => i !== index),
    }));
  };

  const addContact = (): void => {
    setDraft((current) =>
      current.contacts.length >= MEDICAL_BOUNDS.MAX_CONTACTS
        ? current
        : {
            ...current,
            contacts: [...current.contacts, { name: '', phone: '', relation: null }],
          },
    );
  };

  async function save(): Promise<void> {
    setSaved(false);
    const validation = validateMedicalDraft(draft);
    if (!validation.valid) {
      const fieldIssue = Object.keys(validation.errors.fields).length > 0;
      setSaveError(fieldIssue ? 'citizenMedicalInvalid' : 'citizenContactInvalid');
      // Rejection blocks the PUT entirely (R7.7).
      return;
    }

    setBusy(true);
    setSaveError(null);
    const result = await client.putMedical(draft);
    setBusy(false);

    if (result.ok) {
      noteConnectivity('online');
      const canonical = draftFromProfile(result.data);
      setDraft(canonical);
      setHasProfile(!isDraftEmpty(canonical));
      setSaved(true);
      clearPreservedDraft();
      setHasPreserved(false);
      return;
    }

    if (result.kind === 'http' && result.status === 401) {
      await sessionExpired();
      onSessionExpired();
      return;
    }

    // Preserve the citizen's edits for the app session (R7.10/R11.5).
    preserveDraft(draft);
    setHasPreserved(true);
    noteConnectivity(result.kind === 'http' ? 'online' : 'offline');
    setSaveError(errorToCopyKey('medicalPut', failureToApiError(result)));
  }

  async function removeProfile(): Promise<void> {
    setBusy(true);
    setSaveError(null);
    const result = await client.deleteMedical();
    setBusy(false);
    setConfirmDelete(false);

    if (result.ok) {
      noteConnectivity('online');
      setDraft(EMPTY_DRAFT);
      setHasProfile(false);
      setSaved(false);
      clearPreservedDraft();
      setHasPreserved(false);
      return;
    }

    if (result.kind === 'http' && result.status === 401) {
      await sessionExpired();
      onSessionExpired();
      return;
    }

    // Offline: retain the displayed profile unchanged (R9.4).
    noteConnectivity(result.kind === 'http' ? 'online' : 'offline');
    setSaveError(
      result.kind === 'http'
        ? errorToCopyKey('medicalDelete', failureToApiError(result))
        : 'citizenOfflineUnavailable',
    );
  }

  const showForm = status === 'ready' || (status === 'error' && hasPreserved);
  const empty = !hasProfile && isDraftEmpty(draft) && !hasPreserved;

  return (
    <ScreenShell
      title={t('citizenMedicalTitle')}
      subtitle={t('citizenMedicalSubtitle')}
      onBack={onBack}
    >
      {connectivity === 'offline' ? <OfflineNotice /> : null}

      {status === 'loading' ? (
        <Text testID="medical-loading" className="text-sm text-muted">
          {t('citizenLoading')}
        </Text>
      ) : null}

      {status === 'error' ? (
        <View className="gap-2">
          <Text testID="medical-load-error" className="text-sm text-status-error">
            {t(loadError ?? 'citizenMedicalLoadFailed')}
          </Text>
          <ActionButton
            testID="medical-retry"
            label={t('retry')}
            tone="secondary"
            onPress={() => {
              void load();
            }}
          />
        </View>
      ) : null}

      {saved ? (
        <Text testID="medical-saved" className="text-sm text-status-success">
          {t('citizenProfileSaved')}
        </Text>
      ) : null}

      {saveError ? (
        <Text testID="medical-save-error" className="text-sm text-status-error">
          {t(saveError)}
        </Text>
      ) : null}

      {empty && showForm ? (
        <Text testID="medical-empty" className="text-sm text-muted">
          {t('citizenMedicalEmpty')}
        </Text>
      ) : null}

      {showForm ? (
        <View className="gap-4">
          <ChipSelect
            testID="blood-type"
            label={t('citizenBloodType')}
            selected={draft.bloodType}
            unsetLabel={t('citizenUnset')}
            options={BLOOD_TYPES.map((value) => ({ value, label: value }))}
            onSelect={(value) => update({ bloodType: value as MedicalDraft['bloodType'] })}
          />
          <ChipSelect
            testID="age-band"
            label={t('citizenAgeBand')}
            selected={draft.ageBand}
            unsetLabel={t('citizenUnset')}
            options={AGE_BANDS.map((value) => ({ value, label: value }))}
            onSelect={(value) => update({ ageBand: value as MedicalDraft['ageBand'] })}
          />

          {LIST_CONFIG.map((entry) => (
            <ListEditor
              key={entry.key}
              testID={`medical-${entry.key}`}
              label={t(entry.labelKey)}
              entries={draft[entry.key]}
              maxItems={MEDICAL_BOUNDS.MAX_ITEMS}
              onChange={(entries) => update({ [entry.key]: entries })}
            />
          ))}

          <TextField
            testID="medical-notes"
            label={t('citizenNotes')}
            value={draft.notes ?? ''}
            onChangeText={(value) => update({ notes: value.length === 0 ? null : value })}
            multiline
          />

          <View className="gap-3">
            <Text className="text-xs font-bold uppercase tracking-label text-muted">
              {t('citizenContacts')}
            </Text>
            {draft.contacts.map((contact, index) => (
              <View key={`contact-${index}`} className="gap-2 border border-line bg-surface p-3">
                <TextField
                  testID={`contact-${index}-name`}
                  label={t('citizenContactName')}
                  value={contact.name}
                  onChangeText={(value) => updateContact(index, { name: value })}
                />
                <TextField
                  testID={`contact-${index}-phone`}
                  label={t('citizenContactPhone')}
                  value={contact.phone}
                  onChangeText={(value) => updateContact(index, { phone: value })}
                  keyboardType="phone-pad"
                />
                <TextField
                  testID={`contact-${index}-relation`}
                  label={t('citizenContactRelation')}
                  hint={t('citizenContactRelationHint')}
                  value={contact.relation ?? ''}
                  onChangeText={(value) =>
                    updateContact(index, { relation: value.length === 0 ? null : value })
                  }
                />
                <ActionButton
                  testID={`contact-${index}-remove`}
                  label={t('citizenRemoveContact')}
                  tone="secondary"
                  onPress={() => removeContact(index)}
                />
              </View>
            ))}
            <ActionButton
              testID="contact-add"
              label={t('citizenAddContact')}
              tone="secondary"
              disabled={draft.contacts.length >= MEDICAL_BOUNDS.MAX_CONTACTS}
              onPress={addContact}
            />
          </View>

          <ActionButton
            testID="medical-save"
            label={busy ? t('citizenSavingProfile') : t('citizenSaveProfile')}
            disabled={busy}
            onPress={() => {
              void save();
            }}
          />
          <ActionButton
            testID="medical-delete"
            label={t('citizenDeleteProfile')}
            tone="danger"
            disabled={busy || (!hasProfile && isDraftEmpty(draft))}
            onPress={() => setConfirmDelete(true)}
          />
          {confirmDelete ? (
            <InlineConfirm
              testID="confirm-delete-profile"
              title={t('citizenDeleteProfileConfirmTitle')}
              body={t('citizenDeleteProfileConfirmBody')}
              confirmLabel={t('citizenDeleteProfile')}
              tone="danger"
              onConfirm={() => {
                void removeProfile();
              }}
              onCancel={() => setConfirmDelete(false)}
            />
          ) : null}
        </View>
      ) : null}
    </ScreenShell>
  );
}
