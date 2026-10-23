/**
 * HTTP helpers shared by every route handler.
 *
 * Boundaries validate by default (SECURITY.md §3.2): bodies are parsed defensively,
 * mutations require a same-origin request, and no response ever echoes a stack trace.
 */

import { createHash } from 'node:crypto';

import { readCookie, SESSION_COOKIE } from '../auth/session';

/** Incident data is private and short-lived - never shared-cached (SECURITY.md §5.6). */
export const PRIVATE_CACHE_HEADERS = {
  'cache-control': 'private, max-age=5, stale-while-revalidate=25',
  vary: 'Cookie',
} as const;

export const NO_STORE_HEADERS = {
  'cache-control': 'no-store',
  vary: 'Cookie',
} as const;

export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return Response.json(body, { status, headers: { ...NO_STORE_HEADERS, ...headers } });
}

export function errorResponse(
  status: number,
  error: string,
  extra: Record<string, unknown> = {},
): Response {
  return jsonResponse({ ok: false, error, ...extra }, status);
}

/** Returns null for malformed JSON, arrays and primitives. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const raw: unknown = await request.json();
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return null;
    }
    return raw as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * CSRF guard for mutations: the session cookie is `SameSite=Lax`, and browsers send
 * `Origin` on cross-site POSTs, so a mismatch (or a cross-site fetch hint) is refused.
 * Non-browser clients (the citizen app, CLI) send no Origin and are unaffected.
 */
export function isSameOrigin(request: Request): boolean {
  if (request.headers.get('sec-fetch-site') === 'cross-site') {
    return false;
  }

  const origin = request.headers.get('origin');
  if (!origin) {
    return true;
  }

  const expected = process.env.AIRA_PUBLIC_ORIGIN ?? new URL(request.url).origin;

  try {
    return new URL(origin).origin === expected;
  } catch {
    return false;
  }
}

export function readSessionToken(request: Request): string | null {
  return readCookie(request.headers.get('cookie'), SESSION_COOKIE);
}

/**
 * Pseudonymous rate-limit key. The raw address is never stored or logged
 * (SECURITY.md §1.3/§5), only a truncated digest held in memory.
 */
export function clientFingerprint(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for') ?? '';
  const address = forwarded.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
  return createHash('sha256').update(address, 'utf8').digest('hex').slice(0, 16);
}

export function isNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}
