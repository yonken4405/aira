/**
 * Server-side wiring for the notification engine.
 *
 * `getNotificationDeps()` assembles the `NotificationServiceDeps` the pure service
 * rules operate over: the Postgres `NotificationStore`, the env-gated Email/Web_Push
 * senders, the real clock, and the `emailAddressFor` recipient-address resolver.
 *
 * The senders are intentionally `null` for now. A `null` sender makes the service
 * record `not_attempted` for that channel (R10.7), which is the correct behavior
 * until SMTP / VAPID credentials are configured. The real senders are wired here in
 * later tasks (see the TODOs below).
 *
 * This module is the single place that touches `process.env` and `pg` for
 * notifications; `service.ts` stays pure over these injected dependencies.
 */

import { query } from '../db';
import { createEmailSender } from './email-sender';
import { createPostgresNotificationStore } from './postgres-store';
import type { NotificationServiceDeps } from './service';
import type { PrincipalRef } from './types';
import { createWebPushSender } from './web-push-sender';

/**
 * Best-effort resolution of a recipient's email address by tier — this is the
 * address the Email channel sends to.
 *
 * Fail-soft by contract: the service treats a `null` result as "no deliverable
 * target" and records the Email channel as `skipped`. So if the database is not
 * configured or the query throws for any reason, we return `null` rather than
 * letting the error escape and break dispatch (R10.3, R10.7).
 */
async function emailAddressFor(ref: PrincipalRef): Promise<string | null> {
  try {
    switch (ref.tier) {
      case 'responders': {
        const rows = await query<{ email: string | null }>(
          `select email from public.responders where id = $1 limit 1`,
          [ref.principalId],
        );
        return rows[0]?.email ?? null;
      }
      case 'platform_admins': {
        const rows = await query<{ email: string | null }>(
          `select email from public.platform_admins where id = $1 limit 1`,
          [ref.principalId],
        );
        return rows[0]?.email ?? null;
      }
      case 'citizens': {
        // citizens.email is nullable (device-key-only accounts) → may be null.
        const rows = await query<{ email: string | null }>(
          `select email from public.citizens where id = $1 limit 1`,
          [ref.principalId],
        );
        return rows[0]?.email ?? null;
      }
      default:
        return null;
    }
  } catch {
    // Resilient: never throw out of emailAddressFor. A missing DATABASE config or a
    // failed query resolves to "no address", which the service treats as skipped.
    return null;
  }
}

export function getNotificationDeps(): NotificationServiceDeps {
  return {
    store: createPostgresNotificationStore(),
    // The real nodemailer EmailSender, gated on SMTP_* env. When SMTP is
    // unconfigured createEmailSender() returns null, which makes the Email channel
    // record not_attempted (R10.7).
    email: createEmailSender(),
    // The real web-push WebPushSender, gated on VAPID_* env. When VAPID keys are
    // unconfigured createWebPushSender() returns null, which makes the Web_Push
    // channel record not_attempted (R10.7).
    webPush: createWebPushSender(),
    now: () => Date.now(),
    emailAddressFor,
  };
}
