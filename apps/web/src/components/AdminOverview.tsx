'use client';

import { t } from '@aira/ui';

import { RESPONDER_ORIGIN, type Incident } from '../lib/incidents';
import { IncidentConsole } from './IncidentConsole';

export interface AdminOverviewProps {
  readonly incidents: readonly Incident[];
}

/**
 * Read-only operations overview for the DRRM officer (DESIGN.md §5a). Same live map +
 * queue the dispatcher sees, but with NO assign/status controls - oversight only. Mounts
 * the shared `IncidentConsole` in read-only mode so there is a single definition of the
 * map+queue surface (R4.4).
 */
export function AdminOverview({ incidents }: AdminOverviewProps) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-bold text-fg">{t('overviewTitle')}</h2>
        <p className="mt-1 text-xs text-muted">{t('overviewReadOnly')}</p>
      </div>

      <IncidentConsole incidents={incidents} origin={RESPONDER_ORIGIN} readOnly />
    </section>
  );
}
