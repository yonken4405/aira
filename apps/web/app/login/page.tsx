import { redirect } from 'next/navigation';

import { getPrincipal, sanitizeNextPath } from '../../src/lib/auth/guard';
import { landingFor } from '../../src/lib/auth/rbac';
import { LoginForm } from './LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const params = await searchParams;
  const principal = await getPrincipal();

  if (principal) {
    redirect(landingFor(principal.role));
  }

  return <LoginForm next={sanitizeNextPath(params.next)} />;
}
