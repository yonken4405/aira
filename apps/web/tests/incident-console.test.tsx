import { ToastProvider } from '@aira/ui/web';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// IncidentConsole does NOT exist yet (task 10.2 extracts it). The failing import below
// is the red state for the test-first task 10.1: the shared map+queue component that
// both /console (interactive) and admin (read-only) must mount from a single definition.
import { IncidentConsole } from '../src/components/IncidentConsole';
import { RESPONDER_ORIGIN } from '../src/lib/incidents';
import { MOCK_INCIDENTS } from './support/fixtures';

// The WebGL map is not renderable in jsdom. The stub surfaces a stable map region and
// the incident ids it received so the reuse contract (map renders from injected data)
// can be asserted without pulling in maplibre. Mirrors tests/dashboard.test.tsx.
vi.mock('../src/components/LiveMap', () => ({
  LiveMap: ({ incidents }: { incidents: readonly { id: string }[] }) => (
    <div data-testid="live-map" data-incident-count={incidents.length} />
  ),
}));

// Keep the live-position poll deterministic and off the network, exactly like the
// dashboard test: useLivePosition calls loadIncidentTracking, which we stub to null so
// no fetch and no maplibre responder marker is exercised here.
const trackingClient = vi.hoisted(() => ({ load: vi.fn() }));

vi.mock('../src/lib/tracking-client', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/tracking-client')>(
    '../src/lib/tracking-client',
  );
  return { ...actual, loadIncidentTracking: trackingClient.load };
});

// Routing data clients are stubbed so the interactive (routing/controls) mode can mount
// without the network. In read-only mode they must never produce visible controls.
const respondersClient = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('../src/lib/responders-client', () => ({
  loadAssignableResponders: respondersClient.load,
}));

const routingClient = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('../src/lib/routing-client', () => ({
  loadRoutingSuggestions: routingClient.load,
}));

const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));

beforeEach(() => {
  vi.stubGlobal('fetch', fetchSpy);
  fetchSpy.mockClear();

  trackingClient.load.mockReset();
  trackingClient.load.mockResolvedValue(null);

  respondersClient.load.mockReset();
  respondersClient.load.mockResolvedValue([]);

  routingClient.load.mockReset();
  routingClient.load.mockResolvedValue([]);
});

const renderConsole = (props: Record<string, unknown>) =>
  render(
    <ToastProvider>
      <IncidentConsole
        incidents={MOCK_INCIDENTS}
        origin={RESPONDER_ORIGIN}
        {...(props as object)}
      />
    </ToastProvider>,
  );

describe('IncidentConsole (shared map + queue, R4.4)', () => {
  it('renders the queue region from the injected incidents', () => {
    renderConsole({ readOnly: true });

    // Every injected incident surfaces as a queue row - the queue is driven by props.
    for (const incident of MOCK_INCIDENTS) {
      expect(screen.getByTestId(`queue-row-${incident.id}`)).toBeTruthy();
    }
  });

  it('renders the map region from the injected incidents', () => {
    renderConsole({ readOnly: true });

    const map = screen.getByTestId('live-map');
    expect(map).toBeTruthy();
    // The map is fed the same incident set as the queue (single shared definition).
    expect(map.getAttribute('data-incident-count')).toBe(String(MOCK_INCIDENTS.length));
  });

  it('hides assign and status controls in read-only (admin oversight) mode', () => {
    renderConsole({ readOnly: true });

    expect(screen.queryByRole('button', { name: 'Assign' })).toBeNull();
    expect(screen.queryByLabelText('Assign to')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Resolved' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'En route' })).toBeNull();
  });

  it('exposes routing/controls in interactive (/console) mode', () => {
    // Interactive mode is the console surface: a dispatcher can assign and advance
    // status. The single component must support both modes from one definition.
    renderConsole({ readOnly: false, canAssign: true, canUpdateStatus: true });

    expect(screen.getByRole('button', { name: 'Assign' })).toBeTruthy();
  });
});
