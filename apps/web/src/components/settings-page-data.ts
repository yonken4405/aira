import 'server-only';

import { getNotificationDeps } from '../lib/notifications/runtime';
import type { ChannelPreferenceView } from './SettingsView';
import type { PrincipalRef } from '../lib/notifications/types';
import type { PushState } from './SettingsView';

/**
 * Server-side data for a per-tier Settings page (R7).
 *
 * Loads the caller's stored per-channel preference via the notification store
 * (owner-scoped by the `(tier, principalId)` pair) and computes the initial
 * `pushState`. The server cannot observe the browser's Web_Push permission, so it
 * seeds `'default'`; the client `SettingsView` refines it on mount/enable from
 * `Notification.permission` and the permission-request flow (R7.5).
 *
 * Fail-soft: if the preference lookup throws (e.g. the DB is unavailable), fall
 * back to all-enabled so the Settings page still renders.
 */
export interface SettingsPageData {
  readonly preferences: ChannelPreferenceView;
  readonly pushState: PushState;
}

const ALL_ENABLED: ChannelPreferenceView = { inApp: true, email: true, webPush: true };

export async function loadSettingsPageData(recipient: PrincipalRef): Promise<SettingsPageData> {
  let preferences: ChannelPreferenceView = ALL_ENABLED;

  try {
    const pref = await getNotificationDeps().store.getPreference(recipient);
    preferences = { inApp: pref.inApp, email: pref.email, webPush: pref.webPush };
  } catch {
    // Best-effort: keep the all-enabled default so Settings still renders.
    preferences = ALL_ENABLED;
  }

  // The server cannot know the browser permission; the client refines it on mount.
  return { preferences, pushState: 'default' };
}
