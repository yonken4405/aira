/**
 * @vitest-environment node
 *
 * Notification service core — property-based tests (tasks 20.3–20.7).
 *
 * Feature: web-ux-and-notifications
 *
 * These encode Properties 1–5 from design.md over the pure, fail-soft dispatch
 * rules in `../src/lib/notifications/service` (`notifyOne` / `notifyMany`). They
 * run against the in-memory `NotificationStore` plus configurable fake
 * Email/Web_Push senders (resolving / throwing / null) generated from fast-check
 * arbitraries, a fixed clock, and an `emailAddressFor` stub.
 *
 * Every property is deterministic: senders, preferences, subscription presence
 * and the critical flag are all seeded from the generated case — no real timers
 * or network. Each property runs >= 100 iterations.
 *
 * These are post-implementation properties: they encode invariants the existing
 * service already satisfies and are EXPECTED TO PASS. A failing property would
 * surface a real service bug (reported with its counterexample), never a reason
 * to weaken the property.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

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

const RUNS = 100;
const FIXED_NOW = 1_700_000_000_000;

const PAYLOAD: NotificationPayload = {
  type: 'incident.assigned',
  data: { incidentId: 'inc-1' },
  title: 'Incident assigned',
  body: 'You have been assigned to incident inc-1.',
};

/** How a generated sender should behave on `send`. */
type SenderMode = 'resolving' | 'throwing' | 'null';

/** fast-check arbitrary over the three sender dispositions. */
const senderMode: fc.Arbitrary<SenderMode> = fc.constantFrom<SenderMode>(
  'resolving',
  'throwing',
  'null',
);

/** An arbitrary recipient keyed by tier + principal id. */
const recipientArb: fc.Arbitrary<PrincipalRef> = fc.record({
  tier: fc.constantFrom<PrincipalRef['tier']>('responders', 'platform_admins', 'citizens'),
  principalId: fc.string({ minLength: 1, maxLength: 12 }).filter((s) => s.trim().length > 0),
});

/** Per-channel preference booleans (In_App is never opt-outable for critical). */
const preferenceArb = fc.record({
  inApp: fc.boolean(),
  email: fc.boolean(),
  webPush: fc.boolean(),
});

function makeEmail(mode: SenderMode): (EmailSender & { readonly calls: EmailMessage[] }) | null {
  if (mode === 'null') return null;
  const calls: EmailMessage[] = [];
  return {
    calls,
    async send(message) {
      calls.push(message);
      if (mode === 'throwing') throw new Error('smtp down');
    },
  };
}

function makeWebPush(
  mode: SenderMode,
): (WebPushSender & { readonly calls: WebPushMessage[] }) | null {
  if (mode === 'null') return null;
  const calls: WebPushMessage[] = [];
  return {
    calls,
    async send(message) {
      calls.push(message);
      if (mode === 'throwing') throw new Error('push gateway error');
    },
  };
}

interface DepsOptions {
  readonly email: EmailSender | null;
  readonly webPush: WebPushSender | null;
  readonly emailAddress?: string | null;
}

function createDeps(store: MemoryNotificationStore, options: DepsOptions): NotificationServiceDeps {
  return {
    store,
    email: options.email,
    webPush: options.webPush,
    now: () => FIXED_NOW,
    emailAddressFor: async () =>
      options.emailAddress === undefined ? 'recipient@aira.ph' : options.emailAddress,
  };
}

async function seedSubscription(
  store: MemoryNotificationStore,
  recipient: PrincipalRef,
): Promise<void> {
  await store.saveSubscription({
    recipient,
    endpoint: `https://push.example/${recipient.tier}/${recipient.principalId}`,
    p256dh: 'p256dh-key',
    auth: 'auth-key',
    at: FIXED_NOW,
  });
}

const rowsFor = (store: MemoryNotificationStore, notificationId: string) =>
  store.deliveries.filter((d) => d.notificationId === notificationId);

const outcomeFor = (
  store: MemoryNotificationStore,
  notificationId: string,
  channel: NotificationChannel,
) => store.deliveries.find((d) => d.notificationId === notificationId && d.channel === channel);

// ---------------------------------------------------------------------------
// Property 1 — Fixed channel order with In_App first, one outcome per channel.
// Feature: web-ux-and-notifications, Property 1
// Validates: Requirements 10.2, 10.8
// ---------------------------------------------------------------------------
describe('Property 1: Fixed channel order with In_App first and exactly one outcome per channel', () => {
  it('records In_App first, one row per channel, never duplicates', async () => {
    await fc.assert(
      fc.asyncProperty(
        recipientArb,
        preferenceArb,
        fc.boolean(), // critical
        senderMode, // email
        senderMode, // web_push
        fc.boolean(), // subscription present
        fc.boolean(), // email address present
        async (recipient, pref, critical, emailMode, pushMode, hasSub, hasAddress) => {
          const store = createMemoryNotificationStore();
          await store.setPreference({ recipient, ...pref });
          if (hasSub) await seedSubscription(store, recipient);

          const deps = createDeps(store, {
            email: makeEmail(emailMode),
            webPush: makeWebPush(pushMode),
            emailAddress: hasAddress ? 'recipient@aira.ph' : null,
          });

          await notifyOne(deps, recipient, PAYLOAD, { critical });

          expect(store.notifications).toHaveLength(1);
          const id = store.notifications[0]!.id;
          const rows = rowsFor(store, id);

          // Exactly one row per channel in {in_app, email, web_push}.
          expect(rows).toHaveLength(CHANNEL_ORDER.length);
          const channels = rows.map((r) => r.channel);
          expect(new Set(channels).size).toBe(channels.length);
          for (const channel of CHANNEL_ORDER) {
            expect(channels).toContain(channel);
            // Never more than one row per channel.
            expect(channels.filter((c) => c === channel)).toHaveLength(1);
          }

          // In_App is recorded first (insertion order).
          expect(channels[0]).toBe('in_app');
          // In_App outcome is always 'sent'.
          expect(outcomeFor(store, id, 'in_app')?.outcome).toBe('sent');
        },
      ),
      { numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2 — Fail-soft: a channel failure never throws out of dispatch.
// Feature: web-ux-and-notifications, Property 2
// Validates: Requirements 10.3, 10.4, 10.5, 10.8
// ---------------------------------------------------------------------------
describe('Property 2: Fail-soft — a channel failure never throws out of dispatch', () => {
  it('notifyOne always resolves, retains In_App, and records failed for a throwing reachable sender', async () => {
    await fc.assert(
      fc.asyncProperty(
        recipientArb,
        fc.boolean(), // critical
        senderMode, // email
        senderMode, // web_push
        async (recipient, critical, emailMode, pushMode) => {
          const store = createMemoryNotificationStore();
          // All channels enabled + a subscription present so throwing senders
          // are actually reached (and thus can record `failed`).
          await store.setPreference({ recipient, inApp: true, email: true, webPush: true });
          await seedSubscription(store, recipient);

          const deps = createDeps(store, {
            email: makeEmail(emailMode),
            webPush: makeWebPush(pushMode),
            emailAddress: 'recipient@aira.ph',
          });

          // Never rejects.
          await expect(notifyOne(deps, recipient, PAYLOAD, { critical })).resolves.toBeUndefined();

          const id = store.notifications[0]!.id;
          // In_App always persists.
          expect(store.notifications).toHaveLength(1);
          expect(outcomeFor(store, id, 'in_app')?.outcome).toBe('sent');

          // A throwing (and reachable) sender yields 'failed', never a thrown error.
          if (emailMode === 'throwing') {
            expect(outcomeFor(store, id, 'email')?.outcome).toBe('failed');
          }
          if (pushMode === 'throwing') {
            expect(outcomeFor(store, id, 'web_push')?.outcome).toBe('failed');
          }
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('notifyMany over a list of recipients always resolves even when senders throw', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(recipientArb, { minLength: 0, maxLength: 5 }),
        fc.boolean(), // critical
        senderMode, // email
        senderMode, // web_push
        async (recipients, critical, emailMode, pushMode) => {
          const store = createMemoryNotificationStore();
          for (const r of recipients) {
            await store.setPreference({ recipient: r, inApp: true, email: true, webPush: true });
            await seedSubscription(store, r);
          }

          const deps = createDeps(store, {
            email: makeEmail(emailMode),
            webPush: makeWebPush(pushMode),
            emailAddress: 'recipient@aira.ph',
          });

          await expect(
            notifyMany(deps, recipients, PAYLOAD, { critical }),
          ).resolves.toBeUndefined();

          // One In_App notification created per recipient.
          expect(store.notifications).toHaveLength(recipients.length);
        },
      ),
      { numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3 — Missing credential yields not_attempted, not an error.
// Feature: web-ux-and-notifications, Property 3
// Validates: Requirements 10.6, 10.7
// ---------------------------------------------------------------------------
describe('Property 3: Missing credential yields not_attempted, not an error', () => {
  it('a null sender on a reached channel records not_attempted and notifyOne resolves', async () => {
    await fc.assert(
      fc.asyncProperty(
        recipientArb,
        fc.boolean(), // critical
        fc.boolean(), // email null?
        fc.boolean(), // web_push null?
        async (recipient, critical, emailNull, pushNull) => {
          const store = createMemoryNotificationStore();
          // Enable both channels and seed a subscription so each channel is
          // actually REACHED — the opt-out `skipped` short-circuit (which runs
          // before the credential check) is not in play here. Property 3 is
          // about what a reached channel does when its credential is absent.
          await store.setPreference({ recipient, inApp: true, email: true, webPush: true });
          await seedSubscription(store, recipient);

          const email = emailNull ? null : makeEmail('resolving');
          const webPush = pushNull ? null : makeWebPush('resolving');

          const deps = createDeps(store, {
            email,
            webPush,
            emailAddress: 'recipient@aira.ph',
          });

          // Never raises.
          await expect(notifyOne(deps, recipient, PAYLOAD, { critical })).resolves.toBeUndefined();

          const id = store.notifications[0]!.id;

          // A null sender on a reached channel → not_attempted, no send possible.
          if (emailNull) {
            expect(outcomeFor(store, id, 'email')?.outcome).toBe('not_attempted');
          } else {
            // A present sender on a reached+enabled channel was attempted, so it
            // is never recorded as not_attempted.
            expect(outcomeFor(store, id, 'email')?.outcome).not.toBe('not_attempted');
          }

          if (pushNull) {
            expect(outcomeFor(store, id, 'web_push')?.outcome).toBe('not_attempted');
          } else {
            expect(outcomeFor(store, id, 'web_push')?.outcome).not.toBe('not_attempted');
          }
        },
      ),
      { numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4 — Preference honored for routine, In_App forced for critical.
// Feature: web-ux-and-notifications, Property 4
// Validates: Requirements 14.1, 14.2, 14.5
// ---------------------------------------------------------------------------
describe('Property 4: Preference honored for routine, In_App forced for critical', () => {
  it('routine: a disabled channel is skipped with no attempt', async () => {
    await fc.assert(
      fc.asyncProperty(recipientArb, preferenceArb, async (recipient, pref) => {
        const store = createMemoryNotificationStore();
        await store.setPreference({ recipient, ...pref });
        await seedSubscription(store, recipient);

        const email = makeEmail('resolving')!;
        const webPush = makeWebPush('resolving')!;
        const deps = createDeps(store, {
          email,
          webPush,
          emailAddress: 'recipient@aira.ph',
        });

        await notifyOne(deps, recipient, PAYLOAD, { critical: false });

        const id = store.notifications[0]!.id;

        // A disabled channel on a routine notification is skipped with no send.
        if (!pref.email) {
          expect(outcomeFor(store, id, 'email')?.outcome).toBe('skipped');
          expect(email.calls).toHaveLength(0);
        }
        if (!pref.webPush) {
          expect(outcomeFor(store, id, 'web_push')?.outcome).toBe('skipped');
          expect(webPush.calls).toHaveLength(0);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('critical: In_App is always sent regardless of an inApp:false preference', async () => {
    await fc.assert(
      fc.asyncProperty(
        recipientArb,
        fc.boolean(), // email pref
        fc.boolean(), // webPush pref
        async (recipient, emailPref, webPushPref) => {
          const store = createMemoryNotificationStore();
          // Attempted In_App opt-out must not suppress the critical In_App copy.
          await store.setPreference({
            recipient,
            inApp: false,
            email: emailPref,
            webPush: webPushPref,
          });
          await seedSubscription(store, recipient);

          const deps = createDeps(store, {
            email: makeEmail('resolving'),
            webPush: makeWebPush('resolving'),
            emailAddress: 'recipient@aira.ph',
          });

          await notifyOne(deps, recipient, PAYLOAD, { critical: true });

          const id = store.notifications[0]!.id;
          expect(outcomeFor(store, id, 'in_app')?.outcome).toBe('sent');
        },
      ),
      { numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 5 — Forced-critical policy is uniform and records overrides.
// Feature: web-ux-and-notifications, Property 5
// Validates: Requirements 14.3, 14.4
// ---------------------------------------------------------------------------
describe('Property 5: Forced-critical policy is uniform and records overrides', () => {
  it('critical delivery depends only on the system-wide constant and flags overridden correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        recipientArb,
        fc.boolean(), // email enabled?
        fc.boolean(), // webPush enabled?
        async (recipient, emailEnabled, webPushEnabled) => {
          const store = createMemoryNotificationStore();
          await store.setPreference({
            recipient,
            inApp: true,
            email: emailEnabled,
            webPush: webPushEnabled,
          });
          // A sender + target exist for both channels so a forced attempt lands.
          await seedSubscription(store, recipient);
          const email = makeEmail('resolving')!;
          const webPush = makeWebPush('resolving')!;
          const deps = createDeps(store, {
            email,
            webPush,
            emailAddress: 'recipient@aira.ph',
          });

          await notifyOne(deps, recipient, PAYLOAD, { critical: true });

          const id = store.notifications[0]!.id;
          const emailRow = outcomeFor(store, id, 'email');
          const pushRow = outcomeFor(store, id, 'web_push');

          // Branch on the documented system-wide constant — the property states
          // the behavior each policy value guarantees.
          if (CRITICAL_FORCES_ALL_CHANNELS) {
            // A disabled channel is attempted (sender + target exist) and its
            // delivery row is overridden=true; an enabled channel is overridden=false.
            if (!emailEnabled) {
              expect(emailRow?.outcome).toBe('sent');
              expect(emailRow?.overridden).toBe(true);
              expect(email.calls).toHaveLength(1);
            } else {
              expect(emailRow?.outcome).toBe('sent');
              expect(emailRow?.overridden).toBe(false);
            }

            if (!webPushEnabled) {
              expect(pushRow?.outcome).toBe('sent');
              expect(pushRow?.overridden).toBe(true);
              expect(webPush.calls).toHaveLength(1);
            } else {
              expect(pushRow?.outcome).toBe('sent');
              expect(pushRow?.overridden).toBe(false);
            }
          } else {
            // Not forced: critical still honors the opt-out on Email/Web_Push.
            if (!emailEnabled) {
              expect(emailRow?.outcome).toBe('skipped');
              expect(emailRow?.overridden).toBe(false);
              expect(email.calls).toHaveLength(0);
            }
            if (!webPushEnabled) {
              expect(pushRow?.outcome).toBe('skipped');
              expect(pushRow?.overridden).toBe(false);
              expect(webPush.calls).toHaveLength(0);
            }
          }
        },
      ),
      { numRuns: RUNS },
    );
  });
});
