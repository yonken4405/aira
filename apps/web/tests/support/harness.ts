/**
 * Handler-test harness: real service + handlers, memory stores, injected clock.
 */

import type { AppDeps } from '../../src/lib/api/deps';
import { createRateLimiter } from '../../src/lib/rate-limit';
import { createMemoryAuthStore, type MemoryAuthStore } from './memory-auth-store';
import { createMemoryCitizenStore, type MemoryCitizenStore } from './memory-citizen-store';
import { createMemoryIncidentsStore, type MemoryIncidentsStore } from './memory-incidents-store';
import { createMemoryMedicalStore, type MemoryMedicalStore } from './memory-medical-store';
import {
  createMemoryNotificationStore,
  type MemoryNotificationStore,
} from './memory-notification-store';
import { createMemoryTrackingStore, type MemoryTrackingStore } from './memory-tracking-store';
import { createMemoryPlatformStore, type MemoryPlatformStore } from './memory-platform-store';

export interface TestClock {
  now(): number;
  advance(ms: number): void;
}

export function createTestClock(start = Date.UTC(2026, 9, 22, 8, 0, 0)): TestClock {
  let current = start;
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    },
  };
}

export interface TestHarness {
  readonly deps: AppDeps;
  readonly clock: TestClock;
  readonly authStore: MemoryAuthStore;
  readonly citizenStore: MemoryCitizenStore;
  readonly medicalStore: MemoryMedicalStore;
  readonly trackingStore: MemoryTrackingStore;
  readonly platformStore: MemoryPlatformStore;
  readonly notificationStore: MemoryNotificationStore;
  readonly incidents: MemoryIncidentsStore;
}

/** Deterministic 32-byte key for the medical encryption in tests only. */
const TEST_MEDICAL_KEY = Buffer.alloc(32, 7);

export function createTestHarness(options?: {
  readonly clock?: TestClock;
  readonly authStore?: MemoryAuthStore;
  readonly citizenStore?: MemoryCitizenStore;
  readonly medicalStore?: MemoryMedicalStore;
  readonly trackingStore?: MemoryTrackingStore;
  readonly platformStore?: MemoryPlatformStore;
  readonly notificationStore?: MemoryNotificationStore;
  readonly incidents?: MemoryIncidentsStore;
}): TestHarness {
  const clock = options?.clock ?? createTestClock();
  const authStore = options?.authStore ?? createMemoryAuthStore({ now: clock.now });
  const citizenStore = options?.citizenStore ?? createMemoryCitizenStore({ now: clock.now });
  const medicalStore = options?.medicalStore ?? createMemoryMedicalStore(clock.now);
  const trackingStore = options?.trackingStore ?? createMemoryTrackingStore();
  const platformStore = options?.platformStore ?? createMemoryPlatformStore(clock.now);
  const notificationStore = options?.notificationStore ?? createMemoryNotificationStore();
  const incidents =
    options?.incidents ??
    createMemoryIncidentsStore({
      now: clock.now,
      responders: { 'responder-dispatcher': 'OPCEN-01', 'responder-field': 'K9-01' },
    });

  const deps: AppDeps = {
    auth: { store: authStore, now: clock.now, secureCookies: false },
    authStore,
    citizen: { store: citizenStore, now: clock.now, secureCookies: false },
    medical: { store: medicalStore, key: TEST_MEDICAL_KEY },
    tracking: { store: trackingStore, now: clock.now },
    platform: {
      store: platformStore,
      now: clock.now,
      secureCookies: false,
      auth: { store: authStore, now: clock.now, secureCookies: false },
    },
    notifications: {
      store: notificationStore,
      email: null,
      webPush: null,
      now: clock.now,
      emailAddressFor: async () => null,
    },
    incidents,
    now: clock.now,
    secureCookies: false,
    loginLimiter: createRateLimiter({ capacity: 20, windowMs: 60_000, now: clock.now }),
    intakeLimiter: createRateLimiter({ capacity: 30, windowMs: 60_000, now: clock.now }),
  };

  return {
    deps,
    clock,
    authStore,
    citizenStore,
    medicalStore,
    trackingStore,
    platformStore,
    notificationStore,
    incidents,
  };
}

/** Builds a request carrying the session cookie, as a browser would send it. */
export function withSession(url: string, token: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set('cookie', `aira_session=${token}`);

  return new Request(url, { ...init, headers });
}

export function jsonBody(
  method: string,
  body: unknown,
  headers: Record<string, string> = {},
): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  };
}
