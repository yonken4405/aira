import { redirect } from 'next/navigation';

import { getPrincipal } from '../src/lib/auth/guard';
import { landingFor } from '../src/lib/auth/rbac';

export const dynamic = 'force-dynamic';

/** Entry point: every role lands on the surface it is allowed to use. */
export default async function HomePage() {
  const principal = await getPrincipal();

  if (!principal) {
    redirect('/login');
  }

  if (principal.mustChangePassword) {
    redirect('/account/password');
  }

  redirect(landingFor(principal.role));
}
