'use client';

import { EMERGENCY_CATEGORIES, categoryLabel, t } from '@aira/ui';
import { CategoryBadge, cn } from '@aira/ui/web';
import { Clock, Navigation } from 'lucide-react';

import { formatDistance, haversineKm, type GeoPoint } from '../lib/geo';
import type { Incident, IncidentStatus } from '../lib/incidents';
import { statusLabel } from '../lib/labels';
import type { CategoryFilter } from './Dashboard';

export interface QueueSidebarProps {
  readonly incidents: readonly Incident[];
  readonly filter: CategoryFilter;
  readonly onFilterChange: (filter: CategoryFilter) => void;
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  readonly origin: GeoPoint;
  readonly emptyLabel?: string;
  readonly className?: string;
}

const FILTER_CHIPS: readonly { readonly id: CategoryFilter; readonly label: string }[] = [
  { id: 'ALL', label: t('filterAll') },
  ...EMERGENCY_CATEGORIES.map((category) => ({
    id: category.id,
    label: categoryLabel(category.id),
  })),
];

const STATUS_TEXT: Record<IncidentStatus, string> = {
  QUEUED: 'text-status-queued',
  DISPATCHED: 'text-status-dispatched',
  EN_ROUTE: 'text-status-enroute',
  ON_SCENE: 'text-status-onscene',
  RESOLVED: 'text-status-resolved',
};

const timeLabel = (iso: string): string => iso.slice(11, 16);

/**
 * Incoming request queue. Structured rows only - category/time/distance/status.
 * Conversational content does not exist in AIRA (PRODUCT.md §2).
 */
export function QueueSidebar({
  incidents,
  filter,
  onFilterChange,
  selectedId,
  onSelect,
  origin,
  emptyLabel,
  className,
}: QueueSidebarProps) {
  return (
    <aside className={cn('flex min-h-0 flex-col bg-surface', className)}>
      <div className="shrink-0 border-b border-line px-3 pb-2 pt-2.5">
        <h2 className="text-[11px] font-bold uppercase tracking-label text-muted">
          {t('incomingQueue')}
        </h2>

        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={t('incomingQueue')}>
          {FILTER_CHIPS.map((chip) => {
            const active = chip.id === filter;
            return (
              <button
                key={chip.id}
                type="button"
                aria-pressed={active}
                onClick={() => onFilterChange(chip.id)}
                className={cn(
                  'border px-2 py-1 text-[10px] font-bold uppercase tracking-label transition-colors duration-fast',
                  active
                    ? 'border-fg bg-fg text-ink'
                    : 'border-line bg-raised text-muted hover:border-muted hover:text-fg',
                )}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {incidents.length === 0 ? (
          <p className="p-3 text-xs text-muted">{emptyLabel ?? t('noQueued')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {incidents.map((incident) => {
              const active = incident.id === selectedId;
              const distance = haversineKm(origin, { lat: incident.lat, lon: incident.lon });

              return (
                <li key={incident.id}>
                  <button
                    type="button"
                    data-testid={`queue-row-${incident.id}`}
                    aria-current={active ? 'true' : undefined}
                    onClick={() => onSelect(incident.id)}
                    className={cn(
                      'w-full border-l-2 px-3 py-2.5 text-left transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-fg',
                      active ? 'border-l-fg bg-raised' : 'border-l-transparent hover:bg-raised/60',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <CategoryBadge category={incident.category} />
                      <span className="flex items-center gap-1 font-mono text-[11px] tabular-nums text-muted">
                        <Clock aria-hidden="true" size={11} />
                        {timeLabel(incident.reportedAt)}
                      </span>
                    </div>

                    <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px]">
                      <span className="flex items-center gap-1.5 text-muted">
                        <span className="font-mono tabular-nums">{incident.id}</span>
                        <span aria-hidden="true" className="h-3 w-px bg-line" />
                        <span
                          className={cn(
                            'font-bold uppercase tracking-label',
                            STATUS_TEXT[incident.status],
                          )}
                        >
                          {statusLabel(incident.status)}
                        </span>
                      </span>

                      <span className="flex items-center gap-1 font-mono tabular-nums text-muted">
                        <Navigation aria-hidden="true" size={11} />
                        {formatDistance(distance)}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
