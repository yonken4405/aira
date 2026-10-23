import { redirect } from 'next/navigation';

import { ProfileView } from '../../../src/components/ProfileView';
import { getPlatformPrincipal } from '../../../src/lib/platform/guard';

export const dynamic = 'force-dynamic';

/**
 * Platform-operator Profile (R6) under the platform App_Shell (the platform layout
 * supplies the shell chrome + nav). Operators carry no responder Role: the email is
 * read-only, there is no editable display label, and the self-service password
 * change (a responder `account:change-password` permission) is not offered here.
 */
export default async function PlatformProfilePage() {
  const principal = await getPlatformPrincipal();
  if (!principal) {
    redirect('/login');
  }

  return <ProfileView email={principal.email} tier="platform_admins" canChangePassword={false} />;
}
