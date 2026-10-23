/**
 * @vitest-environment node
 *
 * NotificationStore — recipient-isolation property test (task 21.3).
 *
 * Feature: web-ux-and-notifications
 *
 * Encodes Property 8 from design.md over the `NotificationStore` port contract
 * that BOTH the in-memory and Postgres stores satisfy. The in-memory store
 * (`tests/support/memory-notification-store.ts`) is the system under test here;
 * because it is the same port the Postgres store implements, a leak that this
 * property can catch would be a contract violation of either backend.
 *
 * A recipient is keyed by the pair `(tier, principalId)` with no shared users FK
 * (R9.4, R9.5), so the SAME `principalId` string can legitimately belong to two
 * different tiers and MUST be treated as two distinct recipients. The generator
 * deliberately injects such collisions so the property proves tier is part of the
 * isolation key, not just the principal id.
 *
 * Every case is deterministic: the recipient set, the per-notification recipient
 * assignment, and `createdAt` are all drawn from the generated case — no real
 * clock or network. The property runs >= 100 iterations.
 *
 * This is a post-implementation property: it encodes an invariant the store
 * already satisfies and is EXPECTED TO PASS. A failing case would surface a real
 * isolation bug (reported with its counterexample), never a reason to weaken it.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type {
  NotificationPayload,
  NotificationTier,
  PrincipalRef,
} from '../src/lib/notifications/types';
import { createMemoryNotificationStore } from './support/memory-notification-store';

const RUNS = 100;
const BASE_NOW = 1_700_000_000_000;
/** Larger than any generated notification count, so `listForRecipient` is unbounded. */
const LARGE_LIMIT = 10_000;

const ALL_TIERS: readonly NotificationTier[] = ['responders', 'platform_admins', 'citizens'];

/** Stable isolation key — must match the store's `(tier, principalId)` contract. */
const keyOf = (r: PrincipalRef): string => `${r.tier}::${r.principalId}`;

const payloadFor = (type: string, index: number): NotificationPayload => ({
  type,
  data: { seq: index },
  title: `Notification ${index}`,
  body: `Body for notification ${index}.`,
});

/**
 * A recipient set that deliberately includes `principalId` collisions ACROSS
 * different tiers. We draw a pool of principal-id strings, then pick a non-empty
 * subset of `(tier, principalId)` pairs. Because every id is paired against each
 * tier independently, the same id string routinely appears under more than one
 * tier — exercising the "same principalId under a different tier" clause of
 * Property 8. The result is de-duplicated by `(tier, principalId)` so each
 * recipient is distinct.
 */
const recipientSetArb: fc.Arbitrary<readonly PrincipalRef[]> = fc
  .uniqueArray(
    fc.string({ minLength: 1, maxLength: 8 }).filter((s) => s.trim().length > 0),
    {
      minLength: 1,
      maxLength: 5,
    },
  )
  .chain((principalIds) =>
    fc
      .uniqueArray(
        fc.record({
          tier: fc.constantFrom<NotificationTier>(...ALL_TIERS),
          principalId: fc.constantFrom(...principalIds),
        }),
        {
          minLength: 1,
          maxLength: principalIds.length * ALL_TIERS.length,
          selector: keyOf,
        },
      )
      .map((pairs) => pairs as readonly PrincipalRef[]),
  );

describe('Property 8: Recipient isolation — a notification is only ever visible to its addressee', () => {
  // Feature: web-ux-and-notifications, Property 8
  // Validates: Requirements 8.6, 11.4, 12.4
  it('listForRecipient / countUnread / markAllRead never cross a (tier, principalId) boundary', async () => {
    await fc.assert(
      fc.asyncProperty(
        recipientSetArb
          .chain((recipients) =>
            fc.record({
              recipients: fc.constant(recipients),
              // Assign each of N notifications to one of the recipients by index.
              assignments: fc.array(fc.nat({ max: recipients.length - 1 }), {
                minLength: 0,
                maxLength: 30,
              }),
            }),
          )
          // Pick one distinct recipient to receive markAllRead, deterministically.
          .chain((caseData) =>
            fc.record({
              recipients: fc.constant(caseData.recipients),
              assignments: fc.constant(caseData.assignments),
              markIndex: fc.nat({ max: caseData.recipients.length - 1 }),
            }),
          ),
        async ({ recipients, assignments, markIndex }) => {
          const store = createMemoryNotificationStore();

          // --- Create every notification, each addressed to exactly one recipient. ---
          const expectedCount = new Map<string, number>();
          for (const r of recipients) expectedCount.set(keyOf(r), 0);

          for (let i = 0; i < assignments.length; i += 1) {
            const recipient = recipients[assignments[i]!]!;
            await store.createNotification({
              recipient,
              type: 'incident.assigned',
              payload: payloadFor('incident.assigned', i),
              critical: false,
              // Deterministic, strictly increasing timestamps from the case.
              createdAt: BASE_NOW + i,
            });
            expectedCount.set(keyOf(recipient), expectedCount.get(keyOf(recipient))! + 1);
          }

          // --- listForRecipient leaks nothing addressed to any other recipient. ---
          for (const r of recipients) {
            const rows = await store.listForRecipient(r, LARGE_LIMIT);
            for (const row of rows) {
              // Same tier AND same principalId — never another (tier, principalId),
              // including the same principalId string under a different tier.
              expect(row.recipient.tier).toBe(r.tier);
              expect(row.recipient.principalId).toBe(r.principalId);
            }
            // It returns ALL notifications addressed to exactly r (under LARGE_LIMIT).
            expect(rows).toHaveLength(expectedCount.get(keyOf(r))!);
          }

          // --- countUnread equals the number addressed to exactly that recipient. ---
          for (const r of recipients) {
            expect(await store.countUnread(r)).toBe(expectedCount.get(keyOf(r))!);
          }

          // --- markAllRead(R) zeroes only R; every other recipient is untouched. ---
          const target = recipients[markIndex]!;
          const othersBefore = new Map<string, number>();
          for (const r of recipients) {
            if (keyOf(r) !== keyOf(target)) othersBefore.set(keyOf(r), await store.countUnread(r));
          }

          await store.markAllRead(target);

          expect(await store.countUnread(target)).toBe(0);
          for (const r of recipients) {
            if (keyOf(r) === keyOf(target)) continue;
            // Unchanged for every OTHER distinct recipient — markAllRead did not
            // bleed across the tier/principal boundary.
            expect(await store.countUnread(r)).toBe(othersBefore.get(keyOf(r))!);
          }
        },
      ),
      { numRuns: RUNS },
    );
  });
});
