import { redirect } from 'next/navigation';

import { ProfileView } from '../../../src/components/ProfileView';
import { getPrincipal, viewerOf } from '../../../src/lib/auth/guard';
import { can } from '../../../src/lib/auth/rbac';

export const dynamic = 'force-dynamic';

/**
 * Responder Profile (R6) under the admin App_Shell (the admin layout supplies the
 * shell chrome + nav). Same editable display label + embedded password change as
 * the console profile; the DRRM admin holds `account:change-password`.
 */
export default async function AdminProfilePage() {
  const principal = await getPrincipal();
  if (!principal) {
    redirect('/login');
  }

  const viewer = viewerOf(principal);

  return (
    <ProfileView
      email={viewer.email}
      tier="responders"
      editable={{ displayName: viewer.displayName, callsign: viewer.callsign }}
      canChangePassword={can(principal.role, 'account:change-password')}
    />
  );
}
