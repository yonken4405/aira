/**
 * @vitest-environment node
 *
 * Operator-tier integration tests for the responder-network management routes
 * (TDD-RED: all handler imports below do NOT exist yet — tests are expected to fail
 * with "is not a function" / "not exported" errors until task 8.2 implements them).
 *
 * Pattern mirrors `api-platform.test.ts`: real service + handlers, in-memory
 * PlatformStore + AuthStore, no Postgres, no network.
 *
 * Requirements covered: R3.1–R3.8, R4.1–R4.9, R5.1–R5.2, R5.6–R5.7, R7.1–R7.3, R7.6.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hashPassword } from '../src/lib/auth/password';
import {
  handlePlatformLogin,
  // The six operator-tier responder-network handlers under test (added in task 8.2).
  handlePlatformCreateAgency,
  handlePlatformListAgencies,
  handlePlatformUpdateAgency,
  handlePlatformReadCapability,
  handlePlatformSetCapability,
  handlePlatformProvisionResponder,
} from '../src/lib/api/platform-handlers';
import { PLATFORM_SESSION_COOKIE } from '../src/lib/platform/session';
import { SESSION_COOKIE } from '../src/lib/auth/session';
import { createTestHarness, jsonBody } from './support/harness';

// ── Helpers ───────────────────────────────────────────────────────────────────

const PASSWORD = 'correct horse battery staple';
const BASE = 'http://localhost';

/** Build a Request carrying the platform session cookie. */
const withPlatform = (url: string, token: string, init: RequestInit = {}): Request => {
  const headers = new Headers(init.headers);
  headers.set('cookie', `${PLATFORM_SESSION_COOKIE}=${token}`);
  return new Request(url, { ...init, headers });
};

/** Add a cross-origin header to simulate a CSRF attempt (triggers 403 forbidden_origin). */
const crossOrigin = (init: RequestInit = {}): RequestInit => {
  const headers = new Headers(init.headers);
  headers.set('origin', 'https://attacker.example');
  return { ...init, headers };
};

let world: ReturnType<typeof createTestHarness>;

beforeEach(async () => {
  world = createTestHarness();
  world.platformStore.seedAdmin({
    id: 'ops-1',
    email: 'ops@aira.ph',
    passwordHash: await hashPassword(PASSWORD),
  });
});

/** Obtain a valid platform operator token. */
async function opsToken(): Promise<string> {
  const response = await handlePlatformLogin(
    new Request(
      `${BASE}/api/platform/login`,
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

/**
 * Seed a tenant and return its id.
 * Uses the low-level store method so it works even before handleCreateTenant is called.
 */
async function seedTenant(name = 'Test City DRRMO'): Promise<string> {
  const tenant = await world.platformStore.createTenantWithLgu({
    name,
    region: 'Region VII',
    province: 'Cebu',
    lguName: `${name} LGU`,
    lat: 10.32,
    lon: 123.9,
    now: Date.now(),
  });
  return tenant.id;
}

// ── Logger spy for coordinate-logging assertion (R7.6) ────────────────────────

let consoleSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Assert no coordinate value (decimal number with 4 dp) was written to any logger. */
function assertNoCoordinateLogged(): void {
  const coordPattern = /\d{1,3}\.\d{4}/;
  const calls = [
    ...consoleSpy.mock.calls,
    ...(vi.mocked(console.warn).mock?.calls ?? []),
    ...(vi.mocked(console.error).mock?.calls ?? []),
    ...(vi.mocked(console.info).mock?.calls ?? []),
  ];
  for (const args of calls) {
    const text = args.map(String).join(' ');
    expect(coordPattern.test(text), `coordinate value found in log output: ${text}`).toBe(false);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/platform/tenants/[id]/agencies
// ═══════════════════════════════════════════════════════════════════════════════

describe('handlePlatformCreateAgency', () => {
  it('201 — creates an agency for a tenant', async () => {
    const tenantId = await seedTenant('Alpha City DRRMO');
    const token = await opsToken();

    const response = await (handlePlatformCreateAgency as Function)(
      withPlatform(
        `${BASE}/api/platform/tenants/${tenantId}/agencies`,
        token,
        jsonBody('POST', { name: 'Bureau of Fire', code: 'BFP', agencyType: 'FIRE' }),
      ),
      world.deps,
      tenantId,
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      ok: boolean;
      agency: { name: string; agencyType: string };
    };
    expect(body.ok).toBe(true);
    expect(body.agency.name).toBe('Bureau of Fire');
    expect(body.agency.agencyType).toBe('FIRE');
    assertNoCoordinateLogged();
  });

  it('400 invalid_agency — name too short', async () => {
    const tenantId = await seedTenant('Beta City DRRMO');
    const token = await opsToken();

    const response = await (handlePlatformCreateAgency as Function)(
      withPlatform(
        `${BASE}/api/platform/tenants/${tenantId}/agencies`,
        token,
        jsonBody('POST', { name: 'X', code: 'BFP', agencyType: 'FIRE' }),
      ),
      world.deps,
      tenantId,
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('invalid_agency');
    assertNoCoordinateLogged();
  });

  it('400 invalid_agency — name too long (> 64 chars)', async () => {
    const tenantId = await seedTenant('Gamma City DRRMO');
    const token = await opsToken();

    const response = await (handlePlatformCreateAgency as Function)(
      withPlatform(
        `${BASE}/api/platform/tenants/${tenantId}/agencies`,
        token,
        jsonBody('POST', { name: 'A'.repeat(65), code: 'CD', agencyType: 'POLICE' }),
      ),
      world.deps,
      tenantId,
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('invalid_agency');
    assertNoCoordinateLogged();
  });

  it('400 invalid_agency — code too long (> 12 chars)', async () => {
    const tenantId = await seedTenant('Delta City DRRMO');
    const token = await opsToken();

    const response = await (handlePlatformCreateAgency as Function)(
      withPlatform(
        `${BASE}/api/platform/tenants/${tenantId}/agencies`,
        token,
        jsonBody('POST', { name: 'Fire Bureau', code: 'TOOLONGCODE!X', agencyType: 'FIRE' }),
      ),
      world.deps,
      tenantId,
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('invalid_agency');
    assertNoCoordinateLogged();
  });

  it('400 invalid_agency_type — unknown agencyType value', async () => {
    const tenantId = await seedTenant('Epsilon City DRRMO');
    const token = await opsToken();

    const response = await (handlePlatformCreateAgency as Function)(
      withPlatform(
        `${BASE}/api/platform/tenants/${tenantId}/agencies`,
        token,
        jsonBody('POST', { name: 'Mystery Agency', code: 'MYS', agencyType: 'NINJA' }),
      ),
      world.deps,
      tenantId,
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('invalid_agency_type');
    // The response must NOT echo the submitted value (R2.4/R2.5).
    expect(JSON.stringify(body)).not.toContain('NINJA');
    assertNoCoordinateLogged();
  });

  it('400 invalid_agency_type — missing agencyType field', async () => {
    const tenantId = await seedTenant('Zeta City DRRMO');
    const token = await opsToken();

    const response = await (handlePlatformCreateAgency as Function)(
      withPlatform(
        `${BASE}/api/platform/tenants/${tenantId}/agencies`,
        token,
        jsonBody('POST', { name: 'Fire Bureau', code: 'FB' }),
      ),
      world.deps,
      tenantId,
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('invalid_agency_type');
    assertNoCoordinateLogged();
  });

  it('404 tenant_not_found — unknown tenant', async () => {
    const token = await opsToken();

    const response = await (handlePlatformCreateAgency as Function)(
      withPlatform(
        `${BASE}/api/platform/tenants/no-such-tenant/agencies`,
        token,
        jsonBody('POST', { name: 'Fire Bureau', code: 'BFP', agencyType: 'FIRE' }),
      ),
      world.deps,
      'no-such-tenant',
    );

    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('tenant_not_found');
    assertNoCoordinateLogged();
  });

  it('409 agency_exists — per-tenant name collision (case-insensitive)', async () => {
    const tenantId = await seedTenant('Eta City DRRMO');
    const token = await opsToken();

    // Seed an agency directly so we don't depend on the handler for setup.
    await world.platformStore.createAgency({
      tenantId,
      name: 'Bureau of Fire',
      code: 'BFP',
      agencyType: 'FIRE',
    });

    const response = await (handlePlatformCreateAgency as Function)(
      withPlatform(
        `${BASE}/api/platform/tenants/${tenantId}/agencies`,
        token,
        jsonBody('POST', { name: 'bureau of fire', code: 'BFP2', agencyType: 'FIRE' }),
      ),
      world.deps,
      tenantId,
    );

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('agency_exists');
    assertNoCoordinateLogged();
  });

  it('401 — no platform cookie', async () => {
    const tenantId = await seedTenant('Theta City DRRMO');

    const response = await (handlePlatformCreateAgency as Function)(
      new Request(
        `${BASE}/api/platform/tenants/${tenantId}/agencies`,
        jsonBody('POST', { name: 'Fire Bureau', code: 'BFP', agencyType: 'FIRE' }),
      ),
      world.deps,
      tenantId,
    );

    expect(response.status).toBe(401);
    assertNoCoordinateLogged();
  });

  it('401 — responder cookie (cross-tier isolation)', async () => {
    const tenantId = await seedTenant('Iota City DRRMO');

    // A responder session token presented under SESSION_COOKIE must not authenticate
    // the platform route, even if the platform cookie slot is filled with it.
    const response = await (handlePlatformCreateAgency as Function)(
      new Request(`${BASE}/api/platform/tenants/${tenantId}/agencies`, {
        ...jsonBody('POST', { name: 'Fire Bureau', code: 'BFP', agencyType: 'FIRE' }),
        headers: {
          'content-type': 'application/json',
          cookie: `${PLATFORM_SESSION_COOKIE}=fabricated_responder_token`,
          [SESSION_COOKIE]: 'should_not_matter',
        },
      }),
      world.deps,
      tenantId,
    );

    expect(response.status).toBe(401);
    assertNoCoordinateLogged();
  });

  it('403 forbidden_origin — cross-site POST', async () => {
    const tenantId = await seedTenant('Kappa City DRRMO');
    const token = await opsToken();

    const response = await (handlePlatformCreateAgency as Function)(
      withPlatform(
        `${BASE}/api/platform/tenants/${tenantId}/agencies`,
        token,
        crossOrigin(jsonBody('POST', { name: 'Fire Bureau', code: 'BFP', agencyType: 'FIRE' })),
      ),
      world.deps,
      tenantId,
    );

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('forbidden_origin');
    // No write must have occurred.
    expect(world.platformStore.agencies.size).toBe(0);
    assertNoCoordinateLogged();
  });

  it('R7.2 — operator cross-tenant: operator may create agency in any tenant', async () => {
    // Create two tenants; log in once and act on both.
    const tenantA = await seedTenant('Lambda A DRRMO');
    const tenantB = await seedTenant('Lambda B DRRMO');
    const token = await opsToken();

    const responseA = await (handlePlatformCreateAgency as Function)(
      withPlatform(
        `${BASE}/api/platform/tenants/${tenantA}/agencies`,
        token,
        jsonBody('POST', { name: 'Fire A', code: 'FA', agencyType: 'FIRE' }),
      ),
      world.deps,
      tenantA,
    );
    expect(responseA.status).toBe(201);

    const responseB = await (handlePlatformCreateAgency as Function)(
      withPlatform(
        `${BASE}/api/platform/tenants/${tenantB}/agencies`,
        token,
        jsonBody('POST', { name: 'Fire B', code: 'FB', agencyType: 'FIRE' }),
      ),
      world.deps,
      tenantB,
    );
    expect(responseB.status).toBe(201);
    assertNoCoordinateLogged();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/platform/tenants/[id]/agencies
// ═══════════════════════════════════════════════════════════════════════════════

describe('handlePlatformListAgencies', () => {
  it('200 — returns an array of agencies for the tenant', async () => {
    const tenantId = await seedTenant('Mu City DRRMO');
    const token = await opsToken();

    // Seed two agencies directly.
    await world.platformStore.createAgency({
      tenantId,
      name: 'Fire Dept',
      code: 'FD',
      agencyType: 'FIRE',
    });
    await world.platformStore.createAgency({
      tenantId,
      name: 'Police Dept',
      code: 'PD',
      agencyType: 'POLICE',
    });

    const response = await (handlePlatformListAgencies as Function)(
      withPlatform(`${BASE}/api/platform/tenants/${tenantId}/agencies`, token),
      world.deps,
      tenantId,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; agencies: unknown[] };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.agencies)).toBe(true);
    expect(body.agencies).toHaveLength(2);
    assertNoCoordinateLogged();
  });

  it('200 — returns empty array when tenant has no agencies', async () => {
    const tenantId = await seedTenant('Nu City DRRMO');
    const token = await opsToken();

    const response = await (handlePlatformListAgencies as Function)(
      withPlatform(`${BASE}/api/platform/tenants/${tenantId}/agencies`, token),
      world.deps,
      tenantId,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { agencies: unknown[] };
    expect(body.agencies).toHaveLength(0);
    assertNoCoordinateLogged();
  });

  it('200 — agencies from other tenants are not included', async () => {
    const tenantA = await seedTenant('Xi A DRRMO');
    const tenantB = await seedTenant('Xi B DRRMO');
    const token = await opsToken();

    await world.platformStore.createAgency({
      tenantId: tenantA,
      name: 'Fire A',
      code: 'FA',
      agencyType: 'FIRE',
    });
    await world.platformStore.createAgency({
      tenantId: tenantB,
      name: 'Fire B',
      code: 'FB',
      agencyType: 'FIRE',
    });

    const response = await (handlePlatformListAgencies as Function)(
      withPlatform(`${BASE}/api/platform/tenants/${tenantA}/agencies`, token),
      world.deps,
      tenantA,
    );

    const body = (await response.json()) as { agencies: Array<{ tenantId: string }> };
    expect(body.agencies).toHaveLength(1);
    expect(body.agencies[0]?.tenantId).toBe(tenantA);
    assertNoCoordinateLogged();
  });

  it('401 — no auth', async () => {
    const tenantId = await seedTenant('Omicron City DRRMO');

    const response = await (handlePlatformListAgencies as Function)(
      new Request(`${BASE}/api/platform/tenants/${tenantId}/agencies`),
      world.deps,
      tenantId,
    );

    expect(response.status).toBe(401);
    assertNoCoordinateLogged();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PATCH /api/platform/agencies/[agencyId]
// ═══════════════════════════════════════════════════════════════════════════════

describe('handlePlatformUpdateAgency', () => {
  it('200 — renames an agency', async () => {
    const tenantId = await seedTenant('Pi City DRRMO');
    const token = await opsToken();

    const created = await world.platformStore.createAgency({
      tenantId,
      name: 'Old Fire Bureau',
      code: 'OFB',
      agencyType: 'FIRE',
    });
    if (created.status !== 'ok') throw new Error('seed failed');
    const agencyId = created.agency.id;

    const response = await (handlePlatformUpdateAgency as Function)(
      withPlatform(
        `${BASE}/api/platform/agencies/${agencyId}`,
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
    assertNoCoordinateLogged();
  });

  it('200 — sets agency active/inactive', async () => {
    const tenantId = await seedTenant('Rho City DRRMO');
    const token = await opsToken();

    const created = await world.platformStore.createAgency({
      tenantId,
      name: 'Fire Rho',
      code: 'FRH',
      agencyType: 'FIRE',
    });
    if (created.status !== 'ok') throw new Error('seed failed');
    const agencyId = created.agency.id;

    const response = await (handlePlatformUpdateAgency as Function)(
      withPlatform(
        `${BASE}/api/platform/agencies/${agencyId}`,
        token,
        jsonBody('PATCH', { active: false }),
      ),
      world.deps,
      agencyId,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { agency: { active: boolean } };
    expect(body.agency.active).toBe(false);
    assertNoCoordinateLogged();
  });

  it('400 invalid_agency — name too short on rename', async () => {
    const tenantId = await seedTenant('Sigma City DRRMO');
    const token = await opsToken();

    const created = await world.platformStore.createAgency({
      tenantId,
      name: 'Fire Sigma',
      code: 'FSG',
      agencyType: 'FIRE',
    });
    if (created.status !== 'ok') throw new Error('seed failed');
    const agencyId = created.agency.id;

    const response = await (handlePlatformUpdateAgency as Function)(
      withPlatform(
        `${BASE}/api/platform/agencies/${agencyId}`,
        token,
        jsonBody('PATCH', { name: 'X' }),
      ),
      world.deps,
      agencyId,
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('invalid_agency');
    assertNoCoordinateLogged();
  });

  it('404 agency_not_found — unknown agencyId', async () => {
    const token = await opsToken();

    const response = await (handlePlatformUpdateAgency as Function)(
      withPlatform(
        `${BASE}/api/platform/agencies/no-such-agency`,
        token,
        jsonBody('PATCH', { name: 'Whatever Bureau' }),
      ),
      world.deps,
      'no-such-agency',
    );

    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('agency_not_found');
    assertNoCoordinateLogged();
  });

  it('409 agency_exists — rename collision within tenant', async () => {
    const tenantId = await seedTenant('Tau City DRRMO');
    const token = await opsToken();

    await world.platformStore.createAgency({
      tenantId,
      name: 'Fire One',
      code: 'F1',
      agencyType: 'FIRE',
    });
    const created2 = await world.platformStore.createAgency({
      tenantId,
      name: 'Fire Two',
      code: 'F2',
      agencyType: 'FIRE',
    });
    if (created2.status !== 'ok') throw new Error('seed failed');
    const agencyId2 = created2.agency.id;

    const response = await (handlePlatformUpdateAgency as Function)(
      withPlatform(
        `${BASE}/api/platform/agencies/${agencyId2}`,
        token,
        jsonBody('PATCH', { name: 'Fire One' }),
      ),
      world.deps,
      agencyId2,
    );

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('agency_exists');
    assertNoCoordinateLogged();
  });

  it('401 — no platform cookie', async () => {
    const tenantId = await seedTenant('Upsilon City DRRMO');
    const created = await world.platformStore.createAgency({
      tenantId,
      name: 'Fire U',
      code: 'FU',
      agencyType: 'FIRE',
    });
    if (created.status !== 'ok') throw new Error('seed failed');
    const agencyId = created.agency.id;

    const response = await (handlePlatformUpdateAgency as Function)(
      new Request(
        `${BASE}/api/platform/agencies/${agencyId}`,
        jsonBody('PATCH', { name: 'Renamed' }),
      ),
      world.deps,
      agencyId,
    );

    expect(response.status).toBe(401);
    assertNoCoordinateLogged();
  });

  it('403 forbidden_origin — cross-site PATCH', async () => {
    const tenantId = await seedTenant('Phi City DRRMO');
    const token = await opsToken();

    const created = await world.platformStore.createAgency({
      tenantId,
      name: 'Fire Phi',
      code: 'FPH',
      agencyType: 'FIRE',
    });
    if (created.status !== 'ok') throw new Error('seed failed');
    const agencyId = created.agency.id;
    const originalName = created.agency.name;

    const response = await (handlePlatformUpdateAgency as Function)(
      withPlatform(
        `${BASE}/api/platform/agencies/${agencyId}`,
        token,
        crossOrigin(jsonBody('PATCH', { name: 'Renamed by attacker' })),
      ),
      world.deps,
      agencyId,
    );

    expect(response.status).toBe(403);
    // Verify the name was NOT changed.
    const still = await world.platformStore.findAgencyById(agencyId);
    expect(still?.name).toBe(originalName);
    assertNoCoordinateLogged();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/platform/tenants/[id]/capability
// ═══════════════════════════════════════════════════════════════════════════════

describe('handlePlatformReadCapability', () => {
  it('200 — returns a total four-key capability config', async () => {
    const tenantId = await seedTenant('Chi City DRRMO');
    const token = await opsToken();

    const response = await (handlePlatformReadCapability as Function)(
      withPlatform(`${BASE}/api/platform/tenants/${tenantId}/capability`, token),
      world.deps,
      tenantId,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      capability: { SUNOG: unknown; MEDIKAL: unknown; KRIMEN: unknown; BAHA: unknown };
    };
    expect(body.ok).toBe(true);
    // All four frozen categories must be present.
    expect(body.capability).toHaveProperty('SUNOG');
    expect(body.capability).toHaveProperty('MEDIKAL');
    expect(body.capability).toHaveProperty('KRIMEN');
    expect(body.capability).toHaveProperty('BAHA');
    assertNoCoordinateLogged();
  });

  it('200 — returns default config when no capability is stored', async () => {
    const tenantId = await seedTenant('Psi City DRRMO');
    const token = await opsToken();

    const response = await (handlePlatformReadCapability as Function)(
      withPlatform(`${BASE}/api/platform/tenants/${tenantId}/capability`, token),
      world.deps,
      tenantId,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      capability: { SUNOG: string[]; MEDIKAL: string[]; KRIMEN: string[] };
    };
    // DEFAULT_CAPABILITY_CONFIG ships FIRE for SUNOG, MEDICAL for MEDIKAL, POLICE for KRIMEN.
    expect(body.capability.SUNOG).toContain('FIRE');
    expect(body.capability.MEDIKAL).toContain('MEDICAL');
    expect(body.capability.KRIMEN).toContain('POLICE');
    assertNoCoordinateLogged();
  });

  it('401 — no auth', async () => {
    const tenantId = await seedTenant('Omega City DRRMO');

    const response = await (handlePlatformReadCapability as Function)(
      new Request(`${BASE}/api/platform/tenants/${tenantId}/capability`),
      world.deps,
      tenantId,
    );

    expect(response.status).toBe(401);
    assertNoCoordinateLogged();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PATCH /api/platform/tenants/[id]/capability
// ═══════════════════════════════════════════════════════════════════════════════

describe('handlePlatformSetCapability', () => {
  it('200 — updates the capability config for a single category', async () => {
    const tenantId = await seedTenant('Alpha2 City DRRMO');
    const token = await opsToken();

    const response = await (handlePlatformSetCapability as Function)(
      withPlatform(
        `${BASE}/api/platform/tenants/${tenantId}/capability`,
        token,
        jsonBody('PATCH', { category: 'SUNOG', agencyTypes: ['FIRE', 'DRRM'] }),
      ),
      world.deps,
      tenantId,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      capability: { SUNOG: string[] };
    };
    expect(body.ok).toBe(true);
    expect(body.capability.SUNOG).toContain('FIRE');
    expect(body.capability.SUNOG).toContain('DRRM');
    assertNoCoordinateLogged();
  });

  it('200 — allows an empty agencyTypes array (clears a category)', async () => {
    const tenantId = await seedTenant('Beta2 City DRRMO');
    const token = await opsToken();

    const response = await (handlePlatformSetCapability as Function)(
      withPlatform(
        `${BASE}/api/platform/tenants/${tenantId}/capability`,
        token,
        jsonBody('PATCH', { category: 'BAHA', agencyTypes: [] }),
      ),
      world.deps,
      tenantId,
    );

    expect(response.status).toBe(200);
    assertNoCoordinateLogged();
  });

  it('400 invalid_capability — unknown category', async () => {
    const tenantId = await seedTenant('Gamma2 City DRRMO');
    const token = await opsToken();

    const response = await (handlePlatformSetCapability as Function)(
      withPlatform(
        `${BASE}/api/platform/tenants/${tenantId}/capability`,
        token,
        jsonBody('PATCH', { category: 'EARTHQUAKE', agencyTypes: ['FIRE'] }),
      ),
      world.deps,
      tenantId,
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('invalid_capability');
    assertNoCoordinateLogged();
  });

  it('400 invalid_capability — unknown agency type in the list', async () => {
    const tenantId = await seedTenant('Delta2 City DRRMO');
    const token = await opsToken();

    const response = await (handlePlatformSetCapability as Function)(
      withPlatform(
        `${BASE}/api/platform/tenants/${tenantId}/capability`,
        token,
        jsonBody('PATCH', { category: 'SUNOG', agencyTypes: ['FIRE', 'NINJA'] }),
      ),
      world.deps,
      tenantId,
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('invalid_capability');
    assertNoCoordinateLogged();
  });

  it('401 — no auth', async () => {
    const tenantId = await seedTenant('Epsilon2 City DRRMO');

    const response = await (handlePlatformSetCapability as Function)(
      new Request(
        `${BASE}/api/platform/tenants/${tenantId}/capability`,
        jsonBody('PATCH', { category: 'SUNOG', agencyTypes: ['FIRE'] }),
      ),
      world.deps,
      tenantId,
    );

    expect(response.status).toBe(401);
    assertNoCoordinateLogged();
  });

  it('403 forbidden_origin — cross-site PATCH', async () => {
    const tenantId = await seedTenant('Zeta2 City DRRMO');
    const token = await opsToken();

    const response = await (handlePlatformSetCapability as Function)(
      withPlatform(
        `${BASE}/api/platform/tenants/${tenantId}/capability`,
        token,
        crossOrigin(jsonBody('PATCH', { category: 'SUNOG', agencyTypes: ['FIRE'] })),
      ),
      world.deps,
      tenantId,
    );

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('forbidden_origin');
    assertNoCoordinateLogged();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/platform/tenants/[id]/responders
// ═══════════════════════════════════════════════════════════════════════════════

describe('handlePlatformProvisionResponder', () => {
  /** Seed a tenant and get its LGU office id (added by createTenantWithLgu). */
  async function seedTenantWithOffice(
    name: string,
  ): Promise<{ tenantId: string; officeId: string }> {
    const tenantId = await seedTenant(name);
    const officeId = await world.platformStore.lguOfficeIdForTenant(tenantId);
    if (!officeId) throw new Error(`no LGU office for tenant ${tenantId}`);
    return { tenantId, officeId };
  }

  it('201 — provisions a responder and returns a one-time password', async () => {
    const { tenantId, officeId } = await seedTenantWithOffice('Eta2 City DRRMO');
    const token = await opsToken();

    const response = await (handlePlatformProvisionResponder as Function)(
      withPlatform(
        `${BASE}/api/platform/tenants/${tenantId}/responders`,
        token,
        jsonBody('POST', {
          email: 'responder@eta2.ph',
          officeId,
          callsign: 'ETA-1',
          role: 'RESPONDER',
        }),
      ),
      world.deps,
      tenantId,
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      ok: boolean;
      responder: { email: string };
      password: string;
    };
    expect(body.ok).toBe(true);
    expect(body.responder.email).toBe('responder@eta2.ph');
    expect(typeof body.password).toBe('string');
    expect(body.password.length).toBeGreaterThan(0);
    // ACCOUNT_CREATED audit should exist.
    const events = world.authStore.events;
    expect(events.some((e) => e.event === 'ACCOUNT_CREATED')).toBe(true);
    assertNoCoordinateLogged();
  });

  it('201 — DRRM_Generalist (no agencyId → agency_id null)', async () => {
    const { tenantId, officeId } = await seedTenantWithOffice('Theta2 City DRRMO');
    const token = await opsToken();

    const response = await (handlePlatformProvisionResponder as Function)(
      withPlatform(
        `${BASE}/api/platform/tenants/${tenantId}/responders`,
        token,
        jsonBody('POST', { email: 'generalist@theta2.ph', officeId }),
      ),
      world.deps,
      tenantId,
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as { responder: { agencyId: unknown } };
    // No agency supplied → agencyId must be null on the created responder.
    expect(body.responder.agencyId).toBeNull();
    assertNoCoordinateLogged();
  });

  it('400 invalid_responder — missing officeId', async () => {
    const { tenantId } = await seedTenantWithOffice('Iota2 City DRRMO');
    const token = await opsToken();

    const response = await (handlePlatformProvisionResponder as Function)(
      withPlatform(
        `${BASE}/api/platform/tenants/${tenantId}/responders`,
        token,
        jsonBody('POST', { email: 'nope@iota2.ph' }),
      ),
      world.deps,
      tenantId,
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('invalid_responder');
    assertNoCoordinateLogged();
  });

  it('404 office_not_found — unknown officeId', async () => {
    const { tenantId } = await seedTenantWithOffice('Kappa2 City DRRMO');
    const token = await opsToken();

    const response = await (handlePlatformProvisionResponder as Function)(
      withPlatform(
        `${BASE}/api/platform/tenants/${tenantId}/responders`,
        token,
        jsonBody('POST', { email: 'nope@kappa2.ph', officeId: 'no-such-office' }),
      ),
      world.deps,
      tenantId,
    );

    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('office_not_found');
    assertNoCoordinateLogged();
  });

  it('403 forbidden — office belongs to a different tenant', async () => {
    const { officeId: officeA } = await seedTenantWithOffice('Lambda2A DRRMO');
    const { tenantId: tenantB } = await seedTenantWithOffice('Lambda2B DRRMO');
    const token = await opsToken();

    // Try to provision into tenantB but supply officeA (which belongs to tenantA).
    const response = await (handlePlatformProvisionResponder as Function)(
      withPlatform(
        `${BASE}/api/platform/tenants/${tenantB}/responders`,
        token,
        jsonBody('POST', { email: 'cross@lambda2.ph', officeId: officeA }),
      ),
      world.deps,
      tenantB,
    );

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('forbidden');
    assertNoCoordinateLogged();
  });

  it('401 — no platform cookie', async () => {
    const { tenantId, officeId } = await seedTenantWithOffice('Mu2 City DRRMO');

    const response = await (handlePlatformProvisionResponder as Function)(
      new Request(
        `${BASE}/api/platform/tenants/${tenantId}/responders`,
        jsonBody('POST', { email: 'nope@mu2.ph', officeId }),
      ),
      world.deps,
      tenantId,
    );

    expect(response.status).toBe(401);
    assertNoCoordinateLogged();
  });

  it('403 forbidden_origin — cross-site POST', async () => {
    const { tenantId, officeId } = await seedTenantWithOffice('Nu2 City DRRMO');
    const token = await opsToken();

    const response = await (handlePlatformProvisionResponder as Function)(
      withPlatform(
        `${BASE}/api/platform/tenants/${tenantId}/responders`,
        token,
        crossOrigin(jsonBody('POST', { email: 'attack@nu2.ph', officeId })),
      ),
      world.deps,
      tenantId,
    );

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('forbidden_origin');
    assertNoCoordinateLogged();
  });

  it('R7.2 — operator cross-tenant: operator may provision into any tenant', async () => {
    const { tenantId: tenantA, officeId: officeA } = await seedTenantWithOffice('Xi2A DRRMO');
    const { tenantId: tenantB, officeId: officeB } = await seedTenantWithOffice('Xi2B DRRMO');
    const token = await opsToken();

    const respA = await (handlePlatformProvisionResponder as Function)(
      withPlatform(
        `${BASE}/api/platform/tenants/${tenantA}/responders`,
        token,
        jsonBody('POST', { email: 'ra@xi2a.ph', officeId: officeA }),
      ),
      world.deps,
      tenantA,
    );
    expect(respA.status).toBe(201);

    const respB = await (handlePlatformProvisionResponder as Function)(
      withPlatform(
        `${BASE}/api/platform/tenants/${tenantB}/responders`,
        token,
        jsonBody('POST', { email: 'rb@xi2b.ph', officeId: officeB }),
      ),
      world.deps,
      tenantB,
    );
    expect(respB.status).toBe(201);
    assertNoCoordinateLogged();
  });
});
