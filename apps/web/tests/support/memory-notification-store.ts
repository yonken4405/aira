/**
 * In-memory `NotificationStore` for notification-engine tests (TESTING.md §4.3).
 *
 * Mirrors `memory-incidents-store.ts` / `memory-platform-store.ts`: a factory
 * returning a store that implements the full `NotificationStore` port in memory,
 * plus public inspection fields and seeding hooks so service/handler tests can
 * drive targeting resolvers (the real `OFFICE_SCOPE` CTE cannot run in memory)
 * and assert on persisted rows (R22.1, R22.3, R22.4).
 */

import type {
  BroadcastAudit,
  ChannelPreference,
  DeliveryRecord,
  NotificationRecord,
  NotificationStore,
  PrincipalRef,
  PushSubscriptionRecord,
  SystemNoticeAudit,
} from '../../src/lib/notifications/types';

export interface MemoryNotificationStore extends NotificationStore {
  /** All persisted notifications in insertion order (oldest first). */
  readonly notifications: NotificationRecord[];
  /** One row per `(notificationId, channel)`. */
  readonly deliveries: DeliveryRecord[];
  /** Keyed by `recipientKey(recipient)`. */
  readonly preferences: Map<string, ChannelPreference>;
  /** All stored Web_Push subscriptions. */
  readonly subscriptions: PushSubscriptionRecord[];
  /** Captured `recordBroadcastAudit` calls. */
  readonly broadcastAudits: BroadcastAudit[];
  /** Captured `recordSystemNoticeAudit` calls. */
  readonly systemNoticeAudits: SystemNoticeAudit[];

  /**
   * Seed which citizen principals are inside a given `(tenantId, rootOfficeId)`
   * OFFICE_SCOPE for `resolveCitizensInOfficeScope`.
   */
  seedCitizenScope(tenantId: string, rootOfficeId: string, refs: readonly PrincipalRef[]): void;
  /**
   * Seed which target office ids are inside a given `(tenantId, rootOfficeId)`
   * subtree for `isOfficeInScope`.
   */
  seedOfficeScope(tenantId: string, rootOfficeId: string, officeIds: readonly string[]): void;
  /** Seed the principals returned by `listAllPrincipals`. */
  seedAllPrincipals(refs: readonly PrincipalRef[]): void;
  /** Seed the principals returned by `listPlatformAdmins`. */
  seedPlatformAdmins(refs: readonly PrincipalRef[]): void;
}

const recipientKey = (recipient: PrincipalRef): string =>
  `${recipient.tier}::${recipient.principalId}`;

const sameRecipient = (a: PrincipalRef, b: PrincipalRef): boolean =>
  a.tier === b.tier && a.principalId === b.principalId;

const defaultPreference = (recipient: PrincipalRef): ChannelPreference => ({
  recipient,
  inApp: true,
  email: true,
  webPush: true,
});

let sequence = 0;
const nextId = (prefix: string): string => {
  sequence += 1;
  return `${prefix}-${sequence}`;
};

export function createMemoryNotificationStore(): MemoryNotificationStore {
  const notifications: NotificationRecord[] = [];
  const deliveries: DeliveryRecord[] = [];
  const preferences = new Map<string, ChannelPreference>();
  const subscriptions: PushSubscriptionRecord[] = [];
  const broadcastAudits: BroadcastAudit[] = [];
  const systemNoticeAudits: SystemNoticeAudit[] = [];

  // Seedable targeting state (stands in for the real OFFICE_SCOPE CTE).
  const citizenScope = new Map<string, PrincipalRef[]>();
  const officeScope = new Map<string, Set<string>>();
  let allPrincipals: PrincipalRef[] = [];
  let platformAdmins: PrincipalRef[] = [];

  const scopeKey = (tenantId: string, rootOfficeId: string): string =>
    `${tenantId}::${rootOfficeId}`;

  return {
    notifications,
    deliveries,
    preferences,
    subscriptions,
    broadcastAudits,
    systemNoticeAudits,

    seedCitizenScope(tenantId, rootOfficeId, refs) {
      citizenScope.set(scopeKey(tenantId, rootOfficeId), [...refs]);
    },

    seedOfficeScope(tenantId, rootOfficeId, officeIds) {
      officeScope.set(scopeKey(tenantId, rootOfficeId), new Set(officeIds));
    },

    seedAllPrincipals(refs) {
      allPrincipals = [...refs];
    },

    seedPlatformAdmins(refs) {
      platformAdmins = [...refs];
    },

    async createNotification(input) {
      const record: NotificationRecord = {
        id: nextId('notif'),
        recipient: input.recipient,
        type: input.type,
        payload: input.payload,
        read: false,
        critical: input.critical,
        createdAt: input.createdAt,
      };
      notifications.push(record);
      return record;
    },

    async recordDelivery(input) {
      const row: DeliveryRecord = {
        notificationId: input.notificationId,
        channel: input.channel,
        outcome: input.outcome,
        overridden: input.overridden,
        recordedAt: input.at,
      };
      const index = deliveries.findIndex(
        (d) => d.notificationId === row.notificationId && d.channel === row.channel,
      );
      if (index >= 0) {
        deliveries[index] = row;
      } else {
        deliveries.push(row);
      }
    },

    async listForRecipient(recipient, limit) {
      return notifications
        .filter((n) => sameRecipient(n.recipient, recipient))
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit);
    },

    async countUnread(recipient) {
      return notifications.filter((n) => sameRecipient(n.recipient, recipient) && !n.read).length;
    },

    async markRead(recipient, notificationId) {
      const index = notifications.findIndex(
        (n) => n.id === notificationId && sameRecipient(n.recipient, recipient),
      );
      const current = index >= 0 ? notifications[index] : undefined;
      if (current) {
        notifications[index] = { ...current, read: true };
      }
    },

    async markAllRead(recipient) {
      for (let i = 0; i < notifications.length; i += 1) {
        const n = notifications[i];
        if (n && sameRecipient(n.recipient, recipient) && !n.read) {
          notifications[i] = { ...n, read: true };
        }
      }
    },

    async getPreference(recipient) {
      return preferences.get(recipientKey(recipient)) ?? defaultPreference(recipient);
    },

    async setPreference(pref) {
      preferences.set(recipientKey(pref.recipient), pref);
    },

    async saveSubscription(sub) {
      const index = subscriptions.findIndex(
        (s) => sameRecipient(s.recipient, sub.recipient) && s.endpoint === sub.endpoint,
      );
      const record: PushSubscriptionRecord = {
        id: index >= 0 ? (subscriptions[index] as PushSubscriptionRecord).id : nextId('push'),
        recipient: sub.recipient,
        endpoint: sub.endpoint,
        p256dh: sub.p256dh,
        auth: sub.auth,
        createdAt: sub.at,
      };
      if (index >= 0) {
        subscriptions[index] = record;
      } else {
        subscriptions.push(record);
      }
    },

    async deleteSubscription(recipient, endpoint) {
      for (let i = subscriptions.length - 1; i >= 0; i -= 1) {
        const s = subscriptions[i];
        if (s && sameRecipient(s.recipient, recipient) && s.endpoint === endpoint) {
          subscriptions.splice(i, 1);
        }
      }
    },

    async listSubscriptions(recipient) {
      return subscriptions.filter((s) => sameRecipient(s.recipient, recipient));
    },

    async resolveCitizensInOfficeScope(tenantId, rootOfficeId) {
      return citizenScope.get(scopeKey(tenantId, rootOfficeId)) ?? [];
    },

    async isOfficeInScope(tenantId, rootOfficeId, targetOfficeId) {
      return officeScope.get(scopeKey(tenantId, rootOfficeId))?.has(targetOfficeId) ?? false;
    },

    async listAllPrincipals() {
      return [...allPrincipals];
    },

    async listPlatformAdmins() {
      return [...platformAdmins];
    },

    async recordBroadcastAudit(entry) {
      broadcastAudits.push(entry);
    },

    async recordSystemNoticeAudit(entry) {
      systemNoticeAudits.push(entry);
    },
  };
}
