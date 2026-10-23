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
 * Unified sign-in (SECURITY.md §4).
 *
 * One front door for both identity tiers. The form submits to the responder login;
 * if that email isn't a responder (a generic 401), it retries the platform-operator
 * login. The two tiers stay fully isolated on the server (separate tables, sessions
 * and cookies) - this only spares the user from having to know which page they need.
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

  /**
   * Maps a non-ok login response to an inline error. Returns the lockout/rate-limit/
   * unavailable message when the tier is known, or `null` for a plain 401 so the caller
   * can try the other tier before giving up.
   */
  async function messageFor(response: Response): Promise<string | null> {
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
    return null;
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

      // Tier 1: responder / dispatcher / DRRM admin.
      const responderRes = await fetch('/api/auth/login', init);
      if (responderRes.ok) {
        const payload = (await responderRes.json()) as { viewer: Viewer };
        router.replace(next ?? landingFor(payload.viewer.role));
        router.refresh();
        return;
      }

      const responderMessage = await messageFor(responderRes);
      if (responderMessage) {
        // A lockout / rate-limit / outage is authoritative - don't mask it by retrying.
        setError(responderMessage);
        setPending(false);
        return;
      }

      // Tier 2: platform operator (superadmin). Only reached on a plain "invalid" 401,
      // i.e. this email is not a responder - it may be a platform admin instead.
      const platformRes = await fetch('/api/platform/login', init);
      if (platformRes.ok) {
        router.replace('/platform');
        router.refresh();
        return;
      }

      setError((await messageFor(platformRes)) ?? t('loginInvalid'));
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
