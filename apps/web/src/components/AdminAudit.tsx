import { t } from '@aira/ui';

import type { AuthEventRecord } from '../lib/auth/types';

export interface AdminAuditProps {
  readonly events: readonly AuthEventRecord[];
}

/**
 * Append-only authentication audit table (SECURITY.md §4.6), extracted from the
 * former `app/admin/audit/page.tsx` body so it can be mounted as the audit tab of
 * the consolidated `AdminSurface` (R4.1). The server page loads the events and
 * hands them in; the markup and i18n copy are preserved verbatim.
 */
export function AdminAudit({ events }: AdminAuditProps) {
  return (
    <section className="border border-line bg-surface">
      <header className="border-b border-line px-3 py-2">
        <h2 className="text-[11px] font-bold uppercase tracking-label text-muted">
          {t('adminAudit')}
        </h2>
      </header>

      {events.length === 0 ? (
        <p className="p-3 text-xs text-muted">{t('auditEmpty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-line text-[10px] uppercase tracking-label text-muted">
                <th className="px-3 py-2 font-bold">{t('timeLabel')}</th>
                <th className="px-3 py-2 font-bold">{t('eventLabel')}</th>
                <th className="px-3 py-2 font-bold">{t('actorLabel')}</th>
                <th className="px-3 py-2 font-bold">{t('detailLabel')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {events.map((event) => (
                <tr key={event.id}>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] tabular-nums text-muted">
                    {new Date(event.createdAt).toISOString().slice(0, 19).replace('T', ' ')}
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-[10px] font-bold uppercase tracking-label text-fg">
                      {event.event}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-fg">
                    {event.callsign ?? t('never')}
                  </td>
                  <td className="px-3 py-2 text-muted">{event.detail ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
