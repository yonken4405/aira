import { AdminSurface } from '../../../src/components/AdminSurface';
import { Forbidden } from '../../../src/components/Forbidden';
import { holdsAny, requirePagePrincipal } from '../../../src/lib/auth/guard';
import { getAuthStore } from '../../../src/lib/auth/runtime';
import { toResponderView } from '../../../src/lib/auth/view';
import { createPostgresIncidentsStore } from '../../../src/lib/incidents-store';
import { computeMetrics } from '../../../src/lib/metrics';

export const dynamic = 'force-dynamic';

/**
 * Consolidated admin surface, metrics tab (R4.1, R4.2). `/admin/dashboards` deep-links
 * to the oversight-metrics tab; this server page loads all three tab datasets so any
 * deep-linked tab shows real data, and hands them to the single `AdminSurface`.
 */
export default async function AdminDashboardsPage() {
  const principal = await requirePagePrincipal();

  if (!holdsAny(principal, ['responder:manage', 'metrics:read', 'audit:read'])) {
    return <Forbidden />;
  }

  const store = getAuthStore();

  const [responders, offices, agencies, incidents, events] = await Promise.all([
    store.listResponders(principal.tenantId),
    store.listOffices(principal.tenantId),
    store.listAgencies(),
    createPostgresIncidentsStore().listForOffice(principal.officeId),
    store.listAuthEvents({ limit: 100 }),
  ]);

  const metrics = computeMetrics(incidents);
  const officeNames = Object.fromEntries(offices.map((office) => [office.id, office.name]));

  return (
    <AdminSurface
      viewerRole={principal.role}
      initialTab="metrics"
      accounts={{
        responders: responders.map((row) => toResponderView(row, row.sessionCount)),
        offices,
        agencies,
        viewerId: principal.responderId,
      }}
      metrics={{ metrics, officeNames }}
      audit={{ events }}
    />
  );
}
