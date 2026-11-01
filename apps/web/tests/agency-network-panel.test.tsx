/**
 * Component tests for the operator `AgencyNetworkPanel` (tenant-responder-network, task 12).
 *
 * TDD RED: the component under test does not exist yet (task 12.2 creates it). These
 * tests intentionally fail at import until `../src/components/AgencyNetworkPanel` is
 * implemented. Map-free jsdom tests mirroring `admin-responders.test.tsx`:
 * `ToastProvider` wrapper, hoisted `next/navigation` spies, a stubbed global `fetch`,
 * `fireEvent`/`waitFor`, and `findByTestId('toast-success'|'toast-error')`.
 *
 * ── Prop contract task 12.2 MUST implement ─────────────────────────────────────────
 *   export interface AgencyNetworkPanelProps {
 *     readonly tenantId: string;
 *     readonly offices: readonly { readonly id: string; readonly name: string }[];
 *   }
 * The panel self-loads agencies (`GET /api/platform/tenants/<tenantId>/agencies`) and the
 * capability map (`GET /api/platform/tenants/<tenantId>/capability`) on mount, rendering a
 * layout-shaped `Skeleton` until both resolve. `offices` feeds the responder-staffing
 * `Select` (mirrors how `AdminResponders` takes `offices` as a prop).
 *
 * ── Fetch contract task 12.2 MUST wire (asserted below) ─────────────────────────────
 *   GET   /api/platform/tenants/<tenantId>/agencies      (initial load + refetch on success)
 *   POST  /api/platform/tenants/<tenantId>/agencies      (add agency)
 *   PATCH /api/platform/agencies/<agencyId>              (rename / deactivate)
 *   GET   /api/platform/tenants/<tenantId>/capability    (initial load)
 *   PATCH /api/platform/tenants/<tenantId>/capability    (full-replace one category)
 *   POST  /api/platform/tenants/<tenantId>/responders    (staffing; not exercised here)
 *
 * Requirements: 2.6, 5.4, 5.9, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7
 */

import { ToastProvider } from '@aira/ui/web';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgencyNetworkPanel } from '../src/components/AgencyNetworkPanel';
import { OFFICE_ID, TENANT_ID } from './support/fixtures';

const nav = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace, refresh: nav.refresh, push: nav.push }),
  usePathname: () => '/platform',
}));

const OFFICES = [{ id: OFFICE_ID, name: 'Cebu City DRRMO' }];

const AGENCY_BFP = {
  id: 'agency-bfp',
  tenantId: TENANT_ID,
  name: 'Cebu City Fire Station',
  code: 'BFP',
  agencyType: 'FIRE',
  active: true,
};

const AGENCY_PNP = {
  id: 'agency-pnp',
  tenantId: TENANT_ID,
  name: 'Cebu City Police',
  code: 'PNP',
  agencyType: 'POLICE',
  active: true,
};

const CAPABILITY = {
  SUNOG: ['FIRE'],
  MEDIKAL: ['MEDICAL'],
  KRIMEN: ['POLICE'],
  BAHA: [] as string[],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A never-settling promise so first render stays in the loading (skeleton) state. */
function pending(): Promise<Response> {
  return new Promise<Response>(() => {});
}

/**
 * Route the two initial GETs (agencies + capability) to deterministic payloads. Each
 * test can queue extra one-off responses with `fetchSpy.mockResolvedValueOnce(...)`
 * BEFORE the mutation fires; those are consumed in call order after the two loads.
 */
function mockInitialLoads(options?: {
  readonly agencies?: readonly unknown[];
  readonly capability?: unknown;
}): void {
  const agencies = options?.agencies ?? [AGENCY_BFP, AGENCY_PNP];
  const capability = options?.capability ?? CAPABILITY;
  fetchSpy.mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.endsWith('/capability')) {
      return Promise.resolve(jsonResponse({ ok: true, capability }));
    }
    return Promise.resolve(jsonResponse({ ok: true, agencies }));
  });
}

const fetchSpy = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

function renderPanel() {
  return render(
    <ToastProvider>
      <AgencyNetworkPanel tenantId={TENANT_ID} offices={OFFICES} />
    </ToastProvider>,
  );
}

/** Scans the DOM + every fetch body for a 4-dp coordinate-shaped value (none allowed). */
const COORD = /\d{1,3}\.\d{4}/;

beforeEach(() => {
  vi.stubGlobal('fetch', fetchSpy);
  fetchSpy.mockReset();
  nav.refresh.mockClear();
});

describe('AgencyNetworkPanel', () => {
  it('shows a layout-shaped skeleton while agencies and capability load (R8.2)', () => {
    fetchSpy.mockImplementation(() => pending());

    const { container } = renderPanel();

    expect(container.querySelector('[data-slot="skeleton"]')).toBeTruthy();
  });

  it('lists each agency with name, code and the t()-resolved Agency_Type label (R8.1/R2.6)', async () => {
    mockInitialLoads();

    renderPanel();

    expect(await screen.findByText('Cebu City Fire Station')).toBeTruthy();
    expect(screen.getByText('Cebu City Police')).toBeTruthy();
    expect(screen.getByText('BFP')).toBeTruthy();
    expect(screen.getByText('PNP')).toBeTruthy();
    // Agency_Type is an identifier; its label resolves through t() ('FIRE' -> 'Fire').
    expect(screen.queryByText('FIRE')).toBeNull();
    expect(screen.queryByText('POLICE')).toBeNull();
  });

  it('adds an agency, POSTs to the tenant route, toasts success and refetches (R8.3)', async () => {
    mockInitialLoads();

    renderPanel();
    await screen.findByText('Cebu City Fire Station');

    // Next POST resolves 201; the subsequent GET refetch falls back to mockImplementation.
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(
        {
          ok: true,
          agency: {
            ...AGENCY_PNP,
            id: 'agency-ems',
            name: 'City EMS',
            code: 'EMS',
            agencyType: 'MEDICAL',
          },
        },
        201,
      ),
    );

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'City EMS' } });
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'EMS' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add agency' }));

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        `/api/platform/tenants/${TENANT_ID}/agencies`,
        expect.objectContaining({ method: 'POST' }),
      ),
    );

    expect(await screen.findByTestId('toast-success')).toBeTruthy();
    expect(screen.getByText('Agency added')).toBeTruthy();

    // Success refetches the list (a second GET to the agencies route).
    const agencyGets = fetchSpy.mock.calls.filter(
      ([url, init]) =>
        url === `/api/platform/tenants/${TENANT_ID}/agencies` &&
        (init === undefined || init.method === undefined || init.method === 'GET'),
    );
    expect(agencyGets.length).toBeGreaterThanOrEqual(2);
  });

  it('shows a coordinate-free failure toast and leaves the list unchanged on add failure (R8.4)', async () => {
    mockInitialLoads();

    renderPanel();
    await screen.findByText('Cebu City Fire Station');

    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: false, error: 'invalid_agency' }, 400));

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'XY' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add agency' }));

    const errorToast = await screen.findByTestId('toast-error');
    expect(
      within(errorToast).getByText('Could not add the agency. Check the name, code and type.'),
    ).toBeTruthy();
    expect(COORD.test(errorToast.textContent ?? '')).toBe(false);

    // The pre-action list is unchanged: both seed agencies still present, no new row.
    expect(screen.getByText('Cebu City Fire Station')).toBeTruthy();
    expect(screen.getByText('Cebu City Police')).toBeTruthy();
    expect(screen.queryByText('City EMS')).toBeNull();
  });

  it('renames an agency inline via PATCH to the agency route (R3.5)', async () => {
    mockInitialLoads();

    renderPanel();
    await screen.findByText('Cebu City Fire Station');

    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ ok: true, agency: { ...AGENCY_BFP, name: 'Cebu Fire HQ' } }),
    );

    fireEvent.click(screen.getAllByRole('button', { name: /rename/i })[0] as HTMLElement);

    const nameInput = screen.getByDisplayValue('Cebu City Fire Station');
    fireEvent.change(nameInput, { target: { value: 'Cebu Fire HQ' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        `/api/platform/agencies/${AGENCY_BFP.id}`,
        expect.objectContaining({ method: 'PATCH' }),
      ),
    );

    expect(await screen.findByTestId('toast-success')).toBeTruthy();
  });

  it('gates deactivate behind ConfirmDialog, mutating only after confirm (R8.5)', async () => {
    mockInitialLoads();

    renderPanel();
    await screen.findByText('Cebu City Fire Station');

    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ ok: true, agency: { ...AGENCY_BFP, active: false } }),
    );

    fireEvent.click(screen.getAllByRole('button', { name: /deactivate/i })[0] as HTMLElement);

    // The confirm dialog appears; no PATCH yet.
    expect(await screen.findByText('Deactivate agency?')).toBeTruthy();
    expect(
      fetchSpy.mock.calls.some(([url]) => url === `/api/platform/agencies/${AGENCY_BFP.id}`),
    ).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        `/api/platform/agencies/${AGENCY_BFP.id}`,
        expect.objectContaining({ method: 'PATCH' }),
      ),
    );
  });

  it('aborts deactivate on cancel with no network call (R8.6)', async () => {
    mockInitialLoads();

    renderPanel();
    await screen.findByText('Cebu City Fire Station');

    const callsBefore = fetchSpy.mock.calls.length;

    fireEvent.click(screen.getAllByRole('button', { name: /deactivate/i })[0] as HTMLElement);
    expect(await screen.findByText('Deactivate agency?')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByText('Deactivate agency?')).toBeNull());

    // No agency mutation fired, and no net-new fetch beyond the initial loads.
    expect(
      fetchSpy.mock.calls.some(([url]) => url === `/api/platform/agencies/${AGENCY_BFP.id}`),
    ).toBe(false);
    expect(fetchSpy.mock.calls.length).toBe(callsBefore);
  });

  it('renders one capability row per frozen category, each with five Agency_Type toggles (R5.4)', async () => {
    mockInitialLoads();

    const { container } = renderPanel();
    await screen.findByText('Cebu City Fire Station');

    // Four frozen categories, identified by their t() display labels.
    expect(screen.getByText('Fire')).toBeTruthy();
    expect(screen.getByText('Medical')).toBeTruthy();
    expect(screen.getByText('Crime')).toBeTruthy();
    expect(screen.getByText('Flood')).toBeTruthy();

    // 4 categories x 5 Agency_Type checkboxes = 20 toggles in the capability editor.
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes.length).toBeGreaterThanOrEqual(20);
  });

  it('full-replace PATCHes the capability for one category when a type is toggled (R5.4)', async () => {
    mockInitialLoads();

    renderPanel();
    await screen.findByText('Cebu City Fire Station');

    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ ok: true, capability: { ...CAPABILITY, SUNOG: ['FIRE', 'DRRM'] } }),
    );

    // Toggle an Agency_Type on SUNOG (the Fire category row). The capability editor
    // exposes a labelled checkbox per (category, type); any one toggle PATCHes the full
    // replacement set for that single category.
    const sunogDrrm = screen.getByRole('checkbox', { name: /SUNOG.*DRRM|DRRM.*SUNOG/i });
    fireEvent.click(sunogDrrm);

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        `/api/platform/tenants/${TENANT_ID}/capability`,
        expect.objectContaining({ method: 'PATCH' }),
      ),
    );

    const patchCall = fetchSpy.mock.calls.find(
      ([url, init]) =>
        url === `/api/platform/tenants/${TENANT_ID}/capability` && init?.method === 'PATCH',
    );
    const body = JSON.parse(String(patchCall?.[1]?.body ?? '{}')) as {
      category?: string;
      agencyTypes?: string[];
    };
    expect(body.category).toBe('SUNOG');
    expect(Array.isArray(body.agencyTypes)).toBe(true);
  });

  it('allows an empty set: deselecting the last type still PATCHes an empty array (R5.9)', async () => {
    mockInitialLoads();

    renderPanel();
    await screen.findByText('Cebu City Fire Station');

    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ ok: true, capability: { ...CAPABILITY, SUNOG: [] } }),
    );

    // SUNOG starts as ['FIRE']; deselecting FIRE empties the set — still a valid PATCH.
    const sunogFire = screen.getByRole('checkbox', { name: /SUNOG.*FIRE|FIRE.*SUNOG/i });
    fireEvent.click(sunogFire);

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        `/api/platform/tenants/${TENANT_ID}/capability`,
        expect.objectContaining({ method: 'PATCH' }),
      ),
    );

    const patchCall = fetchSpy.mock.calls.find(
      ([url, init]) =>
        url === `/api/platform/tenants/${TENANT_ID}/capability` && init?.method === 'PATCH',
    );
    const body = JSON.parse(String(patchCall?.[1]?.body ?? '{}')) as {
      category?: string;
      agencyTypes?: string[];
    };
    expect(body.category).toBe('SUNOG');
    expect(body.agencyTypes).toEqual([]);
  });

  it('surfaces an "unavailable" toast when a load rejects (offline/timeout) (R8.7)', async () => {
    fetchSpy.mockRejectedValue(new Error('network down'));

    renderPanel();

    expect(await screen.findByTestId('toast-error')).toBeTruthy();
    expect(screen.getByText('Capability settings are unavailable')).toBeTruthy();
  });

  it('never renders or transmits a coordinate-shaped value (coordinate-free feature)', async () => {
    mockInitialLoads();

    const { container } = renderPanel();
    await screen.findByText('Cebu City Fire Station');

    expect(COORD.test(container.textContent ?? '')).toBe(false);
    for (const [, init] of fetchSpy.mock.calls) {
      const body = init?.body;
      if (typeof body === 'string') {
        expect(COORD.test(body)).toBe(false);
      }
    }
  });
});
