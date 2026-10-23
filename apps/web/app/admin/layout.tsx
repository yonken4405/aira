import { t } from '@aira/ui';
import type { ReactNode } from 'react';

import { AppShell, type NavEntry } from '../../src/components/AppShell';
import { Forbidden } from '../../src/components/Forbidden';
import { SessionProvider } from '../../src/components/SessionProvider';
import { holdsAny, requirePagePrincipal, viewerOf } from '../../src/lib/auth/guard';
import { roleLabel } from '../../src/lib/labels';

export const dynamic = 'force-dynamic';

/**
 * Admin console nav: accounts, oversight metrics, and the audit trail. The shell
 * gates each entry via `can()` against the principal's role (R3.7), so an ADMIN
 * sees all three while a lesser role sees only what it holds. Profile/Settings and
 * sign-out live in the shared shell header (R3.9), not here.
 */
const ADMIN_NAV: readonly NavEntry[] = [
  { href: '/admin', label: t('adminAccounts'), match: 'nested', permission: 'responder:manage' },
  {
    href: '/admin/dashboards',
    label: t('adminDashboards'),
    match: 'nested',
    permission: 'metrics:read',
  },
  { href: '/admin/audit', label: t('adminAudit'), match: 'nested', permission: 'audit:read' },
];

/**
 * Admin console guard: account + audit only. ADMIN holds no incident permission, so
 * this surface can never render citizen data (SECURITY.md §4).
 */
export default async function AdminLayout({ children }: { readonly children: ReactNode }) {
  const principal = await requirePagePrincipal();

  if (!holdsAny(principal, ['responder:manage', 'audit:read'])) {
    return <Forbidden />;
  }

  const viewer = viewerOf(principal);

  return (
    <SessionProvider viewer={viewer}>
      <AppShell
        identity={{
          tier: 'responders',
          displayName: viewer.displayName,
          roleLabel: roleLabel(principal.role),
        }}
        navEntries={ADMIN_NAV}
        role={principal.role}
      >
        <div className="mx-auto w-full max-w-6xl p-4">{children}</div>
      </AppShell>
    </SessionProvider>
  );
}
