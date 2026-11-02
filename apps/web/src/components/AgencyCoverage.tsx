'use client';

import { t } from '@aira/ui';
import { Button, ConfirmDialog, Skeleton, useToast } from '@aira/ui/web';
import { MapPinned } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { OfficeSummary } from '../lib/auth/types';

export interface AgencyCoverageProps {
  /** The acting agency admin's own agency. */
  readonly agencyId: string;
  readonly agencyName: string;
  /** Barangays (and the LGU root) the agency may cover. */
  readonly offices: readonly OfficeSummary[];
}

type Phase =
  { readonly kind: 'loading' } | { readonly kind: 'ready' } | { readonly kind: 'unavailable' };

/**
 * Agency coverage editor (single-lgu-agency-network R5). A barangay checklist for the
 * acting agency; saving full-replaces the agency's coverage set. Coverage is
 * prioritization only — units still respond anywhere in the LGU. Operate Mode: a
 * layout-shaped Skeleton on first load, a ConfirmDialog before the full-replace save,
 * unified toast on the outcome, an honest "unavailable" state on failure, copy via t().
 */
export function AgencyCoverage({ agencyId, agencyName, offices }: AgencyCoverageProps) {
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await fetch(
          `/api/admin/agencies/${encodeURIComponent(agencyId)}/coverage`,
          {
            headers: { accept: 'application/json' },
            credentials: 'same-origin',
            cache: 'no-store',
          },
        );
        if (!response.ok) {
          throw new Error(`coverage_request_failed_${response.status}`);
        }
        const body = (await response.json()) as { officeIds: readonly string[] };
        if (active) {
          setSelected(new Set(body.officeIds));
          setPhase({ kind: 'ready' });
        }
      } catch {
        if (active) {
          setPhase({ kind: 'unavailable' });
          toast({
            tone: 'error',
            title: t('coverageTitle'),
            description: t('coverageUnavailable'),
          });
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [agencyId, toast]);

  function toggle(officeId: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(officeId)) {
        next.delete(officeId);
      } else {
        next.add(officeId);
      }
      return next;
    });
  }

  async function save(): Promise<void> {
    setConfirming(false);
    setSaving(true);
    try {
      const response = await fetch(`/api/admin/agencies/${encodeURIComponent(agencyId)}/coverage`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ officeIds: [...selected] }),
      });
      if (!response.ok) {
        throw new Error(`coverage_save_failed_${response.status}`);
      }
      toast({ tone: 'success', title: t('coverageSaved'), description: agencyName });
    } catch {
      toast({ tone: 'error', title: t('coverageTitle'), description: t('coverageSaveFailed') });
    } finally {
      setSaving(false);
    }
  }

  if (phase.kind === 'loading') {
    return (
      <div aria-busy="true" data-testid="coverage-skeleton" className="flex flex-col gap-3">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (phase.kind === 'unavailable') {
    return (
      <section className="border border-line bg-surface p-4">
        <p className="text-[11px] font-bold uppercase tracking-label text-muted">
          {t('coverageUnavailable')}
        </p>
      </section>
    );
  }

  return (
    <section className="border border-line bg-surface">
      <header className="border-b border-line px-3 py-2">
        <h2 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-label text-muted">
          <MapPinned aria-hidden="true" size={12} />
          {t('coverageTitle')} — {agencyName}
        </h2>
      </header>

      <p className="px-3 pt-3 text-[11px] leading-relaxed text-muted">{t('coverageHint')}</p>

      <ul className="flex flex-col gap-1 p-3">
        {offices.map((office) => (
          <li key={office.id}>
            <label className="flex items-center gap-2 text-xs text-fg">
              <input
                type="checkbox"
                checked={selected.has(office.id)}
                onChange={() => toggle(office.id)}
              />
              <span>{office.name}</span>
              <span className="text-[10px] uppercase tracking-label text-muted">{office.kind}</span>
            </label>
          </li>
        ))}
      </ul>

      <div className="flex justify-end border-t border-line p-3">
        <Button disabled={saving} onClick={() => setConfirming(true)}>
          {saving ? t('saving') : t('coverageSave')}
        </Button>
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('coverageConfirmTitle')}
        description={t('coverageConfirmBody', { agency: agencyName })}
        confirmLabel={t('coverageSave')}
        cancelLabel={t('cancelAction')}
        onConfirm={() => void save()}
      />
    </section>
  );
}
