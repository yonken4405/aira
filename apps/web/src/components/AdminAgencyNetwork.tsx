'use client';

import {
  AGENCY_TYPES,
  EMERGENCY_CATEGORIES,
  categoryLabel,
  t,
  type AgencyType,
  type EmergencyCategoryId,
  type MessageKey,
} from '@aira/ui';
import {
  Button,
  Checkbox,
  ConfirmDialog,
  Field,
  Input,
  Select,
  Skeleton,
  cn,
  useOptionalToast,
} from '@aira/ui/web';
import { Building2, Plus, ShieldOff } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';

import {
  createAgency,
  loadAgencies,
  loadCapability,
  setAgencyActive,
  setCapability,
} from '../lib/admin-client';
import type { AgencyView, CapabilityConfigView } from '../lib/platform-client';

/**
 * DRRM_Admin agency + capability editors (tenant-responder-network, task 13.2).
 *
 * A DRRM_Admin is tenant-bounded: the server derives the acting tenant from the
 * session principal, so this component takes NO props and NO `tenantId`. It
 * self-loads the tenant's agencies and the capability map on mount via the
 * session-scoped `/api/admin/...` routes (never a tenantId in the URL), mirroring
 * how `AdminResponders` self-manages its mutations.
 *
 * Operate Mode only (DESIGN.md): shared primitives, Lucide icons, token colors,
 * no coordinates anywhere, and every async surface gets a skeleton + toast. This
 * is a Tier-2 online enrichment surface and never sits on the Tier-0 SOS path.
 */

/** Agency_Type → i18n label key. Tokens are identifiers; labels resolve via t() (R2.6). */
const AGENCY_TYPE_LABEL_KEY: Readonly<Record<AgencyType, MessageKey>> = {
  FIRE: 'agencyTypeFire',
  POLICE: 'agencyTypePolice',
  MEDICAL: 'agencyTypeMedical',
  DRRM: 'agencyTypeDrrm',
  OTHER: 'agencyTypeOther',
};

function agencyTypeLabel(type: AgencyType): string {
  return t(AGENCY_TYPE_LABEL_KEY[type]);
}

/**
 * The set of category display labels ('Fire' / 'Medical' / 'Crime' / 'Flood'). Some
 * Agency_Type labels collide with these (FIRE→'Fire', MEDICAL→'Medical'). Where an
 * agency row would render an Agency_Type label that is ALSO a category label, we pair
 * it with the code on one line so the capability category rows remain the single,
 * unambiguous source of that exact label (keeps both surfaces readable).
 */
const CATEGORY_LABELS: ReadonlySet<string> = new Set(
  EMERGENCY_CATEGORIES.map((category) => categoryLabel(category.id)),
);

type LoadState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly data: T }
  | { readonly status: 'error' };

export function AdminAgencyNetwork(): ReactElement {
  const { toast } = useOptionalToast();

  const [agencies, setAgencies] = useState<LoadState<readonly AgencyView[]>>({ status: 'loading' });
  const [capability, setCapabilityState] = useState<LoadState<CapabilityConfigView>>({
    status: 'loading',
  });

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [agencyType, setAgencyType] = useState<AgencyType>('FIRE');
  const [adding, setAdding] = useState(false);
  const [busyCapability, setBusyCapability] = useState(false);
  const [pending, setPending] = useState<AgencyView | null>(null);

  useEffect(() => {
    let active = true;

    void loadAgencies()
      .then((rows) => {
        if (active) {
          setAgencies({ status: 'ready', data: rows });
        }
      })
      .catch(() => {
        if (active) {
          setAgencies({ status: 'error' });
        }
      });

    void loadCapability()
      .then((config) => {
        if (active) {
          setCapabilityState({ status: 'ready', data: config });
        }
      })
      .catch(() => {
        if (active) {
          setCapabilityState({ status: 'error' });
        }
      });

    return () => {
      active = false;
    };
  }, []);

  async function addAgency(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setAdding(true);
    try {
      const created = await createAgency({ name, code, agencyType });
      setAgencies((current) =>
        current.status === 'ready'
          ? { status: 'ready', data: [...current.data, created] }
          : current,
      );
      toast({ tone: 'success', title: t('agencyCreated'), description: created.name });
      setName('');
      setCode('');
    } catch {
      toast({ tone: 'error', title: t('agencyCreateFailed') });
    } finally {
      setAdding(false);
    }
  }

  async function confirmDeactivate(): Promise<void> {
    const target = pending;
    setPending(null);
    if (!target) {
      return;
    }
    try {
      const updated = await setAgencyActive(target.id, false);
      setAgencies((current) =>
        current.status === 'ready'
          ? {
              status: 'ready',
              data: current.data.map((row) => (row.id === updated.id ? updated : row)),
            }
          : current,
      );
      toast({ tone: 'success', title: t('agencyRenamed'), description: updated.name });
    } catch {
      toast({ tone: 'error', title: t('agencyUpdateFailed') });
    }
  }

  async function toggleCapability(
    category: EmergencyCategoryId,
    type: AgencyType,
    nextChecked: boolean,
  ): Promise<void> {
    if (capability.status !== 'ready') {
      return;
    }
    const current = capability.data[category];
    const nextSet = nextChecked
      ? [...current, type]
      : current.filter((existing) => existing !== type);

    setBusyCapability(true);
    try {
      const config = await setCapability(category, nextSet);
      setCapabilityState({ status: 'ready', data: config });
      toast({ tone: 'success', title: t('capabilitySaved') });
    } catch {
      toast({ tone: 'error', title: t('capabilitySaveFailed') });
    } finally {
      setBusyCapability(false);
    }
  }

  const agencyRows = agencies.status === 'ready' ? agencies.data : [];

  return (
    <div className="flex flex-col gap-4">
      <section className="border border-line bg-surface">
        <header className="border-b border-line px-3 py-2">
          <h2 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-label text-muted">
            <Plus aria-hidden="true" size={12} />
            {t('addAgency')}
          </h2>
        </header>

        <form className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={addAgency}>
          <Field id="new-agency-name" label={t('agencyNameLabel')}>
            <Input
              id="new-agency-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              spellCheck={false}
              maxLength={120}
              required
            />
          </Field>

          <Field id="new-agency-code" label={t('agencyCodeLabel')}>
            <Input
              id="new-agency-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              spellCheck={false}
              maxLength={32}
              required
            />
          </Field>

          <Field id="new-agency-type" label={t('agencyTypeLabel')}>
            <Select
              id="new-agency-type"
              value={agencyType}
              onChange={(event) => {
                const next = event.target.value;
                const match = AGENCY_TYPES.find((value) => value === next);
                if (match) {
                  setAgencyType(match);
                }
              }}
            >
              {AGENCY_TYPES.map((value) => (
                <option key={value} value={value}>
                  {/*
                    Descriptor suffix (never a bare Agency_Type label) so the
                    picker options don't duplicate the single exact label nodes
                    the agency list and capability rows own. Still t()-resolved,
                    never the raw identifier (R2.6).
                  */}
                  {t('agencyTypeOption', { type: agencyTypeLabel(value) })}
                </option>
              ))}
            </Select>
          </Field>

          <div className="flex items-end">
            <Button
              type="submit"
              className="w-full"
              disabled={adding || name === '' || code === ''}
            >
              {adding ? t('saving') : t('addAgency')}
            </Button>
          </div>
        </form>
      </section>

      <section className="border border-line bg-surface">
        <header className="border-b border-line px-3 py-2">
          <h2 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-label text-muted">
            <Building2 aria-hidden="true" size={12} />
            {t('agenciesTitle')}
          </h2>
        </header>

        {agencies.status === 'loading' ? (
          <div className="flex flex-col gap-2 p-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : agencies.status === 'error' ? (
          <p className="p-3 text-xs text-status-error">{t('agencyUpdateFailed')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {agencyRows.map((agency) => {
              const typeLabel = agencyTypeLabel(agency.agencyType);
              const collides = CATEGORY_LABELS.has(typeLabel);
              return (
                <li
                  key={agency.id}
                  className={cn(
                    'flex flex-wrap items-center justify-between gap-2 px-3 py-2',
                    !agency.active && 'opacity-60',
                  )}
                >
                  <div className="flex flex-col">
                    <span className="text-sm text-fg">{agency.name}</span>
                    <span className="text-[10px] uppercase tracking-label text-muted">
                      {/*
                        An Agency_Type label that is also a category display label
                        (e.g. 'Fire') is paired with the code so the capability rows
                        stay the single unambiguous source of that exact label.
                      */}
                      {collides ? (
                        <span className="font-mono normal-case">
                          {typeLabel} · {agency.code}
                        </span>
                      ) : (
                        <>
                          <span>{typeLabel}</span>
                          <span className="ml-2 font-mono normal-case text-muted">
                            {agency.code}
                          </span>
                        </>
                      )}
                    </span>
                  </div>

                  {agency.active ? (
                    <Button variant="secondary" size="sm" onClick={() => setPending(agency)}>
                      <ShieldOff aria-hidden="true" size={12} />
                      {t('deactivateAgency')}
                    </Button>
                  ) : (
                    <span className="text-[10px] font-bold uppercase tracking-label text-status-error">
                      {t('inactiveValue')}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="border border-line bg-surface">
        <header className="border-b border-line px-3 py-2">
          <h2 className="text-[11px] font-bold uppercase tracking-label text-muted">
            {t('capabilityTitle')}
          </h2>
        </header>

        {capability.status === 'loading' ? (
          <div className="flex flex-col gap-2 p-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : capability.status === 'error' ? (
          <p className="p-3 text-xs text-status-error">{t('capabilityUnavailable')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {/*
              One row per frozen category. Each row's header is the ONLY exact
              occurrence of that category label ('Fire'/'Medical'/'Crime'/'Flood')
              on the whole surface. Agency_Type labels are NOT rendered as visible
              text here — each checkbox carries an aria-label combining the category
              display label with the Agency_Type label (R8.1, R2.6), so the type
              names never duplicate the exact text nodes the agency list owns.
            */}
            {EMERGENCY_CATEGORIES.map((category) => {
              const label = categoryLabel(category.id);
              const capable = capability.data[category.id];
              return (
                <li
                  key={category.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2"
                >
                  <span className="min-w-[4rem] text-sm text-fg">{label}</span>
                  <div className="flex flex-wrap items-center gap-3">
                    {AGENCY_TYPES.map((type) => (
                      <Checkbox
                        key={type}
                        aria-label={`${label} ${agencyTypeLabel(type)}`}
                        checked={capable.includes(type)}
                        disabled={busyCapability}
                        onChange={(event) =>
                          void toggleCapability(category.id, type, event.target.checked)
                        }
                      />
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPending(null);
          }
        }}
        title={t('deactivateAgencyTitle')}
        description={pending ? t('deactivateAgencyBody', { agency: pending.name }) : ''}
        confirmLabel={t('deactivateAgency')}
        cancelLabel={t('cancelAction')}
        tone="destructive"
        onConfirm={() => void confirmDeactivate()}
      />
    </div>
  );
}
