/**
 * Page-level session guard.
 *
 * Every protected page funnels through here; the API routes use the same service
 * through `src/lib/api`. Hiding a control in the UI is never the access control
 * (SECURITY.md §4.1).
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { canAny, type Permission } from './rbac';
import { getAuthDeps } from './runtime';
import { resolveSession } from './service';
import { SESSION_COOKIE } from './session';
import type { AuthenticatedPrincipal, Viewer } from './types';
import { viewerOfPrincipal } from './view';

/** Resolves the cookie session, or null when there is no usable session. */
export async function getPrincipal(): Promise<AuthenticatedPrincipal | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value ?? null;
  return resolveSession(getAuthDeps(), token);
}

/**
 * Requires a signed-in responder. Redirects to the login screen preserving the
 * requested path, and forces a password change before anything else renders.
 */
export async function requirePagePrincipal(): Promise<AuthenticatedPrincipal> {
  const principal = await getPrincipal();
  if (!principal) {
    redirect('/login');
  }
  if (principal.mustChangePassword) {
    redirect('/account/password');
  }
  return principal;
}

export function holdsAny(
  principal: AuthenticatedPrincipal,
  permissions: readonly Permission[],
): boolean {
  return canAny(principal.role, permissions);
}

export function viewerOf(principal: AuthenticatedPrincipal): Viewer {
  return viewerOfPrincipal(principal);
}

/**
 * Only same-site absolute paths survive a `?next=` round trip, so the login form can
 * never be turned into an open redirect.
 */
export function sanitizeNextPath(value: string | string[] | undefined): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || !candidate.startsWith('/') || candidate.startsWith('//')) {
    return null;
  }
  if (candidate.includes('\\') || candidate.includes('://')) {
    return null;
  }
  return candidate;
}
