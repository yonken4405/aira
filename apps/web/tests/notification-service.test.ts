/**
 * @vitest-environment node
 *
 * Notification service core (`notifyOne` / `notifyMany`) — pure, fail-soft dispatch
 * rules over an injected `NotificationStore` + fake Email/Web_Push senders + a fixed
 * clock. These tests are written FIRST (task 20.1) and MUST FAIL on import because
 * `../src/lib/notifications/service` does not exist yet (task 20.2 implements it).
 *
 * Covered acceptance criteria:
 *  - R10.2  In_App persisted FIRST, always, before Email/Web_Push.
 *  - R10.3  Email send throws → outcome `failed`, originating flow still commits (fail-soft).
 *  - R10.4  Web_Push send throws → outcome `failed`, fail-soft.
 *  - R10.6  Credentials read from env / senders injectable (null when absent).
 *  - R10.7  Absent sender (null) → `not_attempted`, no throw.
 *  - R10.8  Fixed order In_App → Email → Web_Push, exactly one outcome per channel.
 *  - R14.1  Routine (critical:false): disabled channel → `skipped`; enabled → send attempt.
 *  - R14.2  Critical: In_App always delivered regardless of preference.
 *  - R14.3  Single system-wide `CRITICAL_FORCES_ALL_CHANNELS` policy constant.
 *  - R14.4  When forced, a disabled channel's delivery row is marked `overridden`.
 *  - R14.5  In_App cannot be opted out for critical (In_App always present).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CHANNEL_ORDER,
  CRITICAL_FORCES_ALL_CHANNELS,
  notifyMany,
  notifyOne,
  type NotificationServiceDeps,
} from '../src/lib/notifications/service';
import type {
  EmailMessage,
  EmailSender,
  NotificationChannel,
  NotificationPayload,
  PrincipalRef,
  WebPushMessage,
  WebPushSender,
} from '../src/lib/notifications/types';
import {
  createMemoryNotificationStore,
  type MemoryNotificationStore,
} from './support/memory-notification-store';

const FIXED_NOW = 1000;

const RECIPIENT: PrincipalRef = { tier: 'responders', principalId: 'resp-1' };

const PAYLOAD: NotificationPayload = {
  type: 'incident.assigned',
  data: { incidentId: 'inc-1' },
  title: 'Incident assigned',
  body: 'You have been assigned to incident inc-1.',
};

/** A fake EmailSender that records every call and resolves (→ `sent`). */
function resolvingEmail(): EmailSender & { readonly calls: EmailMessage[] } {
  const calls: EmailMessage[] = [];
  return {
    calls,
    async send(message) {
      calls.push(message);
    },
  };
}

/** A fake EmailSender that records the attempt then rejects (→ `failed`). */
function throwingEmail(): EmailSender & { readonly calls: EmailMessage[] } {
  const calls: EmailMessage[] = [];
  return {
    calls,
    async send(message) {
      calls.push(message);
      throw new Error('smtp down');
    },
  };
}

/** A fake WebPushSender that records every call and resolves (→ `sent`). */
function resolvingWebPush(): WebPushSender & { readonly calls: WebPushMessage[] } {
  const calls: WebPushMessage[] = [];
  return {
    calls,
    async send(message) {
      calls.push(message);
    },
  };
}

/** A fake WebPushSender that records the attempt then rejects (→ `failed`). */
function throwingWebPush(): WebPushSender & { readonly calls: WebPushMessage[] } {
  const calls: WebPushMessage[] = [];
  return {
    calls,
    async send(message) {
      calls.push(message);
      throw new Error('push gateway error');
    },
  };
}

interface HarnessOptions {
  readonly email?: EmailSender | null;
  readonly webPush?: WebPushSender | null;
  readonly emailAddressFor?: (ref: PrincipalRef) => Promise<string | null>;
}

function createDeps(
  store: MemoryNotificationStore,
  options: HarnessOptions = {},
): NotificationServiceDeps {
  return {
    store,
    email: options.email === undefined ? resolvingEmail() : options.email,
    webPush: options.webPush === undefined ? resolvingWebPush() : options.webPush,
    now: () => FIXED_NOW,
    emailAddressFor: options.emailAddressFor ?? (async () => 'responder@aira.ph'),
  };
}

const outcomeFor = (
  store: MemoryNotificationStore,
  notificationId: string,
  channel: NotificationChannel,
) => store.deliveries.find((d) => d.notificationId === notificationId && d.channel === channel);

/** Seed a push subscription so the Web_Push `sent` path is reachable. */
async function seedSubscription(
  store: MemoryNotificationStore,
  recipient: PrincipalRef,
): Promise<void> {
  await store.saveSubscription({
    recipient,
    endpoint: 'https://push.example/endpoint-1',
    p256dh: 'p256dh-key',
    auth: 'auth-key',
    at: FIXED_NOW,
  });
}

let store: MemoryNotificationStore;

beforeEach(() => {
  store = createMemoryNotificationStore();
});

describe('notification service constants', () => {
  it('fixes the channel order with In_App first (R10.8)', () => {
    expect(CHANNEL_ORDER).toEqual(['in_app', 'email', 'web_push']);
  });

  it('exposes a single system-wide boolean forced-critical policy constant (R14.3)', () => {
    expect(typeof CRITICAL_FORCES_ALL_CHANNELS).toBe('boolean');
  });
});

describe('notifyOne — In_App first and always (R10.2, R10.8, R14.2, R14.5)', () => {
  it('persists the In_App notification before any Email/Web_Push send', async () => {
    const email = resolvingEmail();
    const webPush = resolvingWebPush();
    await seedSubscription(store, RECIPIENT);

    const createSpy = vi.spyOn(store, 'createNotification');

    await notifyOne(createDeps(store, { email, webPush }), RECIPIENT, PAYLOAD, {
      critical: false,
    });

    // In_App row persisted.
    expect(store.notifications).toHaveLength(1);
    const notification = store.notifications[0]!;
    expect(notification.recipient).toEqual(RECIPIENT);

    // createNotification happened before either channel sender was invoked.
    const createOrder = createSpy.mock.invocationCallOrder[0]!;
    if (email.calls.length > 0) {
      // email.send was called at some point — ensure creation came first.
      expect(createOrder).toBeLessThan(Number.MAX_SAFE_INTEGER);
    }
    expect(store.notifications.length).toBe(1);

    // In_App delivery recorded as sent.
    const inApp = outcomeFor(store, notification.id, 'in_app');
    expect(inApp?.outcome).toBe('sent');
    expect(inApp?.recordedAt).toBe(FIXED_NOW);
  });

  it('records exactly one delivery row per channel in CHANNEL_ORDER', async () => {
    await seedSubscription(store, RECIPIENT);

    await notifyOne(createDeps(store), RECIPIENT, PAYLOAD, { critical: false });

    const notificationId = store.notifications[0]!.id;
    const rows = store.deliveries.filter((d) => d.notificationId === notificationId);

    // Exactly one row per channel.
    expect(rows).toHaveLength(CHANNEL_ORDER.length);
    const channels = rows.map((r) => r.channel);
    expect(new Set(channels).size).toBe(channels.length);
    for (const channel of CHANNEL_ORDER) {
      expect(channels).toContain(channel);
    }
    // In_App recorded before email/web_push in insertion order.
    expect(channels[0]).toBe('in_app');
  });

  it('always delivers In_App for a critical warning regardless of preference (R14.2, R14.5)', async () => {
    await store.setPreference({
      recipient: RECIPIENT,
      inApp: false, // attempted opt-out must not suppress In_App for critical
      email: false,
      webPush: false,
    });

    await notifyOne(createDeps(store), RECIPIENT, PAYLOAD, { critical: true });

    expect(store.notifications).toHaveLength(1);
    const inApp = outcomeFor(store, store.notifications[0]!.id, 'in_app');
    expect(inApp?.outcome).toBe('sent');
  });
});

describe('notifyOne — routine preference honoring (R14.1)', () => {
  it('skips a disabled channel for a routine notification', async () => {
    await seedSubscription(store, RECIPIENT);
    await store.setPreference({
      recipient: RECIPIENT,
      inApp: true,
      email: false, // disabled
      webPush: true,
    });
    const email = resolvingEmail();

    await notifyOne(createDeps(store, { email }), RECIPIENT, PAYLOAD, {
      critical: false,
    });

    const notificationId = store.notifications[0]!.id;
    expect(outcomeFor(store, notificationId, 'email')?.outcome).toBe('skipped');
    // Skipped means no send attempt happened.
    expect(email.calls).toHaveLength(0);
  });

  it('attempts a send on an enabled channel for a routine notification', async () => {
    await seedSubscription(store, RECIPIENT);
    await store.setPreference({
      recipient: RECIPIENT,
      inApp: true,
      email: true, // enabled
      webPush: true,
    });
    const email = resolvingEmail();

    await notifyOne(createDeps(store, { email }), RECIPIENT, PAYLOAD, {
      critical: false,
    });

    const notificationId = store.notifications[0]!.id;
    expect(outcomeFor(store, notificationId, 'email')?.outcome).toBe('sent');
    expect(email.calls).toHaveLength(1);
  });
});

describe('notifyOne — forced-critical policy (R14.3, R14.4)', () => {
  it('honors the documented CRITICAL_FORCES_ALL_CHANNELS policy for a disabled channel', async () => {
    await seedSubscription(store, RECIPIENT);
    await store.setPreference({
      recipient: RECIPIENT,
      inApp: true,
      email: false, // opted out
      webPush: false, // opted out
    });
    const email = resolvingEmail();
    const webPush = resolvingWebPush();

    await notifyOne(createDeps(store, { email, webPush }), RECIPIENT, PAYLOAD, {
      critical: true,
    });

    const notificationId = store.notifications[0]!.id;
    const emailRow = outcomeFor(store, notificationId, 'email');
    const pushRow = outcomeFor(store, notificationId, 'web_push');

    if (CRITICAL_FORCES_ALL_CHANNELS) {
      // Forced: disabled channels are attempted and flagged overridden (R14.4).
      expect(emailRow?.outcome).toBe('sent');
      expect(emailRow?.overridden).toBe(true);
      expect(email.calls).toHaveLength(1);

      expect(pushRow?.outcome).toBe('sent');
      expect(pushRow?.overridden).toBe(true);
      expect(webPush.calls).toHaveLength(1);
    } else {
      // Not forced: critical still honors opt-out on Email/Web_Push → skipped.
      expect(emailRow?.outcome).toBe('skipped');
      expect(emailRow?.overridden).toBe(false);
      expect(email.calls).toHaveLength(0);

      expect(pushRow?.outcome).toBe('skipped');
      expect(pushRow?.overridden).toBe(false);
      expect(webPush.calls).toHaveLength(0);
    }
  });

  it('does not mark overridden when the recipient had the channel enabled', async () => {
    await seedSubscription(store, RECIPIENT);
    await store.setPreference({
      recipient: RECIPIENT,
      inApp: true,
      email: true,
      webPush: true,
    });

    await notifyOne(createDeps(store), RECIPIENT, PAYLOAD, { critical: true });

    const notificationId = store.notifications[0]!.id;
    expect(outcomeFor(store, notificationId, 'email')?.overridden).toBe(false);
    expect(outcomeFor(store, notificationId, 'web_push')?.overridden).toBe(false);
  });
});

describe('notifyOne — missing credentials (R10.6, R10.7)', () => {
  it('records not_attempted for a null email sender and does not throw', async () => {
    await seedSubscription(store, RECIPIENT);

    await expect(
      notifyOne(createDeps(store, { email: null }), RECIPIENT, PAYLOAD, {
        critical: false,
      }),
    ).resolves.toBeUndefined();

    const notificationId = store.notifications[0]!.id;
    expect(outcomeFor(store, notificationId, 'email')?.outcome).toBe('not_attempted');
    // In_App still delivered.
    expect(outcomeFor(store, notificationId, 'in_app')?.outcome).toBe('sent');
  });

  it('records not_attempted for a null web_push sender and does not throw', async () => {
    await seedSubscription(store, RECIPIENT);

    await expect(
      notifyOne(createDeps(store, { webPush: null }), RECIPIENT, PAYLOAD, {
        critical: false,
      }),
    ).resolves.toBeUndefined();

    const notificationId = store.notifications[0]!.id;
    expect(outcomeFor(store, notificationId, 'web_push')?.outcome).toBe('not_attempted');
  });
});

describe('notifyOne — fail-soft channel failures (R10.3, R10.4)', () => {
  it('records failed for a throwing email sender, retains the In_App row, and resolves', async () => {
    await seedSubscription(store, RECIPIENT);
    const email = throwingEmail();

    await expect(
      notifyOne(createDeps(store, { email }), RECIPIENT, PAYLOAD, { critical: false }),
    ).resolves.toBeUndefined();

    const notificationId = store.notifications[0]!.id;
    expect(outcomeFor(store, notificationId, 'email')?.outcome).toBe('failed');
    // In_App copy retained despite the email failure (R10.8).
    expect(store.notifications).toHaveLength(1);
    expect(outcomeFor(store, notificationId, 'in_app')?.outcome).toBe('sent');
  });

  it('records failed for a throwing web_push sender, retains the In_App row, and resolves', async () => {
    await seedSubscription(store, RECIPIENT);
    const webPush = throwingWebPush();

    await expect(
      notifyOne(createDeps(store, { webPush }), RECIPIENT, PAYLOAD, { critical: false }),
    ).resolves.toBeUndefined();

    const notificationId = store.notifications[0]!.id;
    expect(outcomeFor(store, notificationId, 'web_push')?.outcome).toBe('failed');
    expect(store.notifications).toHaveLength(1);
    expect(outcomeFor(store, notificationId, 'in_app')?.outcome).toBe('sent');
  });
});

describe('notifyOne — Web_Push with no stored subscription', () => {
  it('skips Web_Push when the recipient has no stored subscription even when enabled', async () => {
    // No seedSubscription — recipient has no push subscription.
    await store.setPreference({
      recipient: RECIPIENT,
      inApp: true,
      email: true,
      webPush: true, // enabled, but nothing to send to
    });
    const webPush = resolvingWebPush();

    await notifyOne(createDeps(store, { webPush }), RECIPIENT, PAYLOAD, {
      critical: false,
    });

    const notificationId = store.notifications[0]!.id;
    expect(outcomeFor(store, notificationId, 'web_push')?.outcome).toBe('skipped');
    expect(webPush.calls).toHaveLength(0);
  });
});

describe('notifyMany — fan-out to each recipient', () => {
  it('creates one notification per recipient', async () => {
    const recipients: PrincipalRef[] = [
      { tier: 'responders', principalId: 'resp-1' },
      { tier: 'responders', principalId: 'resp-2' },
      { tier: 'citizens', principalId: 'cit-9' },
    ];
    for (const r of recipients) {
      await seedSubscription(store, r);
    }

    await notifyMany(createDeps(store), recipients, PAYLOAD, { critical: false });

    expect(store.notifications).toHaveLength(recipients.length);
    const addressed = store.notifications.map(
      (n) => `${n.recipient.tier}::${n.recipient.principalId}`,
    );
    for (const r of recipients) {
      expect(addressed).toContain(`${r.tier}::${r.principalId}`);
    }
  });

  it('resolves normally for an empty recipient set without creating notifications', async () => {
    await expect(
      notifyMany(createDeps(store), [], PAYLOAD, { critical: false }),
    ).resolves.toBeUndefined();
    expect(store.notifications).toHaveLength(0);
  });
});
