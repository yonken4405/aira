/**
 * Server-side wiring for the citizen service. Mirrors `auth/runtime` so tests inject a
 * memory store + fake clock and importing the service never opens a connection.
 */

import { isDatabaseConfigured } from '../db';
import { createPostgresCitizenStore } from './postgres-store';
import type { CitizenServiceDeps } from './service';
import type { CitizenStore } from './types';

let store: CitizenStore | null = null;

export function getCitizenStore(): CitizenStore {
  if (!store) {
    if (!isDatabaseConfigured()) {
      throw new Error('database_not_configured');
    }
    store = createPostgresCitizenStore();
  }
  return store;
}

export function getCitizenDeps(): CitizenServiceDeps {
  return {
    store: getCitizenStore(),
    now: () => Date.now(),
    secureCookies: process.env.NODE_ENV === 'production',
  };
}
