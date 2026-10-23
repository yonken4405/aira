import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CitizenTracking } from '../src/components/CitizenTracking';

const trackingClient = vi.hoisted(() => ({ load: vi.fn() }));

vi.mock('../src/lib/tracking-client', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/tracking-client')>(
    '../src/lib/tracking-client',
  );
  return { ...actual, loadIncidentTracking: trackingClient.load };
});

beforeEach(() => {
  trackingClient.load.mockReset();
});

describe('CitizenTracking', () => {
  it('renders the status timeline and the assigned unit', async () => {
    trackingClient.load.mockResolvedValue({
      incidentId: 'i1',
      status: 'EN_ROUTE',
      assignedToCallsign: 'K9-01',
      position: { lat: 10.33, lon: 123.9, updatedAt: 1000, fresh: true },
    });

    render(<CitizenTracking incidentId="i1" token="tok" />);

    expect(await screen.findByTestId('track-timeline')).toBeTruthy();
    expect(screen.getByText('Unit en route')).toBeTruthy();
    expect(screen.getByTestId('track-unit').textContent).toContain('K9-01');
    await waitFor(() => expect(trackingClient.load).toHaveBeenCalledWith('i1', { token: 'tok' }));
  });

  it('shows a resolved banner when the incident is resolved', async () => {
    trackingClient.load.mockResolvedValue({
      incidentId: 'i1',
      status: 'RESOLVED',
      assignedToCallsign: 'K9-01',
      position: null,
    });

    render(<CitizenTracking incidentId="i1" token="tok" />);
    expect(await screen.findByTestId('track-resolved')).toBeTruthy();
  });

  it('shows an expired state on a 401', async () => {
    trackingClient.load.mockRejectedValue(new Error('tracking_request_failed_401'));

    render(<CitizenTracking incidentId="i1" token="bad" />);
    expect(await screen.findByText('This tracking link has expired')).toBeTruthy();
  });

  it('shows an unavailable state on a transient error with no prior data', async () => {
    trackingClient.load.mockRejectedValue(new Error('tracking_request_failed_503'));

    render(<CitizenTracking incidentId="i1" token="tok" />);
    await waitFor(() =>
      expect(screen.getByTestId('track-status').textContent).toContain('No signal'),
    );
  });

  it('marks a stale position as last seen', async () => {
    trackingClient.load.mockResolvedValue({
      incidentId: 'i1',
      status: 'EN_ROUTE',
      assignedToCallsign: 'K9-01',
      position: { lat: 10.33, lon: 123.9, updatedAt: 1000, fresh: false },
    });

    render(<CitizenTracking incidentId="i1" token="tok" />);
    await waitFor(() =>
      expect(screen.getByTestId('track-position').textContent).toContain('last seen'),
    );
  });
});
