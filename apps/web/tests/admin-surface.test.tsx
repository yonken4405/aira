import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// AdminSurface does NOT exist yet (task 11.2 implements it). The failing import
// below is the red state for the test-first task 11.1 — these tests pin the
// tab-gating, deep-linking, tab-switching, and not-authorized contract the
// implementation must satisfy, per Requirement 4 (4.1, 4.5, 4.6, 4.7, 4.8, 4.9).
import { AdminSurface } from '../src/components/AdminSurface';

import type { Role } from '../src/lib/auth/rbac';

/**
 * PROP CONTRACT chosen for AdminSurface (task 11.2 must match this):
 *
 *   interface AdminSurfaceProps {
 *     // The signed-in principal's role. Tabs are gated via can(viewerRole, perm):
 *     //   accounts -> 'responder:manage'   (R4.6)
 *     //   metrics  -> 'metrics:read'        (R4.6)
 *     //   audit    -> 'audit:read'          (R4.6)
 *     readonly viewerRole: Role;
 *
 *     // The deep-linked tab when the server page knows it (e.g. /admin -> 'accounts',
 *     // /admin/dashboards -> 'metrics', /admin/audit -> 'audit'). Optional: when
 *     // absent the surface derives the selected tab from usePathname(), and failing
 *     // that falls back to the first permitted tab (R4.8).
 *     readonly initialTab?: AdminTabId;   // 'accounts' | 'metrics' | 'audit'
 *
 *     // The already-loaded data each tab body consumes, passed straight through to
 *     // AdminResponders / AdminDashboards / the audit table (the server pages load it).
 *     readonly accounts: AdminRespondersProps;   // { responders, offices, agencies, viewerId }
 *     readonly metrics: AdminDashboardsProps;    // { metrics, officeNames }
 *     readonly audit: { readonly events: readonly unknown[] };
 *   }
 *
 * This test mocks the three tab-body components down to simple markers so the
 * assertions stay focused on tab gating / selection / switching rather than the
 * internals of AdminResponders / AdminDashboards / the audit table. It therefore
 * only needs the NAMED props to exist (the data is handed through opaquely).
 */

// usePathname is the deep-link input when initialTab is omitted; useRouter is
// mocked because the real tab switch may push/replace the URL. Same hoisted
// mutable-closure pattern as app-shell.test.tsx / nav-link.test.tsx.
const navState = vi.hoisted(() => ({ pathname: '/admin' }));

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

// Mock the three tab bodies to opaque markers. AdminSurface renders the body of
// the selected tab; these markers let us assert which body is visible without
// pulling AdminResponders / AdminDashboards / the audit table internals in.
vi.mock('../src/components/AdminResponders', () => ({
  AdminResponders: () => <div data-testid="tab-accounts-body">accounts body</div>,
}));

vi.mock('../src/components/AdminDashboards', () => ({
  AdminDashboards: () => <div data-testid="tab-metrics-body">metrics body</div>,
}));

// The audit tab body currently lives inline in app/admin/audit/page.tsx; task 11.2
// is expected to extract it into a component AdminSurface mounts. We mock that
// extracted component here. If 11.2 names it differently, this mock path is the
// single place to update — the gating contract is unaffected.
vi.mock('../src/components/AdminAudit', () => ({
  AdminAudit: () => <div data-testid="tab-audit-body">audit body</div>,
}));

// Minimal, shape-valid data handed through to the (mocked) tab bodies. The bodies
// ignore it, so empty collections are enough to satisfy the named-prop contract.
const accountsData = {
  responders: [],
  offices: [],
  agencies: [],
  viewerId: 'admin-1',
} as const;

const metricsData = {
  metrics: {
    total: 0,
    active: 0,
    activeUnits: 0,
    avgResolveMinutes: null,
    byStatus: { QUEUED: 0, DISPATCHED: 0, EN_ROUTE: 0, ON_SCENE: 0, RESOLVED: 0 },
    byCategory: { SUNOG: 0, MEDIKAL: 0, KRIMEN: 0, BAHA: 0 },
    byOffice: {},
  },
  officeNames: {},
} as const;

const auditData = { events: [] } as const;

type AdminTabId = 'accounts' | 'metrics' | 'audit';

function renderSurface(args: { viewerRole: Role; initialTab?: AdminTabId }) {
  return render(
    <AdminSurface
      viewerRole={args.viewerRole}
      initialTab={args.initialTab}
      accounts={accountsData as never}
      metrics={metricsData as never}
      audit={auditData as never}
    />,
  );
}

// Tab triggers are exposed as tablist tabs; we match the accessible name loosely
// so the implementation is free to choose the visible label copy.
const tab = (name: RegExp) => screen.queryByRole('tab', { name });

beforeEach(() => {
  navState.pathname = '/admin';
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AdminSurface tab gating by permission (R4.6, R4.7)', () => {
  it('ADMIN sees all three tabs (responder:manage + metrics:read + audit:read)', () => {
    renderSurface({ viewerRole: 'ADMIN', initialTab: 'accounts' });

    expect(tab(/account/i)).toBeTruthy();
    expect(tab(/metric|dashboard/i)).toBeTruthy();
    expect(tab(/audit/i)).toBeTruthy();
  });

  it('DISPATCHER sees only the metrics tab (holds metrics:read, not responder:manage/audit:read)', () => {
    renderSurface({ viewerRole: 'DISPATCHER' });

    // Metrics tab and its body are present; the other two tabs are omitted (R4.7).
    expect(tab(/metric|dashboard/i)).toBeTruthy();
    expect(tab(/account/i)).toBeNull();
    expect(tab(/audit/i)).toBeNull();

    // Omitted tabs must not render their content either (R4.7).
    expect(screen.queryByTestId('tab-accounts-body')).toBeNull();
    expect(screen.queryByTestId('tab-audit-body')).toBeNull();
  });

  it('omits the accounts and audit content, showing only the metrics body for DISPATCHER', () => {
    renderSurface({ viewerRole: 'DISPATCHER' });

    expect(screen.getByTestId('tab-metrics-body')).toBeTruthy();
  });
});

describe('AdminSurface initial tab selection / deep-linking (R4.8)', () => {
  it('selects the deep-linked tab when initialTab is provided', () => {
    renderSurface({ viewerRole: 'ADMIN', initialTab: 'audit' });

    // The audit body is the visible one; accounts/metrics bodies are not shown.
    expect(screen.getByTestId('tab-audit-body')).toBeTruthy();
    expect(screen.queryByTestId('tab-accounts-body')).toBeNull();
    expect(screen.queryByTestId('tab-metrics-body')).toBeNull();
  });

  it('derives the selected tab from the pathname when initialTab is omitted', () => {
    navState.pathname = '/admin/audit';
    renderSurface({ viewerRole: 'ADMIN' });

    expect(screen.getByTestId('tab-audit-body')).toBeTruthy();
    expect(screen.queryByTestId('tab-accounts-body')).toBeNull();
  });

  it('falls back to the first permitted tab when neither initialTab nor pathname resolves a permitted tab', () => {
    // DISPATCHER holds only metrics:read, so the first (and only) permitted tab
    // is metrics even though the pathname points at the permission-less /admin.
    navState.pathname = '/admin';
    renderSurface({ viewerRole: 'DISPATCHER' });

    expect(screen.getByTestId('tab-metrics-body')).toBeTruthy();
  });
});

describe('AdminSurface tab switching keeps the same surface (R4.5)', () => {
  it('switching tabs changes the visible body and hides the others without remounting a per-tab header', () => {
    renderSurface({ viewerRole: 'ADMIN', initialTab: 'accounts' });

    // Start on accounts.
    expect(screen.getByTestId('tab-accounts-body')).toBeTruthy();
    expect(screen.queryByTestId('tab-audit-body')).toBeNull();

    // The single tablist (shell) instance stays mounted across switches.
    const tablist = screen.getByRole('tablist');

    fireEvent.click(screen.getByRole('tab', { name: /audit/i }));

    // Audit body now visible, accounts body hidden — same tablist instance.
    expect(screen.getByTestId('tab-audit-body')).toBeTruthy();
    expect(screen.queryByTestId('tab-accounts-body')).toBeNull();
    expect(screen.getByRole('tablist')).toBe(tablist);
  });
});

describe('AdminSurface not-authorized fallback (R4.9)', () => {
  it('renders a not-authorized indication and no tab content when the principal holds none of the three permissions', () => {
    // RESPONDER holds none of responder:manage / metrics:read / audit:read.
    renderSurface({ viewerRole: 'RESPONDER' });

    // Forbidden copy (forbiddenTitle = "Not authorised") renders instead of tabs.
    expect(screen.getByText(/not authorised/i)).toBeTruthy();

    // No tab and no tab body render.
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByTestId('tab-accounts-body')).toBeNull();
    expect(screen.queryByTestId('tab-metrics-body')).toBeNull();
    expect(screen.queryByTestId('tab-audit-body')).toBeNull();
  });
});
