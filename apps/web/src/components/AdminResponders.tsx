'use client';

import { t } from '@aira/ui';
import { Button, ConfirmDialog, Field, Input, Select, cn, useToast } from '@aira/ui/web';
import { KeyRound, Plus, ShieldOff, Unlock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { ROLES, isRole, type Role } from '../lib/auth/rbac';
import type { AgencySummary, OfficeSummary, ResponderView } from '../lib/auth/types';
import { roleLabel } from '../lib/labels';

export interface AdminRespondersProps {
  readonly responders: readonly ResponderView[];
  readonly offices: readonly OfficeSummary[];
  readonly agencies: readonly AgencySummary[];
  /** The signed-in admin, used to mark (and protect) their own row. */
  readonly viewerId: string;
}

interface ApiResult {
  readonly ok: boolean;
  readonly status: number;
  readonly data: Record<string, unknown>;
}

async function request(url: string, method: string, body?: unknown): Promise<ApiResult> {
  try {
    const response = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const data =
      response.status === 204
        ? {}
        : ((await response.json().catch(() => ({}))) as Record<string, unknown>);

    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: {} };
  }
}

type PendingAction =
  | { readonly kind: 'deactivate'; readonly row: ResponderView }
  | { readonly kind: 'revoke'; readonly row: ResponderView }
  | { readonly kind: 'unlock'; readonly row: ResponderView }
  | { readonly kind: 'role'; readonly row: ResponderView; readonly role: Role };

function formatTimestamp(value: number | null): string {
  return value === null ? t('never') : new Date(value).toISOString().slice(0, 16).replace('T', ' ');
}

/**
 * Account administration (SECURITY.md §4.5): provision responders, change roles,
 * deactivate, unlock and revoke sessions.
 *
 * The roster arrives already projected server-side, so no password hash is ever part
 * of this component's props. Every mutation is confirmed, audited server-side and
 * announced through the unified toast surface (DESIGN.md §6).
 */
export function AdminResponders({ responders, offices, agencies, viewerId }: AdminRespondersProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [email, setEmail] = useState('');
  const [callsign, setCallsign] = useState('');
  const [role, setRole] = useState<Role>('RESPONDER');
  const [officeId, setOfficeId] = useState(offices[0]?.id ?? '');
  const [agencyId, setAgencyId] = useState('');
  const [creating, setCreating] = useState(false);
  const [oneTimePassword, setOneTimePassword] = useState<string | null>(null);
  const [pendingRow, setPendingRow] = useState<string | null>(null);
  const [action, setAction] = useState<PendingAction | null>(null);

  async function createResponder(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setCreating(true);

    const result = await request('/api/admin/responders', 'POST', {
      email,
      callsign: callsign === '' ? null : callsign,
      role,
      officeId,
      agencyId: agencyId === '' ? null : agencyId,
      mustChangePassword: true,
    });

    setCreating(false);

    if (result.ok) {
      const password = typeof result.data.password === 'string' ? result.data.password : null;
      setOneTimePassword(password);
      toast({ tone: 'success', title: t('accountCreated'), description: email });
      setEmail('');
      setCallsign('');
      router.refresh();
      return;
    }

    if (result.status === 409) {
      toast({ tone: 'error', title: t('createFailedTitle'), description: t('emailTaken') });
      return;
    }

    toast({
      tone: 'error',
      title: t('createFailedTitle'),
      description:
        result.data.error === 'weak_password' ? t('weakPasswordBody') : t('createFailedBody'),
    });
  }

  async function applyPatch(
    row: ResponderView,
    patch: Record<string, unknown>,
    success: string,
  ): Promise<void> {
    setPendingRow(row.id);
    const result = await request(`/api/admin/responders/${row.id}`, 'PATCH', patch);
    setPendingRow(null);

    if (!result.ok) {
      toast({ tone: 'error', title: t('updateFailed'), description: t('createFailedBody') });
      return;
    }

    toast({ tone: 'success', title: success, description: row.displayName });
    router.refresh();
  }

  async function revokeSessions(row: ResponderView): Promise<void> {
    setPendingRow(row.id);
    const result = await request(`/api/admin/responders/${row.id}/sessions`, 'DELETE');
    setPendingRow(null);

    if (!result.ok) {
      toast({ tone: 'error', title: t('updateFailed'), description: t('createFailedBody') });
      return;
    }

    toast({
      tone: 'success',
      title: t('sessionsRevokedTitle'),
      description: t('sessionsRevokedBody', { callsign: row.displayName }),
    });
    router.refresh();
  }

  async function confirmAction(): Promise<void> {
    const current = action;
    setAction(null);
    if (!current) {
      return;
    }

    if (current.kind === 'revoke') {
      await revokeSessions(current.row);
      return;
    }

    if (current.kind === 'deactivate') {
      await applyPatch(current.row, { active: false }, t('accountDeactivated'));
      return;
    }

    if (current.kind === 'unlock') {
      await applyPatch(current.row, { unlock: true }, t('accountUnlocked'));
      return;
    }

    await applyPatch(current.row, { role: current.role }, t('roleChangedTitle'));
  }

  const dialogTitle =
    action?.kind === 'deactivate'
      ? t('deactivateTitle')
      : action?.kind === 'revoke'
        ? t('revokeTitle')
        : action?.kind === 'unlock'
          ? t('unlockTitle')
          : t('roleChangeTitle');

  const dialogDescription =
    action?.kind === 'deactivate'
      ? t('deactivateBody', { callsign: action.row.displayName })
      : action?.kind === 'revoke'
        ? t('revokeBody', { callsign: action.row.displayName })
        : action?.kind === 'unlock'
          ? t('unlockBody', { callsign: action.row.displayName })
          : action?.kind === 'role'
            ? t('roleChangeBody', {
                callsign: action.row.displayName,
                role: roleLabel(action.role),
              })
            : '';

  const dialogConfirm =
    action?.kind === 'deactivate'
      ? t('confirmDeactivate')
      : action?.kind === 'revoke'
        ? t('revokeSessionsAction')
        : action?.kind === 'unlock'
          ? t('unlockAction')
          : t('confirmRoleChange');

  return (
    <div className="flex flex-col gap-4">
      <section className="border border-line bg-surface">
        <header className="border-b border-line px-3 py-2">
          <h2 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-label text-muted">
            <Plus aria-hidden="true" size={12} />
            {t('newResponder')}
          </h2>
        </header>

        <form className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-6" onSubmit={createResponder}>
          <Field id="new-email" label={t('email')} hint={t('emailHint')}>
            <Input
              id="new-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              spellCheck={false}
              maxLength={254}
              required
            />
          </Field>

          <Field id="new-callsign" label={t('callsignOptional')} hint={t('callsignHint')}>
            <Input
              id="new-callsign"
              value={callsign}
              onChange={(event) => setCallsign(event.target.value)}
              spellCheck={false}
              maxLength={32}
            />
          </Field>

          <Field id="new-role" label={t('role')}>
            <Select
              id="new-role"
              value={role}
              onChange={(event) => {
                if (isRole(event.target.value)) {
                  setRole(event.target.value);
                }
              }}
            >
              {ROLES.map((value) => (
                <option key={value} value={value}>
                  {roleLabel(value)}
                </option>
              ))}
            </Select>
          </Field>

          <Field id="new-office" label={t('office')}>
            <Select
              id="new-office"
              value={officeId}
              onChange={(event) => setOfficeId(event.target.value)}
            >
              {offices.map((office) => (
                <option key={office.id} value={office.id}>
                  {office.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field id="new-agency" label={t('agency')}>
            <Select
              id="new-agency"
              value={agencyId}
              onChange={(event) => setAgencyId(event.target.value)}
            >
              <option value="">{t('agencyNone')}</option>
              {agencies.map((agency) => (
                <option key={agency.id} value={agency.id}>
                  {agency.name}
                </option>
              ))}
            </Select>
          </Field>

          <div className="flex items-end">
            <Button
              type="submit"
              className="w-full"
              disabled={creating || email === '' || officeId === ''}
            >
              {creating ? t('saving') : t('createResponder')}
            </Button>
          </div>
        </form>

        {oneTimePassword ? (
          <div className="mx-3 mb-3 border border-status-success/50 bg-status-success/5 p-2.5">
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-label text-status-success">
              <KeyRound aria-hidden="true" size={12} />
              {t('oneTimePassword')}
            </p>
            <p className="mt-1 select-all break-all font-mono text-sm text-fg">{oneTimePassword}</p>
            <p className="mt-1 text-[10px] leading-relaxed text-muted">
              {t('oneTimePasswordHint')}
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => setOneTimePassword(null)}
            >
              {t('dismiss')}
            </Button>
          </div>
        ) : null}
      </section>

      <section className="border border-line bg-surface">
        <header className="border-b border-line px-3 py-2">
          <h2 className="text-[11px] font-bold uppercase tracking-label text-muted">
            {t('respondersTitle')} ({responders.length})
          </h2>
        </header>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-line text-[10px] uppercase tracking-label text-muted">
                <th className="px-3 py-2 font-bold">{t('responderLabel')}</th>
                <th className="px-3 py-2 font-bold">{t('role')}</th>
                <th className="px-3 py-2 font-bold">{t('office')}</th>
                <th className="px-3 py-2 font-bold">{t('activeLabel')}</th>
                <th className="px-3 py-2 font-bold">{t('lastLogin')}</th>
                <th className="px-3 py-2 font-bold">{t('sessions')}</th>
                <th className="px-3 py-2 font-bold">
                  <span className="sr-only">{t('responderRouting')}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {responders.map((row) => {
                const self = row.id === viewerId;
                const locked = row.lockedUntil !== null && row.lockedUntil > Date.now();
                const busy = pendingRow === row.id;

                return (
                  <tr key={row.id} className={cn(!row.active && 'opacity-60')}>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] tabular-nums text-fg">
                          {row.displayName}
                        </span>
                        {self ? (
                          <span className="text-[10px] uppercase tracking-label text-muted">
                            {t('signedInAs')}
                          </span>
                        ) : null}
                      </div>
                      <div className="text-[10px] lowercase text-muted">{row.email}</div>
                    </td>

                    <td className="px-3 py-2">
                      <Select
                        aria-label={`${t('role')} ${row.displayName}`}
                        className="h-8"
                        value={row.role}
                        disabled={self || busy}
                        onChange={(event) => {
                          if (isRole(event.target.value) && event.target.value !== row.role) {
                            setAction({ kind: 'role', row, role: event.target.value });
                          }
                        }}
                      >
                        {ROLES.map((value) => (
                          <option key={value} value={value}>
                            {roleLabel(value)}
                          </option>
                        ))}
                      </Select>
                    </td>

                    <td className="px-3 py-2 text-muted">
                      <div>{row.officeName}</div>
                      <div className="text-[10px] uppercase tracking-label">
                        {row.agencyName ?? t('agencyNone')}
                      </div>
                    </td>

                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          'text-[10px] font-bold uppercase tracking-label',
                          row.active ? 'text-status-resolved' : 'text-status-error',
                        )}
                      >
                        {row.active ? t('activeValue') : t('inactiveValue')}
                      </span>
                      {locked ? (
                        <span className="ml-2 text-[10px] font-bold uppercase tracking-label text-status-queued">
                          {t('lockedValue')}
                        </span>
                      ) : null}
                    </td>

                    <td className="px-3 py-2 font-mono text-[11px] tabular-nums text-muted">
                      {formatTimestamp(row.lastLoginAt)}
                    </td>

                    <td className="px-3 py-2 font-mono text-[11px] tabular-nums text-muted">
                      {row.sessionCount}
                    </td>

                    <td className="px-3 py-2">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {locked ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            onClick={() => setAction({ kind: 'unlock', row })}
                          >
                            <Unlock aria-hidden="true" size={12} />
                            {t('unlockAction')}
                          </Button>
                        ) : null}

                        {row.active ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={self || busy}
                            onClick={() => setAction({ kind: 'deactivate', row })}
                          >
                            <ShieldOff aria-hidden="true" size={12} />
                            {t('deactivateAction')}
                          </Button>
                        ) : (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              void applyPatch(row, { active: true }, t('accountActivated'))
                            }
                          >
                            {t('activateAction')}
                          </Button>
                        )}

                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy || row.sessionCount === 0}
                          onClick={() => setAction({ kind: 'revoke', row })}
                        >
                          {t('revokeSessionsAction')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <ConfirmDialog
        open={action !== null}
        onOpenChange={(open) => {
          if (!open) {
            setAction(null);
          }
        }}
        title={dialogTitle}
        description={dialogDescription}
        confirmLabel={dialogConfirm}
        cancelLabel={t('cancelAction')}
        onConfirm={() => void confirmAction()}
      />
    </div>
  );
}
