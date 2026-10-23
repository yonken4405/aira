'use client';

import { t } from '@aira/ui';
import { Button, Field, Input, useToast } from '@aira/ui/web';
import { useState, type FormEvent, type ReactElement } from 'react';

import type { NotificationTier } from '../lib/notifications/types';
import { ChangePasswordForm } from '../../app/account/password/ChangePasswordForm';

/**
 * `ProfileView` is the Profile common feature island (R6). It renders the
 * signed-in account's read-only email (R6.2); for a responder it exposes editable
 * display-name and callsign fields (R6.3). A valid submit persists the change to
 * the shared profile endpoint and raises a success Toast (R6.4); an invalid submit
 * surfaces a field-scoped error through the upgraded `Field` without touching the
 * network (R6.5). The self-service password change is embedded only when the
 * principal holds `account:change-password` (R6.6).
 *
 * The prop contract mirrors the design's `ProfileViewProps` (design.md §3).
 */
export interface ProfileViewProps {
  /** Signed-in email, rendered read-only (R6.2). */
  readonly email: string;
  readonly tier: NotificationTier;
  /** Present only for responders: the editable display label fields (R6.3). */
  readonly editable?: {
    readonly displayName: string;
    readonly callsign: string | null;
  };
  /** `can(role, 'account:change-password')` — gates the embedded form (R6.6). */
  readonly canChangePassword: boolean;
}

/** Endpoint the responder profile submit persists to (shared across tiers). */
const PROFILE_ENDPOINT = '/api/auth/profile';

export function ProfileView({
  email,
  tier,
  editable,
  canChangePassword,
}: ProfileViewProps): ReactElement {
  void tier;
  const { toast } = useToast();

  const [displayName, setDisplayName] = useState(editable?.displayName ?? '');
  const [callsign, setCallsign] = useState(editable?.callsign ?? '');
  const [pending, setPending] = useState(false);
  const [displayNameError, setDisplayNameError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setDisplayNameError(null);

    // Client-side validation rejects an empty display name BEFORE any network
    // call, so an invalid submit never reaches persistence (R6.5).
    if (displayName.trim().length === 0) {
      setDisplayNameError(t('displayNameRequired'));
      return;
    }

    setPending(true);

    try {
      const response = await fetch(PROFILE_ENDPOINT, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          displayName: displayName.trim(),
          callsign: callsign.trim().length > 0 ? callsign.trim() : null,
        }),
      });

      if (response.ok) {
        toast({ tone: 'success', title: t('profileSaved') });
      } else {
        toast({ tone: 'error', title: t('profileSaveFailed') });
      }
    } catch {
      toast({ tone: 'error', title: t('profileSaveFailed') });
    }

    setPending(false);
  }

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-1">
        <h2 className="text-[11px] font-bold uppercase tracking-label text-muted">
          {t('profileTitle')}
        </h2>
        <p className="text-[11px] leading-relaxed text-muted">{t('profileSubtitle')}</p>
      </header>

      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-bold uppercase tracking-label text-muted">
          {t('profileEmailLabel')}
        </span>
        <p className="font-mono text-[13px] tabular-nums text-fg">{email}</p>
      </div>

      {editable ? (
        <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
          <Field
            id="profile-display-name"
            label={t('displayNameLabel')}
            error={displayNameError ?? undefined}
          >
            <Input
              id="profile-display-name"
              type="text"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              disabled={pending}
              required
            />
          </Field>

          <Field id="profile-callsign" label={t('callsignLabel')}>
            <Input
              id="profile-callsign"
              type="text"
              value={callsign}
              onChange={(event) => setCallsign(event.target.value)}
              disabled={pending}
            />
          </Field>

          <Button type="submit" disabled={pending}>
            {pending ? t('saving') : t('save')}
          </Button>
        </form>
      ) : null}

      {canChangePassword ? (
        <ChangePasswordForm identity={email} mustChange={false} next="/" />
      ) : null}
    </div>
  );
}
