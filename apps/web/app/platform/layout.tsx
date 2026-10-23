import { t } from '@aira/ui';
import type { ReactNode } from 'react';

import { AppShell, type NavEntry } from '../../src/components/AppShell';
import { requirePlatformPrincipal } from '../../src/lib/platform/guard';

export const dynamic = 'force-dynamic';

/**
 * Platform-operator nav: tenants and the nationwide map. Operators carry no
 * responder `Role`, so these entries are tier-gated with `platformOnly` rather
 * than a `permission` (R3.8). Profile/Settings and sign-out live in the shared
 * shell header (R3.9).
 */
const PLATFORM_NAV: readonly NavEntry[] = [
  { href: '/platform', label: t('platformTenants'), match: 'nested', platformOnly: true },
  { href: '/platform/map', label: t('platformMap'), match: 'nested', platformOnly: true },
];

/**
 * Platform-operator console guard. A separate superadmin tier: it manages tenants and
 * the nationwide map, and holds no incident/citizen access (SECURITY.md). Non-operators
 * are redirected to the platform login by `requirePlatformPrincipal`.
 */
export default async function PlatformLayout({ children }: { readonly children: ReactNode }) {
  const principal = await requirePlatformPrincipal();

  return (
    <AppShell
      identity={{ tier: 'platform_admins', displayName: principal.email }}
      navEntries={PLATFORM_NAV}
      signOut={{
        endpoint: '/api/platform/session',
        method: 'DELETE',
        redirectTo: '/platform/login',
      }}
    >
      <div className="mx-auto w-full max-w-6xl p-4">{children}</div>
    </AppShell>
  );
}
