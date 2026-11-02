/**
 * Task 31.1 — failing tests for the new confirmation gating (Requirement 18).
 *
 * These tests render the REAL existing components and assert that a
 * `ConfirmDialog` now gates each high-impact action before its mutation fires.
 * They are expected to FAIL today: the targeted actions still call their
 * mutation directly (no dialog), so no `role="alertdialog"` appears and the
 * network request fires on the first click. Task 31.2 wires the dialog in and
 * turns these green.
 *
 * Covered here (existing components only):
 *  - R18.1 suspend-tenant  -> destructive-tone ConfirmDialog  (PlatformTenants)
 *  - R18.2 incident status transition incl. RESOLVED           (RoutingPanel)
 *  - R18.3 unlock-account / activate-tenant / logout           (AdminResponders,
 *                                                               PlatformTenants,
 *                                                               AppShellHeader)
 *  - R18.5 cancel aborts with state unchanged (no fetch)
 *  - R18.6 existing deactivate gating still present            (AdminResponders)
 *
 * DEFERRED: R18.4 broadcast / system-notice send confirmation (audience
 * summary). Those send UIs do not exist as components yet (the broadcast /
 * system-notice APIs land in Phase 5 tasks 26/27 but no client component
 * targets them). Their confirm-dialog coverage is deferred to the task that
 * builds those send UIs; nothing is asserted on them here.
 */

import { ToastProvider } from '@aira/ui/web';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminResponders } from '../src/components/AdminResponders';
import { AppShellHeader } from '../src/components/AppShellHeader';
import { RoutingPanel } from '../src/components/RoutingPanel';
import type { ResponderView } from '../src/lib/auth/types';
import { OFFICE_ID, makeIncident } from './support/fixtures';

const nav = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace, refresh: nav.refresh, push: nav.push }),
  usePathname: () => '/admin',
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// A 200-OK fetch stub; individual tests assert whether / with what it was called.
const fetchSpy = vi.fn(
  async (_input?: RequestInfo | URL, _init?: RequestInit) =>
    new Response(JSON.stringify({ ok: true }), { status: 200 }),
);

beforeEach(() => {
  vi.stubGlobal('fetch', fetchSpy);
  fetchSpy.mockClear();
  nav.replace.mockClear();
  nav.refresh.mockClear();
  nav.push.mockClear();
});

/** All fetch() calls whose first argument matches a URL fragment. */
function fetchCallsFor(fragment: string): unknown[][] {
  return fetchSpy.mock.calls.filter(
    (call) => typeof call[0] === 'string' && (call[0] as string).includes(fragment),
  );
}

// NOTE: the PlatformTenants suspend/activate confirm-gating cases were removed with the
// operator console (single-lgu-agency-network R2). The remaining confirm-gating coverage
// (RoutingPanel / AdminResponders / AppShellHeader) is unaffected.

// ---------------------------------------------------------------------------
// RoutingPanel — incident status transition incl. RESOLVED (R18.2, R18.5)
// ---------------------------------------------------------------------------

describe('RoutingPanel status-transition confirmation (R18.2, R18.5)', () => {
  const QUEUED = makeIncident({ id: 'mesh-2001', category: 'SUNOG', status: 'QUEUED' });

  function renderPanel() {
    return render(
      <ToastProvider>
        <RoutingPanel
          incident={QUEUED}
          canAssign={false}
          canUpdateStatus
          onChanged={() => undefined}
        />
      </ToastProvider>,
    );
  }

  it('opens a confirm dialog before POSTing a Resolved transition', async () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Resolved' }));

    // A confirm gate must appear and the status POST must NOT have fired yet.
    expect(await screen.findByRole('alertdialog')).toBeTruthy();
    expect(fetchCallsFor(`/api/incidents/${QUEUED.id}/status`)).toHaveLength(0);

    const confirm = screen
      .getAllByRole('button')
      .find((b) => /confirm|resolve/i.test(b.textContent ?? ''));
    fireEvent.click(confirm as HTMLElement);

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        `/api/incidents/${QUEUED.id}/status`,
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('aborts the transition with no POST when cancelled (R18.5)', async () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Resolved' }));
    await screen.findByRole('alertdialog');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(fetchCallsFor(`/api/incidents/${QUEUED.id}/status`)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// AdminResponders — unlock-account (R18.3) + preserved deactivate gating (R18.6)
// ---------------------------------------------------------------------------

const ADMIN_ROW: ResponderView = {
  id: 'responder-admin',
  email: 'admin@aira.test',
  callsign: 'ADMIN-1',
  displayName: 'ADMIN-1',
  role: 'ADMIN',
  active: true,
  officeId: OFFICE_ID,
  officeName: 'Cebu City DRRMO',
  agencyId: null,
  agencyName: null,
  mustChangePassword: false,
  lockedUntil: null,
  lastLoginAt: Date.UTC(2026, 9, 22, 7, 30),
  sessionCount: 1,
};

const LOCKED_ROW: ResponderView = {
  id: 'responder-field',
  email: 'field@aira.test',
  callsign: 'K9-01',
  displayName: 'K9-01',
  role: 'RESPONDER',
  active: true,
  officeId: OFFICE_ID,
  officeName: 'Cebu City DRRMO',
  agencyId: 'agency-bfp',
  agencyName: 'Bureau of Fire Protection',
  mustChangePassword: false,
  // Future lock so the Unlock control is always rendered when the suite runs.
  lockedUntil: Date.now() + 60 * 60 * 1000,
  lastLoginAt: null,
  sessionCount: 2,
};

const OFFICES = [{ id: OFFICE_ID, name: 'Cebu City DRRMO', kind: 'LGU' as const }];
const AGENCIES = [{ id: 'agency-bfp', name: 'Bureau of Fire Protection', code: 'BFP' }];

function renderAdmin() {
  return render(
    <ToastProvider>
      <AdminResponders
        responders={[ADMIN_ROW, LOCKED_ROW]}
        offices={OFFICES}
        agencies={AGENCIES}
        viewerId={ADMIN_ROW.id}
      />
    </ToastProvider>,
  );
}

describe('AdminResponders unlock confirmation (R18.3, R18.5)', () => {
  it('opens a confirm dialog before the unlock PATCH', async () => {
    renderAdmin();

    fireEvent.click(screen.getByRole('button', { name: /unlock/i }));

    // A confirm gate must appear and the unlock PATCH must NOT have fired yet.
    expect(await screen.findByRole('alertdialog')).toBeTruthy();
    expect(fetchCallsFor(`/api/admin/responders/${LOCKED_ROW.id}`)).toHaveLength(0);

    const confirm = screen
      .getAllByRole('button')
      .find((b) => /unlock|confirm/i.test(b.textContent ?? ''));
    fireEvent.click(confirm as HTMLElement);

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        `/api/admin/responders/${LOCKED_ROW.id}`,
        expect.objectContaining({ method: 'PATCH' }),
      ),
    );
  });

  it('aborts the unlock with no PATCH when cancelled (R18.5)', async () => {
    renderAdmin();

    fireEvent.click(screen.getByRole('button', { name: /unlock/i }));
    await screen.findByRole('alertdialog');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(fetchCallsFor(`/api/admin/responders/${LOCKED_ROW.id}`)).toHaveLength(0);
  });
});

describe('AdminResponders preserves existing deactivate gating (R18.6)', () => {
  it('still opens a confirm dialog before the deactivate PATCH', async () => {
    renderAdmin();

    // The second (non-self) row is the deactivatable one.
    const deactivate = screen.getAllByRole('button', { name: /deactivate/i })[1] as HTMLElement;
    fireEvent.click(deactivate);

    expect(await screen.findByText('Deactivate this account?')).toBeTruthy();
    expect(fetchCallsFor(`/api/admin/responders/${LOCKED_ROW.id}`)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// AppShellHeader — logout (R18.3, R18.5)
// ---------------------------------------------------------------------------

describe('AppShellHeader logout confirmation (R18.3, R18.5)', () => {
  function renderHeader() {
    return render(
      <AppShellHeader
        identity={{ tier: 'responders', displayName: 'ADMIN-1', roleLabel: 'Admin' }}
        role="ADMIN"
        navEntries={[{ href: '/console', label: 'Queue' }]}
      />,
    );
  }

  it('opens a confirm dialog before POSTing logout', async () => {
    renderHeader();

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));

    // A confirm gate must appear and the logout POST must NOT have fired yet.
    expect(await screen.findByRole('alertdialog')).toBeTruthy();
    expect(fetchCallsFor('/api/auth/logout')).toHaveLength(0);

    const confirm = screen
      .getAllByRole('button')
      .find(
        (b) =>
          /sign out|log ?out|confirm/i.test(b.textContent ?? '') &&
          b.getAttribute('aria-label') !== 'Sign out',
      );
    fireEvent.click(confirm as HTMLElement);

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/auth/logout',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('aborts logout with no POST when cancelled (R18.5)', async () => {
    renderHeader();

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    await screen.findByRole('alertdialog');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(fetchCallsFor('/api/auth/logout')).toHaveLength(0);
  });
});
