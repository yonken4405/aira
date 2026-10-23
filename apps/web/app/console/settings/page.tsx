import { SettingsView } from '../../../src/components/SettingsView';
import { loadSettingsPageData } from '../../../src/components/settings-page-data';
import { requirePagePrincipal } from '../../../src/lib/auth/guard';

export const dynamic = 'force-dynamic';

/**
 * Responder/dispatcher Settings surface (R7.1). Rendered inside the console
 * layout's App_Shell with the tier nav; the single app-wide `ToastProvider` lives
 * in the root layout. Loads the caller's per-channel preference scoped to the
 * responders tier; the client refines the Web_Push permission state on mount.
 */
export default async function ConsoleSettingsPage() {
  const principal = await requirePagePrincipal();
  const { preferences, pushState } = await loadSettingsPageData({
    tier: 'responders',
    principalId: principal.responderId,
  });

  return <SettingsView preferences={preferences} pushState={pushState} />;
}
