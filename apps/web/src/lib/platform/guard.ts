/**
 * Page-level platform-operator guard. The /platform surface funnels through here; it is
 * a separate tier from responders/citizens and holds no incident access.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { getPlatformDeps } from './runtime';
import { resolvePlatformSession } from './service';
import { PLATFORM_SESSION_COOKIE } from './session';
import type { PlatformPrincipal } from './types';

export async function getPlatformPrincipal(): Promise<PlatformPrincipal | null> {
  const jar = await cookies();
  const token = jar.get(PLATFORM_SESSION_COOKIE)?.value ?? null;
  return resolvePlatformSession(getPlatformDeps(), token);
}

/** Requires a signed-in platform operator; redirects to the unified login otherwise. */
export async function requirePlatformPrincipal(): Promise<PlatformPrincipal> {
  const principal = await getPlatformPrincipal();
  if (!principal) {
    redirect('/login');
  }
  return principal;
}
