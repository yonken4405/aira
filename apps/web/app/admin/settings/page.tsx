import { SettingsView } from '../../../src/components/SettingsView';
import { loadSettingsPageData } from '../../../src/components/settings-page-data';
import { requirePagePrincipal } from '../../../src/lib/auth/guard';

export const dynamic = 'force-dynamic';

/**
 * Admin Settings surface (R7.1). Rendered inside the admin layout's App_Shell with
 * the admin nav; the single app-wide `ToastProvider` lives in the root layout. The
 * DRRM admin is a responder-tier principal, so its preference is scoped to the
 * responders tier; the client refines the Web_Push permission state on mount.
 */
export default async function AdminSettingsPage() {
  const principal = await requirePagePrincipal();
  const { preferences, pushState } = await loadSettingsPageData({
    tier: 'responders',
    principalId: principal.responderId,
  });

  return <SettingsView preferences={preferences} pushState={pushState} />;
}
