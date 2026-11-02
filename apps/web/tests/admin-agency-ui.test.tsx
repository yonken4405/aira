/**
 * @vitest-environment jsdom
 *
 * single-lgu-agency-network (Task 9.1): the role-aware admin tabs + the new OrgView and
 * AgencyCoverage components. Map-free jsdom tests with a stubbed fetch, mirroring the
 * existing admin component tests. Operate Mode: Skeleton on first load, unified toast,
 * ConfirmDialog on the full-replace save, copy via t(), no coordinates.
 */

import { ToastProvider } from '@aira/ui/web';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgencyCoverage } from '../src/components/AgencyCoverage';
import { OrgView } from '../src/components/OrgView';
import { OFFICE_ID } from './support/fixtures';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/admin/org',
}));

const OFFICES = [
  { id: OFFICE_ID, name: 'Cebu City DRRMO', kind: 'LGU' as const },
  { id: 'brgy-lahug', name: 'Barangay Lahug', kind: 'BARANGAY' as const },
];

const fetchSpy = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchSpy);
  fetchSpy.mockReset();
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** A promise that never settles — holds a component in its loading phase. */
const pending = <T,>(): Promise<T> => new Promise<T>(() => {});

describe('OrgView (R8)', () => {
  it('shows a first-load skeleton while the org data loads', () => {
    fetchSpy.mockReturnValue(pending());
    render(
      <ToastProvider>
        <OrgView />
      </ToastProvider>,
    );
    expect(screen.getByTestId('org-skeleton')).toBeTruthy();
  });

  it('renders offices + agencies with their members once loaded', async () => {
    fetchSpy.mockResolvedValueOnce(
      json({
        members: [
          {
            id: 'r1',
            email: 'bfp1@aira.test',
            callsign: 'BFP-01',
            displayName: 'BFP-01',
            role: 'RESPONDER',
            active: true,
            officeId: OFFICE_ID,
            officeName: 'Cebu City DRRMO',
            agencyId: 'agency-bfp',
            agencyName: 'Bureau of Fire Protection',
            mustChangePassword: false,
            lockedUntil: null,
            lastLoginAt: null,
            sessionCount: 0,
          },
        ],
        offices: OFFICES,
        agencies: [{ id: 'agency-bfp', name: 'Bureau of Fire Protection', code: 'BFP' }],
      }),
    );

    render(
      <ToastProvider>
        <OrgView />
      </ToastProvider>,
    );

    expect(await screen.findByText('Barangay Lahug')).toBeTruthy();
    expect(screen.getByText('BFP-01')).toBeTruthy();
  });

  it('degrades to an honest unavailable state on failure', async () => {
    fetchSpy.mockResolvedValueOnce(json({ ok: false }, 503));
    render(
      <ToastProvider>
        <OrgView />
      </ToastProvider>,
    );
    // The copy appears both in the panel and in the toast; at least one must render.
    expect(
      (await screen.findAllByText('The organization view is unavailable. Try again shortly.'))
        .length,
    ).toBeGreaterThan(0);
  });
});

describe('AgencyCoverage (R5)', () => {
  it('shows a first-load skeleton while coverage loads', () => {
    fetchSpy.mockReturnValue(pending());
    render(
      <ToastProvider>
        <AgencyCoverage
          agencyId="agency-bfp"
          agencyName="Bureau of Fire Protection"
          offices={OFFICES}
        />
      </ToastProvider>,
    );
    expect(screen.getByTestId('coverage-skeleton')).toBeTruthy();
  });

  it('full-replaces coverage behind a ConfirmDialog and PUTs the selected set', async () => {
    // Initial load: no coverage yet.
    fetchSpy.mockResolvedValueOnce(json({ officeIds: [] }));

    render(
      <ToastProvider>
        <AgencyCoverage
          agencyId="agency-bfp"
          agencyName="Bureau of Fire Protection"
          offices={OFFICES}
        />
      </ToastProvider>,
    );

    // Wait for the checklist to render, then select a barangay.
    const lahug = await screen.findByLabelText(/Barangay Lahug/);
    fireEvent.click(lahug);

    // The PUT is gated behind a ConfirmDialog.
    fetchSpy.mockResolvedValueOnce(json({ officeIds: ['brgy-lahug'] }));
    fireEvent.click(screen.getByRole('button', { name: 'Save coverage' }));
    expect(await screen.findByRole('alertdialog')).toBeTruthy();

    const confirm = screen
      .getAllByRole('button')
      .find((b) => /save coverage/i.test(b.textContent ?? '') && b.closest('[role="alertdialog"]'));
    fireEvent.click(confirm as HTMLElement);

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/admin/agencies/agency-bfp/coverage',
        expect.objectContaining({ method: 'PUT' }),
      ),
    );
    const putCall = fetchSpy.mock.calls.find((c) => (c[1] as RequestInit)?.method === 'PUT');
    expect(JSON.parse((putCall?.[1] as RequestInit).body as string)).toEqual({
      officeIds: ['brgy-lahug'],
    });
  });

  it('degrades to an honest unavailable state on a failed load', async () => {
    fetchSpy.mockResolvedValueOnce(json({ ok: false }, 503));
    render(
      <ToastProvider>
        <AgencyCoverage
          agencyId="agency-bfp"
          agencyName="Bureau of Fire Protection"
          offices={OFFICES}
        />
      </ToastProvider>,
    );
    expect(
      (await screen.findAllByText('Coverage is unavailable right now. Try again shortly.')).length,
    ).toBeGreaterThan(0);
  });
});
