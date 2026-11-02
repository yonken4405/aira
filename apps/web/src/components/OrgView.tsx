'use client';

import { t } from '@aira/ui';
import { Skeleton, useToast } from '@aira/ui/web';
import { Building2, Users } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { AgencySummary, OfficeSummary, ResponderView } from '../lib/auth/types';
import { roleLabel } from '../lib/labels';

interface OrgData {
  readonly members: readonly ResponderView[];
  readonly offices: readonly OfficeSummary[];
  readonly agencies: readonly AgencySummary[];
}

type Phase =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly data: OrgData }
  | { readonly kind: 'unavailable' };

/**
 * Users / organization view (single-lgu-agency-network R8). Lists accounts with their
 * role, agency and office, and presents the hierarchy (office tree + each agency's
 * members). Scoped server-side to the viewer's authority (an AGENCY_ADMIN sees only its
 * own agency). Operate Mode: a layout-shaped Skeleton on first load, an honest
 * "unavailable" state on failure (never blocks a Tier-0 action), copy via t(), Lucide
 * icons. Coordinate-free: offices carry name + kind only.
 */
export function OrgView() {
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await fetch('/api/admin/org', {
          headers: { accept: 'application/json' },
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (!response.ok) {
          throw new Error(`org_request_failed_${response.status}`);
        }
        const body = (await response.json()) as OrgData;
        if (active) {
          setPhase({ kind: 'ready', data: body });
        }
      } catch {
        if (active) {
          setPhase({ kind: 'unavailable' });
          toast({ tone: 'error', title: t('orgTitle'), description: t('orgUnavailable') });
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [toast]);

  if (phase.kind === 'loading') {
    return (
      <div aria-busy="true" data-testid="org-skeleton" className="flex flex-col gap-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (phase.kind === 'unavailable') {
    return (
      <section className="border border-line bg-surface p-4">
        <p className="text-[11px] font-bold uppercase tracking-label text-muted">
          {t('orgUnavailable')}
        </p>
      </section>
    );
  }

  const { members, offices, agencies } = phase.data;
  const membersByAgency = new Map<string | null, ResponderView[]>();
  for (const member of members) {
    const key = member.agencyId;
    const list = membersByAgency.get(key) ?? [];
    list.push(member);
    membersByAgency.set(key, list);
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="border border-line bg-surface">
        <header className="border-b border-line px-3 py-2">
          <h2 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-label text-muted">
            <Building2 aria-hidden="true" size={12} />
            {t('orgOfficesTitle')}
          </h2>
        </header>
        <ul className="divide-y divide-line">
          {offices.map((office) => (
            <li
              key={office.id}
              className="flex items-center justify-between px-3 py-2 text-xs text-fg"
            >
              <span>{office.name}</span>
              <span className="text-[10px] uppercase tracking-label text-muted">{office.kind}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="border border-line bg-surface">
        <header className="border-b border-line px-3 py-2">
          <h2 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-label text-muted">
            <Users aria-hidden="true" size={12} />
            {t('orgAgenciesTitle')}
          </h2>
        </header>
        <div className="flex flex-col divide-y divide-line">
          {agencies.map((agency) => {
            const agencyMembers = membersByAgency.get(agency.id) ?? [];
            return (
              <div key={agency.id} className="px-3 py-2">
                <p className="text-[11px] font-bold uppercase tracking-label text-fg">
                  {agency.name} <span className="text-muted">({agency.code})</span>
                </p>
                {agencyMembers.length === 0 ? (
                  <p className="mt-1 text-[10px] text-muted">{t('orgNoMembers')}</p>
                ) : (
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {agencyMembers.map((member) => (
                      <li
                        key={member.id}
                        className="flex items-center justify-between text-[11px] text-muted"
                      >
                        <span className="font-mono tabular-nums text-fg">{member.displayName}</span>
                        <span className="text-[10px] uppercase tracking-label">
                          {roleLabel(member.role)} · {member.officeName}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
