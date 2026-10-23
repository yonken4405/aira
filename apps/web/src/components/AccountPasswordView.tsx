'use client';

import { t } from '@aira/ui';
import type { ReactElement } from 'react';

import type { Role } from '../lib/auth/rbac';
import { ChangePasswordForm } from '../../app/account/password/ChangePasswordForm';
import { AppShell, type NavEntry, type ShellIdentity } from './AppShell';

/**
 * `AccountPasswordView` hosts the self-service password change inside the shared
 * App_Shell so the page keeps the standard header + authorized navigation instead
 * of appearing as a chrome-less screen (R5.1, R5.2, R5.4). The form sits inside
 * the shell content frame within the Profile/Settings area (R5.3).
 *
 * The prop contract mirrors what {@link AppShell}/`AppShellHeader` consume: the
 * `identity` shape, the raw `navEntries` set (filtered by tier / `can()` in the
 * header), and the viewer `role` used to gate permission-bearing entries. The
 * `mustChange`/`next` pair is forwarded straight to {@link ChangePasswordForm}.
 */
export interface AccountPasswordViewProps {
  readonly identity: ShellIdentity;
  /** Raw nav entry set handed to the shell; the header filters it before render. */
  readonly navEntries: readonly NavEntry[];
  /** Viewer role used to gate permission-bearing nav entries (R5.4). */
  readonly role?: Role;
  /** Forwarded to the form: provisioned accounts must replace their OTP. */
  readonly mustChange: boolean;
  /** Where to land once the password is set. */
  readonly next: string;
}

export function AccountPasswordView({
  identity,
  navEntries,
  role,
  mustChange,
  next,
}: AccountPasswordViewProps): ReactElement {
  return (
    <AppShell identity={identity} navEntries={navEntries} role={role}>
      <div className="mx-auto flex w-full max-w-sm flex-col gap-4 px-4 py-10">
        <div className="flex flex-col gap-1">
          <h2 className="text-[11px] font-bold uppercase tracking-label text-muted">
            {t('accountPasswordHeading')}
          </h2>
          <p className="text-[11px] leading-relaxed text-muted">{t('accountPasswordSubtitle')}</p>
        </div>
        <ChangePasswordForm identity={identity.displayName} mustChange={mustChange} next={next} />
      </div>
    </AppShell>
  );
}
