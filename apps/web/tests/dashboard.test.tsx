import { ToastProvider } from '@aira/ui/web';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Dashboard } from '../src/components/Dashboard';
import { loadIncidents } from '../src/lib/incidents-client';
import type { Viewer } from '../src/lib/auth/types';
import {
  DISPATCHER_VIEWER,
  MOCK_INCIDENTS,
  RESPONDER_VIEWER,
  makeIncident,
} from './support/fixtures';

// The WebGL map is not renderable in jsdom - component behavior is tested without it.
// The stub surfaces the responder marker prop so live-tracking wiring can be asserted.
vi.mock('../src/components/LiveMap', () => ({
  LiveMap: ({ responder }: { responder?: { callsign: string | null } | null }) => (
    <div data-testid="live-map" data-responder={responder?.callsign ?? ''} />
  ),
}));

// Keep the data layer deterministic; the cache itself is covered by cache/client tests.
vi.mock('../src/lib/incidents-client', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/incidents-client')>(
    '../src/lib/incidents-client',
  );
  return { ...actual, loadIncidents: vi.fn() };
});

const nav = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace, refresh: nav.refresh, push: vi.fn() }),
  usePathname: () => '/console',
}));

const respondersClient = vi.hoisted(() => ({ load: vi.fn() }));

vi.mock('../src/lib/responders-client', () => ({
  loadAssignableResponders: respondersClient.load,
}));

const routingClient = vi.hoisted(() => ({ load: vi.fn() }));

vi.mock('../src/lib/routing-client', () => ({
  loadRoutingSuggestions: routingClient.load,
}));

const trackingClient = vi.hoisted(() => ({ load: vi.fn() }));

vi.mock('../src/lib/tracking-client', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/tracking-client')>(
    '../src/lib/tracking-client',
  );
  return { ...actual, loadIncidentTracking: trackingClient.load };
});

const mockLoad = vi.mocked(loadIncidents);

const ASSIGNABLE = [
  {
    id: 'responder-field',
    callsign: 'K9-01',
    role: 'RESPONDER' as const,
    officeName: 'Cebu City DRRMO',
    agencyName: 'Bureau of Fire Protection',
  },
  {
    id: 'responder-field-2',
    callsign: 'K9-02',
    role: 'RESPONDER' as const,
    officeName: 'Cebu City DRRMO',
    agencyName: null,
  },
];

const renderDashboard = (viewer: Viewer = DISPATCHER_VIEWER) =>
  render(
    <ToastProvider>
      <Dashboard viewer={viewer} />
    </ToastProvider>,
  );

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));

beforeEach(() => {
  vi.stubGlobal('fetch', fetchSpy);
  fetchSpy.mockClear();
  nav.replace.mockClear();
  nav.refresh.mockClear();

  respondersClient.load.mockReset();
  respondersClient.load.mockResolvedValue(ASSIGNABLE);

  trackingClient.load.mockReset();
  trackingClient.load.mockResolvedValue(null);

  routingClient.load.mockReset();
  routingClient.load.mockResolvedValue([
    {
      id: 'responder-field',
      callsign: 'K9-01',
      agencyName: 'Bureau of Fire Protection',
      officeName: 'Cebu City DRRMO',
      capable: true,
      distanceKm: 1.2,
    },
  ]);

  mockLoad.mockReset();
  mockLoad.mockResolvedValue({ incidents: MOCK_INCIDENTS, source: 'network' });
});

describe('Responder dashboard', () => {
  it('shows layout skeletons while the queue loads, then the real rows', async () => {
    const pending = deferred<Awaited<ReturnType<typeof loadIncidents>>>();
    mockLoad.mockReturnValueOnce(pending.promise);

    renderDashboard();

    expect(screen.getByTestId('queue-skeleton')).toBeTruthy();
    expect(screen.getByTestId('map-skeleton')).toBeTruthy();
    expect(screen.getByTestId('routing-skeleton')).toBeTruthy();

    await act(async () => {
      pending.resolve({ incidents: MOCK_INCIDENTS, source: 'network' });
    });

    expect(await screen.findByTestId('queue-row-mesh-1001')).toBeTruthy();
    expect(screen.queryByTestId('queue-skeleton')).toBeNull();
    expect(screen.getByTestId('live-map')).toBeTruthy();
  });

  it('labels the queue in English (Bisaya stays as secondary text)', async () => {
    renderDashboard();
    await screen.findByTestId('queue-row-mesh-1001');

    for (const english of ['Fire', 'Medical', 'Crime', 'Flood']) {
      expect(screen.getAllByText(english).length).toBeGreaterThan(0);
    }
    for (const bisaya of ['Sunog', 'Medikal', 'Krimen', 'Baha']) {
      expect(screen.getAllByText(bisaya).length).toBeGreaterThan(0);
    }
  });

  it('shows the decoded mesh payload of the selected incident', async () => {
    renderDashboard();
    await screen.findByTestId('queue-row-mesh-1001');

    expect(screen.getByText('["SUNOG",10.3157,123.8854]')).toBeTruthy();
    expect(screen.getByText('Responder routing')).toBeTruthy();
  });

  it('updates the routing panel when another incident is selected', async () => {
    renderDashboard();
    await screen.findByTestId('queue-row-mesh-1001');

    fireEvent.click(screen.getByTestId('queue-row-mesh-1003'));

    expect(await screen.findByText('["KRIMEN",10.2965,123.902]')).toBeTruthy();
  });

  it('filters the queue by category', async () => {
    renderDashboard();
    await screen.findByTestId('queue-row-mesh-1001');

    fireEvent.click(screen.getByRole('button', { name: 'Flood' }));

    expect(screen.getByTestId('queue-row-mesh-1004')).toBeTruthy();
    expect(screen.queryByTestId('queue-row-mesh-1001')).toBeNull();
  });

  it('owns the live-status toolbar (queued count and refresh), not identity or sign-out', async () => {
    // Identity + sign-out moved into the shared App_Shell header (R3.2), which the
    // console layout owns and app-shell.test.tsx covers. The Dashboard body now only
    // renders the dispatch live-status toolbar, so it must NOT render those controls.
    renderDashboard();
    await screen.findByTestId('queue-row-mesh-1001');

    expect(screen.getByRole('button', { name: /refresh/i })).toBeTruthy();
    expect(screen.getByText('Mesh link: standby')).toBeTruthy();

    expect(screen.queryByText('OPCEN-01')).toBeNull();
    expect(screen.queryByRole('button', { name: /sign out/i })).toBeNull();
  });

  it('polls and renders the assigned unit live position on the map', async () => {
    mockLoad.mockResolvedValue({
      incidents: [
        makeIncident({
          id: 'mesh-dispatched',
          category: 'MEDIKAL',
          status: 'EN_ROUTE',
          assignedToId: 'responder-field',
          assignedToCallsign: 'K9-01',
        }),
      ],
      source: 'network',
    });
    trackingClient.load.mockResolvedValue({
      incidentId: 'mesh-dispatched',
      status: 'EN_ROUTE',
      assignedToCallsign: 'K9-01',
      position: { lat: 10.33, lon: 123.9, updatedAt: 1000, fresh: true },
    });

    renderDashboard();
    await screen.findByTestId('queue-row-mesh-dispatched');

    await waitFor(() => expect(trackingClient.load).toHaveBeenCalledWith('mesh-dispatched'));
    await waitFor(() =>
      expect(screen.getByTestId('live-map').getAttribute('data-responder')).toBe('K9-01'),
    );
  });

  it('does not track a resolved incident', async () => {
    mockLoad.mockResolvedValue({
      incidents: [
        makeIncident({
          id: 'mesh-resolved',
          category: 'MEDIKAL',
          status: 'RESOLVED',
          assignedToId: 'responder-field',
          assignedToCallsign: 'K9-01',
          resolvedAt: '2026-10-22T08:00:00.000Z',
        }),
      ],
      source: 'network',
    });

    renderDashboard();
    await screen.findByTestId('queue-row-mesh-resolved');

    // The poll never fires for a resolved incident (grant auto-revoke).
    expect(trackingClient.load).not.toHaveBeenCalled();
  });

  it('offers a Google Maps navigate deep-link with only the destination coordinates', async () => {
    renderDashboard();
    await screen.findByTestId('queue-row-mesh-1001');

    const link = (await screen.findByTestId('navigate-link')) as HTMLAnchorElement;
    const url = new URL(link.href);
    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/dir/');
    expect(url.searchParams.get('destination')).toBe('10.3157,123.8854');
    // No PII in the hand-off: only the three navigation params.
    expect([...url.searchParams.keys()].sort()).toEqual(['api', 'destination', 'travelmode']);
  });

  it('shows ranked nearest-unit suggestions to a dispatcher', async () => {
    renderDashboard();
    await screen.findByTestId('queue-row-mesh-1001');

    expect(await screen.findByTestId('routing-suggestion-responder-field')).toBeTruthy();
    expect(screen.getByText('Nearest units')).toBeTruthy();
    await waitFor(() => expect(routingClient.load).toHaveBeenCalledWith('mesh-1001'));
  });

  it('assigns the selected unit after confirmation and reports success', async () => {
    renderDashboard();
    await screen.findByTestId('queue-row-mesh-1001');

    await waitFor(() => expect(respondersClient.load).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Assign' }));

    expect(await screen.findByText('Assign this incident?')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm assignment' }));

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/incidents/mesh-1001/assign',
        expect.objectContaining({ method: 'POST' }),
      ),
    );

    expect(await screen.findByTestId('toast-success')).toBeTruthy();
    expect(screen.getByText('K9-01 assigned to mesh-1001.')).toBeTruthy();
  });

  it('reports a failed assignment back through the toast system', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ ok: false }), { status: 403 }));

    renderDashboard();
    await screen.findByTestId('queue-row-mesh-1001');
    await waitFor(() => expect(respondersClient.load).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Assign' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm assignment' }));

    expect(await screen.findByTestId('toast-error')).toBeTruthy();
  });

  it('lets a dispatcher advance a queued incident to resolved', async () => {
    renderDashboard();
    await screen.findByTestId('queue-row-mesh-1001');

    fireEvent.click(screen.getByRole('button', { name: 'Resolved' }));

    // Resolving is confirmation-gated (R18.2): confirm the dialog before the POST.
    await screen.findByRole('alertdialog');
    const confirm = screen
      .getAllByRole('button')
      .find((b) => /confirm|resolve/i.test(b.textContent ?? ''));
    fireEvent.click(confirm as HTMLElement);

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/incidents/mesh-1001/status',
        expect.objectContaining({ method: 'POST' }),
      ),
    );

    expect(await screen.findByTestId('toast-success')).toBeTruthy();
  });

  it('hides dispatch controls from field responders', async () => {
    mockLoad.mockResolvedValue({
      incidents: [
        makeIncident({
          id: 'own-1',
          category: 'SUNOG',
          status: 'DISPATCHED',
          assignedToId: 'responder-field',
          assignedToCallsign: 'K9-01',
        }),
      ],
      source: 'network',
    });

    renderDashboard(RESPONDER_VIEWER);

    expect(await screen.findByTestId('queue-row-own-1')).toBeTruthy();
    expect(screen.queryByLabelText('Assign to')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Assign' })).toBeNull();

    // The responder can still report field status for their own assignment.
    fireEvent.click(screen.getByRole('button', { name: 'En route' }));

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/incidents/own-1/status',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('redirects to sign-in when the session has expired', async () => {
    const { IncidentsRequestError } = await vi.importActual<
      typeof import('../src/lib/incidents-client')
    >('../src/lib/incidents-client');

    mockLoad.mockRejectedValueOnce(new IncidentsRequestError(401));

    renderDashboard();

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/login?next=/console'));
    expect(await screen.findByTestId('toast-error')).toBeTruthy();
  });

  it('surfaces a blocking load failure with a retry action', async () => {
    mockLoad.mockRejectedValueOnce(new Error('offline'));
    mockLoad.mockResolvedValue({ incidents: MOCK_INCIDENTS, source: 'network' });

    renderDashboard();

    expect(await screen.findByTestId('load-error')).toBeTruthy();
    expect(await screen.findByTestId('toast-error')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByTestId('queue-row-mesh-1001')).toBeTruthy();
  });

  it('never renders conversational or voice affordances', async () => {
    renderDashboard();
    await screen.findByTestId('queue-row-mesh-1001');

    expect(screen.queryByText(/microphone|voice input|transcript|chat/i)).toBeNull();
  });

  it('renders plain punctuation, no em or en dashes', async () => {
    const { container } = renderDashboard();
    await screen.findByTestId('queue-row-mesh-1001');

    expect(container.textContent ?? '').not.toMatch(/[\u2014\u2013]/);
  });
});
