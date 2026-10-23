import { t } from '@aira/ui';
import type { ReactNode } from 'react';

import { AppShell, type NavEntry } from '../../src/components/AppShell';
import { Forbidden } from '../../src/components/Forbidden';
import { SessionProvider } from '../../src/components/SessionProvider';
import { holdsAny, requirePagePrincipal, viewerOf } from '../../src/lib/auth/guard';
import { roleLabel } from '../../src/lib/labels';

export const dynamic = 'force-dynamic';

/**
 * Incident console nav. The dispatch surface itself is always available to anyone
 * who clears the guard; the account/audit entries are `can()`-gated so a DISPATCHER
 * only sees what its role holds (R3.7). Profile/Settings and sign-out live in the
 * shared shell header (R3.9).
 */
const CONSOLE_NAV: readonly NavEntry[] = [
  { href: '/console', label: t('consoleTitle'), match: 'nested' },
  { href: '/admin', label: t('adminAccounts'), match: 'nested', permission: 'responder:manage' },
  { href: '/admin/audit', label: t('adminAudit'), match: 'nested', permission: 'audit:read' },
];

/**
 * Incident console guard: RESPONDER and DISPATCHER only - the surfaces that ACT on
 * incidents (assign / status). ADMIN is intentionally excluded here: the DRRM officer
 * now has read-only oversight (`incident:read:office` + `metrics:read`) on the /admin
 * surface, but must never reach the dispatch console (separation of duties,
 * SECURITY.md §4). So this guard checks an ACTION permission, not a read permission.
 */
export default async function ConsoleLayout({ children }: { readonly children: ReactNode }) {
  const principal = await requirePagePrincipal();

  if (!holdsAny(principal, ['incident:assign', 'incident:status:any', 'incident:status:own'])) {
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
        navEntries={CONSOLE_NAV}
        role={principal.role}
      >
        {children}
      </AppShell>
    </SessionProvider>
  );
}
