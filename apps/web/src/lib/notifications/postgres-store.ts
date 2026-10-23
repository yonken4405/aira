/**
 * Postgres `NotificationStore` adapter.
 *
 * The notification engine spans the three ISOLATED identity tiers (responders,
 * platform_admins, citizens) with no shared users FK: a recipient is the pair
 * `(recipient_tier, recipient_id)` (R9.4, R9.5). Every read/write is scoped to that
 * pair, so a notification is only ever visible to its addressee (R8.6) and a
 * cross-principal mark-read is impossible by construction.
 *
 * Tenant-scoped targeting reuses the exact `OFFICE_SCOPE` recursive CTE from
 * `incidents-store.ts` — seeded by the root office and hard-bounded to the starting
 * office's `tenant_id` — so a recipient set can never cross a tenant boundary (R13.4,
 * R16.1). Only area-bound citizens (`office_id` not null) participate.
 *
 * Server-only. Speaks plain `pg` through `./db`; all values are bound, never
 * interpolated. Mirrors the column-alias + row-mapping conventions of
 * `incidents-store.ts`.
 */

import { query, queryOne, type SqlParam } from '../db';
import type {
  BroadcastAudit,
  ChannelPreference,
  NotificationRecord,
  NotificationStore,
  NotificationTier,
  PushSubscriptionRecord,
  SystemNoticeAudit,
} from './types';

// Office subtree scope, hard-bounded to the starting office's tenant: the recursion
// only follows parent links WITHIN the same tenant, so a scope can never cross a
// tenant boundary even if a parent_id were ever mis-set (defense-in-depth,
// multi-tenant). Copied from incidents-store.ts (R13.4, R16.1); $1 = root office id,
// $2 = tenant id.
const OFFICE_SCOPE = `
  with recursive scope as (
    select id, tenant_id from public.offices where id = $1 and tenant_id = $2
    union all
    select o.id, o.tenant_id
      from public.offices o
      join scope s on o.parent_id = s.id and o.tenant_id = s.tenant_id
  )
`;

interface NotificationRow {
  id: string;
  recipientTier: NotificationTier;
  recipientId: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  critical: boolean;
  read: boolean;
  createdAt: Date;
}

const NOTIFICATION_COLUMNS = `
  n.id,
  n.recipient_tier as "recipientTier",
  n.recipient_id as "recipientId",
  n.type,
  n.title,
  n.body,
  n.data,
  n.critical,
  n.read,
  n.created_at as "createdAt"
`;

/** Rebuilds the domain record from a stored row (payload reconstructed from columns). */
function mapNotification(row: NotificationRow): NotificationRecord {
  return {
    id: row.id,
    recipient: { tier: row.recipientTier, principalId: row.recipientId },
    type: row.type,
    payload: {
      type: row.type,
      data: row.data ?? {},
      title: row.title,
      body: row.body,
    },
    read: row.read,
    critical: row.critical,
    createdAt: row.createdAt.getTime(),
  };
}

interface SubscriptionRow {
  id: string;
  recipientTier: NotificationTier;
  recipientId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  createdAt: Date;
}

const SUBSCRIPTION_COLUMNS = `
  s.id,
  s.recipient_tier as "recipientTier",
  s.recipient_id as "recipientId",
  s.endpoint,
  s.p256dh,
  s.auth,
  s.created_at as "createdAt"
`;

function mapSubscription(row: SubscriptionRow): PushSubscriptionRecord {
  return {
    id: row.id,
    recipient: { tier: row.recipientTier, principalId: row.recipientId },
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
    createdAt: row.createdAt.getTime(),
  };
}

export function createPostgresNotificationStore(): NotificationStore {
  return {
    async createNotification(input) {
      const row = await queryOne<{ id: string; createdAt: Date }>(
        `insert into public.notifications
           (recipient_tier, recipient_id, type, title, body, data, critical, created_at)
         values ($1::notification_tier, $2, $3, $4, $5, $6::jsonb, $7, $8)
         returning id, created_at as "createdAt"`,
        [
          input.recipient.tier,
          input.recipient.principalId,
          input.type,
          input.payload.title,
          input.payload.body,
          JSON.stringify(input.payload.data ?? {}),
          input.critical,
          new Date(input.createdAt),
        ],
      );
      if (!row) {
        throw new Error('notification_insert_failed');
      }

      return {
        id: row.id,
        recipient: input.recipient,
        type: input.type,
        payload: input.payload,
        read: false,
        critical: input.critical,
        createdAt: row.createdAt.getTime(),
      };
    },

    async recordDelivery(input) {
      // One row per (notification, channel): the upsert keeps exactly one recorded
      // outcome per channel per notification (R10.8).
      await query(
        `insert into public.notification_deliveries
           (notification_id, channel, outcome, overridden, recorded_at)
         values ($1, $2::notification_channel, $3::delivery_outcome, $4, $5)
         on conflict (notification_id, channel) do update
           set outcome = excluded.outcome,
               overridden = excluded.overridden,
               recorded_at = excluded.recorded_at`,
        [input.notificationId, input.channel, input.outcome, input.overridden, new Date(input.at)],
      );
    },

    async listForRecipient(recipient, limit) {
      const rows = await query<NotificationRow>(
        `select ${NOTIFICATION_COLUMNS}
           from public.notifications n
          where n.recipient_tier = $1::notification_tier
            and n.recipient_id = $2
          order by n.created_at desc
          limit $3`,
        [recipient.tier, recipient.principalId, limit],
      );
      return rows.map(mapNotification);
    },

    async countUnread(recipient) {
      const row = await queryOne<{ count: string }>(
        `select count(*)::text as count
           from public.notifications n
          where n.recipient_tier = $1::notification_tier
            and n.recipient_id = $2
            and n.read = false`,
        [recipient.tier, recipient.principalId],
      );
      return row ? Number(row.count) : 0;
    },

    async markRead(recipient, notificationId) {
      // Always (tier, id)-scoped: another principal can never mark this read (R8.6).
      await query(
        `update public.notifications
            set read = true
          where id = $1
            and recipient_tier = $2::notification_tier
            and recipient_id = $3`,
        [notificationId, recipient.tier, recipient.principalId],
      );
    },

    async markAllRead(recipient) {
      await query(
        `update public.notifications
            set read = true
          where recipient_tier = $1::notification_tier
            and recipient_id = $2
            and read = false`,
        [recipient.tier, recipient.principalId],
      );
    },

    async getPreference(recipient) {
      const row = await queryOne<{ inApp: boolean; email: boolean; webPush: boolean }>(
        `select in_app as "inApp", email, web_push as "webPush"
           from public.channel_preferences
          where recipient_tier = $1::notification_tier
            and recipient_id = $2
          limit 1`,
        [recipient.tier, recipient.principalId],
      );

      if (!row) {
        // Absent preference defaults all-enabled.
        return { recipient, inApp: true, email: true, webPush: true };
      }

      return {
        recipient,
        inApp: row.inApp,
        email: row.email,
        webPush: row.webPush,
      };
    },

    async setPreference(pref: ChannelPreference) {
      await query(
        `insert into public.channel_preferences
           (recipient_tier, recipient_id, in_app, email, web_push)
         values ($1::notification_tier, $2, $3, $4, $5)
         on conflict (recipient_tier, recipient_id) do update
           set in_app = excluded.in_app,
               email = excluded.email,
               web_push = excluded.web_push`,
        [pref.recipient.tier, pref.recipient.principalId, pref.inApp, pref.email, pref.webPush],
      );
    },

    async saveSubscription(sub) {
      await query(
        `insert into public.push_subscriptions
           (recipient_tier, recipient_id, endpoint, p256dh, auth, created_at)
         values ($1::notification_tier, $2, $3, $4, $5, $6)
         on conflict (recipient_tier, recipient_id, endpoint) do update
           set p256dh = excluded.p256dh,
               auth = excluded.auth`,
        [
          sub.recipient.tier,
          sub.recipient.principalId,
          sub.endpoint,
          sub.p256dh,
          sub.auth,
          new Date(sub.at),
        ],
      );
    },

    async deleteSubscription(recipient, endpoint) {
      await query(
        `delete from public.push_subscriptions
          where recipient_tier = $1::notification_tier
            and recipient_id = $2
            and endpoint = $3`,
        [recipient.tier, recipient.principalId, endpoint],
      );
    },

    async listSubscriptions(recipient) {
      const rows = await query<SubscriptionRow>(
        `select ${SUBSCRIPTION_COLUMNS}
           from public.push_subscriptions s
          where s.recipient_tier = $1::notification_tier
            and s.recipient_id = $2
          order by s.created_at asc`,
        [recipient.tier, recipient.principalId],
      );
      return rows.map(mapSubscription);
    },

    async resolveCitizensInOfficeScope(tenantId, rootOfficeId) {
      // The OFFICE_SCOPE subtree is the authoritative recipient set (R16.1): only
      // area-bound citizens whose office falls inside it, within the same tenant.
      const rows = await query<{ id: string }>(
        `${OFFICE_SCOPE}
         select c.id
           from public.citizens c
          where c.office_id in (select id from scope)
            and c.tenant_id = $2
          order by c.id asc`,
        [rootOfficeId, tenantId],
      );
      return rows.map((row) => ({ tier: 'citizens', principalId: row.id }));
    },

    async isOfficeInScope(tenantId, rootOfficeId, targetOfficeId) {
      // Targeting guard: true iff the target office is inside the sender's subtree
      // (same tenant) (R13.5, R16.2).
      const row = await queryOne<{ id: string }>(
        `${OFFICE_SCOPE}
         select id from scope where id = $3 limit 1`,
        [rootOfficeId, tenantId, targetOfficeId],
      );
      return row !== null;
    },

    async listAllPrincipals() {
      // System-notice fan-out (R15.3): the union of every active principal across the
      // three isolated tiers, each tagged with its own tier discriminator.
      const rows = await query<{ tier: NotificationTier; id: string }>(
        `select 'responders'::text as tier, id from public.responders where active
         union all
         select 'platform_admins'::text as tier, id from public.platform_admins where active
         union all
         select 'citizens'::text as tier, id from public.citizens where active`,
      );
      return rows.map((row) => ({ tier: row.tier, principalId: row.id }));
    },

    async listPlatformAdmins() {
      const rows = await query<{ id: string }>(
        `select id from public.platform_admins where active order by id asc`,
      );
      return rows.map((row) => ({ tier: 'platform_admins', principalId: row.id }));
    },

    async recordBroadcastAudit(entry: BroadcastAudit) {
      await query(
        `insert into public.civilian_broadcasts
           (sender_id, sender_role, tenant_id, granularity, target_office_id,
            recipient_count, outcome, violation, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          entry.senderId,
          entry.senderRole,
          entry.tenantId,
          entry.granularity,
          entry.targetOfficeId,
          entry.recipientCount,
          entry.outcome,
          entry.violation,
          new Date(entry.at),
        ] satisfies SqlParam[],
      );
    },

    async recordSystemNoticeAudit(entry: SystemNoticeAudit) {
      await query(
        `insert into public.system_notices (sender_id, created_at)
         values ($1, $2)`,
        [entry.senderId, new Date(entry.at)],
      );
    },
  };
}
