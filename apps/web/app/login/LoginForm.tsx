'use client';

import { t } from '@aira/ui';
import { Button, Field, Input } from '@aira/ui/web';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { landingFor } from '../../src/lib/auth/rbac';
import type { Viewer } from '../../src/lib/auth/types';

export interface LoginFormProps {
  /** Validated same-site path to return to after sign-in. */
  readonly next: string | null;
}

const EMAIL_MAX = 254;
const PASSWORD_MAX = 128;

/**
 * Responder sign-in (SECURITY.md §4).
 *
 * The single front door for the whole product: responders, dispatchers, agency admins
 * and the LDRRMO coordinator all sign in here. The break-glass superadmin tier has no
 * web entry point (single-lgu-agency-network R2) — it is CLI-only — so there is no
 * platform-login retry.
 *
 * Failures are inline and generic; there is no "account not found" distinction and
 * no toast spam on a form the user is already looking at.
 */
export function LoginForm({ next }: LoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Maps a non-ok login response to an inline error message. */
  async function messageFor(response: Response): Promise<string> {
    if (response.status === 423) {
      const payload = (await response.json().catch(() => ({}))) as { retryAfterSeconds?: number };
      const minutes = Math.max(1, Math.ceil((payload.retryAfterSeconds ?? 60) / 60));
      return t('loginLocked', { minutes });
    }
    if (response.status === 429) {
      return t('loginRateLimited');
    }
    if (response.status === 503) {
      return t('loginUnavailable');
    }
    return t('loginInvalid');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const body = JSON.stringify({ email, password });
      const init: RequestInit = {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body,
      };

      // The single responder tier (responder / dispatcher / agency admin / LDRRMO
      // coordinator). The break-glass superadmin has no web login (R2).
      const responderRes = await fetch('/api/auth/login', init);
      if (responderRes.ok) {
        const payload = (await responderRes.json()) as { viewer: Viewer };
        router.replace(next ?? landingFor(payload.viewer.role));
        router.refresh();
        return;
      }

      setError(await messageFor(responderRes));
    } catch {
      setError(t('loginUnavailable'));
    }

    setPending(false);
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-ink px-4 py-10">
      <div className="w-full max-w-sm border border-line bg-surface">
        <header className="border-b border-line px-5 py-4">
          <p className="text-sm font-extrabold tracking-label text-fg">{t('appName')}</p>
          <h1 className="mt-1 text-[11px] font-bold uppercase tracking-label text-muted">
            {t('loginTitle')}
          </h1>
        </header>

        <form className="flex flex-col gap-4 p-5" onSubmit={handleSubmit} noValidate>
          <Field id="email" label={t('email')} hint={t('loginEmailHint')}>
            <Input
              id="email"
              name="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
              spellCheck={false}
              maxLength={EMAIL_MAX}
              disabled={pending}
              required
            />
          </Field>

          <Field id="password" label={t('password')}>
            <Input
              id="password"
              name="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              maxLength={PASSWORD_MAX}
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

          <Button type="submit" size="lg" disabled={pending || !email || !password}>
            {pending ? t('signingIn') : t('signIn')}
          </Button>

          <p className="text-center text-[10px] uppercase tracking-label text-muted">
            {t('loginSubtitle')}
          </p>
        </form>
      </div>
    </main>
  );
}
