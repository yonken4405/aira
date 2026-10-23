/**
 * @vitest-environment node
 *
 * Task 28.1 — FAILING tests for the notification event hooks (R10.5, R11.1–11.4,
 * R12.1–12.4). These assert the notification side-effects that task 28.2 will wire
 * into the EXISTING handlers; until the hooks exist, no notification is created, so
 * every "a notification was created" assertion here fails for the right reason.
 *
 * The hooks (28.2) call `notifyOne`/`notifyMany` AFTER the primary mutation has
 * already succeeded, inside the same request, fail-soft — a thrown channel/store
 * must never change the HTTP result (R10.5). Design: design.md "Event hook points".
 *
 *   - incident assign → `handleAssignIncident` → notify the assigned responder
 *     (tier 'responders', principalId = assignee id), type 'incident.assigned' (R11.1).
 *   - account lock → `login` ACCOUNT_LOCKED path; unlock / role-change / deactivate →
 *     `updateResponder` → notify the affected responder only (R11.2, R11.4).
 *   - tenant onboard → `handleCreateTenant`; suspend → `handleSetTenantStatus` →
 *     notify platform admins, no incident/citizen data (R12.1, R12.2, R12.4).
 *
 * Fail-soft is injected purely through deps (a notification store whose
 * `createNotification` rejects), never by editing production code.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { handleLogin } from '../src/lib/api/auth-handlers';
import { handleUpdateResponder } from '../src/lib/api/admin-handlers';
import { handleAssignIncident } from '../src/lib/api/incidents-handlers';
import {
  handleCreateTenant,
  handlePlatformLogin,
  handleSetTenantStatus,
} from '../src/lib/api/platform-handlers';
import { hashPassword } from '../src/lib/auth/password';
import { PLATFORM_SESSION_COOKIE } from '../src/lib/platform/session';
import type { AppDeps } from '../src/lib/api/deps';
import type { MemoryNotificationStore } from './support/memory-notification-store';
import { createMemoryIncidentsStore } from './support/memory-incidents-store';
import { createTestClock, createTestHarness, jsonBody, withSession } from './support/harness';
import { TEST_PASSWORD, makeIncident } from './support/fixtures';

const PLATFORM_PASSWORD = 'correct horse battery staple';

/**
 * A notification store whose `createNotification` always rejects, wrapping a real
 * memory store so inspection still works. This is the fail-soft injection: a hook
 * that persists an In_App notification will throw, and the test asserts the
 * ORIGINATING request still commits (HTTP success). No production code is touched.
 */
function failingNotificationStore(base: MemoryNotificationStore): MemoryNotificationStore {
  return {
    ...base,
    async createNotification() {
      throw new Error('notification_store_down');
    },
  };
}

function depsWithFailingNotifications(deps: AppDeps, base: MemoryNotificationStore): AppDeps {
  return {
    ...deps,
    notifications: {
      ...deps.notifications,
      store: failingNotificationStore(base),
    },
  };
}

// ---------------------------------------------------------------------------
// Incident assign → the assigned responder (R11.1), fail-soft (R10.5).
// ---------------------------------------------------------------------------

describe('event hook: incident assign notifies the assigned responder (R11.1, R10.5)', () => {
  function createWorld() {
    const clock = createTestClock();
    const incidents = createMemoryIncidentsStore({
      now: clock.now,
      incidents: [makeIncident({ id: 'i-queued', category: 'SUNOG' })],
      responders: { 'responder-field': 'K9-01', 'responder-dispatcher': 'OPCEN-01' },
    });
    const harness = createTestHarness({ clock, incidents });
    harness.authStore.seedResponder({
      id: 'responder-field',
      callsign: 'K9-01',
      role: 'RESPONDER',
    });
    harness.authStore.seedResponder({
      id: 'responder-dispatcher',
      callsign: 'OPCEN-01',
      role: 'DISPATCHER',
    });

    return { ...harness, clock };
  }

  async function dispatcherToken(deps: AppDeps): Promise<string> {
    const response = await handleLogin(
      new Request(
        'http://localhost/api/auth/login',
        jsonBody('POST', { email: 'opcen-01@aira.test', password: TEST_PASSWORD }),
      ),
      deps,
    );
    const cookie = response.headers.get('set-cookie') ?? '';
    const token = /aira_session=([A-Za-z0-9_-]+)/.exec(cookie)?.[1];
    if (!token) {
      throw new Error('dispatcher_login_failed');
    }
    return token;
  }

  let world: ReturnType<typeof createWorld>;
  beforeEach(() => {
    world = createWorld();
  });

  const assign = (deps: AppDeps, token: string): Promise<Response> =>
    handleAssignIncident(
      withSession(
        'http://localhost/api/incidents/i-queued/assign',
        token,
        jsonBody('POST', { responderId: 'responder-field' }),
      ),
      deps,
      'i-queued',
    );

  it('creates a notification addressed to the assigned responder on a successful assign', async () => {
    const token = await dispatcherToken(world.deps);

    const response = await assign(world.deps, token);
    expect(response.status).toBe(200);

    // R11.1 / R11.4: exactly the assigned responder (responders tier) is notified.
    const notifications = world.notificationStore.notifications;
    const forAssignee = notifications.filter(
      (n) => n.recipient.tier === 'responders' && n.recipient.principalId === 'responder-field',
    );
    expect(forAssignee).toHaveLength(1);
    expect(forAssignee[0]?.type).toContain('assign');
    // The acting dispatcher is NOT a recipient (notify the affected responder only).
    expect(notifications.some((n) => n.recipient.principalId === 'responder-dispatcher')).toBe(
      false,
    );
  });

  it('still returns 200 when the notification store throws (fail-soft, R10.5)', async () => {
    const token = await dispatcherToken(world.deps);
    const deps = depsWithFailingNotifications(world.deps, world.notificationStore);

    const response = await assign(deps, token);

    // The assignment transaction commits regardless of the notification failure.
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { ok: boolean; incident: { status: string } };
    expect(payload.ok).toBe(true);
    expect(payload.incident.status).toBe('DISPATCHED');
  });
});

// ---------------------------------------------------------------------------
// Account events → the affected responder only (R11.2, R11.4), fail-soft (R10.5).
// ---------------------------------------------------------------------------

describe('event hook: account events notify the affected responder only (R11.2, R11.4, R10.5)', () => {
  function setup() {
    const clock = createTestClock();
    const harness = createTestHarness({ clock });
    // An ADMIN actor drives the admin HTTP mutations; the target responder is the
    // affected principal that must be notified.
    harness.authStore.seedResponder({ id: 'responder-admin', callsign: 'ADMIN-1', role: 'ADMIN' });
    const responder = harness.authStore.seedResponder({
      id: 'responder-field',
      callsign: 'K9-01',
      role: 'RESPONDER',
    });
    harness.authStore.seedResponder({
      id: 'responder-other',
      callsign: 'K9-02',
      role: 'RESPONDER',
    });
    return { ...harness, clock, responder };
  }

  let world: ReturnType<typeof setup>;
  beforeEach(() => {
    world = setup();
  });

  async function adminToken(deps: AppDeps): Promise<string> {
    const response = await handleLogin(
      new Request(
        'http://localhost/api/auth/login',
        jsonBody('POST', { email: 'admin-1@aira.test', password: TEST_PASSWORD }),
      ),
      deps,
    );
    const cookie = response.headers.get('set-cookie') ?? '';
    const token = /aira_session=([A-Za-z0-9_-]+)/.exec(cookie)?.[1];
    if (!token) {
      throw new Error('admin_login_failed');
    }
    return token;
  }

  const updateResponderHttp = (
    deps: AppDeps,
    token: string,
    patch: Record<string, unknown>,
  ): Promise<Response> =>
    handleUpdateResponder(
      withSession(
        'http://localhost/api/admin/responders/responder-field',
        token,
        jsonBody('PATCH', patch),
      ),
      deps,
      'responder-field',
    );

  const notificationsFor = (store: MemoryNotificationStore, principalId: string) =>
    store.notifications.filter(
      (n) => n.recipient.tier === 'responders' && n.recipient.principalId === principalId,
    );

  it('role-change notifies the affected responder only', async () => {
    const token = await adminToken(world.deps);
    const response = await updateResponderHttp(world.deps, token, { role: 'DISPATCHER' });
    expect(response.status).toBe(200);

    expect(notificationsFor(world.notificationStore, 'responder-field')).toHaveLength(1);
    // Neither the acting admin nor an uninvolved responder is notified (R11.4).
    expect(notificationsFor(world.notificationStore, 'responder-other')).toHaveLength(0);
    expect(notificationsFor(world.notificationStore, 'responder-admin')).toHaveLength(0);
  });

  it('deactivate notifies the affected responder', async () => {
    const token = await adminToken(world.deps);
    const response = await updateResponderHttp(world.deps, token, { active: false });
    expect(response.status).toBe(200);

    expect(notificationsFor(world.notificationStore, 'responder-field')).toHaveLength(1);
  });

  it('unlock notifies the affected responder', async () => {
    const token = await adminToken(world.deps);
    const response = await updateResponderHttp(world.deps, token, { unlock: true });
    expect(response.status).toBe(200);

    expect(notificationsFor(world.notificationStore, 'responder-field')).toHaveLength(1);
  });

  it('account lock (max login failures) notifies the affected responder', async () => {
    // Drive the ACCOUNT_LOCKED path: five consecutive bad-password logins.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await handleLogin(
        new Request(
          'http://localhost/api/auth/login',
          jsonBody('POST', { email: 'k9-01@aira.test', password: 'wrong-password' }),
        ),
        world.deps,
      );
    }

    expect(notificationsFor(world.notificationStore, 'responder-field')).toHaveLength(1);
  });

  it('role-change still succeeds (200) when the notification store throws (fail-soft, R10.5)', async () => {
    const token = await adminToken(world.deps);
    const deps = depsWithFailingNotifications(world.deps, world.notificationStore);

    const response = await updateResponderHttp(deps, token, { role: 'DISPATCHER' });

    // The account mutation commits even though notifying the responder failed.
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { ok: boolean; responder: { role: string } };
    expect(payload.ok).toBe(true);
    expect(payload.responder.role).toBe('DISPATCHER');
  });
});

// ---------------------------------------------------------------------------
// Tenant events → platform admins, no incident/citizen data (R12.1/12.2/12.4),
// fail-soft (R10.5).
// ---------------------------------------------------------------------------

describe('event hook: tenant events notify platform admins (R12.1, R12.2, R12.4, R10.5)', () => {
  let world: ReturnType<typeof createTestHarness>;

  beforeEach(async () => {
    world = createTestHarness();
    world.platformStore.seedAdmin({
      id: 'ops-1',
      email: 'ops@aira.ph',
      passwordHash: await hashPassword(PLATFORM_PASSWORD),
    });
    // The hook resolves recipients via store.listPlatformAdmins(); seed that set so a
    // wired hook has an addressee. Until 28.2 wires it, nothing is created.
    world.notificationStore.seedPlatformAdmins([{ tier: 'platform_admins', principalId: 'ops-1' }]);
  });

  async function opsToken(deps: AppDeps): Promise<string> {
    const response = await handlePlatformLogin(
      new Request(
        'http://localhost/api/platform/login',
        jsonBody('POST', { email: 'ops@aira.ph', password: PLATFORM_PASSWORD }),
      ),
      deps,
    );
    const cookie = response.headers.get('set-cookie') ?? '';
    const token = new RegExp(`${PLATFORM_SESSION_COOKIE}=([A-Za-z0-9_-]+)`).exec(cookie)?.[1];
    if (!token) {
      throw new Error('platform_login_failed');
    }
    return token;
  }

  const withPlatform = (url: string, token: string, init: RequestInit = {}): Request => {
    const headers = new Headers(init.headers);
    headers.set('cookie', `${PLATFORM_SESSION_COOKIE}=${token}`);
    return new Request(url, { ...init, headers });
  };

  const createTenant = (deps: AppDeps, token: string, name: string): Promise<Response> =>
    handleCreateTenant(
      withPlatform(
        'http://localhost/api/platform/tenants',
        token,
        jsonBody('POST', {
          name,
          region: 'Region VII',
          province: 'Cebu',
          lguName: name,
          lat: 10.3234,
          lon: 123.9222,
        }),
      ),
      deps,
    );

  const platformNotifications = (store: MemoryNotificationStore) =>
    store.notifications.filter((n) => n.recipient.tier === 'platform_admins');

  it('onboarding a tenant notifies platform admins with no incident/citizen data', async () => {
    const token = await opsToken(world.deps);

    const created = await createTenant(world.deps, token, 'Mandaue City DRRMO');
    expect(created.status).toBe(201);

    const platformNotifs = platformNotifications(world.notificationStore);
    expect(platformNotifs.length).toBeGreaterThanOrEqual(1);
    expect(platformNotifs.some((n) => n.recipient.principalId === 'ops-1')).toBe(true);

    // R12.4: platform notifications carry no incident/citizen fields.
    for (const notif of platformNotifs) {
      const serialized = JSON.stringify(notif);
      expect(serialized).not.toContain('reporterCitizenId');
      expect(serialized).not.toContain('citizenId');
      expect(serialized).not.toContain('incidentId');
    }
  });

  it('suspending a tenant notifies platform admins', async () => {
    const token = await opsToken(world.deps);

    const created = await createTenant(world.deps, token, 'Lapu City DRRMO');
    const { tenant } = (await created.json()) as { tenant: { id: string } };

    // Count platform notifications created by onboarding, then assert suspend adds one.
    const before = platformNotifications(world.notificationStore).length;

    const suspended = await handleSetTenantStatus(
      withPlatform(
        `http://localhost/api/platform/tenants/${tenant.id}`,
        token,
        jsonBody('PATCH', { status: 'suspended' }),
      ),
      world.deps,
      tenant.id,
    );
    expect(suspended.status).toBe(200);

    const after = platformNotifications(world.notificationStore).length;
    expect(after).toBeGreaterThan(before);
  });

  it('still onboards the tenant (201) when the notification store throws (fail-soft, R10.5)', async () => {
    const token = await opsToken(world.deps);
    const deps = depsWithFailingNotifications(world.deps, world.notificationStore);

    const created = await createTenant(deps, token, 'Resilient City DRRMO');

    // R10.5: onboarding commits even when notifying platform admins fails.
    expect(created.status).toBe(201);
    const payload = (await created.json()) as { ok: boolean; tenant: { name: string } };
    expect(payload.ok).toBe(true);
    expect(payload.tenant.name).toBe('Resilient City DRRMO');
  });
});
