import { categoryLabel, t } from '@aira/ui';
import { MetricRow, Panel } from '@aira/ui/web';

import { statusLabel } from '../lib/labels';
import type { OfficeMetrics } from '../lib/metrics';
import type { IncidentStatus } from '../lib/incidents';
import type { EmergencyCategoryId } from '@aira/ui';

export interface AdminDashboardsProps {
  readonly metrics: OfficeMetrics;
  /** officeId -> display name for the barangay heatmap. */
  readonly officeNames: Readonly<Record<string, string>>;
}

const STATUS_ORDER: readonly IncidentStatus[] = [
  'QUEUED',
  'DISPATCHED',
  'EN_ROUTE',
  'ON_SCENE',
  'RESOLVED',
];
const CATEGORY_ORDER: readonly EmergencyCategoryId[] = ['SUNOG', 'MEDIKAL', 'KRIMEN', 'BAHA'];

/**
 * Read-only DRRM oversight dashboards (DESIGN.md §5a): dense metric tables, tabular
 * numerals, no decorative charts. No coordinates or citizen data - counts only.
 */
export function AdminDashboards({ metrics, officeNames }: AdminDashboardsProps) {
  const offices = Object.entries(metrics.byOffice).sort((a, b) => b[1] - a[1]);

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-sm font-bold text-fg">{t('metricsTitle')}</h2>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t('metricTotal')} value={String(metrics.total)} />
        <Stat label={t('metricActive')} value={String(metrics.active)} />
        <Stat label={t('metricActiveUnits')} value={String(metrics.activeUnits)} />
        <Stat
          label={t('metricAvgResolve')}
          value={
            metrics.avgResolveMinutes === null
              ? t('metricNone')
              : t('metricMinutes', { value: metrics.avgResolveMinutes })
          }
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title={t('metricsByStatus')} bodyClassName="p-3">
          {STATUS_ORDER.map((status) => (
            <MetricRow
              key={status}
              label={statusLabel(status)}
              value={String(metrics.byStatus[status])}
            />
          ))}
        </Panel>

        <Panel title={t('metricsByCategory')} bodyClassName="p-3">
          {CATEGORY_ORDER.map((category) => (
            <MetricRow
              key={category}
              label={categoryLabel(category)}
              value={String(metrics.byCategory[category])}
            />
          ))}
        </Panel>
      </div>

      <Panel title={t('metricsByOffice')} bodyClassName="p-3">
        {offices.length === 0 ? (
          <p className="text-xs text-muted">{t('metricNone')}</p>
        ) : (
          offices.map(([officeId, count]) => (
            <MetricRow
              key={officeId}
              label={officeNames[officeId] ?? officeId}
              value={String(count)}
            />
          ))
        )}
      </Panel>
    </section>
  );
}

function Stat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="border border-line bg-surface p-3">
      <p className="text-[10px] font-bold uppercase tracking-label text-muted">{label}</p>
      <p className="mt-1 font-mono text-2xl tabular-nums text-fg">{value}</p>
    </div>
  );
}
