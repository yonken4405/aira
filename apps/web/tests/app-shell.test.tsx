import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// This import intentionally points at a module that does not exist yet
// (task 9.2 implements `AppShell.tsx` / `AppShellHeader.tsx`). The failing
// import is the red state for task 9.1 — the tests below pin the shell-header
// contract the implementation must satisfy, per Requirement 3 (3.1, 3.7, 3.8, 3.9).
import { AppShell } from '../src/components/AppShell';

import type { Role } from '../src/lib/auth/rbac';

/**
 * `AppShellHeader` is a client island that uses `NavLink`, which reads
 * `usePathname`. We drive the pathname through a hoisted mutable closure (the
 * `vi.hoisted` pattern used by apps/web/tests/login-form.test.tsx) and mock
 * `next/link` down to a plain anchor so the test can read labels/hrefs straight
 * off the DOM without the real Next.js runtime (mirrors
 * packages/ui/src/web/ui/nav-link.test.tsx).
 */
const navState = vi.hoisted(() => ({ pathname: '/console' }));

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

// NavEntry.label strings. Routing visible labels through props (not hardcoded
// product copy) keeps the assertions aligned to the NavEntry contract: the
// header renders whatever labels the caller hands it.
const LABEL = {
  queue: 'Nav Queue Entry',
  accounts: 'Nav Accounts Entry',
  audit: 'Nav Audit Entry',
  tenants: 'Nav Tenants Entry',
} as const;

type TestIdentity = {
  readonly tier: 'responders' | 'platform_admins' | 'citizens';
  readonly displayName: string;
  readonly roleLabel?: string;
};

// A permission-free entry that must always survive filtering.
const openEntry = { href: '/console', label: LABEL.queue };

// Responder-tier gated entries (filtered via can(role, permission)).
const accountsEntry = {
  href: '/admin',
  label: LABEL.accounts,
  permission: 'responder:manage' as const,
};
const auditEntry = {
  href: '/admin/audit',
  label: LABEL.audit,
  permission: 'audit:read' as const,
};

// Platform-tier entry (operators carry no Role; gated by platformOnly).
const tenantsEntry = { href: '/platform', label: LABEL.tenants, platformOnly: true };

function renderShell(args: {
  identity: TestIdentity;
  role?: Role;
  navEntries: ReadonlyArray<Record<string, unknown>>;
  children?: React.ReactNode;
}) {
  return render(
    <AppShell
      identity={args.identity}
      role={args.role}
      navEntries={args.navEntries as never}
      viewerRole={args.role}
    >
      {args.children ?? <p>shell child</p>}
    </AppShell>,
  );
}

beforeEach(() => {
  navState.pathname = '/console';
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AppShell permission gating (R3.7)', () => {
  it('omits a responder entry whose mapped permission the principal lacks', () => {
    // A RESPONDER holds neither responder:manage nor audit:read, so both gated
    // entries must be filtered out while the open entry survives.
    renderShell({
      identity: { tier: 'responders', displayName: 'k9-01', roleLabel: 'Responder' },
      role: 'RESPONDER',
      navEntries: [openEntry, accountsEntry, auditEntry],
    });

    expect(screen.getByText(LABEL.queue)).toBeTruthy();
    expect(screen.queryByText(LABEL.accounts)).toBeNull();
    expect(screen.queryByText(LABEL.audit)).toBeNull();
  });

  it('renders a responder entry when the principal holds the mapped permission', () => {
    // An ADMIN holds responder:manage and audit:read (rbac.ts), so both gated
    // entries render for the same entry set that RESPONDER had them hidden.
    renderShell({
      identity: { tier: 'responders', displayName: 'admin-1', roleLabel: 'Admin' },
      role: 'ADMIN',
      navEntries: [openEntry, accountsEntry, auditEntry],
    });

    expect(screen.getByText(LABEL.accounts)).toBeTruthy();
    expect(screen.getByText(LABEL.audit)).toBeTruthy();
  });
});

describe('AppShell always-present header entry points (R3.9)', () => {
  const identities: ReadonlyArray<{
    readonly name: string;
    readonly identity: TestIdentity;
    readonly role?: Role;
  }> = [
    {
      name: 'responder tier',
      identity: { tier: 'responders', displayName: 'k9-01', roleLabel: 'Responder' },
      role: 'RESPONDER',
    },
    {
      name: 'platform tier',
      identity: { tier: 'platform_admins', displayName: 'ops' },
    },
    {
      name: 'citizen tier',
      identity: { tier: 'citizens', displayName: 'resident' },
    },
  ];

  for (const { name, identity, role } of identities) {
    it(`exposes bell, Profile, Settings and ThemeToggle for the ${name}`, () => {
      renderShell({ identity, role, navEntries: [openEntry] });

      // Notification bell + Profile + Settings entry points live in the header
      // region for every tier (R3.9). Profile/Settings are reachable links.
      expect(screen.getByRole('link', { name: /profile/i })).toBeTruthy();
      expect(screen.getByRole('link', { name: /settings/i })).toBeTruthy();
      // The notification bell exposes an accessible name mentioning notifications.
      expect(screen.getByRole('button', { name: /notification/i })).toBeTruthy();
      // The ThemeToggle renders its segmented "Appearance" group (from @aira/ui/web).
      expect(screen.getByRole('group', { name: /appearance/i })).toBeTruthy();
    });
  }
});

describe('AppShell tier-derived entry sets (R3.8)', () => {
  it('renders a platformOnly entry for a platform identity', () => {
    renderShell({
      identity: { tier: 'platform_admins', displayName: 'ops' },
      navEntries: [tenantsEntry],
    });

    expect(screen.getByText(LABEL.tenants)).toBeTruthy();
  });

  it('omits a platformOnly entry for a responder identity', () => {
    // platformOnly entries belong to the platform tier only; a responder-tier
    // identity must never see them even if handed the same entry.
    renderShell({
      identity: { tier: 'responders', displayName: 'k9-01', roleLabel: 'Responder' },
      role: 'RESPONDER',
      navEntries: [openEntry, tenantsEntry],
    });

    expect(screen.getByText(LABEL.queue)).toBeTruthy();
    expect(screen.queryByText(LABEL.tenants)).toBeNull();
  });

  it('shows a permission-gated admin entry for ADMIN but not RESPONDER', () => {
    const { unmount } = renderShell({
      identity: { tier: 'responders', displayName: 'admin-1', roleLabel: 'Admin' },
      role: 'ADMIN',
      navEntries: [accountsEntry],
    });
    expect(screen.getByText(LABEL.accounts)).toBeTruthy();
    unmount();

    renderShell({
      identity: { tier: 'responders', displayName: 'k9-01', roleLabel: 'Responder' },
      role: 'RESPONDER',
      navEntries: [accountsEntry],
    });
    expect(screen.queryByText(LABEL.accounts)).toBeNull();
  });
});

describe('AppShell content frame (R3.1)', () => {
  it('renders its children below the header inside the content frame', () => {
    renderShell({
      identity: { tier: 'responders', displayName: 'k9-01', roleLabel: 'Responder' },
      role: 'RESPONDER',
      navEntries: [openEntry],
      children: <section>unique shell body content</section>,
    });

    expect(screen.getByText('unique shell body content')).toBeTruthy();
  });
});
