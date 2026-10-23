import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * `/admin/overview` is removed as a distinct map-plus-queue page (R4.3). The live
 * map + queue is now defined once in `IncidentConsole` (R4.4) and consumed by
 * `/console`; it is NOT a tab of the consolidated admin surface (whose tabs are
 * accounts/metrics/audit), and `/console` itself is denied to ADMIN (no
 * `incident:*` permission). The surviving map-plus-queue view an admin can reach
 * is therefore the consolidated admin surface at `/admin`, so we redirect there
 * to keep existing `/admin/overview` bookmarks resolving without a not-found
 * result (R4.3). The redirect runs before any body renders, so the old overview
 * page body is fully removed.
 */
export default function AdminOverviewPage(): never {
  redirect('/admin');
}
