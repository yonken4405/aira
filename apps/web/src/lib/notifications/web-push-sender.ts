/**
 * Web_Push channel sender (VAPID), the real implementation behind the `WebPushSender`
 * port.
 *
 * This is the ONLY module that imports `web-push`. It is constructed exclusively from
 * `runtime.ts` via {@link createWebPushSender}, which reads the `VAPID_*` env. Keeping
 * the dependency and the env reads isolated here lets `service.ts` stay a pure function
 * of the injected `WebPushSender | null` port, and lets tests exercise the service with
 * a fake sender (TESTING.md §4.3).
 *
 * Credential policy (R10.6, R10.7): if the required VAPID keys are absent,
 * {@link createWebPushSender} returns `null`. A `null` sender makes the notification
 * service record the Web_Push channel as `not_attempted` rather than an error — the
 * correct behavior until VAPID keys are configured.
 *
 * Failure policy (R10.4): when credentials are present, delivery rejections are allowed
 * to propagate out of `send()`. The service catches them and records the channel as
 * `failed`; it never throws out of dispatch.
 */

import webpush from 'web-push';

import type { WebPushMessage, WebPushSender } from './types';

/** Default VAPID subject (contact) used when `VAPID_SUBJECT` is not set. */
const DEFAULT_VAPID_SUBJECT = 'mailto:ops@aira.ph';

/**
 * `web-push` holds VAPID details in module-global state, so `setVapidDetails` must be
 * called exactly once per process. This guard makes construction idempotent even if
 * `createWebPushSender` is invoked more than once.
 */
let vapidConfigured = false;

/**
 * Builds the real Web_Push sender, or `null` when VAPID keys are not configured.
 *
 * Reads `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`. Both keys are
 * required; the subject is optional and defaults to {@link DEFAULT_VAPID_SUBJECT}.
 */
export function createWebPushSender(): WebPushSender | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;

  // Missing credentials → no sender (service records not_attempted, R10.7).
  if (!publicKey || !privateKey) {
    return null;
  }

  const subject = process.env.VAPID_SUBJECT ?? DEFAULT_VAPID_SUBJECT;

  if (!vapidConfigured) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    vapidConfigured = true;
  }

  return {
    async send({ subscription, payload }: WebPushMessage): Promise<void> {
      // Rejections propagate: the notification service records `failed` (R10.4).
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        JSON.stringify({
          title: payload.title,
          body: payload.body,
          data: payload.data,
        }),
      );
    },
  };
}
