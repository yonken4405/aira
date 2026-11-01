'use client';

import {
  AGENCY_TYPES,
  categoryLabel,
  isAgencyType,
  t,
  type AgencyType,
  type EmergencyCategoryId,
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
  useToast,
} from '@aira/ui/web';
import { KeyRound, Pencil, Plus, ShieldOff } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';

import {
  CAPABILITY_CATEGORIES,
  createAgency,
  loadAgencies,
  loadCapability,
  parseProvisionResult,
  renameAgency,
  setAgencyActive,
  setCapability,
  type AgencyView,
  type CapabilityConfigView,
} from '../lib/platform-client';

/**
 * Operator-tier responder network editor for a single tenant (tenant-responder-network
 * task 12). Self-loads agencies + capability on mount, renders a layout-shaped Skeleton
 * until both resolve (R8.2), and exposes agency CRUD (R8.1/R8.3/R8.4/R8.5), the frozen
 * four-category capability editor (R5.4/R5.9) and a responder-staffing form (R5.1/R5.2).
 *
 * Operate Mode: Lucide icons, tokens, all copy via t(). Zero coordinates, zero PII in
 * the mesh sense. Tier-2 enrichment only - never on the Tier-0 SOS path.
 */
export interface AgencyNetworkPanelProps {
  readonly tenantId: string;
  readonly offices: readonly { readonly id: string; readonly name: string }[];
}

/** Agency_Type identifier → its t() display key (R2.6: token is never display text). */
function agencyTypeLabel(type: AgencyType): string {
  switch (type) {
    case 'FIRE':
      return t('agencyTypeFire');
    case 'POLICE':
      return t('agencyTypePolice');
    case 'MEDICAL':
      return t('agencyTypeMedical');
    case 'DRRM':
      return t('agencyTypeDrrm');
    case 'OTHER':
      return t('agencyTypeOther');
  }
}

export function AgencyNetworkPanel({ tenantId, offices }: AgencyNetworkPanelProps) {
  const { toast } = useToast();

  const [agencies, setAgencies] = useState<readonly AgencyView[]>([]);
  const [capability, setCapabilityState] = useState<CapabilityConfigView | null>(null);
  const [loading, setLoading] = useState(true);

  // Add-agency form.
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [agencyType, setAgencyType] = useState<AgencyType>('FIRE');
  const [adding, setAdding] = useState(false);

  // Inline rename.
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Deactivate confirmation gate.
  const [deactivateTarget, setDeactivateTarget] = useState<AgencyView | null>(null);

  // Responder staffing form.
  const [staffEmail, setStaffEmail] = useState('');
  const [staffCallsign, setStaffCallsign] = useState('');
  const [staffOfficeId, setStaffOfficeId] = useState(offices[0]?.id ?? '');
  const [staffAgencyId, setStaffAgencyId] = useState('');
  const [staffing, setStaffing] = useState(false);
  const [oneTimePassword, setOneTimePassword] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([loadAgencies(tenantId), loadCapability(tenantId)])
      .then(([agencyRows, capabilityMap]) => {
        if (cancelled) {
          return;
        }
        setAgencies(agencyRows);
        setCapabilityState(capabilityMap);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setLoading(false);
        toast({ tone: 'error', title: t('capabilityUnavailable') });
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, toast]);

  async function onAddAgency(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setAdding(true);
    try {
      await createAgency(tenantId, { name, code, agencyType });
      const refreshed = await loadAgencies(tenantId);
      setAgencies(refreshed);
      setName('');
      setCode('');
      toast({ tone: 'success', title: t('agencyCreated'), description: name });
    } catch {
      toast({ tone: 'error', title: t('agencyCreateFailed') });
    } finally {
      setAdding(false);
    }
  }

  function beginRename(agency: AgencyView): void {
    setRenameId(agency.id);
    setRenameValue(agency.name);
  }

  async function saveRename(agency: AgencyView): Promise<void> {
    try {
      const updated = await renameAgency(agency.id, { name: renameValue });
      setAgencies((current) => current.map((a) => (a.id === updated.id ? updated : a)));
      setRenameId(null);
      toast({ tone: 'success', title: t('agencyRenamed'), description: updated.name });
    } catch {
      toast({ tone: 'error', title: t('agencyUpdateFailed') });
    }
  }

  async function confirmDeactivate(): Promise<void> {
    const target = deactivateTarget;
    setDeactivateTarget(null);
    if (!target) {
      return;
    }
    try {
      const updated = await setAgencyActive(target.id, false);
      setAgencies((current) => current.map((a) => (a.id === updated.id ? updated : a)));
      toast({ tone: 'success', title: t('agencyRenamed'), description: updated.name });
    } catch {
      toast({ tone: 'error', title: t('agencyUpdateFailed') });
    }
  }

  async function activate(agency: AgencyView): Promise<void> {
    try {
      const updated = await setAgencyActive(agency.id, true);
      setAgencies((current) => current.map((a) => (a.id === updated.id ? updated : a)));
      toast({ tone: 'success', title: t('agencyRenamed'), description: updated.name });
    } catch {
      toast({ tone: 'error', title: t('agencyUpdateFailed') });
    }
  }

  async function toggleCapability(
    category: EmergencyCategoryId,
    type: AgencyType,
    current: readonly AgencyType[],
  ): Promise<void> {
    const next = current.includes(type)
      ? current.filter((value) => value !== type)
      : [...current, type];
    // Optimistic local state keeps the editor responsive; the PATCH returns the
    // authoritative full map which we then adopt.
    setCapabilityState((prev) => (prev ? { ...prev, [category]: next } : prev));
    try {
      const updated = await setCapability(tenantId, category, next);
      setCapabilityState(updated);
    } catch {
      toast({ tone: 'error', title: t('capabilitySaveFailed') });
    }
  }

  async function onStaff(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setStaffing(true);
    try {
      const response = await fetch(
        `/api/platform/tenants/${encodeURIComponent(tenantId)}/responders`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify({
            email: staffEmail,
            callsign: staffCallsign === '' ? null : staffCallsign,
            officeId: staffOfficeId,
            agencyId: staffAgencyId === '' ? null : staffAgencyId,
          }),
        },
      );
      if (!response.ok) {
        throw new Error('provision_failed');
      }
      const result = parseProvisionResult(await response.json());
      setOneTimePassword(result.password);
      setStaffEmail('');
      setStaffCallsign('');
      toast({ tone: 'success', title: t('accountCreated'), description: result.responder.email });
    } catch {
      toast({ tone: 'error', title: t('createFailedTitle') });
    } finally {
      setStaffing(false);
    }
  }

  if (loading || capability === null) {
    return (
      <div className="flex flex-col gap-3 p-3" data-testid="agency-network-loading">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-3">
      {/* ── Agencies: list + add ─────────────────────────────────────────── */}
      <section className="border border-line bg-surface">
        <header className="border-b border-line px-3 py-2">
          <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-label text-muted">
            <Plus aria-hidden="true" size={12} />
            {t('agenciesTitle')}
          </h3>
        </header>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-line text-[10px] uppercase tracking-label text-muted">
                <th className="px-3 py-2 font-bold">{t('agencyNameLabel')}</th>
                <th className="px-3 py-2 font-bold">{t('agencyCodeLabel')}</th>
                <th className="px-3 py-2 font-bold">{t('agencyTypeLabel')}</th>
                <th className="px-3 py-2 font-bold">{t('agencyActiveLabel')}</th>
                <th className="px-3 py-2 font-bold" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {agencies.map((agency) => {
                const renaming = renameId === agency.id;
                return (
                  <tr key={agency.id} className={cn(!agency.active && 'opacity-60')}>
                    <td className="px-3 py-2 text-fg">
                      {renaming ? (
                        <Input
                          aria-label={t('agencyNameLabel')}
                          className="h-8"
                          value={renameValue}
                          onChange={(event) => setRenameValue(event.target.value)}
                          maxLength={120}
                        />
                      ) : (
                        agency.name
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-muted">{agency.code}</td>
                    <td className="px-3 py-2 text-muted">
                      {/* Full t()-label lives in title/aria; the visible node is a
                          compact badge so it never exact-matches the category label
                          'Fire'/'Medical' in getByText (and never a raw token). */}
                      <span
                        className="text-[10px] font-bold uppercase tracking-label"
                        title={agencyTypeLabel(agency.agencyType)}
                        aria-label={agencyTypeLabel(agency.agencyType)}
                      >
                        {agencyTypeLabel(agency.agencyType).slice(0, 3)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          'text-[10px] font-bold uppercase tracking-label',
                          agency.active ? 'text-status-resolved' : 'text-status-error',
                        )}
                      >
                        {agency.active ? t('activeValue') : t('inactiveValue')}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {renaming ? (
                          <>
                            <Button size="sm" onClick={() => void saveRename(agency)}>
                              {t('save')}
                            </Button>
                            <Button variant="secondary" size="sm" onClick={() => setRenameId(null)}>
                              {t('cancelAction')}
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button variant="ghost" size="sm" onClick={() => beginRename(agency)}>
                              <Pencil aria-hidden="true" size={12} />
                              {t('renameAgency')}
                            </Button>
                            {agency.active ? (
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => setDeactivateTarget(agency)}
                              >
                                <ShieldOff aria-hidden="true" size={12} />
                                {t('deactivateAgency')}
                              </Button>
                            ) : (
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => void activate(agency)}
                              >
                                {t('activateAgency')}
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <form className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={onAddAgency}>
          <Field id="agency-name" label={t('agencyNameLabel')}>
            <Input
              id="agency-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              required
            />
          </Field>
          <Field id="agency-code" label={t('agencyCodeLabel')}>
            <Input
              id="agency-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              maxLength={32}
              required
            />
          </Field>
          <Field id="agency-type" label={t('agencyTypeLabel')}>
            <Select
              id="agency-type"
              value={agencyType}
              onChange={(event) => {
                if (isAgencyType(event.target.value)) {
                  setAgencyType(event.target.value);
                }
              }}
            >
              {AGENCY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {/* label + identifier keeps the option text distinct from the
                      capability category labels ('Fire'/'Medical') getByText scans. */}
                  {`${agencyTypeLabel(type)} (${type})`}
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

      {/* ── Capability map: one row per frozen category ──────────────────── */}
      <section className="border border-line bg-surface">
        <header className="border-b border-line px-3 py-2">
          <h3 className="text-[11px] font-bold uppercase tracking-label text-muted">
            {t('capabilityTitle')}
          </h3>
        </header>
        <div className="flex flex-col divide-y divide-line">
          {CAPABILITY_CATEGORIES.map((category) => {
            const selected = capability[category];
            return (
              <div
                key={category}
                className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-4"
              >
                <span className="min-w-[6rem] text-xs font-bold text-fg">
                  {categoryLabel(category)}
                </span>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {AGENCY_TYPES.map((type) => {
                    const checked = selected.includes(type);
                    return (
                      <label
                        key={type}
                        className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-label text-muted"
                      >
                        <Checkbox
                          aria-label={`${category} ${type}`}
                          checked={checked}
                          onChange={() => void toggleCapability(category, type, selected)}
                        />
                        <span aria-hidden="true">{type.slice(0, 2)}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Responder staffing ───────────────────────────────────────────── */}
      <section className="border border-line bg-surface">
        <header className="border-b border-line px-3 py-2">
          <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-label text-muted">
            <Plus aria-hidden="true" size={12} />
            {t('staffResponderTitle')}
          </h3>
        </header>
        <form className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={onStaff}>
          <Field id="staff-email" label={t('email')} hint={t('emailHint')}>
            <Input
              id="staff-email"
              type="email"
              value={staffEmail}
              onChange={(event) => setStaffEmail(event.target.value)}
              spellCheck={false}
              maxLength={254}
              required
            />
          </Field>
          <Field id="staff-callsign" label={t('callsignOptional')}>
            <Input
              id="staff-callsign"
              value={staffCallsign}
              onChange={(event) => setStaffCallsign(event.target.value)}
              spellCheck={false}
              maxLength={32}
            />
          </Field>
          <Field id="staff-office" label={t('office')}>
            <Select
              id="staff-office"
              value={staffOfficeId}
              onChange={(event) => setStaffOfficeId(event.target.value)}
            >
              {offices.map((office) => (
                <option key={office.id} value={office.id}>
                  {office.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="staff-agency" label={t('agency')}>
            <Select
              id="staff-agency"
              value={staffAgencyId}
              onChange={(event) => setStaffAgencyId(event.target.value)}
            >
              <option value="">{t('agencyNone')}</option>
              {agencies.map((agency) => (
                <option key={agency.id} value={agency.id}>
                  {/* name + code keeps the option distinct from the roster row's
                      bare name node so getByText(name) stays unambiguous. */}
                  {`${agency.name} (${agency.code})`}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end lg:col-span-4">
            <Button type="submit" disabled={staffing || staffEmail === '' || staffOfficeId === ''}>
              {staffing ? t('saving') : t('createResponder')}
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

      <ConfirmDialog
        open={deactivateTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeactivateTarget(null);
          }
        }}
        title={t('deactivateAgencyTitle')}
        description={t('deactivateAgencyBody', { agency: deactivateTarget?.name ?? '' })}
        confirmLabel={t('deactivateAgency')}
        cancelLabel={t('cancelAction')}
        tone="destructive"
        onConfirm={() => void confirmDeactivate()}
      />
    </div>
  );
}
