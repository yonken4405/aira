/**
 * Server-side wiring for the auth service.
 *
 * Kept separate from the service so tests can inject a memory store and a fake
 * clock, and so importing the service never opens a database connection.
 */

import { isDatabaseConfigured } from '../db';
import { createPostgresAuthStore } from './postgres-store';
import type { AuthServiceDeps } from './service';
import type { AuthStore } from './types';

export class ServiceUnavailableError extends Error {
  constructor(message = 'database_not_configured') {
    super(message);
    this.name = 'ServiceUnavailableError';
  }
}

let store: AuthStore | null = null;

export function getAuthStore(): AuthStore {
  if (!store) {
    if (!isDatabaseConfigured()) {
      throw new ServiceUnavailableError();
    }
    store = createPostgresAuthStore();
  }
  return store;
}

export function getAuthDeps(): AuthServiceDeps {
  return {
    store: getAuthStore(),
    now: () => Date.now(),
    secureCookies: process.env.NODE_ENV === 'production',
  };
}
