/**
 * Pure, DOM-free cookie helpers for the manual cookie jar maintained by
 * `CitizenApiClient` on React Native (DESIGN.md §"Top design risk: native cookie
 * handling"; R6.5, R12.2).
 *
 * React Native's `fetch` has no browser-style cookie jar, so the client reads the
 * `Set-Cookie` header off register/login/device responses, extracts the
 * `aira_citizen_session` value, persists it, and re-attaches it as a
 * `Cookie: aira_citizen_session=<token>` request header on every later request.
 *
 * The cookie name matches the server's `CITIZEN_SESSION_COOKIE`
 * (apps/web/src/lib/citizen/session.ts). Both helpers stay pure / DOM-free.
 */

/** The exact server cookie name (apps/web/src/lib/citizen/session.ts). */
const COOKIE_NAME = 'aira_citizen_session';

/**
 * Parse a `Set-Cookie` header and return ONLY the `aira_citizen_session` value,
 * or `null` if absent / empty / null.
 *
 * The header may carry attributes (Path, HttpOnly, SameSite, Max-Age, Secure) and
 * may list several cookies. We locate the `aira_citizen_session=` name/value pair
 * directly, then stop at the first attribute delimiter (`;`) or the end of that
 * cookie (`,`). Attribute text is never returned.
 */
export function extractSessionToken(setCookieHeader: string | null): string | null {
  if (!setCookieHeader) {
    return null;
  }

  // Find `aira_citizen_session=` as a cookie-name boundary: either at the very
  // start of the header or immediately after a cookie separator (`,`) / attribute
  // separator (`;`), ignoring surrounding whitespace.
  const needle = `${COOKIE_NAME}=`;
  let searchFrom = 0;

  while (searchFrom <= setCookieHeader.length) {
    const nameIndex = setCookieHeader.indexOf(needle, searchFrom);
    if (nameIndex === -1) {
      return null;
    }

    // Check that what precedes the name is a valid boundary (start, `,`, or `;`).
    let i = nameIndex - 1;
    while (i >= 0 && (setCookieHeader[i] === ' ' || setCookieHeader[i] === '\t')) {
      i -= 1;
    }
    const atBoundary = i < 0 || setCookieHeader[i] === ',' || setCookieHeader[i] === ';';

    if (!atBoundary) {
      // This was a substring match inside another token; keep looking.
      searchFrom = nameIndex + needle.length;
      continue;
    }

    const valueStart = nameIndex + needle.length;
    // The value ends at the first `;` (attribute) or `,` (next cookie).
    let valueEnd = valueStart;
    while (
      valueEnd < setCookieHeader.length &&
      setCookieHeader[valueEnd] !== ';' &&
      setCookieHeader[valueEnd] !== ','
    ) {
      valueEnd += 1;
    }

    const value = setCookieHeader.slice(valueStart, valueEnd).trim();
    return value === '' ? null : value;
  }

  return null;
}

/**
 * Format the `Cookie` request-header value the server reads back
 * (`readCitizenToken` → `readCookie`): exactly `aira_citizen_session=<token>`.
 */
export function formatCookieHeader(token: string): string {
  return `${COOKIE_NAME}=${token}`;
}
