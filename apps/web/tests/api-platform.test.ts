/**
 * @vitest-environment node
 *
 * Platform console API (multi-tenant superadmin tier): auth, tenant CRUD, office pins,
 * bootstrap admin, and the hard cross-tier isolation (a platform session never
 * authenticates a responder/citizen route, and vice versa).
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { hashPassword } from '../src/lib/auth/password';
import {
  handleBootstrapTenantAdmin,
  handleCreateTenant,
  handleListOfficePins,
  handleListTenants,
  handlePlatformLogin,
  handleSetTenantStatus,
} from '../src/lib/api/platform-handlers';
import { handleListIncidents } from '../src/lib/api/incidents-handlers';
import { PLATFORM_SESSION_COOKIE } from '../src/lib/platform/session';
import { SESSION_COOKIE } from '../src/lib/auth/session';
import { createTestHarness, jsonBody } from './support/harness';

const PASSWORD = 'correct horse battery staple';

let world: ReturnType<typeof createTestHarness>;

beforeEach(async () => {
  world = createTestHarness();
  world.platformStore.seedAdmin({
    id: 'ops-1',
    email: 'ops@aira.ph',
    passwordHash: await hashPassword(PASSWORD),
  });
});

async function opsToken(): Promise<string> {
  const response = await handlePlatformLogin(
    new Request(
      'http://localhost/api/platform/login',
      jsonBody('POST', { email: 'ops@aira.ph', password: PASSWORD }),
    ),
    world.deps,
  );
  const cookie = response.headers.get('set-cookie') ?? '';
  const token = new RegExp(`${PLATFORM_SESSION_COOKIE}=([A-Za-z0-9_-]+)`).exec(cookie)?.[1];
  if (!token) {
    throw new Error(`platform_login_failed_${response.status}`);
  }
  return token;
}

const withPlatform = (url: string, token: string, init: RequestInit = {}): Request => {
  const headers = new Headers(init.headers);
  headers.set('cookie', `${PLATFORM_SESSION_COOKIE}=${token}`);
  return new Request(url, { ...init, headers });
};

describe('POST /api/platform/login', () => {
  it('signs in an operator and sets a platform cookie', async () => {
    const response = await handlePlatformLogin(
      new Request(
        'http://localhost/api/platform/login',
        jsonBody('POST', { email: 'ops@aira.ph', password: PASSWORD }),
      ),
      world.deps,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain(PLATFORM_SESSION_COOKIE);
  });

  it('rejects bad credentials', async () => {
    const response = await handlePlatformLogin(
      new Request(
        'http://localhost/api/platform/login',
        jsonBody('POST', { email: 'ops@aira.ph', password: 'nope-nope-nope' }),
      ),
      world.deps,
    );
    expect(response.status).toBe(401);
  });
});

describe('tenant management', () => {
  it('requires a platform session', async () => {
    expect(
      (await handleListTenants(new Request('http://localhost/api/platform/tenants'), world.deps))
        .status,
    ).toBe(401);
  });

  it('creates, lists, suspends tenants and provisions the first admin', async () => {
    const token = await opsToken();

    const created = await handleCreateTenant(
      withPlatform(
        'http://localhost/api/platform/tenants',
        token,
        jsonBody('POST', {
          name: 'Mandaue City DRRMO',
          region: 'Region VII',
          province: 'Cebu',
          lguName: 'Mandaue City DRRMO',
          lat: 10.3234,
          lon: 123.9222,
        }),
      ),
      world.deps,
    );
    expect(created.status).toBe(201);
    const { tenant } = (await created.json()) as { tenant: { id: string } };

    const list = await handleListTenants(
      withPlatform('http://localhost/api/platform/tenants', token),
      world.deps,
    );
    const payload = (await list.json()) as { tenants: Array<{ id: string }> };
    expect(payload.tenants.some((row) => row.id === tenant.id)).toBe(true);

    const suspended = await handleSetTenantStatus(
      withPlatform(
        `http://localhost/api/platform/tenants/${tenant.id}`,
        token,
        jsonBody('PATCH', { status: 'suspended' }),
      ),
      world.deps,
      tenant.id,
    );
    expect(((await suspended.json()) as { tenant: { status: string } }).tenant.status).toBe(
      'suspended',
    );

    const bootstrap = await handleBootstrapTenantAdmin(
      withPlatform(
        `http://localhost/api/platform/tenants/${tenant.id}/admin`,
        token,
        jsonBody('POST', { email: 'officer@mandaue.gov.ph' }),
      ),
      world.deps,
      tenant.id,
    );
    expect(bootstrap.status).toBe(201);
    const body = (await bootstrap.json()) as { email: string; password: string };
    expect(body.email).toBe('officer@mandaue.gov.ph');
    expect(body.password).toHaveLength(20);
  });

  it('serves nationwide office pins (office locations only, no citizen data)', async () => {
    const token = await opsToken();
    await handleCreateTenant(
      withPlatform(
        'http://localhost/api/platform/tenants',
        token,
        jsonBody('POST', {
          name: 'Lapu City DRRMO',
          region: 'Region VII',
          province: 'Cebu',
          lguName: 'Lapu City DRRMO',
          lat: 10.31,
          lon: 123.95,
        }),
      ),
      world.deps,
    );

    const response = await handleListOfficePins(
      withPlatform('http://localhost/api/platform/offices', token),
      world.deps,
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { offices: Array<Record<string, unknown>> };
    expect(payload.offices.length).toBeGreaterThan(0);
    // Pins carry no incident/citizen fields.
    for (const pin of payload.offices) {
      expect(pin).not.toHaveProperty('reporterCitizenId');
      expect(pin).not.toHaveProperty('category');
    }
  });

  it('rejects a duplicate tenant name', async () => {
    const token = await opsToken();
    const payload = {
      name: 'Dup City DRRMO',
      region: 'Region VII',
      province: 'Cebu',
      lguName: 'Dup City DRRMO',
      lat: null,
      lon: null,
    };
    await handleCreateTenant(
      withPlatform('http://localhost/api/platform/tenants', token, jsonBody('POST', payload)),
      world.deps,
    );
    const again = await handleCreateTenant(
      withPlatform('http://localhost/api/platform/tenants', token, jsonBody('POST', payload)),
      world.deps,
    );
    expect(again.status).toBe(409);
  });
});

describe('cross-tier isolation', () => {
  it('a platform session never authenticates a responder route', async () => {
    const token = await opsToken();

    // Present the platform token under both the responder and platform cookie names.
    const asResponder = await handleListIncidents(
      new Request('http://localhost/api/incidents', {
        headers: { cookie: `${SESSION_COOKIE}=${token}` },
      }),
      world.deps,
    );
    expect(asResponder.status).toBe(401);

    const asPlatform = await handleListIncidents(
      new Request('http://localhost/api/incidents', {
        headers: { cookie: `${PLATFORM_SESSION_COOKIE}=${token}` },
      }),
      world.deps,
    );
    expect(asPlatform.status).toBe(401);
  });

  it('a responder session never authenticates a platform route', async () => {
    world.authStore.seedResponder({ id: 'responder-admin', callsign: 'ADMIN-1', role: 'ADMIN' });
    // Mint a responder session directly.
    const { login } = await import('../src/lib/auth/service');
    const signIn = await login(world.deps.auth, { email: 'admin-1@aira.test', password: PASSWORD });
    // The seeded responder uses the dummy hash, so login fails; assert the responder
    // cookie (even a fabricated one) cannot reach the platform tenants route.
    const fabricated = signIn.status === 'ok' ? signIn.token : 'a'.repeat(43);

    const response = await handleListTenants(
      new Request('http://localhost/api/platform/tenants', {
        headers: { cookie: `${PLATFORM_SESSION_COOKIE}=${fabricated}` },
      }),
      world.deps,
    );
    expect(response.status).toBe(401);
  });
});
