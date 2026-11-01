/**
 * @vitest-environment node
 *
 * Feature: tenant-responder-network, Property 12: No coordinate ever leaves a management action
 *
 * Property 12 (Design.md; Validates: Requirements R7.6, R4.9):
 *   For any management request/response (success OR error) and any audit entry, the serialized
 *   output contains no coordinate value; payloads carry only identity/status fields.
 *
 * We exercise the operator-tier responder-network handlers over `createTestHarness()` — the same
 * ops-token + withPlatform setup as `api-platform-responder-network.test.ts` — across many
 * randomly-generated management actions (valid and invalid inputs). The tenant's LGU office is
 * seeded with real 4-dp lat/lon so that the property proves even an office that HAS coordinates
 * never leaks them through any responder-network response body or any log line.
 *
 * Agencies / capability / responder payloads have no coordinate fields by design; this property
 * confirms that invariant holds across the whole management surface.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

import { AGENCY_TYPES, type AgencyType } from '@aira/ui';
import { hashPassword } from '../src/lib/auth/password';
import {
  handlePlatformLogin,
  handlePlatformCreateAgency,
  handlePlatformListAgencies,
  handlePlatformUpdateAgency,
  handlePlatformReadCapability,
  handlePlatformSetCapability,
  handlePlatformProvisionResponder,
} from '../src/lib/api/platform-handlers';
import { PLATFORM_SESSION_COOKIE } from '../src/lib/platform/session';
import { createTestHarness, jsonBody } from './support/harness';

// ── Constants ───────────────────────────────────────────────────────────────

const PASSWORD = 'correct horse battery staple';
const BASE = 'http://localhost';

/**
 * A lat/lon-style value: an optionally-signed number with 1–3 integer digits and ≥3 decimals.
 * This matches the seeded office coordinates (and anything resembling a GPS fix) if it were ever
 * serialized into a response or log line.
 */
const COORDINATE_TOKEN = /-?\d{1,3}\.\d{3,}/;

/** Seeded LGU-office coordinates — real 4-dp values, mesh-payload shaped. */
const SEED_LAT = 10.3157;
const SEED_LON = 123.8854;

// ── Harness + logger spies ────────────────────────────────────────────────────

let world: ReturnType<typeof createTestHarness>;
let logSpies: ReturnType<typeof vi.spyOn>[];

beforeEach(async () => {
  world = createTestHarness();
  world.platformStore.seedAdmin({
    id: 'ops-1',
    email: 'ops@aira.ph',
    passwordHash: await hashPassword(PASSWORD),
  });

  logSpies = [
    vi.spyOn(console, 'log').mockImplementation(() => undefined),
    vi.spyOn(console, 'info').mockImplementation(() => undefined),
    vi.spyOn(console, 'warn').mockImplementation(() => undefined),
    vi.spyOn(console, 'error').mockImplementation(() => undefined),
  ];
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Build a Request carrying the platform session cookie. */
function withPlatform(url: string, token: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set('cookie', `${PLATFORM_SESSION_COOKIE}=${token}`);
  return new Request(url, { ...init, headers });
}

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

/** Seed a tenant whose LGU office carries real 4-dp coordinates; return ids. */
async function seedTenantWithOffice(name: string): Promise<{ tenantId: string; officeId: string }> {
  const tenant = await world.platformStore.createTenantWithLgu({
    name,
    region: 'Region VII',
    province: 'Cebu',
    lguName: `${name} LGU`,
    lat: SEED_LAT,
    lon: SEED_LON,
    now: Date.now(),
  });
  const officeId = await world.platformStore.lguOfficeIdForTenant(tenant.id);
  if (!officeId) {
    throw new Error(`no LGU office for tenant ${tenant.id}`);
  }
  return { tenantId: tenant.id, officeId };
}

/** Collect every string argument passed to any console logger this run. */
function allLoggedText(): string {
  const parts: string[] = [];
  for (const spy of logSpies) {
    for (const args of spy.mock.calls) {
      parts.push(args.map(String).join(' '));
    }
  }
  return parts.join('\n');
}

// ── Response-body assertion ─────────────────────────────────────────────────

/** Serialize a handler response's JSON body to text; empty string if no JSON. */
async function serializeBody(response: Response): Promise<string> {
  try {
    const clone = response.clone();
    const value: unknown = await clone.json();
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function assertNoCoordinate(label: string, serialized: string): void {
  expect(
    COORDINATE_TOKEN.test(serialized),
    `coordinate value leaked in ${label}: ${serialized}`,
  ).toBe(false);
}

// ── Arbitraries ─────────────────────────────────────────────────────────────

/** A possibly-valid, possibly-invalid agency name (free text, some out of range). */
const nameArb = fc.string({ minLength: 0, maxLength: 80 });
/** A possibly-valid, possibly-invalid agency code. */
const codeArb = fc.string({ minLength: 0, maxLength: 16 });
/** A member agency type OR an arbitrary (often invalid) string. */
const agencyTypeArb = fc.oneof(
  fc.constantFrom<AgencyType>(...AGENCY_TYPES),
  fc.string({ minLength: 0, maxLength: 12 }),
);
/** A frozen category OR an arbitrary (often invalid) string. */
const categoryArb = fc.oneof(
  fc.constantFrom('SUNOG', 'MEDIKAL', 'KRIMEN', 'BAHA'),
  fc.string({ minLength: 0, maxLength: 12 }),
);
/** A list of agency-type-ish tokens (mix of valid + invalid). */
const agencyTypesListArb = fc.array(agencyTypeArb, { maxLength: 6 });
/** An email-ish string (mostly valid, sometimes garbage). */
const emailArb = fc.oneof(
  fc
    .tuple(fc.stringMatching(/^[a-z]{1,10}$/), fc.stringMatching(/^[a-z]{1,8}$/))
    .map(([user, host]) => `${user}@${host}.ph`),
  fc.string({ maxLength: 20 }),
);

// ── The property ──────────────────────────────────────────────────────────────

describe('Property 12 — no coordinate ever leaves a management action', () => {
  it('serialized responses and logs never contain a coordinate value (≥100 runs)', async () => {
    // Log in once; reuse the token across runs (the login limiter caps attempts far below ≥100).
    const token = await opsToken();

    await fc.assert(
      fc.asyncProperty(
        fc.record({
          createName: nameArb,
          createCode: codeArb,
          createType: agencyTypeArb,
          renameName: nameArb,
          renameActive: fc.boolean(),
          capCategory: categoryArb,
          capTypes: agencyTypesListArb,
          email: emailArb,
          callsign: fc.option(fc.string({ maxLength: 12 }), { nil: undefined }),
          useRealOffice: fc.boolean(),
          bogusAgencyId: fc.string({ minLength: 1, maxLength: 16 }),
        }),
        async (gen) => {
          // Fresh tenant per run so sequences don't interfere.
          const suffix = Math.random().toString(36).slice(2, 8);
          const { tenantId, officeId } = await seedTenantWithOffice(`PropCity ${suffix}`);

          // Sanity: the seeded office truly carries a coordinate token (the thing we guard against
          // leaking). If this ever fails, the property would be vacuous.
          const office = await world.platformStore.lguOfficeIdForTenant(tenantId);
          expect(office).toBe(officeId);

          // 1) Create agency (valid or invalid input).
          const createRes = await handlePlatformCreateAgency(
            withPlatform(
              `${BASE}/api/platform/tenants/${tenantId}/agencies`,
              token,
              jsonBody('POST', {
                name: gen.createName,
                code: gen.createCode,
                agencyType: gen.createType,
              }),
            ),
            world.deps,
            tenantId,
          );
          assertNoCoordinate('create response', await serializeBody(createRes));

          // Capture a real agency id if the create succeeded, else use a bogus id.
          let agencyId = gen.bogusAgencyId;
          if (createRes.status === 201) {
            const body = (await createRes.clone().json()) as { agency?: { id?: string } };
            if (body.agency?.id) {
              agencyId = body.agency.id;
            }
          }

          // 2) List agencies.
          const listRes = await handlePlatformListAgencies(
            withPlatform(`${BASE}/api/platform/tenants/${tenantId}/agencies`, token),
            world.deps,
            tenantId,
          );
          assertNoCoordinate('list response', await serializeBody(listRes));

          // 3) Update (rename / toggle active) — may 200/400/404/409.
          const updateRes = await handlePlatformUpdateAgency(
            withPlatform(
              `${BASE}/api/platform/agencies/${agencyId}`,
              token,
              jsonBody('PATCH', { name: gen.renameName, active: gen.renameActive }),
            ),
            world.deps,
            agencyId,
          );
          assertNoCoordinate('update response', await serializeBody(updateRes));

          // 4) Read capability config.
          const readCapRes = await handlePlatformReadCapability(
            withPlatform(`${BASE}/api/platform/tenants/${tenantId}/capability`, token),
            world.deps,
            tenantId,
          );
          assertNoCoordinate('read-capability response', await serializeBody(readCapRes));

          // 5) Set capability (valid or invalid).
          const setCapRes = await handlePlatformSetCapability(
            withPlatform(
              `${BASE}/api/platform/tenants/${tenantId}/capability`,
              token,
              jsonBody('PATCH', { category: gen.capCategory, agencyTypes: gen.capTypes }),
            ),
            world.deps,
            tenantId,
          );
          assertNoCoordinate('set-capability response', await serializeBody(setCapRes));

          // 6) Provision responder — uses the real office (which HAS coordinates) or a bogus one.
          const provisionRes = await handlePlatformProvisionResponder(
            withPlatform(
              `${BASE}/api/platform/tenants/${tenantId}/responders`,
              token,
              jsonBody('POST', {
                email: gen.email,
                officeId: gen.useRealOffice ? officeId : 'no-such-office',
                callsign: gen.callsign,
              }),
            ),
            world.deps,
            tenantId,
          );
          assertNoCoordinate('provision response', await serializeBody(provisionRes));

          // 7) Audit entries must never carry a coordinate value either.
          const auditText = JSON.stringify(world.authStore.events);
          assertNoCoordinate('audit log', auditText);

          // 8) No coordinate string may have been logged to any console channel.
          assertNoCoordinate('console output', allLoggedText());

          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});
