'use client';

import { Switch, ThemeToggle, useToast } from '@aira/ui/web';
import { t } from '@aira/ui';
import { useState, type ReactElement } from 'react';

/**
 * Settings common feature under App_Shell (DESIGN.md §3, R7).
 *
 * Presents the Theme_Preference control (the shared `ThemeToggle`, R7.2) and the
 * three per-channel notification toggles (In_App / Email / Web_Push, R7.3). A
 * channel change persists to `POST /api/notifications/preferences` and confirms
 * with a success Toast (R7.4).
 *
 * In_App is locked-on: it always reflects enabled and is rendered disabled so it
 * can never be toggled off — a critical warning must always reach the In_App copy
 * (R14.5).
 *
 * Web_Push is gated on the browser permission (`pushState`): `granted` → on +
 * enabled; `denied` → off + disabled + an explanatory message (R7.6); `default` →
 * enabling triggers the browser permission request, and on grant registers the
 * service worker + push subscription, POSTs it to the subscriptions endpoint, then
 * records the Web_Push preference (R7.5); `unsupported` → off + disabled with a
 * note. Every browser-push call is guarded so it never throws when the APIs are
 * absent.
 */

const PREFERENCES_ENDPOINT = '/api/notifications/preferences';
const SUBSCRIPTIONS_ENDPOINT = '/api/notifications/subscriptions';

export type PushState = 'unsupported' | 'default' | 'granted' | 'denied';

/** The client-facing per-channel preference flags (mirrors the handler view). */
export interface ChannelPreferenceView {
  readonly inApp: boolean;
  readonly email: boolean;
  readonly webPush: boolean;
}

export interface SettingsViewProps {
  /**
   * Per-channel notification preferences (R7.3). `inApp` is locked-on per R14.5
   * (In_App cannot be opted out of for critical warnings).
   */
  readonly preferences: ChannelPreferenceView;
  /**
   * Browser Web_Push permission state (R7.5, R7.6). Drives the web-push control's
   * enabled/disabled state and the explanatory denied/unsupported message. The
   * server can only guess `'default'`; the client refines it on mount.
   */
  readonly pushState: PushState;
}

/** Narrow mutable channel key set the user may change from this view. */
type MutableChannel = 'email' | 'webPush';

export function SettingsView({
  preferences,
  pushState: initialPushState,
}: SettingsViewProps): ReactElement {
  const { toast } = useToast();

  const [prefs, setPrefs] = useState<ChannelPreferenceView>(preferences);
  // The live push permission state. Starts from the server-provided guess and is
  // refined by the browser permission request flow on an enable attempt.
  const [pushState, setPushState] = useState<PushState>(initialPushState);

  /** Persists the merged preference set and surfaces a success/error Toast (R7.4). */
  async function persist(next: ChannelPreferenceView): Promise<boolean> {
    try {
      const response = await fetch(PREFERENCES_ENDPOINT, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: next.email, webPush: next.webPush }),
      });
      if (!response.ok) {
        throw new Error('preferences_rejected');
      }
      toast({ title: t('prefsSaved'), tone: 'success' });
      return true;
    } catch {
      toast({ title: t('prefsSaveFailed'), tone: 'error' });
      return false;
    }
  }

  /** Optimistically flips a channel, persisting the change (rolls back on failure). */
  async function changeChannel(channel: MutableChannel, value: boolean): Promise<void> {
    const next = { ...prefs, [channel]: value };
    setPrefs(next);
    const ok = await persist(next);
    if (!ok) {
      setPrefs(prefs);
    }
  }

  /**
   * Best-effort browser push enablement (R7.5). Requests permission, and on grant
   * registers the service worker + a push subscription and POSTs it to the
   * subscriptions endpoint. Every browser call is guarded so a missing API never
   * throws. Returns the resolved permission so the caller can reconcile UI state.
   */
  async function requestBrowserPush(): Promise<PushState> {
    const notification = typeof Notification !== 'undefined' ? Notification : undefined;
    if (!notification || typeof notification.requestPermission !== 'function') {
      return 'unsupported';
    }

    let permission: NotificationPermission;
    try {
      permission = await notification.requestPermission();
    } catch {
      return 'denied';
    }

    if (permission !== 'granted') {
      return permission === 'denied' ? 'denied' : 'default';
    }

    // Permission granted: register the service worker + push subscription and hand
    // the subscription to the server. Guarded end-to-end — any failure here still
    // leaves the permission granted; it just means no server-side subscription.
    try {
      const sw = globalThis.navigator?.serviceWorker;
      if (sw && typeof sw.register === 'function') {
        const registration = await sw.register('/sw.js');
        const subscription = await registration?.pushManager?.subscribe?.({
          userVisibleOnly: true,
        });
        if (subscription) {
          await fetch(SUBSCRIPTIONS_ENDPOINT, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(subscription),
          });
        }
      }
    } catch {
      // Subscription registration is best-effort; permission is still granted.
    }

    return 'granted';
  }

  /** Handles a Web_Push toggle, driving the permission flow when enabling. */
  async function changeWebPush(value: boolean): Promise<void> {
    if (!value) {
      await changeChannel('webPush', false);
      return;
    }

    // Enabling. If permission is already granted, just record the preference.
    if (pushState === 'granted') {
      await changeChannel('webPush', true);
      return;
    }

    // From the default state, enabling triggers the browser permission request
    // (R7.5). The resolved state drives whether the preference is recorded.
    const resolved = await requestBrowserPush();
    setPushState(resolved);
    if (resolved === 'granted') {
      await changeChannel('webPush', true);
    }
  }

  const webPushDisabled = pushState === 'denied' || pushState === 'unsupported';
  // The control reflects the stored preference; `pushState` only governs whether
  // it is operable (denied/unsupported lock it off). A denied state also forces
  // the preference off at the source, so `prefs.webPush` is already false there.
  const webPushChecked = prefs.webPush;

  return (
    <section className="mx-auto w-full max-w-2xl space-y-8 p-4">
      <header className="space-y-1">
        <h1 className="text-lg font-bold uppercase tracking-label text-fg">{t('settingsTitle')}</h1>
        <p className="text-sm text-muted">{t('settingsSubtitle')}</p>
      </header>

      <div className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-label text-muted">
          {t('settingsAppearanceHeading')}
        </h2>
        <ThemeToggle />
      </div>

      <div className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-xs font-bold uppercase tracking-label text-muted">
            {t('settingsNotificationsHeading')}
          </h2>
          <p className="text-sm text-muted">{t('settingsNotificationsHint')}</p>
        </div>

        <ul className="space-y-3">
          {/* In_App — locked on for critical warnings (R14.5). */}
          <li className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm text-fg">{t('channelInApp')}</p>
              <p className="text-xs text-muted">{t('channelInAppLocked')}</p>
            </div>
            <Switch
              checked
              disabled
              label={t('channelInApp')}
              onCheckedChange={() => {
                /* locked-on (R14.5) */
              }}
            />
          </li>

          {/* Email. */}
          <li className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm text-fg">{t('channelEmail')}</p>
            </div>
            <Switch
              checked={prefs.email}
              label={t('channelEmail')}
              onCheckedChange={(next) => void changeChannel('email', next)}
            />
          </li>

          {/* Web_Push. */}
          <li className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm text-fg">{t('channelWebPush')}</p>
              {pushState === 'denied' ? (
                <p className="mt-1 text-xs text-status-error">{t('pushDenied')}</p>
              ) : null}
              {pushState === 'unsupported' ? (
                <p className="mt-1 text-xs text-muted">{t('pushUnsupported')}</p>
              ) : null}
            </div>
            <Switch
              checked={webPushChecked}
              disabled={webPushDisabled}
              label={t('channelWebPush')}
              onCheckedChange={(next) => void changeWebPush(next)}
            />
          </li>
        </ul>
      </div>
    </section>
  );
}
