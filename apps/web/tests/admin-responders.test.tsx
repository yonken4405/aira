import { ToastProvider } from '@aira/ui/web';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminResponders } from '../src/components/AdminResponders';
import type { ResponderView } from '../src/lib/auth/types';
import { OFFICE_ID } from './support/fixtures';

const nav = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace, refresh: nav.refresh, push: vi.fn() }),
  usePathname: () => '/admin',
}));

const OFFICES = [{ id: OFFICE_ID, name: 'Cebu City DRRMO', kind: 'LGU' as const }];
const AGENCIES = [{ id: 'agency-bfp', name: 'Bureau of Fire Protection', code: 'BFP' }];

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

const FIELD_ROW: ResponderView = {
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
  // Relative to "now" so the lock is always in the future when the suite runs; a
  // hardcoded absolute date silently stops testing the locked state once it elapses.
  lockedUntil: Date.now() + 60 * 60 * 1000,
  lastLoginAt: null,
  sessionCount: 2,
};

const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));

function renderAdmin(rows: readonly ResponderView[] = [ADMIN_ROW, FIELD_ROW]) {
  return render(
    <ToastProvider>
      <AdminResponders
        responders={rows}
        offices={OFFICES}
        agencies={AGENCIES}
        viewerId={ADMIN_ROW.id}
      />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchSpy);
  fetchSpy.mockClear();
  nav.refresh.mockClear();
});

describe('AdminResponders', () => {
  it('renders the roster with roles, status and session counts', () => {
    renderAdmin();

    expect(screen.getByText('ADMIN-1')).toBeTruthy();
    expect(screen.getByText('K9-01')).toBeTruthy();
    expect(screen.getByText('Locked')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByRole('button', { name: /unlock/i })).toBeTruthy();
  });

  it('protects the signed-in admin from locking themselves out', () => {
    renderAdmin();

    const deactivateButtons = screen.getAllByRole('button', { name: /deactivate/i });
    expect(deactivateButtons[0]?.hasAttribute('disabled')).toBe(true);
    expect(deactivateButtons[1]?.hasAttribute('disabled')).toBe(false);

    const roleSelect = screen.getByLabelText('Role ADMIN-1') as HTMLSelectElement;
    expect(roleSelect.disabled).toBe(true);
  });

  it('confirms before deactivating and calls the API', async () => {
    renderAdmin();

    fireEvent.click(screen.getAllByRole('button', { name: /deactivate/i })[1] as HTMLElement);

    expect(await screen.findByText('Deactivate this account?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate account' }));

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/admin/responders/responder-field',
        expect.objectContaining({ method: 'PATCH' }),
      ),
    );

    expect(await screen.findByTestId('toast-success')).toBeTruthy();
    expect(nav.refresh).toHaveBeenCalled();
  });

  it('creates an account and shows the one-time password exactly once', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, password: 'Aa23456789Bb' }), { status: 201 }),
    );

    renderAdmin();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new.unit@cebu.gov.ph' } });
    fireEvent.change(screen.getByLabelText('Callsign (optional)'), { target: { value: 'UNIT-7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create responder' }));

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/admin/responders',
        expect.objectContaining({ method: 'POST' }),
      ),
    );

    expect(await screen.findByText('Aa23456789Bb')).toBeTruthy();
    expect(screen.getByText('One-time password')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Aa23456789Bb')).toBeNull();
  });

  it('surfaces a duplicate email as an error toast', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error: 'email_taken' }), { status: 409 }),
    );

    renderAdmin();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'k9@cebu.gov.ph' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create responder' }));

    expect(await screen.findByTestId('toast-error')).toBeTruthy();
    expect(screen.getByText('That email is already in use.')).toBeTruthy();
  });
});
