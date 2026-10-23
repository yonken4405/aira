import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@aira/ui/web';

// This import intentionally points at a module that does not exist yet
// (task 13.2 creates `AccountPasswordView.tsx`). The failing import is the red
// state for task 13.1 — the tests below pin the contract 13.2 must satisfy:
// the account password-change page renders *inside* the shared App_Shell with
// the standard header and the principal's authorized NavLinks, rather than as a
// chrome-less screen (R5.1, R5.2, R5.4).
import { AccountPasswordView } from '../src/components/AccountPasswordView';

import type { Role } from '../src/lib/auth/rbac';

/**
 * Prop contract chosen for `AccountPasswordView` (task 13.2 must match this).
 *
 *   interface AccountPasswordViewProps {
 *     // Who the shell renders for — same shape AppShell/AppShellHeader consume
 *     // ({ tier, displayName, roleLabel? }).
 *     identity: { tier: 'responders' | 'platform_admins' | 'citizens';
 *                 displayName: string; roleLabel?: string };
 *     // Raw nav entry set handed to the shell; the header filters it by
 *     // tier / can(role, permission) before render (R5.4 → R3.7/R3.8).
 *     navEntries: readonly { href: string; label: string;
 *                            permission?: Permission; platformOnly?: boolean }[];
 *     // Viewer role used to gate permission-bearing nav entries.
 *     role?: Role;
 *     // Forwarded to ChangePasswordForm: provisioned accounts must replace
 *     // their one-time password; `next` is where to land afterwards.
 *     mustChange: boolean;
 *     next: string;
 *   }
 *
 * `AccountPasswordView` wraps `ChangePasswordForm` inside `AppShell`, so the
 * rendered output must contain BOTH the shell header hallmarks (Profile link,
 * Settings link, the ThemeToggle "Appearance" group) AND the password form (the
 * "Change password" heading + the current-password field). That combination is
 * exactly what proves the page is no longer chrome-less.
 */

// `AppShellHeader` is a client island whose `NavLink` reads `usePathname`;
// `ChangePasswordForm` uses `useRouter`. Drive the pathname through a hoisted
// mutable closure and mock `next/link` down to a plain anchor so the DOM can be
// read without the real Next.js runtime (mirrors apps/web/tests/app-shell.test.tsx).
const navState = vi.hoisted(() => ({ pathname: '/profile/password' }));

vi.mock('next/navigation', () => ({
  usePathname: () => navState.pathname,
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// NavEntry.label strings. A permission-free entry must always survive filtering;
// a gated entry exercises can(role, permission) so we prove the authorized
// NavLinks render in the shell (R5.4).
const LABEL = {
  queue: 'Nav Queue Entry',
  accounts: 'Nav Accounts Entry',
} as const;

const openEntry = { href: '/console', label: LABEL.queue };
const accountsEntry = {
  href: '/admin',
  label: LABEL.accounts,
  permission: 'responder:manage' as const,
};

type TestIdentity = {
  readonly tier: 'responders' | 'platform_admins' | 'citizens';
  readonly displayName: string;
  readonly roleLabel?: string;
};

function renderView(args: {
  identity: TestIdentity;
  role?: Role;
  navEntries: ReadonlyArray<Record<string, unknown>>;
  mustChange?: boolean;
  next?: string;
}) {
  // ChangePasswordForm's useToast requires a ToastProvider ancestor.
  return render(
    <ToastProvider>
      <AccountPasswordView
        identity={args.identity as never}
        role={args.role}
        navEntries={args.navEntries as never}
        mustChange={args.mustChange ?? false}
        next={args.next ?? '/console'}
      />
    </ToastProvider>,
  );
}

beforeEach(() => {
  navState.pathname = '/profile/password';
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('account password page under App_Shell (R5.1, R5.2, R5.4)', () => {
  it('renders the password form wrapped by the App_Shell header, not chrome-less (R5.1)', () => {
    renderView({
      identity: { tier: 'responders', displayName: 'k9-01', roleLabel: 'Responder' },
      role: 'RESPONDER',
      navEntries: [openEntry],
      mustChange: false,
      next: '/console',
    });

    // Shell header hallmarks — these only exist when the page is inside AppShell.
    expect(screen.getByRole('link', { name: /profile/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /settings/i })).toBeTruthy();
    expect(screen.getByRole('group', { name: /appearance/i })).toBeTruthy();

    // The password form itself still renders inside the shell content frame.
    expect(screen.getByRole('heading', { name: /change password/i })).toBeTruthy();
    expect(screen.getByLabelText(/current password/i)).toBeTruthy();
  });

  it("shows the principal's authorized NavLinks in the shell header (R5.4)", () => {
    // An ADMIN holds responder:manage, so the gated accounts entry renders
    // alongside the always-present queue entry — identical to what the shell
    // shows on other authenticated surfaces for that principal.
    renderView({
      identity: { tier: 'responders', displayName: 'admin-1', roleLabel: 'Admin' },
      role: 'ADMIN',
      navEntries: [openEntry, accountsEntry],
    });

    expect(screen.getByText(LABEL.queue)).toBeTruthy();
    expect(screen.getByText(LABEL.accounts)).toBeTruthy();
  });

  it('omits a NavLink whose mapped permission the principal lacks (R5.4)', () => {
    // A RESPONDER lacks responder:manage, so the gated entry is filtered out
    // while the shell chrome + password form are still present.
    renderView({
      identity: { tier: 'responders', displayName: 'k9-01', roleLabel: 'Responder' },
      role: 'RESPONDER',
      navEntries: [openEntry, accountsEntry],
    });

    expect(screen.getByText(LABEL.queue)).toBeTruthy();
    expect(screen.queryByText(LABEL.accounts)).toBeNull();
    expect(screen.getByRole('heading', { name: /change password/i })).toBeTruthy();
  });

  it('renders the full shell chrome regardless of entry path / deep link (R5.2)', () => {
    // A direct deep-link entry still gets the full header + nav, not a
    // chrome-less screen.
    navState.pathname = '/account/password';
    renderView({
      identity: { tier: 'responders', displayName: 'k9-01', roleLabel: 'Responder' },
      role: 'RESPONDER',
      navEntries: [openEntry],
      mustChange: true,
      next: '/console',
    });

    expect(screen.getByRole('link', { name: /profile/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /settings/i })).toBeTruthy();
    expect(screen.getByRole('group', { name: /appearance/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /change password/i })).toBeTruthy();
  });
});
