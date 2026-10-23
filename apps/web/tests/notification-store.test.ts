/**
 * @vitest-environment node
 *
 * NotificationStore PORT contract tests (task 21.1), written test-first for the
 * Postgres store (task 21.2). The task note says "memory-backed where the DB is
 * unavailable": these assertions pin the behavioral CONTRACT that BOTH the
 * in-memory store (`tests/support/memory-notification-store.ts`) and the future
 * `postgres-store.ts` must satisfy. The real `OFFICE_SCOPE` recursive CTE runs
 * only in Postgres; here we pin the port's observable behavior so 21.2 has a
 * target and recipient isolation is guaranteed at the port/API level.
 *
 * Covered acceptance criteria:
 *  - R8.6   A notification is only ever visible to its addressee.
 *  - R11.4  Responder-targeted events reach only the affected responder.
 *  - R12.4  Platform events reach only platform admins (no cross-principal leak).
 *  - R13.4  Tenant-scoped targeting resolves recipients via OFFICE_SCOPE.
 *  - R16.1  The OFFICE_SCOPE bound is the authoritative recipient set.
 *
 * Two describe blocks, by design:
 *  - "NotificationStore port contract (memory-backed)" — GREEN now: the memory
 *    store already implements the port, so these lock the contract.
 *  - "Postgres NotificationStore factory (task 21.2)" — RED now: it imports
 *    `../src/lib/notifications/postgres-store`, which does not exist yet. That
 *    failing import is the genuine red signal for task 21.2.
 */

import { describe, expect, it } from 'vitest';

import type { NotificationRecord, PrincipalRef } from '../src/lib/notifications/types';
import {
  createMemoryNotificationStore,
  type MemoryNotificationStore,
} from './support/memory-notification-store';

const NOW = 1_000;

/** Seed one unread notification for `recipient`, returning the stored record. */
async function seedNotification(
  store: MemoryNotificationStore,
  recipient: PrincipalRef,
  overrides: Partial<{ type: string; critical: boolean; createdAt: number }> = {},
): Promise<NotificationRecord> {
  const type = overrides.type ?? 'incident.assigned';
  return store.createNotification({
    recipient,
    type,
    payload: {
      type,
      data: {},
      title: `Title for ${recipient.tier}:${recipient.principalId}`,
      body: 'Body',
    },
    critical: overrides.critical ?? false,
    createdAt: overrides.createdAt ?? NOW,
  });
}

describe('NotificationStore port contract (memory-backed)', () => {
  describe('recipient isolation (R8.6, R11.4, R12.4)', () => {
    // The SAME principalId string under DIFFERENT tiers — proves the tier is part
    // of identity and the two are distinct recipients that must never see each
    // other's notifications.
    const responderX: PrincipalRef = { tier: 'responders', principalId: 'x' };
    const citizenX: PrincipalRef = { tier: 'citizens', principalId: 'x' };
    const responderY: PrincipalRef = { tier: 'responders', principalId: 'y' };
    const platformZ: PrincipalRef = { tier: 'platform_admins', principalId: 'z' };

    it('listForRecipient returns only the queried (tier, principalId), never another principal or the same id under another tier', async () => {
      const store = createMemoryNotificationStore();
      const rx = await seedNotification(store, responderX, { type: 'resp.x' });
      const cx = await seedNotification(store, citizenX, { type: 'cit.x' });
      const ry = await seedNotification(store, responderY, { type: 'resp.y' });
      const pz = await seedNotification(store, platformZ, { type: 'plat.z' });

      const responderXList = await store.listForRecipient(responderX, 50);
      expect(responderXList.map((n) => n.id)).toEqual([rx.id]);
      // Same id "x" under the citizens tier must NOT leak in.
      expect(responderXList.some((n) => n.id === cx.id)).toBe(false);
      // Other responders must NOT leak in.
      expect(responderXList.some((n) => n.id === ry.id)).toBe(false);
      expect(responderXList.every((n) => n.recipient.tier === 'responders')).toBe(true);
      expect(responderXList.every((n) => n.recipient.principalId === 'x')).toBe(true);

      const citizenXList = await store.listForRecipient(citizenX, 50);
      expect(citizenXList.map((n) => n.id)).toEqual([cx.id]);
      expect(citizenXList.some((n) => n.id === rx.id)).toBe(false);

      const platformZList = await store.listForRecipient(platformZ, 50);
      expect(platformZList.map((n) => n.id)).toEqual([pz.id]);
      expect(platformZList.some((n) => n.id === ry.id)).toBe(false);
    });

    it('countUnread counts only the exact (tier, principalId)', async () => {
      const store = createMemoryNotificationStore();
      await seedNotification(store, responderX);
      await seedNotification(store, responderX);
      await seedNotification(store, citizenX); // same id, different tier
      await seedNotification(store, responderY);

      expect(await store.countUnread(responderX)).toBe(2);
      expect(await store.countUnread(citizenX)).toBe(1);
      expect(await store.countUnread(responderY)).toBe(1);
      // A principal with nothing addressed to it sees zero.
      expect(await store.countUnread(platformZ)).toBe(0);
    });

    it('markRead affects only the addressee and never the same id under another tier', async () => {
      const store = createMemoryNotificationStore();
      const rx = await seedNotification(store, responderX);
      const cx = await seedNotification(store, citizenX);

      // Another principal (citizenX) cannot mark responderX's notification read.
      await store.markRead(citizenX, rx.id);
      expect(await store.countUnread(responderX)).toBe(1);
      expect(await store.countUnread(citizenX)).toBe(1);

      // The rightful addressee can.
      await store.markRead(responderX, rx.id);
      expect(await store.countUnread(responderX)).toBe(0);
      // citizenX untouched.
      expect(await store.countUnread(citizenX)).toBe(1);
      const cxList = await store.listForRecipient(citizenX, 50);
      expect(cxList.find((n) => n.id === cx.id)?.read).toBe(false);
    });

    it('markAllRead zeroes only the addressee and leaves every other principal/tier unread', async () => {
      const store = createMemoryNotificationStore();
      await seedNotification(store, responderX);
      await seedNotification(store, responderX);
      await seedNotification(store, citizenX); // same id string, other tier
      await seedNotification(store, responderY);
      await seedNotification(store, platformZ);

      await store.markAllRead(responderX);

      expect(await store.countUnread(responderX)).toBe(0);
      // Every other recipient is untouched — including id "x" under citizens.
      expect(await store.countUnread(citizenX)).toBe(1);
      expect(await store.countUnread(responderY)).toBe(1);
      expect(await store.countUnread(platformZ)).toBe(1);
    });
  });

  describe('scope resolution contract (R13.4, R16.1)', () => {
    const tenantId = 'tenant-1';
    const rootOfficeId = 'office-root';
    const citizenA: PrincipalRef = { tier: 'citizens', principalId: 'cit-a' };
    const citizenB: PrincipalRef = { tier: 'citizens', principalId: 'cit-b' };

    it('resolveCitizensInOfficeScope returns exactly the seeded citizen refs for that (tenantId, rootOfficeId)', async () => {
      const store = createMemoryNotificationStore();
      store.seedCitizenScope(tenantId, rootOfficeId, [citizenA, citizenB]);

      const resolved = await store.resolveCitizensInOfficeScope(tenantId, rootOfficeId);
      expect([...resolved]).toEqual([citizenA, citizenB]);
    });

    it('resolveCitizensInOfficeScope returns empty for an unseeded scope (different tenant or root)', async () => {
      const store = createMemoryNotificationStore();
      store.seedCitizenScope(tenantId, rootOfficeId, [citizenA, citizenB]);

      expect([...(await store.resolveCitizensInOfficeScope('other-tenant', rootOfficeId))]).toEqual(
        [],
      );
      expect([...(await store.resolveCitizensInOfficeScope(tenantId, 'other-root'))]).toEqual([]);
      // An entirely unseeded store resolves to empty.
      const fresh = createMemoryNotificationStore();
      expect([...(await fresh.resolveCitizensInOfficeScope(tenantId, rootOfficeId))]).toEqual([]);
    });

    it('isOfficeInScope is true only for seeded in-scope office ids, false otherwise', async () => {
      const store = createMemoryNotificationStore();
      store.seedOfficeScope(tenantId, rootOfficeId, ['office-child-1', 'office-child-2']);

      expect(await store.isOfficeInScope(tenantId, rootOfficeId, 'office-child-1')).toBe(true);
      expect(await store.isOfficeInScope(tenantId, rootOfficeId, 'office-child-2')).toBe(true);
      // An office not in the seeded subtree.
      expect(await store.isOfficeInScope(tenantId, rootOfficeId, 'office-outside')).toBe(false);
    });

    it('isOfficeInScope is false for a different tenant or root even when the office id matches', async () => {
      const store = createMemoryNotificationStore();
      store.seedOfficeScope(tenantId, rootOfficeId, ['office-child-1']);

      // Same target office id, but a different tenant / root is a different scope.
      expect(await store.isOfficeInScope('other-tenant', rootOfficeId, 'office-child-1')).toBe(
        false,
      );
      expect(await store.isOfficeInScope(tenantId, 'other-root', 'office-child-1')).toBe(false);
    });
  });
});

describe('Postgres NotificationStore factory (task 21.2)', () => {
  // RED for 21.2: this dynamic import resolves `postgres-store.ts`, which does
  // NOT exist yet. The failing import is the intended red signal; task 21.2 makes
  // it green by creating the module with a `createPostgresNotificationStore`
  // factory that exposes the NotificationStore shape.
  it('exposes a createPostgresNotificationStore factory matching the NotificationStore port', async () => {
    const mod = await import('../src/lib/notifications/postgres-store');
    expect(typeof mod.createPostgresNotificationStore).toBe('function');
  });
});
