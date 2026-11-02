/**
 * Minimal runtime config for the mobile app (mobile-citizen-account spec, task 13.2).
 *
 * The only value the app needs at launch is the citizen backend base URL. It is read
 * from the public env var `EXPO_PUBLIC_AIRA_API_BASE` (injected at build time by Expo),
 * falling back to a local HTTPS dev host when unset. The real `CitizenApiClient` enforces
 * HTTPS outside development, so a release build MUST provide an https base.
 *
 * This is deliberately tiny: tests always inject a `client`/`store` pair into
 * `AppNavigator`, so this helper only matters for the real app.
 */

/** `__DEV__` is a React Native global; declare it so we can read it defensively. */
declare const __DEV__: boolean | undefined;

function isDevelopment(): boolean {
  return typeof __DEV__ === 'boolean' ? __DEV__ : false;
}

/** The default dev host used when no env var is provided. */
const DEV_FALLBACK_BASE = 'https://localhost:3000';

/** The citizen backend base URL for the real app (release builds must supply https). */
export function apiBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_AIRA_API_BASE;
  if (typeof fromEnv === 'string' && fromEnv.length > 0) {
    return fromEnv;
  }
  return DEV_FALLBACK_BASE;
}

export { isDevelopment };
