import { describe, expect, it } from 'vitest';

// TDD (red): `./cookieJar` does not exist yet — task 5.5 implements it.
//
// This is the pure, testable core of the TOP DESIGN RISK — native cookie handling
// (DESIGN.md §"Top design risk: native cookie handling"). React Native's `fetch`
// has no browser-style cookie jar, so `CitizenApiClient` maintains a MANUAL jar: it
// reads the `Set-Cookie` header from register/login/device responses, extracts the
// `aira_citizen_session` value, persists it, and re-attaches it as a
// `Cookie: aira_citizen_session=<token>` request header on every subsequent request
// (DESIGN.md §Data Models / §Risk; R6.5, R12.2).
//
// The two signatures task 5.5 MUST export from `./cookieJar` (pinned here):
//   extractSessionToken(setCookieHeader: string | null): string | null
//     — the `aira_citizen_session` value ONLY, never any attribute text.
//   formatCookieHeader(token: string): string
//     — exactly `aira_citizen_session=<token>` (the Cookie request-header form the
//       server's `readCitizenToken` → `readCookie` reads: split on `;`, then `=`).
//
// The server cookie name is `CITIZEN_SESSION_COOKIE = 'aira_citizen_session'`
// (apps/web/src/lib/citizen/session.ts). Both helpers stay DOM-free / pure.
import { extractSessionToken, formatCookieHeader } from './cookieJar';

/** The exact server cookie name (apps/web/src/lib/citizen/session.ts). */
const COOKIE_NAME = 'aira_citizen_session';

/**
 * A realistic `Set-Cookie` header exactly as the server emits it via
 * `serializeCitizenSessionCookie` — token followed by attributes joined with "; ".
 */
function serverSetCookie(token: string): string {
  return [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=1209600',
    'Secure',
  ].join('; ');
}

describe('extractSessionToken', () => {
  it('returns only the aira_citizen_session value from a realistic attribute-laden Set-Cookie header', () => {
    const token = 'OpAqUe-Session-Token_1234567890abcdefXYZ';

    expect(extractSessionToken(serverSetCookie(token))).toBe(token);
  });

  it('never returns any attribute text alongside the token', () => {
    const token = 'tok_no_attrs_please';

    const result = extractSessionToken(serverSetCookie(token));

    expect(result).not.toBeNull();
    expect(result).not.toContain('HttpOnly');
    expect(result).not.toContain('Path');
    expect(result).not.toContain('SameSite');
    expect(result).not.toContain('Max-Age');
    expect(result).not.toContain('Secure');
    expect(result).not.toContain(';');
    expect(result).not.toContain('=');
  });

  it('extracts the target cookie when it is listed among other cookies', () => {
    const token = 'target_token_value';
    const header = [
      'other_cookie=irrelevant; Path=/',
      serverSetCookie(token),
      'another=also_irrelevant; HttpOnly',
    ].join(', ');

    expect(extractSessionToken(header)).toBe(token);
  });

  it('returns null for an empty header', () => {
    expect(extractSessionToken('')).toBeNull();
  });

  it('returns null for a null-ish header', () => {
    expect(extractSessionToken(null)).toBeNull();
  });

  it('returns null when the header contains only other cookies (no aira_citizen_session)', () => {
    const header = 'session=something; Path=/; HttpOnly, csrf=abc; SameSite=Lax';

    expect(extractSessionToken(header)).toBeNull();
  });
});

describe('formatCookieHeader', () => {
  it('produces exactly `aira_citizen_session=<token>` — the form the server reads', () => {
    expect(formatCookieHeader('abc123')).toBe(`${COOKIE_NAME}=abc123`);
  });

  it('round-trips with extractSessionToken: formatting then re-extracting yields the same token', () => {
    const token = 'round_trip_token_0987654321';

    expect(extractSessionToken(formatCookieHeader(token))).toBe(token);
  });
});
