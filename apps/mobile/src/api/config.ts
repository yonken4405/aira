/**
 * Runtime configuration for the citizen API (R12.4).
 *
 * The base URL comes from Expo config `extra.citizenApiBase` (or the
 * `EXPO_PUBLIC_CITIZEN_API_BASE` env value inlined by Expo). Release builds must use
 * HTTPS; the client refuses a plain-HTTP base outside development.
 */

import Constants from 'expo-constants';

/** Development fallback: the local Next.js console. Never used in a release build. */
export const DEV_CITIZEN_API_BASE = 'http://localhost:3000';

/** Resolves the configured citizen API base URL. */
export function resolveCitizenApiBase(): string {
  const fromExtra = Constants.expoConfig?.extra?.['citizenApiBase'];
  if (typeof fromExtra === 'string' && fromExtra.length > 0) {
    return fromExtra;
  }

  return DEV_CITIZEN_API_BASE;
}
