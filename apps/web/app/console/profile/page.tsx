import { redirect } from 'next/navigation';

import { ProfileView } from '../../../src/components/ProfileView';
import { getPrincipal, viewerOf } from '../../../src/lib/auth/guard';
import { can } from '../../../src/lib/auth/rbac';

export const dynamic = 'force-dynamic';

/**
 * Responder Profile (R6) under the console App_Shell (the console layout supplies
 * the shell chrome + nav). Responders may edit their display label (callsign) and,
 * when they hold `account:change-password`, change their password inline.
 */
export default async function ConsoleProfilePage() {
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
