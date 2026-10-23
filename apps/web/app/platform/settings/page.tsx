import { SettingsView } from '../../../src/components/SettingsView';
import { loadSettingsPageData } from '../../../src/components/settings-page-data';
import { requirePlatformPrincipal } from '../../../src/lib/platform/guard';

export const dynamic = 'force-dynamic';

/**
 * Platform-operator Settings surface (R7.1). Rendered inside the platform layout's
 * App_Shell with the platform nav; the single app-wide `ToastProvider` lives in the
 * root layout. The operator is a platform_admins-tier principal, so its preference
 * is scoped to that tier; the client refines the Web_Push permission state on mount.
 */
export default async function PlatformSettingsPage() {
  const principal = await requirePlatformPrincipal();
  const { preferences, pushState } = await loadSettingsPageData({
    tier: 'platform_admins',
    principalId: principal.adminId,
  });

  return <SettingsView preferences={preferences} pushState={pushState} />;
}
