import { ThemeProvider } from '@aira/ui/web';
import type { ReactElement, ReactNode } from 'react';

import type { Role } from '../lib/auth/rbac';
import {
  AppShellHeader,
  type AppShellHeaderProps,
  type NavEntry,
  type ShellIdentity,
  type ShellTier,
} from './AppShellHeader';

export type { NavEntry, ShellIdentity, ShellTier };

/**
 * App_Shell — the single chrome definition used by the console, admin, platform,
 * and account/profile/settings surfaces (DESIGN.md §2, R3.1, R3.2). It renders
 * the interactive {@link AppShellHeader} client island above a content frame that
 * hosts the route's children (R3.1).
 *
 * This component intentionally calls no server-only APIs (no `cookies()` etc.) so
 * it remains renderable in jsdom tests and is driven purely by props; the
 * tier-specific layouts (task 12.2) load the real identity/nav data and pass it
 * in. The header is wrapped in a `ThemeProvider` so its `ThemeToggle` works no
 * matter where the shell is mounted.
 */
export interface AppShellProps {
  readonly identity: ShellIdentity;
  /** Raw entry set; the header filters it by tier / `can()` before render. */
  readonly navEntries: readonly NavEntry[];
  /** Viewer role used to gate `permission`-bearing nav entries (R3.7). */
  readonly role?: Role;
  /** Accepted alias for {@link AppShellProps.role}; forwarded to the header. */
  readonly viewerRole?: Role;
  /**
   * Tier-specific sign-out wiring forwarded to the header. Optional: the default
   * (responder/admin/citizen) POSTs `/api/auth/logout`; the platform layout passes
   * its DELETE `/api/platform/session` endpoint so platform logout stays intact.
   */
  readonly signOut?: AppShellHeaderProps['signOut'];
  readonly children: ReactNode;
}

export function AppShell({
  identity,
  navEntries,
  role,
  viewerRole,
  signOut,
  children,
}: AppShellProps): ReactElement {
  return (
    <ThemeProvider>
      <div className="flex min-h-screen flex-col bg-ink text-fg">
        <AppShellHeader
          identity={identity}
          navEntries={navEntries}
          role={role}
          viewerRole={viewerRole}
          signOut={signOut}
        />
        <main className="flex-1">{children}</main>
      </div>
    </ThemeProvider>
  );
}
