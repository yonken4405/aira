'use client';

import { t } from '@aira/ui';
import { Button, Field, Input, useToast } from '@aira/ui/web';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

export interface ChangePasswordFormProps {
  /** Display label for the signed-in account (callsign or email local-part). */
  readonly identity: string;
  /** True for a provisioned account that must replace its one-time password. */
  readonly mustChange: boolean;
  /** Where to go once the password is set. */
  readonly next: string;
}

const MIN_LENGTH = 12;
const MAX_LENGTH = 128;

/** Self-service password change; revokes every other session server-side. */
export function ChangePasswordForm({ identity, mustChange, next }: ChangePasswordFormProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);

    if (newPassword.length < MIN_LENGTH) {
      setError(t('passwordTooShort'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t('passwordMismatch'));
      return;
    }

    setPending(true);

    try {
      const response = await fetch('/api/auth/password', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      if (response.ok) {
        toast({ tone: 'success', title: t('passwordUpdated') });
        router.replace(next);
        router.refresh();
        return;
      }

      if (response.status === 401) {
        setError(t('passwordCurrentInvalid'));
      } else if (response.status === 400) {
        setError(t('passwordWeak'));
      } else {
        setError(t('passwordUpdateFailed'));
      }
    } catch {
      setError(t('passwordUpdateFailed'));
    }

    setPending(false);
  }

  return (
    <div className="w-full max-w-sm border border-line bg-surface">
      <header className="border-b border-line px-5 py-4">
        <p className="text-sm font-extrabold tracking-label text-fg">{t('appName')}</p>
        <h1 className="mt-1 text-[11px] font-bold uppercase tracking-label text-muted">
          {t('changePassword')}
        </h1>
        <p className="mt-1 font-mono text-[11px] tabular-nums text-fg">{identity}</p>
      </header>

      <form className="flex flex-col gap-4 p-5" onSubmit={submit} noValidate>
        {mustChange ? (
          <p className="border border-status-queued/50 bg-status-queued/5 px-2.5 py-2 text-[11px] font-bold leading-relaxed text-status-queued">
            {t('mustChangePasswordNotice')}
          </p>
        ) : null}

        <Field id="current-password" label={t('currentPassword')}>
          <Input
            id="current-password"
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            autoComplete="current-password"
            maxLength={MAX_LENGTH}
            disabled={pending}
            required
          />
        </Field>

        <Field id="new-password" label={t('newPassword')} hint={t('passwordTooShort')}>
          <Input
            id="new-password"
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            autoComplete="new-password"
            maxLength={MAX_LENGTH}
            disabled={pending}
            required
          />
        </Field>

        <Field id="confirm-password" label={t('confirmPassword')}>
          <Input
            id="confirm-password"
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            autoComplete="new-password"
            maxLength={MAX_LENGTH}
            disabled={pending}
            required
          />
        </Field>

        {error ? (
          <p
            role="alert"
            className="border border-status-error/50 bg-status-error/5 px-2.5 py-2 text-[11px] font-bold leading-relaxed text-status-error"
          >
            {error}
          </p>
        ) : null}

        <Button
          type="submit"
          disabled={pending || !currentPassword || !newPassword || !confirmPassword}
        >
          {pending ? t('saving') : t('save')}
        </Button>

        {mustChange ? null : (
          <Link
            href={next}
            className="text-center text-[10px] uppercase tracking-label text-muted hover:text-fg"
          >
            {t('cancelAction')}
          </Link>
        )}
      </form>
    </div>
  );
}
