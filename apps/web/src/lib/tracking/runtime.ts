/**
 * Server-side wiring for the tracking service.
 */

import { isDatabaseConfigured } from '../db';
import { createPostgresTrackingStore } from './postgres-store';
import type { TrackingServiceDeps } from './service';
import type { TrackingStore } from './store';

let store: TrackingStore | null = null;

export function getTrackingDeps(): TrackingServiceDeps {
  if (!isDatabaseConfigured()) {
    throw new Error('database_not_configured');
  }
  if (!store) {
    store = createPostgresTrackingStore();
  }
  return { store, now: () => Date.now() };
}
