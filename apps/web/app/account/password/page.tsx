import { redirect } from 'next/navigation';

import { t } from '@aira/ui';

import { AccountPasswordView } from '../../../src/components/AccountPasswordView';
import type { NavEntry } from '../../../src/components/AppShell';
import { SessionProvider } from '../../../src/components/SessionProvider';
import { getPrincipal, viewerOf } from '../../../src/lib/auth/guard';
import { landingFor } from '../../../src/lib/auth/rbac';
import { roleLabel } from '../../../src/lib/labels';

export const dynamic = 'force-dynamic';

/**
 * Responder nav entries handed to the shell on the account/password surface. The
 * header filters these by tier / `can(role, permission)` before render, so this
 * is the same authorized set a responder sees on other Authenticated_Surfaces
 * (R5.4). The console/queue entry is always shown; the admin/accounts and audit
 * entries are gated by the permissions only ADMIN/DISPATCHER hold.
 */
const RESPONDER_NAV_ENTRIES: readonly NavEntry[] = [
  { href: '/console', label: t('consoleTitle'), match: 'nested' },
  {
    href: '/admin',
    label: t('adminAccounts'),
    match: 'nested',
    permission: 'responder:manage',
  },
  { href: '/admin/audit', label: t('adminAudit'), match: 'nested', permission: 'audit:read' },
];

/**
 * Reached either voluntarily or because the account still holds a provisioned
 * password. Deliberately does not use `requirePagePrincipal` - that would redirect
 * here again and loop.
 */
export default async function AccountPasswordPage() {
  const principal = await getPrincipal();

  if (!principal) {
    redirect('/login');
  }

  const viewer = viewerOf(principal);

  return (
    <SessionProvider viewer={viewer}>
      <AccountPasswordView
        identity={{
          tier: 'responders',
          displayName: viewer.displayName,
          roleLabel: roleLabel(principal.role),
        }}
        navEntries={RESPONDER_NAV_ENTRIES}
        role={principal.role}
        mustChange={principal.mustChangePassword}
        next={landingFor(principal.role)}
      />
    </SessionProvider>
  );
}
