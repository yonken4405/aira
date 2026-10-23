import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CitizenTracking } from '../src/components/CitizenTracking';
import { PlatformMap } from '../src/components/PlatformMap';

/**
 * Task 32.1 (RED) — Consistent loading states across async surfaces (R19.1–R19.5).
 *
 * These tests are written FIRST and MUST FAIL against today's code. Task 32.2 makes
 * them green by adding the two new skeletons + route-level `loading.tsx` files and by
 * wiring the map/tracking surfaces to render a layout-shaped skeleton while loading and
 * a `LoadError`-style retry control on failure.
 *
 * ──────────────────────────────────────────────────────────────────────────────────
 * CONTRACT FOR TASK 32.2 — testids the implementation must expose
 * ──────────────────────────────────────────────────────────────────────────────────
 *   - data-testid="platform-map-skeleton"  → PlatformMap renders this (via the new
 *     PlatformMapSkeleton in src/components/loading.tsx) while loadOfficePins() is
 *     in flight, instead of mounting an empty map. (R19.3, R19.5)
 *   - data-testid="tracking-skeleton"       → CitizenTracking renders this (via the new
 *     CitizenTrackingSkeleton in src/components/loading.tsx) during the 'loading' phase
 *     instead of the plain "track-status" text. (R19.3, R19.5)
 *   - CitizenTracking's 'unavailable' phase (transient failure, no prior data) must
 *     show the shared LoadError retry affordance — a control named /retry/i — not just
 *     the "track-status" text. (R19.4)
 *
 * ──────────────────────────────────────────────────────────────────────────────────
 * CONTRACT FOR TASK 32.2 — route-level loading.tsx files that must exist (R19.2)
 * ──────────────────────────────────────────────────────────────────────────────────
 * One `loading.tsx` per async App-Router segment (console / admin tabs / platform /
 * platform-map / track / profile / settings / account-password):
 *   app/console/loading.tsx
 *   app/console/profile/loading.tsx
 *   app/console/settings/loading.tsx
 *   app/admin/loading.tsx
 *   app/admin/dashboards/loading.tsx
 *   app/admin/audit/loading.tsx
 *   app/admin/profile/loading.tsx
 *   app/admin/settings/loading.tsx
 *   app/platform/loading.tsx
 *   app/platform/map/loading.tsx
 *   app/platform/profile/loading.tsx
 *   app/platform/settings/loading.tsx
 *   app/track/[id]/loading.tsx
 *   app/account/password/loading.tsx
 * ──────────────────────────────────────────────────────────────────────────────────
 */

// The WebGL map is not renderable in jsdom. Mirror dashboard.test.tsx's LiveMap stub:
// stub react-map-gl/maplibre so PlatformMap mounts without a real map context.
vi.mock('react-map-gl/maplibre', () => ({
  default: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="map-gl">{children}</div>
  ),
  Marker: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

const platformClient = vi.hoisted(() => ({ load: vi.fn() }));

vi.mock('../src/lib/platform-client', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/platform-client')>(
    '../src/lib/platform-client',
  );
  return { ...actual, loadOfficePins: platformClient.load };
});

const trackingClient = vi.hoisted(() => ({ load: vi.fn() }));

vi.mock('../src/lib/tracking-client', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/tracking-client')>(
    '../src/lib/tracking-client',
  );
  return { ...actual, loadIncidentTracking: trackingClient.load };
});

/** A promise that never settles — holds the component in its loading phase. */
const pending = <T,>(): Promise<T> => new Promise<T>(() => {});

beforeEach(() => {
  platformClient.load.mockReset();
  trackingClient.load.mockReset();
});

describe('Loading states (R19)', () => {
  describe('PlatformMap skeleton (R19.3, R19.5)', () => {
    it('shows a layout-shaped map skeleton while office pins load', () => {
      platformClient.load.mockReturnValue(pending());

      render(<PlatformMap />);

      // RED today: PlatformMap mounts an empty map with no skeleton placeholder.
      expect(screen.getByTestId('platform-map-skeleton')).toBeTruthy();
    });
  });

  describe('CitizenTracking skeleton (R19.3, R19.5)', () => {
    it('shows a layout-shaped tracking skeleton during the loading phase', () => {
      trackingClient.load.mockReturnValue(pending());

      render(<CitizenTracking incidentId="i1" token="tok" />);

      // RED today: the loading phase renders only the plain "track-status" text.
      expect(screen.getByTestId('tracking-skeleton')).toBeTruthy();
    });
  });

  describe('LoadError retry on async failure (R19.4)', () => {
    it('offers a retry control when tracking is unavailable with no prior data', async () => {
      trackingClient.load.mockRejectedValue(new Error('tracking_request_failed_503'));

      render(<CitizenTracking incidentId="i1" token="tok" />);

      // RED today: the 'unavailable' phase renders text only, with no retry affordance.
      expect(await screen.findByRole('button', { name: /retry/i })).toBeTruthy();
    });

    it('offers a retry control when the platform map fails to load its pins', async () => {
      platformClient.load.mockRejectedValue(new Error('offices_request_failed_503'));

      render(<PlatformMap />);

      // RED today: on failure PlatformMap silently falls back to an empty map.
      await waitFor(() => expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy());
    });
  });

  describe('Route-level loading.tsx for every async segment (R19.2)', () => {
    const APP_DIR = resolve(__dirname, '..', 'app');

    // Task 32.2 must create one loading.tsx per async route segment.
    const REQUIRED_LOADING_FILES = [
      'console/loading.tsx',
      'console/profile/loading.tsx',
      'console/settings/loading.tsx',
      'admin/loading.tsx',
      'admin/dashboards/loading.tsx',
      'admin/audit/loading.tsx',
      'admin/profile/loading.tsx',
      'admin/settings/loading.tsx',
      'platform/loading.tsx',
      'platform/map/loading.tsx',
      'platform/profile/loading.tsx',
      'platform/settings/loading.tsx',
      'track/[id]/loading.tsx',
      'account/password/loading.tsx',
    ] as const;

    it.each(REQUIRED_LOADING_FILES)('provides app/%s', (relativePath) => {
      // RED today: no route-level loading.tsx files exist yet.
      expect(existsSync(resolve(APP_DIR, relativePath))).toBe(true);
    });
  });
});
