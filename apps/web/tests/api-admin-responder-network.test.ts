/**
 * @vitest-environment node
 *
 * DRRM_Admin-tier integration tests for the responder-network management routes
 * (TDD-RED: the admin handler imports below do NOT exist yet â€” tests are expected to
 * fail with "is not a function" / "not exported" errors until task 9.2 implements
 * them). Once green they assert the shared status table scoped to the SESSION tenant.
 *
 * Pattern mirrors `api-admin.test.ts`: real service + handlers over the in-memory
 * AuthStore + PlatformStore via `createTestHarness()`, no Postgres, no network. The
 * DRRM admin is a RESPONDER-tier account with role ADMIN holding `responder:manage`;
 * its acting tenant comes from `principal.tenantId` (never a URL).
 *
 * Requirements covered: R3.1-R3.2/R3.5/R3.6, R4.1/R4.4, R5.1/R5.2/R5.6,
 * R7.1-R7.5, R7.7.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  // The five DRRM_Admin-tier responder-network handlers under test (added in task 9.2).
  // They resolve the acting tenant from the session (principal.tenantId), NOT a URL,
  // so they take (request, deps) only â€” update takes (request, deps, agencyId).
  handleAdminCreateAgency,
  handleAdminListAgencies,
  handleAdminUpdateAgency,
} from '../src/lib/api/admin-handlers';
import { handleLogin } from '../src/lib/api/auth-handlers';
import { PLATFORM_SESSION_COOKIE } from '../src/lib/platform/session';
import { createRateLimiter } from '../src/lib/rate-limit';
import { createTestClock, createTestHarness, jsonBody, withSession } from './support/harness';
import { TENANT_ID, TEST_PASSWORD } from './support/fixtures';

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const BASE = 'http://localhost';

/** Add a cross-origin header to simulate a CSRF attempt (triggers 403 forbidden_origin). */
const crossOrigin = (init: RequestInit = {}): RequestInit => {
  const headers = new Headers(init.headers);
  headers.set('origin', 'https://attacker.example');
  return { ...init, headers };
};

/** A UUID-shaped id for a foreign tenant the seeded admin must never reach. */
const OTHER_TENANT_ID = '7e000000-0000-4000-8000-0000000000ff';

function createWorld() {
  const clock = createTestClock();
  const harness = createTestHarness({ clock });

  // The DRRM admin: a RESPONDER-tier ADMIN whose tenant/office are the harness
  // defaults (TENANT_ID / OFFICE_ID) â€” see memory-auth-store seedResponder.
  const admin = harness.authStore.seedResponder({
    id: 'responder-admin',
    callsign: 'ADMIN-1',
    role: 'ADMIN',
  });
  // A dispatcher and a field responder: logged-in but WITHOUT `responder:manage`.
  const dispatcher = harness.authStore.seedResponder({
    id: 'responder-dispatcher',
    callsign: 'OPCEN-01',
    role: 'DISPATCHER',
  });
  const field = harness.authStore.seedResponder({
    id: 'responder-field',
    callsign: 'K9-01',
    role: 'RESPONDER',
  });

  // The admin's own tenant must exist in the platform store so agency creation
  // (which proves tenant existence) resolves. Seed it directly with the known id.
  harness.platformStore.tenants.set(TENANT_ID, {
    id: TENANT_ID,
    name: 'Cebu City DRRMO',
    region: 'Region VII',
    province: 'Cebu',
    status: 'active',
    createdAt: clock.now(),
  });
  // A second, foreign tenant whose resources the admin must never touch.
  harness.platformStore.tenants.set(OTHER_TENANT_ID, {
    id: OTHER_TENANT_ID,
    name: 'Mandaue City DRRMO',
    region: 'Region VII',
    province: 'Cebu',
    status: 'active',
    createdAt: clock.now(),
  });

  async function tokenFor(callsign: string, password = TEST_PASSWORD): Promise<string> {
    const response = await handleLogin(
      new Request(
        `${BASE}/api/auth/login`,
        jsonBody('POST', { email: `${callsign.toLowerCase()}@aira.test`, password }),
      ),
      {
        ...harness.deps,
        loginLimiter: createRateLimiter({ capacity: 100, windowMs: 60_000, now: clock.now }),
      },
    );

    const cookie = response.headers.get('set-cookie') ?? '';
    const token = /aira_session=([A-Za-z0-9_-]+)/.exec(cookie)?.[1];
    if (!token) {
      throw new Error(`login_failed_${response.status}`);
    }
    return token;
  }

  return { ...harness, clock, admin, dispatcher, field, tokenFor };
}

let world: ReturnType<typeof createWorld>;

beforeEach(() => {
  world = createWorld();
});

/** Seed an agency in the admin's OWN tenant and return its id. */
async function seedOwnAgency(
  name: string,
  code: string,
  agencyType: 'FIRE' | 'POLICE' | 'MEDICAL' | 'DRRM' | 'OTHER' = 'FIRE',
): Promise<string> {
  const created = await world.platformStore.createAgency({
    tenantId: TENANT_ID,
    name,
    code,
    agencyType,
  });
  if (created.status !== 'ok') {
    throw new Error(`seed_own_agency_failed_${created.status}`);
  }
  return created.agency.id;
}

/** Seed an agency in ANOTHER tenant and return its id (for cross-tenant tests). */
async function seedForeignAgency(name: string, code: string): Promise<string> {
  const created = await world.platformStore.createAgency({
    tenantId: OTHER_TENANT_ID,
    name,
    code,
    agencyType: 'FIRE',
  });
  if (created.status !== 'ok') {
    throw new Error(`seed_foreign_agency_failed_${created.status}`);
  }
  return created.agency.id;
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// POST /api/admin/agencies
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

describe('handleAdminCreateAgency', () => {
  it('201 â€” creates an agency in the admin\u2019s own tenant', async () => {
    const token = await world.tokenFor('ADMIN-1');

    const response = await handleAdminCreateAgency(
      withSession(
        `${BASE}/api/admin/agencies`,
        token,
        jsonBody('POST', { name: 'Bureau of Fire', code: 'BFP', agencyType: 'FIRE' }),
      ),
      world.deps,
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      ok: boolean;
      agency: { name: string; agencyType: string; tenantId: string };
    };
    expect(body.ok).toBe(true);
    expect(body.agency.name).toBe('Bureau of Fire');
    expect(body.agency.agencyType).toBe('FIRE');
    // The tenant comes from the session, so the row lands in the admin's tenant.
    expect(body.agency.tenantId).toBe(TENANT_ID);
  });

  it('400 invalid_agency â€” name out of range', async () => {
    const token = await world.tokenFor('ADMIN-1');

    const response = await handleAdminCreateAgency(
      withSession(
        `${BASE}/api/admin/agencies`,
        token,
        jsonBody('POST', { name: 'X', code: 'BFP', agencyType: 'FIRE' }),
      ),
      world.deps,
    );

    expect(response.status).toBe(400);
    expect((await response.json()) as { error: string }).toMatchObject({ error: 'invalid_agency' });
  });

  it('400 invalid_agency_type â€” unknown type, value not echoed', async () => {
    const token = await world.tokenFor('ADMIN-1');

    const response = await handleAdminCreateAgency(
      withSession(
        `${BASE}/api/admin/agencies`,
        token,
        jsonBody('POST', { name: 'Mystery Agency', code: 'MYS', agencyType: 'NINJA' }),
      ),
      world.deps,
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('invalid_agency_type');
    expect(JSON.stringify(body)).not.toContain('NINJA');
  });

  it('409 agency_exists â€” per-tenant case-insensitive name collision', async () => {
    const token = await world.tokenFor('ADMIN-1');
    await seedOwnAgency('Bureau of Fire', 'BFP');

    const response = await handleAdminCreateAgency(
      withSession(
        `${BASE}/api/admin/agencies`,
        token,
        jsonBody('POST', { name: 'bureau of fire', code: 'BFP2', agencyType: 'FIRE' }),
      ),
      world.deps,
    );

    expect(response.status).toBe(409);
    expect((await response.json()) as { error: string }).toMatchObject({ error: 'agency_exists' });
  });

  it('401 â€” no responder session', async () => {
    const response = await handleAdminCreateAgency(
      new Request(
        `${BASE}/api/admin/agencies`,
        jsonBody('POST', { name: 'Bureau of Fire', code: 'BFP', agencyType: 'FIRE' }),
      ),
      world.deps,
    );

    expect(response.status).toBe(401);
  });

  it('401 â€” platform cookie must NOT authenticate an admin route (cross-tier isolation)', async () => {
    // A value presented under the PLATFORM cookie name must never satisfy the
    // responder-tier `authenticate` guard the admin routes use.
    const headers = new Headers({ 'content-type': 'application/json' });
    headers.set('cookie', `${PLATFORM_SESSION_COOKIE}=any_platform_token`);

    const response = await handleAdminCreateAgency(
      new Request(`${BASE}/api/admin/agencies`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Bureau of Fire', code: 'BFP', agencyType: 'FIRE' }),
      }),
      world.deps,
    );

    expect(response.status).toBe(401);
  });

  it('403 â€” a logged-in RESPONDER/DISPATCHER lacking responder:manage', async () => {
    for (const callsign of ['OPCEN-01', 'K9-01']) {
      const response = await handleAdminCreateAgency(
        withSession(
          `${BASE}/api/admin/agencies`,
          await world.tokenFor(callsign),
          jsonBody('POST', { name: 'Bureau of Fire', code: 'BFP', agencyType: 'FIRE' }),
        ),
        world.deps,
      );
      expect(response.status).toBe(403);
    }
  });

  it('403 forbidden_origin â€” cross-site POST makes no write', async () => {
    const token = await world.tokenFor('ADMIN-1');

    const response = await handleAdminCreateAgency(
      withSession(
        `${BASE}/api/admin/agencies`,
        token,
        crossOrigin(jsonBody('POST', { name: 'Bureau of Fire', code: 'BFP', agencyType: 'FIRE' })),
      ),
      world.deps,
    );

    expect(response.status).toBe(403);
    expect((await response.json()) as { error: string }).toMatchObject({
      error: 'forbidden_origin',
    });
    expect(world.platformStore.agencies.size).toBe(0);
  });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// GET /api/admin/agencies
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

describe('handleAdminListAgencies', () => {
  it('200 â€” scoped to the admin\u2019s own tenant; a foreign agency is absent', async () => {
    const token = await world.tokenFor('ADMIN-1');
    await seedOwnAgency('Fire Dept', 'FD');
    await seedOwnAgency('Police Dept', 'PD', 'POLICE');
    await seedForeignAgency('Foreign Fire', 'FF');

    const response = await handleAdminListAgencies(
      withSession(`${BASE}/api/admin/agencies`, token),
      world.deps,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      agencies: Array<{ tenantId: string; code: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.agencies).toHaveLength(2);
    expect(body.agencies.every((row) => row.tenantId === TENANT_ID)).toBe(true);
    expect(body.agencies.some((row) => row.code === 'FF')).toBe(false);
  });

  it('401 â€” no responder session', async () => {
    const response = await handleAdminListAgencies(
      new Request(`${BASE}/api/admin/agencies`),
      world.deps,
    );
    expect(response.status).toBe(401);
  });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// PATCH /api/admin/agencies/[id]
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

describe('handleAdminUpdateAgency', () => {
  it('200 â€” renames an in-tenant agency', async () => {
    const token = await world.tokenFor('ADMIN-1');
    const agencyId = await seedOwnAgency('Old Fire Bureau', 'OFB');

    const response = await handleAdminUpdateAgency(
      withSession(
        `${BASE}/api/admin/agencies/${agencyId}`,
        token,
        jsonBody('PATCH', { name: 'New Fire Bureau' }),
      ),
      world.deps,
      agencyId,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; agency: { name: string } };
    expect(body.ok).toBe(true);
    expect(body.agency.name).toBe('New Fire Bureau');
  });

  it('200 â€” sets an in-tenant agency active/inactive', async () => {
    const token = await world.tokenFor('ADMIN-1');
    const agencyId = await seedOwnAgency('Fire Active', 'FAC');

    const response = await handleAdminUpdateAgency(
      withSession(
        `${BASE}/api/admin/agencies/${agencyId}`,
        token,
        jsonBody('PATCH', { active: false }),
      ),
      world.deps,
      agencyId,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { agency: { active: boolean } };
    expect(body.agency.active).toBe(false);
  });

  it('R7.4 â€” DRRM_Admin cross-tenant: editing a known-other-tenant agency by id \u2192 403 forbidden', async () => {
    const token = await world.tokenFor('ADMIN-1');
    // Seed the foreign agency directly, then PATCH it by id â€” the admin never names
    // the foreign tenant; the service resolves the agency and sees a tenant mismatch.
    const foreignAgencyId = await seedForeignAgency('Foreign Fire', 'FF');
    const originalName = (await world.platformStore.findAgencyById(foreignAgencyId))?.name;

    const response = await handleAdminUpdateAgency(
      withSession(
        `${BASE}/api/admin/agencies/${foreignAgencyId}`,
        token,
        jsonBody('PATCH', { name: 'Hijacked Bureau' }),
      ),
      world.deps,
      foreignAgencyId,
    );

    expect(response.status).toBe(403);
    expect((await response.json()) as { error: string }).toMatchObject({ error: 'forbidden' });
    // The foreign row is untouched.
    expect((await world.platformStore.findAgencyById(foreignAgencyId))?.name).toBe(originalName);
  });

  it('404 agency_not_found â€” a truly unknown agency id', async () => {
    const token = await world.tokenFor('ADMIN-1');

    const response = await handleAdminUpdateAgency(
      withSession(
        `${BASE}/api/admin/agencies/no-such-agency`,
        token,
        jsonBody('PATCH', { name: 'Whatever Bureau' }),
      ),
      world.deps,
      'no-such-agency',
    );

    expect(response.status).toBe(404);
    expect((await response.json()) as { error: string }).toMatchObject({
      error: 'agency_not_found',
    });
  });

  it('409 agency_exists â€” rename collision within the admin\u2019s tenant', async () => {
    const token = await world.tokenFor('ADMIN-1');
    await seedOwnAgency('Fire One', 'F1');
    const second = await seedOwnAgency('Fire Two', 'F2');

    const response = await handleAdminUpdateAgency(
      withSession(
        `${BASE}/api/admin/agencies/${second}`,
        token,
        jsonBody('PATCH', { name: 'Fire One' }),
      ),
      world.deps,
      second,
    );

    expect(response.status).toBe(409);
    expect((await response.json()) as { error: string }).toMatchObject({ error: 'agency_exists' });
  });

  it('401 â€” no responder session', async () => {
    const agencyId = await seedOwnAgency('Fire Session', 'FSE');

    const response = await handleAdminUpdateAgency(
      new Request(`${BASE}/api/admin/agencies/${agencyId}`, jsonBody('PATCH', { name: 'Renamed' })),
      world.deps,
      agencyId,
    );

    expect(response.status).toBe(401);
  });

  it('403 â€” a non-responder:manage role cannot update', async () => {
    const token = await world.tokenFor('OPCEN-01');
    const agencyId = await seedOwnAgency('Fire Role', 'FRO');

    const response = await handleAdminUpdateAgency(
      withSession(
        `${BASE}/api/admin/agencies/${agencyId}`,
        token,
        jsonBody('PATCH', { name: 'Renamed By Dispatcher' }),
      ),
      world.deps,
      agencyId,
    );

    expect(response.status).toBe(403);
  });
});

// NOTE: the editable capability map was removed (single-lgu-agency-network R9); routing
// now uses the fixed built-in CATEGORY_AGENCY_DEFAULT, so the admin capability endpoint
// and its tests are gone. Agency management + provisioning coverage remains above.
