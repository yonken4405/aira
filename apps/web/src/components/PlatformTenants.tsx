'use client';

import { t } from '@aira/ui';
import { Button, ConfirmDialog, Field, Input, cn, useToast } from '@aira/ui/web';
import { KeyRound, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import type { TenantRecord } from '../lib/platform/types';

export interface PlatformTenantsProps {
  readonly tenants: readonly TenantRecord[];
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

export function PlatformTenants({ tenants }: PlatformTenantsProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [name, setName] = useState('');
  const [region, setRegion] = useState('');
  const [province, setProvince] = useState('');
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [creating, setCreating] = useState(false);

  const [adminFor, setAdminFor] = useState<TenantRecord | null>(null);
  const [adminEmail, setAdminEmail] = useState('');
  const [oneTimePassword, setOneTimePassword] = useState<string | null>(null);

  // High-impact status changes (suspend/activate) are confirmation-gated (R18):
  // the PATCH only fires once the operator confirms, and Cancel aborts with no
  // network call. Suspension uses a destructive-tone confirm.
  const [statusAction, setStatusAction] = useState<{
    readonly tenant: TenantRecord;
    readonly status: 'active' | 'suspended';
  } | null>(null);

  async function onboard(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setCreating(true);
    const result = await request('/api/platform/tenants', 'POST', {
      name,
      region,
      province,
      lguName: name,
      lat: lat === '' ? null : Number(lat),
      lon: lon === '' ? null : Number(lon),
    });
    setCreating(false);

    if (result.ok) {
      toast({ tone: 'success', title: t('tenantCreated'), description: name });
      setName('');
      setRegion('');
      setProvince('');
      setLat('');
      setLon('');
      router.refresh();
      return;
    }
    toast({
      tone: 'error',
      title: t('updateFailed'),
      description: result.status === 409 ? t('tenantExists') : t('tenantInvalid'),
    });
  }

  async function confirmStatus(): Promise<void> {
    const current = statusAction;
    setStatusAction(null);
    if (!current) {
      return;
    }
    await setStatus(current.tenant, current.status);
  }

  async function setStatus(tenant: TenantRecord, status: 'active' | 'suspended'): Promise<void> {
    const result = await request(`/api/platform/tenants/${tenant.id}`, 'PATCH', { status });
    if (result.ok) {
      toast({ tone: 'success', title: t('accountUpdated'), description: tenant.name });
      router.refresh();
    } else {
      toast({ tone: 'error', title: t('updateFailed') });
    }
  }

  async function bootstrap(): Promise<void> {
    const tenant = adminFor;
    if (!tenant || adminEmail === '') {
      return;
    }
    const result = await request(`/api/platform/tenants/${tenant.id}/admin`, 'POST', {
      email: adminEmail,
    });
    if (result.ok && typeof result.data.password === 'string') {
      setOneTimePassword(result.data.password);
      toast({ tone: 'success', title: t('adminProvisioned'), description: adminEmail });
      setAdminEmail('');
      setAdminFor(null);
    } else {
      toast({
        tone: 'error',
        title: t('updateFailed'),
        description: result.status === 409 ? t('emailTaken') : t('createFailedBody'),
      });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="border border-line bg-surface">
        <header className="border-b border-line px-3 py-2">
          <h2 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-label text-muted">
            <Plus aria-hidden="true" size={12} />
            {t('newTenant')}
          </h2>
        </header>

        <form className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-6" onSubmit={onboard}>
          <Field id="t-name" label={t('tenantName')}>
            <Input
              id="t-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              required
            />
          </Field>
          <Field id="t-region" label={t('tenantRegion')}>
            <Input
              id="t-region"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              maxLength={64}
              required
            />
          </Field>
          <Field id="t-province" label={t('tenantProvince')}>
            <Input
              id="t-province"
              value={province}
              onChange={(e) => setProvince(e.target.value)}
              maxLength={64}
              required
            />
          </Field>
          <Field id="t-lat" label={t('tenantLat')}>
            <Input
              id="t-lat"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              inputMode="decimal"
            />
          </Field>
          <Field id="t-lon" label={t('tenantLon')}>
            <Input
              id="t-lon"
              value={lon}
              onChange={(e) => setLon(e.target.value)}
              inputMode="decimal"
            />
          </Field>
          <div className="flex items-end">
            <Button
              type="submit"
              className="w-full"
              disabled={creating || name === '' || region === '' || province === ''}
            >
              {creating ? t('saving') : t('createTenantAction')}
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
            {t('platformTenants')} ({tenants.length})
          </h2>
        </header>

        {tenants.length === 0 ? (
          <p className="p-3 text-xs text-muted">{t('noTenants')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-line text-[10px] uppercase tracking-label text-muted">
                  <th className="px-3 py-2 font-bold">{t('tenantName')}</th>
                  <th className="px-3 py-2 font-bold">{t('tenantRegion')}</th>
                  <th className="px-3 py-2 font-bold">{t('tenantProvince')}</th>
                  <th className="px-3 py-2 font-bold">{t('tenantStatus')}</th>
                  <th className="px-3 py-2 font-bold" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {tenants.map((tenant) => (
                  <tr key={tenant.id} className={cn(tenant.status === 'suspended' && 'opacity-60')}>
                    <td className="px-3 py-2 text-fg">{tenant.name}</td>
                    <td className="px-3 py-2 text-muted">{tenant.region}</td>
                    <td className="px-3 py-2 text-muted">{tenant.province}</td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          'text-[10px] font-bold uppercase tracking-label',
                          tenant.status === 'active' ? 'text-status-resolved' : 'text-status-error',
                        )}
                      >
                        {tenant.status === 'active' ? t('tenantActive') : t('tenantSuspended')}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setAdminEmail('');
                            setAdminFor(tenant);
                          }}
                        >
                          {t('bootstrapAdmin')}
                        </Button>
                        {tenant.status === 'active' ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setStatusAction({ tenant, status: 'suspended' })}
                          >
                            {t('suspendTenant')}
                          </Button>
                        ) : (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setStatusAction({ tenant, status: 'active' })}
                          >
                            {t('activateTenant')}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {adminFor ? (
        <section className="border border-line bg-surface" data-testid="bootstrap-panel">
          <header className="border-b border-line px-3 py-2">
            <h2 className="text-[11px] font-bold uppercase tracking-label text-muted">
              {t('bootstrapAdminTitle')}
            </h2>
          </header>
          <div className="flex flex-col gap-3 p-3">
            <p className="text-xs text-muted">
              {t('bootstrapAdminBody', { tenant: adminFor.name })}
            </p>
            <Field id="bootstrap-email" label={t('adminEmail')}>
              <Input
                id="bootstrap-email"
                type="email"
                value={adminEmail}
                onChange={(event) => setAdminEmail(event.target.value)}
                maxLength={254}
              />
            </Field>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void bootstrap()} disabled={adminEmail === ''}>
                {t('createResponder')}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setAdminFor(null)}>
                {t('cancelAction')}
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      <ConfirmDialog
        open={statusAction !== null}
        onOpenChange={(open) => {
          if (!open) {
            setStatusAction(null);
          }
        }}
        title={
          statusAction?.status === 'suspended' ? t('suspendTenantTitle') : t('activateTenantTitle')
        }
        description={
          statusAction?.status === 'suspended'
            ? t('suspendTenantBody', { tenant: statusAction?.tenant.name ?? '' })
            : t('activateTenantBody', { tenant: statusAction?.tenant.name ?? '' })
        }
        confirmLabel={
          statusAction?.status === 'suspended' ? t('suspendTenant') : t('activateTenant')
        }
        cancelLabel={t('cancelAction')}
        tone={statusAction?.status === 'suspended' ? 'destructive' : 'default'}
        onConfirm={() => void confirmStatus()}
      />
    </div>
  );
}
