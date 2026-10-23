/**
 * @vitest-environment node
 *
 * Web_Push subscription-registration endpoint (`/api/notifications/subscriptions`).
 *
 * A subscription is bound to the authenticated caller's `(tier, principalId)` pair and
 * is owner-scoped: a caller may only register/modify its OWN subscription, never
 * another principal's (R9.4). These handler tests drive the real handlers with the
 * memory `NotificationStore` from the test harness (TESTING.md §4.3) and assert on the
 * persisted `notificationStore.subscriptions` rows.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { handleLogin } from '../src/lib/api/auth-handlers';
import {
  handleRegisterPushSubscription,
  handleUnregisterPushSubscription,
} from '../src/lib/api/push-subscription-handlers';
import { createTestHarness, jsonBody, withSession } from './support/harness';
import { TEST_PASSWORD } from './support/fixtures';

const URL = 'http://localhost/api/notifications/subscriptions';

const SUBSCRIPTION = {
  endpoint: 'https://push.example.com/sub/abc123',
  keys: { p256dh: 'p256dh-key-value', auth: 'auth-key-value' },
};

function makeWorld() {
  const harness = createTestHarness();
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

  async function tokenFor(callsign: string): Promise<string> {
    const response = await handleLogin(
      new Request(
        'http://localhost/api/auth/login',
        jsonBody('POST', { email: `${callsign.toLowerCase()}@aira.test`, password: TEST_PASSWORD }),
      ),
      harness.deps,
    );
    const cookie = response.headers.get('set-cookie') ?? '';
    const token = /aira_session=([A-Za-z0-9_-]+)/.exec(cookie)?.[1];
    if (!token) {
      throw new Error(`login_failed_${callsign}_${response.status}`);
    }
    return token;
  }

  return { ...harness, tokenFor };
}

let world: ReturnType<typeof makeWorld>;

beforeEach(() => {
  world = makeWorld();
});

describe('POST /api/notifications/subscriptions', () => {
  it('rejects an unauthenticated request', async () => {
    const response = await handleRegisterPushSubscription(
      new Request(URL, jsonBody('POST', SUBSCRIPTION)),
      world.deps,
    );

    expect(response.status).toBe(401);
    expect(world.notificationStore.subscriptions).toHaveLength(0);
  });

  it('stores a subscription bound to the authenticated caller', async () => {
    const token = await world.tokenFor('K9-01');

    const response = await handleRegisterPushSubscription(
      withSession(URL, token, jsonBody('POST', SUBSCRIPTION)),
      world.deps,
    );

    expect(response.status).toBe(201);
    expect(world.notificationStore.subscriptions).toHaveLength(1);

    const stored = world.notificationStore.subscriptions[0]!;
    expect(stored.endpoint).toBe(SUBSCRIPTION.endpoint);
    expect(stored.p256dh).toBe(SUBSCRIPTION.keys.p256dh);
    expect(stored.auth).toBe(SUBSCRIPTION.keys.auth);
  });

  it('owner-scopes the subscription to the caller (tier, principalId)', async () => {
    const token = await world.tokenFor('K9-01');

    await handleRegisterPushSubscription(
      withSession(URL, token, jsonBody('POST', SUBSCRIPTION)),
      world.deps,
    );

    const stored = world.notificationStore.subscriptions[0]!;
    expect(stored.recipient).toEqual({ tier: 'responders', principalId: 'responder-field' });
  });

  it('never binds a subscription to a different principal than the caller', async () => {
    const fieldToken = await world.tokenFor('K9-01');
    const dispatcherToken = await world.tokenFor('OPCEN-01');

    await handleRegisterPushSubscription(
      withSession(URL, fieldToken, jsonBody('POST', SUBSCRIPTION)),
      world.deps,
    );
    await handleRegisterPushSubscription(
      withSession(
        URL,
        dispatcherToken,
        jsonBody('POST', { ...SUBSCRIPTION, endpoint: 'https://push.example.com/sub/def456' }),
      ),
      world.deps,
    );

    for (const sub of world.notificationStore.subscriptions) {
      if (sub.endpoint === SUBSCRIPTION.endpoint) {
        expect(sub.recipient.principalId).toBe('responder-field');
      } else {
        expect(sub.recipient.principalId).toBe('responder-dispatcher');
      }
    }
    expect(world.notificationStore.subscriptions).toHaveLength(2);
  });

  it('rejects a malformed subscription body', async () => {
    const token = await world.tokenFor('K9-01');

    const response = await handleRegisterPushSubscription(
      withSession(URL, token, jsonBody('POST', { endpoint: SUBSCRIPTION.endpoint })),
      world.deps,
    );

    expect(response.status).toBe(400);
    expect(world.notificationStore.subscriptions).toHaveLength(0);
  });
});

describe('DELETE /api/notifications/subscriptions', () => {
  it('rejects an unauthenticated request', async () => {
    const response = await handleUnregisterPushSubscription(
      new Request(URL, jsonBody('DELETE', { endpoint: SUBSCRIPTION.endpoint })),
      world.deps,
    );

    expect(response.status).toBe(401);
  });

  it("removes only the caller's own subscription by endpoint", async () => {
    const token = await world.tokenFor('K9-01');

    await handleRegisterPushSubscription(
      withSession(URL, token, jsonBody('POST', SUBSCRIPTION)),
      world.deps,
    );
    expect(world.notificationStore.subscriptions).toHaveLength(1);

    const response = await handleUnregisterPushSubscription(
      withSession(URL, token, jsonBody('DELETE', { endpoint: SUBSCRIPTION.endpoint })),
      world.deps,
    );

    expect(response.status).toBe(200);
    expect(world.notificationStore.subscriptions).toHaveLength(0);
  });
});
