/**
 * Notification domain types + ports.
 *
 * The notification engine spans all three identity tiers (responders, platform
 * admins, citizens) without a shared users FK: a recipient is keyed by the pair
 * `(tier, principalId)` (R9.4, R9.5). This module declares ONLY the domain types,
 * the channel sender ports (the Email/Web_Push testability seam), and the
 * `NotificationStore` persistence port. Service rules, store implementations, and
 * runtime wiring live in `service.ts`, `memory-store.ts` / `postgres-store.ts`, and
 * `runtime.ts` respectively.
 */

import type { Role } from '../auth/rbac';

/** The three identity tiers a notification may be addressed to. */
export type NotificationTier = 'responders' | 'platform_admins' | 'citizens';

/** The fixed set of delivery channels. In_App is always first and authoritative. */
export type NotificationChannel = 'in_app' | 'email' | 'web_push';

/** The outcome recorded for each attempted (or skipped) channel delivery. */
export type DeliveryOutcome = 'sent' | 'failed' | 'skipped' | 'not_attempted';

/**
 * The tier-scoped recipient key — mirrors how each tier is keyed, with no shared
 * users FK (R9.4, R9.5).
 */
export interface PrincipalRef {
  readonly tier: NotificationTier;
  /** responders.id | platform_admins.id | citizens.id */
  readonly principalId: string;
}

/** The structured + rendered content of a notification (R9.7). */
export interface NotificationPayload {
  /** e.g. 'incident.assigned', 'account.locked' */
  readonly type: string;
  /** Structured context (R9.7). */
  readonly data: Readonly<Record<string, unknown>>;
  /** Rendered presentation (R9.7). */
  readonly title: string;
  readonly body: string;
}

/** A persisted In_App notification scoped to a single recipient. */
export interface NotificationRecord {
  readonly id: string;
  readonly recipient: PrincipalRef;
  readonly type: string;
  readonly payload: NotificationPayload;
  readonly read: boolean;
  readonly critical: boolean;
  /** UTC ms (R9.1). */
  readonly createdAt: number;
}

/** The outcome of dispatching a notification over one channel. */
export interface DeliveryRecord {
  readonly notificationId: string;
  readonly channel: NotificationChannel;
  readonly outcome: DeliveryOutcome;
  /** Critical override of an opt-out (R14.4). */
  readonly overridden: boolean;
  /** UTC (R9.2). */
  readonly recordedAt: number;
}

/** A recipient's per-channel delivery preferences. */
export interface ChannelPreference {
  readonly recipient: PrincipalRef;
  /** Cannot be false for critical (R14.5). */
  readonly inApp: boolean;
  readonly email: boolean;
  readonly webPush: boolean;
}

/** A stored Web_Push subscription bound to exactly one tier principal (R9.4). */
export interface PushSubscriptionRecord {
  readonly id: string;
  readonly recipient: PrincipalRef;
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
  readonly createdAt: number;
}

// --- Channel sender ports — the testability seam for Email/Web_Push. ---

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
}

/** Throws on failure (recorded as `'failed'`). */
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export interface WebPushMessage {
  readonly subscription: PushSubscriptionRecord;
  readonly payload: NotificationPayload;
}

/** Throws on failure (recorded as `'failed'`). */
export interface WebPushSender {
  send(message: WebPushMessage): Promise<void>;
}

/** Persistence port. Memory + Postgres implementations (test seam, R22). */
export interface NotificationStore {
  createNotification(input: Omit<NotificationRecord, 'id' | 'read'>): Promise<NotificationRecord>;
  recordDelivery(
    input: Omit<DeliveryRecord, 'recordedAt'> & { readonly at: number },
  ): Promise<void>;
  listForRecipient(recipient: PrincipalRef, limit: number): Promise<readonly NotificationRecord[]>;
  countUnread(recipient: PrincipalRef): Promise<number>;
  markRead(recipient: PrincipalRef, notificationId: string): Promise<void>;
  markAllRead(recipient: PrincipalRef): Promise<void>;

  /** Defaults all-enabled when absent. */
  getPreference(recipient: PrincipalRef): Promise<ChannelPreference>;
  setPreference(pref: ChannelPreference): Promise<void>;

  saveSubscription(
    sub: Omit<PushSubscriptionRecord, 'id' | 'createdAt'> & { readonly at: number },
  ): Promise<void>;
  deleteSubscription(recipient: PrincipalRef, endpoint: string): Promise<void>;
  listSubscriptions(recipient: PrincipalRef): Promise<readonly PushSubscriptionRecord[]>;

  /** Recipient resolvers for broadcast/notice targeting. */
  /** OFFICE_SCOPE (R13.4, R16.1). */
  resolveCitizensInOfficeScope(
    tenantId: string,
    rootOfficeId: string,
  ): Promise<readonly PrincipalRef[]>;
  /** Targeting guard (R13.5, R16.2). */
  isOfficeInScope(tenantId: string, rootOfficeId: string, targetOfficeId: string): Promise<boolean>;
  /** System-notice fan-out (R15.3). */
  listAllPrincipals(): Promise<readonly PrincipalRef[]>;
  /** Platform events (R12). */
  listPlatformAdmins(): Promise<readonly PrincipalRef[]>;

  /** R13.7 */
  recordBroadcastAudit(entry: BroadcastAudit): Promise<void>;
  /** R15.6 */
  recordSystemNoticeAudit(entry: SystemNoticeAudit): Promise<void>;
}

/** Audit row for a civilian-broadcast send (R13.7). */
export interface BroadcastAudit {
  readonly senderId: string;
  readonly senderRole: Role;
  readonly tenantId: string;
  readonly granularity: 'tenant' | 'barangay';
  readonly targetOfficeId: string | null;
  readonly recipientCount: number;
  readonly outcome: 'accepted' | 'denied';
  readonly violation: string | null;
  readonly at: number;
}

/** Audit row for a platform system-notice send (R15.6). */
export interface SystemNoticeAudit {
  readonly senderId: string;
  readonly at: number;
}
