/**
 * Route-level authentication/authorisation helpers.
 *
 * Role checks happen here, on the server, before any data is touched. The UI only
 * mirrors these decisions (SECURITY.md §4.1).
 */

import { can, type Permission } from '../auth/rbac';
import { resolveSession } from '../auth/service';
import type { AuthenticatedPrincipal } from '../auth/types';
import type { AppDeps } from './deps';
import { errorResponse, readSessionToken } from './http';

export type AuthContext =
  | { readonly ok: true; readonly principal: AuthenticatedPrincipal }
  | { readonly ok: false; readonly response: Response };

/** Resolves the session cookie into a principal or a 401 response. */
export async function authenticate(request: Request, deps: AppDeps): Promise<AuthContext> {
  const principal = await resolveSession(deps.auth, readSessionToken(request));

  if (!principal) {
    return { ok: false, response: errorResponse(401, 'unauthenticated') };
  }

  return { ok: true, principal };
}

/** 403 unless the principal holds the permission. Deny by default. */
export function requirePermission(
  principal: AuthenticatedPrincipal,
  permission: Permission,
): Response | null {
  return can(principal.role, permission) ? null : errorResponse(403, 'forbidden');
}

/** Some routes accept one of several permissions (own scope vs office scope). */
export function requireAnyPermission(
  principal: AuthenticatedPrincipal,
  permissions: readonly Permission[],
): Response | null {
  return permissions.some((permission) => can(principal.role, permission))
    ? null
    : errorResponse(403, 'forbidden');
}
