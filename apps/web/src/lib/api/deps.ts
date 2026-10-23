/**
 * Request-scoped dependencies for the API handlers.
 *
 * Handlers receive this object instead of importing Postgres directly, which is what
 * keeps the whole API testable without a database (TESTING.md §4.3).
 */

import { getAuthDeps } from '../auth/runtime';
import type { AuthServiceDeps } from '../auth/service';
import type { AuthStore } from '../auth/types';
import { getCitizenDeps } from '../citizen/runtime';
import type { CitizenServiceDeps } from '../citizen/service';
import { isDatabaseConfigured } from '../db';
import { createPostgresIncidentsStore, type IncidentsStore } from '../incidents-store';
import { getMedicalDeps } from '../medical/runtime';
import type { MedicalServiceDeps } from '../medical/service';
import { getNotificationDeps } from '../notifications/runtime';
import type { NotificationServiceDeps } from '../notifications/service';
import { getPlatformDeps } from '../platform/runtime';
import type { PlatformServiceDeps } from '../platform/service';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import { getTrackingDeps } from '../tracking/runtime';
import type { TrackingServiceDeps } from '../tracking/service';

export interface AppDeps {
  readonly auth: AuthServiceDeps;
  readonly authStore: AuthStore;
  readonly citizen: CitizenServiceDeps;
  readonly medical: MedicalServiceDeps;
  readonly tracking: TrackingServiceDeps;
  readonly platform: PlatformServiceDeps;
  readonly notifications: NotificationServiceDeps;
  readonly incidents: IncidentsStore;
  readonly now: () => number;
  readonly secureCookies: boolean;
  readonly loginLimiter: RateLimiter;
  readonly intakeLimiter: RateLimiter;
}

let deps: AppDeps | null = null;

/** Null when `DATABASE_URL` is missing, so routes answer 503 instead of crashing. */
export function getAppDeps(): AppDeps | null {
  if (!isDatabaseConfigured()) {
    return null;
  }

  if (!deps) {
    const auth = getAuthDeps();
    deps = {
      auth,
      authStore: auth.store,
      citizen: getCitizenDeps(),
      medical: getMedicalDeps(),
      tracking: getTrackingDeps(),
      platform: getPlatformDeps(),
      notifications: getNotificationDeps(),
      incidents: createPostgresIncidentsStore(),
      now: () => Date.now(),
      secureCookies: process.env.NODE_ENV === 'production',
      loginLimiter: createRateLimiter({ capacity: 10, windowMs: 60_000 }),
      intakeLimiter: createRateLimiter({ capacity: 30, windowMs: 60_000 }),
    };
  }

  return deps;
}
