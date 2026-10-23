/**
 * @vitest-environment node
 *
 * Platform-operator service (multi-tenant superadmin tier): auth, tenant CRUD, office
 * provisioning with a 4 dp pin, and bootstrapping a tenant's first DRRM admin. A
 * platform principal carries no incident access and is disjoint from responders.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { hashPassword } from '../src/lib/auth/password';
import {
  bootstrapTenantAdmin,
  createTenant,
  listOfficePins,
  listTenants,
  login,
  logout,
  resolvePlatformSession,
  setTenantStatus,
  type PlatformServiceDeps,
} from '../src/lib/platform/service';
import { login as responderLogin } from '../src/lib/auth/service';
import { createTestClock, createTestHarness } from './support/harness';

const PASSWORD = 'correct horse battery staple';

let world: ReturnType<typeof createTestHarness>;
let deps: PlatformServiceDeps;

beforeEach(async () => {
  const clock = createTestClock();
  world = createTestHarness({ clock });
  deps = world.deps.platform;
  world.platformStore.seedAdmin({
    id: 'ops-1',
    email: 'ops@aira.ph',
    passwordHash: await hashPassword(PASSWORD),
  });
});

describe('platform login', () => {
  it('signs in a platform admin and issues an opaque token', async () => {
    const result = await login(deps, { email: 'ops@aira.ph', password: PASSWORD });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(result.principal.email).toBe('ops@aira.ph');
      // A platform principal has no role/tenant/incident fields.
      expect(result.principal).not.toHaveProperty('role');
      expect(result.principal).not.toHaveProperty('tenantId');
    }
  });

  it('rejects a wrong password and an unknown admin identically', async () => {
    expect((await login(deps, { email: 'ops@aira.ph', password: 'nope-nope-nope' })).status).toBe(
      'invalid',
    );
    expect((await login(deps, { email: 'ghost@aira.ph', password: PASSWORD })).status).toBe(
      'invalid',
    );
  });

  it('resolves a session, then stops after logout', async () => {
    const result = await login(deps, { email: 'ops@aira.ph', password: PASSWORD });
    if (result.status !== 'ok') {
      throw new Error('setup');
    }
    const principal = await resolvePlatformSession(deps, result.token);
    expect(principal?.adminId).toBe('ops-1');

    await logout(deps, result.principal);
    expect(await resolvePlatformSession(deps, result.token)).toBeNull();
  });
});

describe('tenant management', () => {
  it('creates a tenant with its LGU office and a 4 dp pin', async () => {
    const result = await createTenant(deps, {
      name: 'Mandaue City DRRMO',
      region: 'Region VII',
      province: 'Cebu',
      lguName: 'Mandaue City DRRMO',
      lat: 10.323456,
      lon: 123.922222,
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }
    expect(result.tenant.status).toBe('active');

    const pins = await listOfficePins(deps);
    const pin = pins.find((p) => p.tenantId === result.tenant.id);
    expect(pin?.kind).toBe('LGU');
    expect(pin?.lat).toBe(10.3235); // rounded to 4 dp
    expect(pin?.lon).toBe(123.9222);
  });

  it('rejects invalid input and duplicate tenant names', async () => {
    expect(
      (
        await createTenant(deps, {
          name: 'x',
          region: 'R',
          province: 'P',
          lguName: 'y',
          lat: null,
          lon: null,
        })
      ).status,
    ).toBe('invalid');

    await createTenant(deps, {
      name: 'Dup City',
      region: 'Region VII',
      province: 'Cebu',
      lguName: 'Dup DRRMO',
      lat: null,
      lon: null,
    });
    const again = await createTenant(deps, {
      name: 'dup city',
      region: 'Region VII',
      province: 'Cebu',
      lguName: 'Dup DRRMO',
      lat: null,
      lon: null,
    });
    expect(again.status).toBe('conflict');
  });

  it('suspends and reactivates a tenant', async () => {
    const created = await createTenant(deps, {
      name: 'Toggle City',
      region: 'Region VII',
      province: 'Cebu',
      lguName: 'Toggle DRRMO',
      lat: null,
      lon: null,
    });
    if (created.status !== 'ok') {
      throw new Error('setup');
    }

    const suspended = await setTenantStatus(deps, created.tenant.id, 'suspended');
    expect(suspended?.status).toBe('suspended');

    const tenants = await listTenants(deps);
    expect(tenants.find((t) => t.id === created.tenant.id)?.status).toBe('suspended');

    const reactivated = await setTenantStatus(deps, created.tenant.id, 'active');
    expect(reactivated?.status).toBe('active');
  });
});

describe('bootstrap tenant admin', () => {
  it("creates the tenant's first DRRM admin in its LGU office with a one-time password", async () => {
    const created = await createTenant(deps, {
      name: 'Lapu City DRRMO',
      region: 'Region VII',
      province: 'Cebu',
      lguName: 'Lapu DRRMO',
      lat: 10.31,
      lon: 123.95,
    });
    if (created.status !== 'ok') {
      throw new Error('setup');
    }

    const result = await bootstrapTenantAdmin(deps, {
      tenantId: created.tenant.id,
      email: 'officer@lapu.gov.ph',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }
    expect(result.email).toBe('officer@lapu.gov.ph');
    expect(result.password).toHaveLength(20);

    // The new DRRM admin can sign in through the RESPONDER tier (not the platform tier)
    // and lands as an ADMIN. (The office<->tenant linkage is enforced in SQL; the two
    // in-memory doubles are intentionally separate, so tenantId is not asserted here.)
    const signIn = await responderLogin(world.deps.auth, {
      email: 'officer@lapu.gov.ph',
      password: result.password,
    });
    expect(signIn.status).toBe('ok');
    if (signIn.status === 'ok') {
      expect(signIn.principal.role).toBe('ADMIN');
    }
  });

  it('returns tenant_not_found for an unknown tenant', async () => {
    const result = await bootstrapTenantAdmin(deps, { tenantId: 'nope', email: 'a@b.com' });
    expect(result.status).toBe('tenant_not_found');
  });
});
