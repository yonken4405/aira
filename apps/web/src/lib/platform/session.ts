/**
 * Platform-operator session cookie. Distinct cookie name from responders and citizens
 * so the three tiers can never be confused; reuses the opaque-token primitives.
 */

import { SESSION_ABSOLUTE_MS, type SessionCookieOptions } from '../auth/session';

export const PLATFORM_SESSION_COOKIE = 'aira_platform_session';

export function serializePlatformSessionCookie(
  token: string,
  options: SessionCookieOptions,
): string {
  const maxAge = Math.floor(SESSION_ABSOLUTE_MS / 1000);
  return [
    `${PLATFORM_SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    ...(options.secure ? ['Secure'] : []),
  ].join('; ');
}

export function serializeClearedPlatformSessionCookie(options: SessionCookieOptions): string {
  return [
    `${PLATFORM_SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    ...(options.secure ? ['Secure'] : []),
  ].join('; ');
}
