/**
 * Citizen session cookie (SECURITY.md §7.4).
 *
 * Reuses the responder session token/expiry primitives (opaque token, SHA-256 hash at
 * rest, idle + absolute windows) but under a DISTINCT cookie name so the two tiers can
 * never be confused: presenting a citizen cookie on a responder route resolves to
 * nothing, and vice versa.
 */

import { SESSION_ABSOLUTE_MS, type SessionCookieOptions } from '../auth/session';

export const CITIZEN_SESSION_COOKIE = 'aira_citizen_session';

export function serializeCitizenSessionCookie(
  token: string,
  options: SessionCookieOptions,
): string {
  const maxAge = Math.floor(SESSION_ABSOLUTE_MS / 1000);
  return [
    `${CITIZEN_SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    ...(options.secure ? ['Secure'] : []),
  ].join('; ');
}

export function serializeClearedCitizenSessionCookie(options: SessionCookieOptions): string {
  return [
    `${CITIZEN_SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    ...(options.secure ? ['Secure'] : []),
  ].join('; ');
}
