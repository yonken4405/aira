import { redirect } from 'next/navigation';

import { getPlatformPrincipal } from '../../../src/lib/platform/guard';

export const dynamic = 'force-dynamic';

/**
 * The platform operator now signs in through the single front door at `/login` (one
 * unified page for all tiers). This route is kept only so existing bookmarks/links
 * resolve: an already-signed-in operator lands on the console, everyone else is sent
 * to the shared login page.
 */
export default async function PlatformLoginPage() {
  const principal = await getPlatformPrincipal();
  redirect(principal ? '/platform' : '/login');
}
