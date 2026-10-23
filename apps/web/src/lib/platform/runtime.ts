/**
 * Server-side wiring for the platform-operator service.
 */

import { getAuthDeps } from '../auth/runtime';
import { isDatabaseConfigured } from '../db';
import { createPostgresPlatformStore } from './postgres-store';
import type { PlatformServiceDeps } from './service';
import type { PlatformStore } from './types';

let store: PlatformStore | null = null;

export function getPlatformStore(): PlatformStore {
  if (!store) {
    if (!isDatabaseConfigured()) {
      throw new Error('database_not_configured');
    }
    store = createPostgresPlatformStore();
  }
  return store;
}

export function getPlatformDeps(): PlatformServiceDeps {
  return {
    store: getPlatformStore(),
    now: () => Date.now(),
    secureCookies: process.env.NODE_ENV === 'production',
    auth: getAuthDeps(),
  };
}
