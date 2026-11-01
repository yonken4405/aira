/**
 * Task 13.1 (TDD RED) — component tests for the DRRM_Admin agency + capability editors.
 *
 * ───────────────────────────────────────────────────────────────────────────────
 * DECISION FOR TASK 13.2 (documented here so the implementation matches these tests)
 * ───────────────────────────────────────────────────────────────────────────────
 * The agencies + capability editors are a NEW, dedicated admin component:
 *
 *     apps/web/src/components/AdminAgencyNetwork.tsx  →  export function AdminAgencyNetwork()
 *
 * Rationale: it mirrors the operator responder-network surface, keeps
 * `AdminResponders` focused on the roster, and is cleanly placed in the admin
 * tabbed surface. Because a DRRM_Admin is tenant-bounded (the server derives the
 * tenant from the session — rule: "no tenant picker"), the component takes NO
 * props and NO `tenantId`. It SELF-LOADS on mount via the session-scoped admin
 * routes (raw `fetch`, exactly like `AdminResponders`):
 *
 *     EXACT PROP INTERFACE 13.2 MUST IMPLEMENT:
 *         export function AdminAgencyNetwork(): JSX.Element   // zero props
 *
 *     FETCH CONTRACT (all `/api/admin/...`, NEVER a tenantId in the URL):
 *         GET   /api/admin/agencies                 → { agencies: AgencyRecord[] }
 *         POST  /api/admin/agencies                 → { agency: AgencyRecord }      (201)
 *         PATCH /api/admin/agencies/<agencyId>      → { agency: AgencyRecord }      (activate/deactivate/rename)
 *         GET   /api/admin/capability               → { capability: CapabilityConfig }
 *         PATCH /api/admin/capability               → { capability: CapabilityConfig }  (full-replace for ONE category)
 *
 * The separate "responder create-form agency Select lists the tenant's agencies"
 * assertion stays against `AdminResponders` (which already takes `agencies`), kept
 * as a small focused test at the bottom of this file.
 *
 * These tests are RED by design: `AdminAgencyNetwork` does not exist yet. Do not
 * implement the editor UI in this task.
 *
 * Mirrors `admin-responders.test.tsx`: ToastProvider wrapper, hoisted
 * next/navigation spies, `vi.stubGlobal('fetch', fetchSpy)`, `fireEvent`/`waitFor`,
 * `findByTestId('toast-success'|'toast-error')`, and
 * `mockResolvedValueOnce(new Response(JSON.stringify(...), { status }))`.
 *
 * Validates: Requirements 2.6, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7
 */

import { t } from '@aira/ui';
import { ToastProvider } from '@aira/ui/web';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// RED: this module/export does not exist until task 13.2 adds it.
import { AdminAgencyNetwork } from '../src/components/AdminAgencyNetwork';
import { AdminResponders } from '../src/components/AdminResponders';
import type { ResponderView } from '../src/lib/auth/types';
import { OFFICE_ID, TENANT_ID } from './support/fixtures';

const nav = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace, refresh: nav.refresh, push: vi.fn() }),
  usePathname: () => '/admin',
}));

// ── Fixtures (no coordinates anywhere — this is the agency/capability surface) ──

const AGENCY_BFP = {
  id: 'agency-bfp',
  tenantId: TENANT_ID,
  name: 'Cebu City Fire Station',
  code: 'BFP-CEBU',
  agencyType: 'FIRE' as const,
  active: true,
};

const AGENCY_PNP = {
  id: 'agency-pnp',
  tenantId: TENANT_ID,
  name: 'Cebu City Police',
  code: 'PNP-CEBU',
  agencyType: 'POLICE' as const,
  active: true,
};

const AGENCIES_PAYLOAD = { agencies: [AGENCY_BFP, AGENCY_PNP] };

/** Every frozen category present with a capable Agency_Type set (one empty allowed). */
const CAPABILITY_PAYLOAD = {
  capability: {
    SUNOG: ['FIRE'],
    MEDIKAL: ['MEDICAL'],
    KRIMEN: ['POLICE'],
    BAHA: [],
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** A fetch spy that routes by URL+method so the component's two loads both resolve. */
function makeFetchSpy(): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();

    if (url === '/api/admin/agencies' && method === 'GET') {
      return jsonResponse(AGENCIES_PAYLOAD);
    }
    if (url === '/api/admin/capability' && method === 'GET') {
      return jsonResponse(CAPABILITY_PAYLOAD);
    }
    return jsonResponse({ ok: true });
  });
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = makeFetchSpy();
  vi.stubGlobal('fetch', fetchSpy);
  nav.refresh.mockClear();
});

function renderNetwork() {
  return render(
    <ToastProvider>
      <AdminAgencyNetwork />
    </ToastProvider>,
  );
}

/** Every request body the spy saw, as parsed JSON (for coordinate/shape assertions). */
function requestBodies(): unknown[] {
  return fetchSpy.mock.calls
    .map((call) => {
      const init = call[1] as RequestInit | undefined;
      const body = init?.body;
      if (typeof body !== 'string') {
        return null;
      }
      try {
        return JSON.parse(body) as unknown;
      } catch {
        return body;
      }
    })
    .filter((b): b is unknown => b !== null);
}

const COORDINATE = /\d{1,3}\.\d{4}/;

describe('AdminAgencyNetwork', () => {
  it('shows first-load skeletons for agencies and capability before data resolves (R8.2)', () => {
    // Keep both loads pending so the first-load skeleton is what renders.
    fetchSpy.mockImplementation(() => new Promise<Response>(() => {}));

    const { container } = renderNetwork();

    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    // No tenant picker on an admin (tenant-bounded) surface (R2.6/R8.1).
    expect(screen.queryByLabelText(/tenant/i)).toBeNull();
  });

  it('loads and lists the tenant agencies with t()-resolved type labels, no tenant picker (R8.1, R2.6)', async () => {
    renderNetwork();

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith('/api/admin/agencies', expect.anything()),
    );

    expect(await screen.findByText('Cebu City Fire Station')).toBeTruthy();
    expect(screen.getByText('Cebu City Police')).toBeTruthy();
    // Agency_Type tokens render through t(), never the raw identifier (R2.6).
    expect(screen.getByText(t('agencyTypeFire'))).toBeTruthy();
    expect(screen.getByText(t('agencyTypePolice'))).toBeTruthy();
    expect(screen.queryByText('FIRE')).toBeNull();
    expect(screen.queryByText('POLICE')).toBeNull();
    // Admin is tenant-bounded: no tenant picker control.
    expect(screen.queryByLabelText(/tenant/i)).toBeNull();
  });

  it('adds an agency via POST /api/admin/agencies and reports success (R8.3)', async () => {
    renderNetwork();
    await screen.findByText('Cebu City Fire Station');

    fetchSpy.mockImplementationOnce(() =>
      Promise.resolve(
        jsonResponse(
          { agency: { ...AGENCY_PNP, id: 'agency-ems', name: 'Cebu EMS', code: 'EMS-1' } },
          201,
        ),
      ),
    );

    fireEvent.change(screen.getByLabelText(t('agencyNameLabel')), {
      target: { value: 'Cebu EMS' },
    });
    fireEvent.change(screen.getByLabelText(t('agencyCodeLabel')), { target: { value: 'EMS-1' } });
    fireEvent.click(screen.getByRole('button', { name: t('addAgency') }));

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/admin/agencies',
        expect.objectContaining({ method: 'POST' }),
      ),
    );

    expect(await screen.findByTestId('toast-success')).toBeTruthy();
    expect(screen.getByText(t('agencyCreated'))).toBeTruthy();
  });

  it('on add failure shows an error toast and leaves the list unchanged, no coordinate (R8.4)', async () => {
    renderNetwork();
    await screen.findByText('Cebu City Fire Station');

    fetchSpy.mockImplementationOnce(() =>
      Promise.resolve(jsonResponse({ error: 'invalid_agency' }, 400)),
    );

    fireEvent.change(screen.getByLabelText(t('agencyNameLabel')), {
      target: { value: 'Bad Agency' },
    });
    fireEvent.change(screen.getByLabelText(t('agencyCodeLabel')), { target: { value: 'BAD' } });
    fireEvent.click(screen.getByRole('button', { name: t('addAgency') }));

    expect(await screen.findByTestId('toast-error')).toBeTruthy();
    // List unchanged: the rejected row never appears.
    expect(screen.queryByText('Bad Agency')).toBeNull();
    expect(screen.getByText('Cebu City Fire Station')).toBeTruthy();
    // No coordinate leaked into the toast surface.
    const toast = screen.getByTestId('toast-error');
    expect(COORDINATE.test(toast.textContent ?? '')).toBe(false);
  });

  it('gates deactivate behind ConfirmDialog: PATCH fires only after confirm (R8.5)', async () => {
    renderNetwork();
    await screen.findByText('Cebu City Fire Station');

    const deactivate = screen.getAllByRole('button', { name: t('deactivateAgency') })[0];
    expect(deactivate).toBeTruthy();
    fireEvent.click(deactivate as HTMLElement);

    // The confirm dialog titled "Deactivate agency?" appears first.
    expect(await screen.findByText(t('deactivateAgencyTitle'))).toBeTruthy();
    // Nothing has been PATCHed yet.
    expect(
      fetchSpy.mock.calls.some(
        (c) => ((c[1] as RequestInit | undefined)?.method ?? 'GET').toUpperCase() === 'PATCH',
      ),
    ).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: t('deactivateAgency') }));

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        `/api/admin/agencies/${AGENCY_BFP.id}`,
        expect.objectContaining({ method: 'PATCH' }),
      ),
    );
  });

  it('cancelling the ConfirmDialog aborts with no PATCH, agency unchanged (R8.6)', async () => {
    renderNetwork();
    await screen.findByText('Cebu City Fire Station');

    fireEvent.click(
      screen.getAllByRole('button', { name: t('deactivateAgency') })[0] as HTMLElement,
    );
    expect(await screen.findByText(t('deactivateAgencyTitle'))).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: t('cancelAction') }));

    // No PATCH ever fired; the row remains listed (still active).
    expect(
      fetchSpy.mock.calls.some(
        (c) => ((c[1] as RequestInit | undefined)?.method ?? 'GET').toUpperCase() === 'PATCH',
      ),
    ).toBe(false);
    expect(screen.getByText('Cebu City Fire Station')).toBeTruthy();
  });

  it('renders one capability row per frozen category (4) and PATCHes a single-category full replace (R8.1)', async () => {
    renderNetwork();
    await screen.findByText('Cebu City Fire Station');

    // Capability map title + one row per frozen category.
    expect(screen.getByText(t('capabilityTitle'))).toBeTruthy();
    for (const label of ['Fire', 'Medical', 'Crime', 'Flood']) {
      expect(screen.getByText(label)).toBeTruthy();
    }

    // Toggle one Agency_Type for one category; the SUNOG row currently has ['FIRE'].
    // Toggling POLICE into SUNOG should PATCH /api/admin/capability with the full
    // replacement set for THAT category only.
    const sunogPolice = screen.getByLabelText(
      new RegExp(`${t('agencyTypePolice')}.*Fire|Fire.*${t('agencyTypePolice')}`, 'i'),
    );
    fireEvent.click(sunogPolice);

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/admin/capability',
        expect.objectContaining({ method: 'PATCH' }),
      ),
    );

    const patched = requestBodies().find(
      (b): b is { category: string; agencyTypes: string[] } =>
        typeof b === 'object' &&
        b !== null &&
        'category' in b &&
        (b as { category: unknown }).category === 'SUNOG',
    );
    expect(patched).toBeTruthy();
    expect(Array.isArray(patched?.agencyTypes)).toBe(true);
    // Full-replace: the body carries the complete new set for SUNOG.
    expect(patched?.agencyTypes).toEqual(expect.arrayContaining(['FIRE', 'POLICE']));
  });

  it('reports an unavailable state when capability loading is offline/times out (R8.7)', async () => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url === '/api/admin/agencies' && method === 'GET') {
        return jsonResponse(AGENCIES_PAYLOAD);
      }
      if (url === '/api/admin/capability') {
        throw new TypeError('network down');
      }
      return jsonResponse({ ok: true });
    });

    renderNetwork();

    expect(await screen.findByText(t('capabilityUnavailable'))).toBeTruthy();
  });

  it('never renders a coordinate anywhere on the surface (coordinate-free sanity)', async () => {
    const { container } = renderNetwork();
    await screen.findByText('Cebu City Fire Station');

    expect(COORDINATE.test(container.textContent ?? '')).toBe(false);
    for (const body of requestBodies()) {
      expect(COORDINATE.test(JSON.stringify(body))).toBe(false);
    }
  });
});

// ── Responder create-form agency Select reflects the tenant's agencies (R8.1) ──

const OFFICES = [{ id: OFFICE_ID, name: 'Cebu City DRRMO', kind: 'LGU' as const }];
const RESPONDER_AGENCIES = [
  { id: 'agency-bfp', name: 'Cebu City Fire Station', code: 'BFP-CEBU' },
  { id: 'agency-pnp', name: 'Cebu City Police', code: 'PNP-CEBU' },
];

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
  lastLoginAt: null,
  sessionCount: 0,
};

describe('AdminResponders agency Select', () => {
  it('lists the tenant agencies as options in the responder create-form (R8.1)', () => {
    render(
      <ToastProvider>
        <AdminResponders
          responders={[ADMIN_ROW]}
          offices={OFFICES}
          agencies={RESPONDER_AGENCIES}
          viewerId={ADMIN_ROW.id}
        />
      </ToastProvider>,
    );

    const agencySelect = screen.getByLabelText(t('agency')) as HTMLSelectElement;
    const optionText = Array.from(agencySelect.options).map((o) => o.textContent);
    expect(optionText).toContain('Cebu City Fire Station');
    expect(optionText).toContain('Cebu City Police');
  });
});
