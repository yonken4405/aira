/**
 * Opaque session tokens, cookie serialisation and expiry maths (SECURITY.md §4.3).
 *
 * The browser only ever holds a random token in an HttpOnly cookie. The database
 * stores the SHA-256 hash of that token, so a database leak cannot be replayed.
 * Sessions have a sliding idle window plus a hard absolute cap; both are enforced
 * server-side, never by the cookie's own lifetime.
 */

import { createHash, randomBytes } from 'node:crypto';

export const SESSION_COOKIE = 'aira_session';

/** 30 minutes of inactivity ends the session. */
export const SESSION_IDLE_MS = 30 * 60 * 1000;
/** 24 hours after sign-in the session ends no matter how active it is. */
export const SESSION_ABSOLUTE_MS = 24 * 60 * 60 * 1000;
/** `last_seen_at`/`expires_at` are written at most once a minute per session. */
export const SESSION_TOUCH_INTERVAL_MS = 60 * 1000;

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface SessionTiming {
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly absoluteExpiresAt: number;
  readonly lastSeenAt: number;
  readonly revokedAt: number | null;
}

export type SessionFailure = 'revoked' | 'idle_timeout' | 'expired';

export type SessionEvaluation =
  { readonly ok: true } | { readonly ok: false; readonly reason: SessionFailure };

export function createSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** Cheap shape check before touching the database. */
export function isSessionToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function evaluateSession(timing: SessionTiming, now: number): SessionEvaluation {
  if (timing.revokedAt !== null) {
    return { ok: false, reason: 'revoked' };
  }
  if (now >= timing.absoluteExpiresAt) {
    return { ok: false, reason: 'expired' };
  }
  if (now >= timing.expiresAt) {
    return { ok: false, reason: 'idle_timeout' };
  }
  return { ok: true };
}

/** Only extend the idle window when it is worth a write (and never past the cap). */
export function shouldTouchSession(timing: SessionTiming, now: number): boolean {
  return now - timing.lastSeenAt >= SESSION_TOUCH_INTERVAL_MS;
}

export function nextIdleExpiry(timing: SessionTiming, now: number): number {
  return Math.min(now + SESSION_IDLE_MS, timing.absoluteExpiresAt);
}

export interface SessionCookieOptions {
  /** `Secure` in production; local http://localhost development would drop the cookie. */
  readonly secure: boolean;
}

/**
 * The cookie lives for the absolute cap; the server still cuts the session off after
 * the idle window. `SameSite=Lax` plus the origin check on mutations is the CSRF pair.
 */
export function serializeSessionCookie(token: string, options: SessionCookieOptions): string {
  const maxAge = Math.floor(SESSION_ABSOLUTE_MS / 1000);
  return [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    ...(options.secure ? ['Secure'] : []),
  ].join('; ');
}

export function serializeClearedSessionCookie(options: SessionCookieOptions): string {
  return [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    ...(options.secure ? ['Secure'] : []),
  ].join('; ');
}

export function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) {
      continue;
    }
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }

  return null;
}
