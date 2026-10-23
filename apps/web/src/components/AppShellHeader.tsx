'use client';

import { t } from '@aira/ui';
import {
  Button,
  ConfirmDialog,
  NavLink,
  ThemeToggle,
  cn,
  useOptionalToast,
  type NavMatch,
} from '@aira/ui/web';
import { LogOut } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactElement } from 'react';

import { can, type Permission, type Role } from '../lib/auth/rbac';
import { NotificationCenter } from './NotificationCenter';

/**
 * The three principal families the App_Shell serves. Mirrors the notification
 * tier union defined later in Phase 5 (`notifications/types.ts`); declared here
 * so the shell does not depend on code that does not exist yet.
 */
export type ShellTier = 'responders' | 'platform_admins' | 'citizens';

/**
 * A single navigation entry handed to the shell. The caller (a tier-specific
 * layout, task 12.2) supplies the raw set; the header filters it before render:
 *  - `permission` → shown only when a viewer `Role` is present and `can()` it (R3.7)
 *  - `platformOnly` → shown only for the platform tier (operators carry no Role) (R3.8)
 *  - neither → always shown.
 */
export interface NavEntry {
  readonly href: string;
  readonly label: string;
  readonly match?: NavMatch;
  readonly permission?: Permission;
  readonly platformOnly?: boolean;
}

/** Who the shell is rendering for; drives the display block and tier gating. */
export interface ShellIdentity {
  readonly tier: ShellTier;
  readonly displayName: string;
  /** Responder role label; omitted for platform/citizen tiers. */
  readonly roleLabel?: string;
}

export interface AppShellHeaderProps {
  readonly identity: ShellIdentity;
  readonly navEntries: readonly NavEntry[];
  /**
   * Viewer role used to gate `permission`-bearing entries via `can()`. Platform
   * operators and citizens carry no `Role`, so this is optional.
   */
  readonly role?: Role;
  /**
   * Accepted alias for {@link AppShellHeaderProps.role} (the server layouts pass
   * both for now). When present it falls back for gating if `role` is unset.
   */
  readonly viewerRole?: Role;
  /**
   * Tier-specific sign-out wiring. The default (responder/admin/citizen) POSTs
   * `/api/auth/logout` then returns to `/login`. The platform tier runs a
   * different endpoint/method and lands on a different page (DELETE
   * `/api/platform/session` -> `/platform/login`), so its layout overrides this.
   * Kept optional so the generic contract in app-shell.test.tsx is unaffected.
   * Per-tier logout toasts are refined later in task 30.
   */
  readonly signOut?: {
    readonly endpoint: string;
    readonly method?: 'POST' | 'DELETE';
    readonly redirectTo?: string;
  };
}

/**
 * Decides whether a nav entry survives filtering for this identity.
 *
 * `platformOnly` entries belong exclusively to the platform tier; a responder or
 * citizen never sees them even if handed one (R3.8). `permission` entries require
 * a viewer role that `can()` the permission (R3.7). Everything else always shows.
 */
function isEntryVisible(entry: NavEntry, tier: ShellTier, role: Role | undefined): boolean {
  if (entry.platformOnly) {
    return tier === 'platform_admins';
  }
  if (entry.permission) {
    return role !== undefined && can(role, entry.permission);
  }
  return true;
}

/**
 * The interactive App_Shell header island (R3, DESIGN.md §2). Renders the
 * tier-filtered primary navigation plus the fixed entry points that live in the
 * same place for every tier: the Notification bell, Profile, Settings, and the
 * ThemeToggle (R3.9).
 */
export function AppShellHeader({
  identity,
  navEntries,
  role,
  viewerRole,
  signOut: signOutConfig,
}: AppShellHeaderProps): ReactElement {
  const router = useRouter();
  const { toast } = useOptionalToast();
  const [signingOut, setSigningOut] = useState(false);
  // Logout is confirmation-gated (R18): the POST only fires once the user
  // confirms; Cancel aborts with no request. The existing success/error logout
  // toasts stay intact inside signOut().
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const gateRole = role ?? viewerRole;

  const visible = navEntries.filter((entry) => isEntryVisible(entry, identity.tier, gateRole));

  const signOutEndpoint = signOutConfig?.endpoint ?? '/api/auth/logout';
  const signOutMethod = signOutConfig?.method ?? 'POST';
  const signOutRedirect = signOutConfig?.redirectTo ?? '/login';

  async function signOut(): Promise<void> {
    setSigningOut(true);
    // Default responder/admin/citizen sign-out POSTs /api/auth/logout; the platform
    // tier overrides with its DELETE /api/platform/session wiring via `signOut` prop.
    // Every logout outcome surfaces through the unified Toast system (R17.2-R17.6):
    // a success Toast on a clean sign-out, an error Toast when the request rejects
    // or returns a non-ok response. The browser still returns to a login page in all
    // cases so a failed logout never strands the user on an authenticated surface.
    let ok = false;
    try {
      const response = await fetch(signOutEndpoint, {
        method: signOutMethod,
        credentials: 'same-origin',
      });
      ok = response.ok;
    } catch {
      ok = false;
    }

    if (ok) {
      toast({ title: t('signedOut'), tone: 'success' });
    } else {
      toast({ title: t('signOutFailed'), tone: 'error' });
    }

    router.replace(signOutRedirect);
    router.refresh();
  }

  return (
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-4 py-2.5">
      <div className="flex items-center gap-3">
        <span className="text-sm font-extrabold tracking-label text-fg">{t('appName')}</span>
      </div>

      <nav className="flex flex-wrap items-center gap-1" aria-label={t('shellPrimaryNav')}>
        {visible.map((entry) => (
          <NavLink key={entry.href} href={entry.href} label={entry.label} match={entry.match} />
        ))}
      </nav>

      <div className="flex items-center gap-2 border-l border-line pl-3">
        {/*
          Notification bell. The NotificationCenter island owns the bell button,
          unread badge, dropdown and polling (task 16.2). The header has no
          server-fetched seed data, so it mounts empty and the mount GET
          populates the count/list (fail-soft if fetch is unavailable).
        */}
        <NotificationCenter initialUnread={0} initialItems={[]} />

        <Link
          href="/profile"
          className={cn(
            'inline-flex items-center border border-line bg-raised px-2 py-1',
            'text-[10px] font-bold uppercase tracking-label text-muted',
            'transition-colors duration-fast hover:border-muted hover:text-fg',
          )}
        >
          {t('shellProfile')}
        </Link>

        <Link
          href="/settings"
          className={cn(
            'inline-flex items-center border border-line bg-raised px-2 py-1',
            'text-[10px] font-bold uppercase tracking-label text-muted',
            'transition-colors duration-fast hover:border-muted hover:text-fg',
          )}
        >
          {t('shellSettings')}
        </Link>

        <ThemeToggle />

        <div className="flex flex-col items-end leading-tight">
          <span className="font-mono text-[11px] tabular-nums text-fg">{identity.displayName}</span>
          {identity.roleLabel ? (
            <span className="text-[10px] uppercase tracking-label text-muted">
              {identity.roleLabel}
            </span>
          ) : null}
        </div>

        <Button
          variant="ghost"
          size="sm"
          aria-label="Sign out"
          onClick={() => setConfirmSignOut(true)}
          disabled={signingOut}
        >
          <LogOut aria-hidden="true" size={12} />
          {t('signOut')}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmSignOut}
        onOpenChange={setConfirmSignOut}
        title={t('signOutTitle')}
        description={t('signOutBody')}
        confirmLabel={t('signOut')}
        cancelLabel={t('cancelAction')}
        onConfirm={() => {
          setConfirmSignOut(false);
          void signOut();
        }}
      />
    </header>
  );
}
