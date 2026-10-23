/**
 * Notification service core — pure, fail-soft dispatch rules over an injected
 * `NotificationStore` plus the Email/Web_Push sender ports (R9–R16).
 *
 * The service runs synchronously inside the originating request. It persists the
 * authoritative In_App copy first, then dispatches Email and Web_Push in a fixed
 * order, recording exactly one delivery outcome per channel. No channel failure
 * ever throws out of `notifyOne` / `notifyMany`: a failed sender is recorded as
 * `failed` and the caller's transaction still commits (R10.3–R10.5, R10.8).
 *
 * This module is pure over its injected dependencies — it reads no `pg`, no
 * `process.env`, and no clock directly. Runtime wiring (env-gated senders, the
 * real clock, `emailAddressFor`) lives in `runtime.ts`.
 */

import type {
  EmailSender,
  NotificationChannel,
  NotificationPayload,
  NotificationStore,
  PrincipalRef,
  WebPushSender,
} from './types';

/**
 * The dependencies `notifyOne` / `notifyMany` operate over. Everything the
 * service touches is injected here so the rules stay pure and testable:
 *  - `email` / `webPush` are `null` when their credentials are absent → the
 *    corresponding channel records `not_attempted` (R10.6, R10.7).
 *  - `now` is the injected clock (fixed in tests).
 *  - `emailAddressFor` resolves a recipient's email address (or `null`).
 */
export interface NotificationServiceDeps {
  store: NotificationStore;
  email: EmailSender | null;
  webPush: WebPushSender | null;
  now: () => number;
  emailAddressFor: (ref: PrincipalRef) => Promise<string | null>;
}

/** The single fixed channel order — In_App is always first (R10.8). */
export const CHANNEL_ORDER: readonly NotificationChannel[] = ['in_app', 'email', 'web_push'];

/**
 * The ONE documented, system-wide forced-critical policy constant (R14.3). It is
 * NOT per-send overridable — there is exactly one knob for the whole system.
 *
 * `true`  → a Critical_Warning forces Email + Web_Push even if the recipient
 *            opted out of those channels; the resulting delivery rows are flagged
 *            `overridden` (R14.4).
 * `false` → critical forces only In_App; Email/Web_Push still honor the opt-out
 *            and record `skipped` when disabled.
 *
 * In_App is always delivered regardless of this constant — a critical In_App
 * opt-out is impossible (R14.2, R14.5).
 */
export const CRITICAL_FORCES_ALL_CHANNELS = true;

/**
 * Core synchronous, fail-soft dispatch to a single recipient. Persists the In_App
 * copy first, then attempts Email and Web_Push per preference/policy, recording
 * exactly one delivery outcome per channel. Never throws (R10).
 */
export async function notifyOne(
  deps: NotificationServiceDeps,
  recipient: PrincipalRef,
  payload: NotificationPayload,
  options: { critical: boolean },
): Promise<void> {
  const { store, now } = deps;

  // 1. Persist the In_App notification FIRST, always — even if the recipient
  //    opted out of In_App, and unconditionally for critical (R10.2, R14.2, R14.5).
  const notification = await store.createNotification({
    recipient,
    type: payload.type,
    payload,
    critical: options.critical,
    createdAt: now(),
  });

  await store.recordDelivery({
    notificationId: notification.id,
    channel: 'in_app',
    outcome: 'sent',
    overridden: false,
    at: now(),
  });

  // 2. Load the recipient's preferences, then process Email then Web_Push in
  //    CHANNEL_ORDER.
  const preference = await store.getPreference(recipient);

  for (const channel of CHANNEL_ORDER) {
    if (channel === 'in_app') continue;

    const enabled = channel === 'email' ? preference.email : preference.webPush;
    const forced = options.critical && CRITICAL_FORCES_ALL_CHANNELS;

    // Disabled and not forced → honor the opt-out: skip, no attempt (R14.1).
    if (!enabled && !forced) {
      await store.recordDelivery({
        notificationId: notification.id,
        channel,
        outcome: 'skipped',
        overridden: false,
        at: now(),
      });
      continue;
    }

    // When forced over an opt-out, every row for this channel is flagged
    // overridden (R14.4). Enabled channels are never overridden.
    const overridden = !enabled;

    if (channel === 'email') {
      await dispatchEmail(deps, notification.id, recipient, payload, overridden);
    } else {
      await dispatchWebPush(deps, notification.id, recipient, payload, overridden);
    }
  }
}

/**
 * Email channel dispatch. Null sender → `not_attempted` (R10.7); missing address
 * → `skipped`; otherwise attempt the send fail-soft (ok → `sent`, throw →
 * `failed`). Exactly one delivery row is recorded (R10.8).
 */
async function dispatchEmail(
  deps: NotificationServiceDeps,
  notificationId: string,
  recipient: PrincipalRef,
  payload: NotificationPayload,
  overridden: boolean,
): Promise<void> {
  const { store, email, now } = deps;

  if (email === null) {
    await store.recordDelivery({
      notificationId,
      channel: 'email',
      outcome: 'not_attempted',
      overridden,
      at: now(),
    });
    return;
  }

  const address = await deps.emailAddressFor(recipient);
  if (address === null) {
    // No deliverable target — nothing to send to (R10): record skipped.
    await store.recordDelivery({
      notificationId,
      channel: 'email',
      outcome: 'skipped',
      overridden,
      at: now(),
    });
    return;
  }

  let outcome: 'sent' | 'failed' = 'sent';
  try {
    await email.send({
      to: address,
      subject: payload.title,
      text: payload.body,
    });
  } catch {
    outcome = 'failed';
  }

  await store.recordDelivery({
    notificationId,
    channel: 'email',
    outcome,
    overridden,
    at: now(),
  });
}

/**
 * Web_Push channel dispatch. Null sender → `not_attempted` (R10.7); no stored
 * subscription → `skipped` (even when forced-critical — there is nothing to send
 * to); otherwise attempt one send per stored subscription fail-soft and record a
 * single aggregate outcome for the channel (`sent` if at least one send
 * succeeded, `failed` if the attempt threw). Exactly one delivery row (R10.8).
 */
async function dispatchWebPush(
  deps: NotificationServiceDeps,
  notificationId: string,
  recipient: PrincipalRef,
  payload: NotificationPayload,
  overridden: boolean,
): Promise<void> {
  const { store, webPush, now } = deps;

  if (webPush === null) {
    await store.recordDelivery({
      notificationId,
      channel: 'web_push',
      outcome: 'not_attempted',
      overridden,
      at: now(),
    });
    return;
  }

  const subscriptions = await store.listSubscriptions(recipient);
  if (subscriptions.length === 0) {
    await store.recordDelivery({
      notificationId,
      channel: 'web_push',
      outcome: 'skipped',
      overridden,
      at: now(),
    });
    return;
  }

  let anySucceeded = false;
  for (const subscription of subscriptions) {
    try {
      await webPush.send({ subscription, payload });
      anySucceeded = true;
    } catch {
      // Fail-soft: a thrown send is tolerated; the aggregate records `failed`.
    }
  }

  // Aggregate: `sent` if at least one send succeeded, otherwise `failed`.
  const outcome: 'sent' | 'failed' = anySucceeded ? 'sent' : 'failed';

  await store.recordDelivery({
    notificationId,
    channel: 'web_push',
    outcome,
    overridden,
    at: now(),
  });
}

/**
 * Fan-out helper. Callers pass an already-resolved recipient list (scope
 * resolution and isolation enforcement happen in the broadcast/notice handlers),
 * and each recipient is notified via `notifyOne`. An empty set resolves without
 * creating anything.
 */
export async function notifyMany(
  deps: NotificationServiceDeps,
  recipients: readonly PrincipalRef[],
  payload: NotificationPayload,
  options: { critical: boolean },
): Promise<void> {
  for (const recipient of recipients) {
    await notifyOne(deps, recipient, payload, options);
  }
}

/**
 * Fail-soft event-hook boundary (R10.5). The request handlers call `notify*`
 * AFTER their primary mutation has already committed; a thrown store/sender from
 * that notification MUST NEVER change the HTTP result. This helper swallows any
 * error so the originating transaction's response is unaffected.
 *
 * `notifyOne`/`notifyMany` are already fail-soft per channel, but the very first
 * `createNotification` (the authoritative In_App persist) can still throw — this
 * wrapper is the single, DRY seam that keeps every hook site identical and safe.
 */
export async function notifySafe(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch {
    // Swallow: notification side-effects are best-effort and must not surface to
    // the caller or alter the committed primary mutation (R10.5).
  }
}
