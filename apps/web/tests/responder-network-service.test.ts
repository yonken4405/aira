/**
 * @vitest-environment node
 *
 * TDD-RED: Agency + Capability service functions over the in-memory PlatformStore.
 *
 * The service module `../src/lib/responder-network/service` does NOT exist yet (task
 * 7.2). Every test in this file is expected to FAIL with a module-not-found error until
 * task 7.2 ships the implementation. The failures confirm the tests are wired correctly
 * and drive the implementation.
 *
 * Requirements: R2.4, R2.5, R3.2, R3.3, R3.4, R3.5, R3.6, R3.7, R3.8,
 *               R4.1, R4.2, R4.3, R4.4, R4.5, R4.6, R4.7, R4.8, R4.9,
 *               R5.1, R5.3, R5.4, R5.5, R5.7, R5.8, R5.9.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { createMemoryAuthStore, type MemoryAuthStore } from './support/memory-auth-store';
import {
  createMemoryPlatformStore,
  type MemoryPlatformStore,
} from './support/memory-platform-store';

// â”€â”€ Service under test (does NOT exist yet â†’ tests fail) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
import {
  createAgency,
  listAgenciesForTenant,
  listAgencyCoverage,
  provisionResponder,
  renameAgency,
  setAgencyActive,
  setAgencyCoverage,
  type ActingScope,
  type CreateAgencyResult,
  type RenameAgencyResult,
  type ResponderNetworkDeps,
  type SetAgencyActiveResult,
} from '../src/lib/responder-network/service';

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const NOW = 1_700_000_000_000;

let store: MemoryPlatformStore;
let authStore: MemoryAuthStore;
let deps: ResponderNetworkDeps;

/** Seed a tenant and return its id. */
async function seedTenant(name = 'Cebu City DRRMO'): Promise<string> {
  const tenant = await store.createTenantWithLgu({
    name,
    region: 'Region VII',
    province: 'Cebu',
    lguName: `${name} Office`,
    lat: 10.3157,
    lon: 123.8854,
    now: NOW,
  });
  return tenant.id;
}

beforeEach(() => {
  store = createMemoryPlatformStore();
  authStore = createMemoryAuthStore({ now: () => NOW });
  deps = { store };
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// createAgency
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('createAgency', () => {
  it('returns invalid for a 1-char trimmed name (below minimum 2)', async () => {
    const tenantId = await seedTenant();
    const scope: ActingScope = { tenantId };
    const result: CreateAgencyResult = await createAgency(deps, scope, {
      name: 'B',
      code: 'BFP',
      agencyType: 'FIRE',
    });
    expect(result.status).toBe('invalid');
  });

  it('returns invalid for a 65-char trimmed name (above maximum 64)', async () => {
    const tenantId = await seedTenant();
    const scope: ActingScope = { tenantId };
    const result: CreateAgencyResult = await createAgency(deps, scope, {
      name: 'A'.repeat(65),
      code: 'BFP',
      agencyType: 'FIRE',
    });
    expect(result.status).toBe('invalid');
  });

  it('accepts a 2-char trimmed name (at minimum boundary)', async () => {
    const tenantId = await seedTenant();
    const scope: ActingScope = { tenantId };
    const result: CreateAgencyResult = await createAgency(deps, scope, {
      name: 'BF',
      code: 'BFP',
      agencyType: 'FIRE',
    });
    expect(result.status).toBe('ok');
  });

  it('accepts a 64-char trimmed name (at maximum boundary)', async () => {
    const tenantId = await seedTenant();
    const scope: ActingScope = { tenantId };
    const result: CreateAgencyResult = await createAgency(deps, scope, {
      name: 'A'.repeat(64),
      code: 'BFP',
      agencyType: 'FIRE',
    });
    expect(result.status).toBe('ok');
  });

  it('returns invalid for a 1-char trimmed code (below minimum 2)', async () => {
    const tenantId = await seedTenant();
    const scope: ActingScope = { tenantId };
    const result: CreateAgencyResult = await createAgency(deps, scope, {
      name: 'Bureau of Fire',
      code: 'B',
      agencyType: 'FIRE',
    });
    expect(result.status).toBe('invalid');
  });

  it('returns invalid for a 13-char trimmed code (above maximum 12)', async () => {
    const tenantId = await seedTenant();
    const scope: ActingScope = { tenantId };
    const result: CreateAgencyResult = await createAgency(deps, scope, {
      name: 'Bureau of Fire',
      code: 'C'.repeat(13),
      agencyType: 'FIRE',
    });
    expect(result.status).toBe('invalid');
  });

  it('accepts a 2-char trimmed code (at minimum boundary)', async () => {
    const tenantId = await seedTenant();
    const scope: ActingScope = { tenantId };
    const result: CreateAgencyResult = await createAgency(deps, scope, {
      name: 'Bureau of Fire',
      code: 'BF',
      agencyType: 'FIRE',
    });
    expect(result.status).toBe('ok');
  });

  it('accepts a 12-char trimmed code (at maximum boundary)', async () => {
    const tenantId = await seedTenant();
    const scope: ActingScope = { tenantId };
    const result: CreateAgencyResult = await createAgency(deps, scope, {
      name: 'Bureau of Fire',
      code: 'C'.repeat(12),
      agencyType: 'FIRE',
    });
    expect(result.status).toBe('ok');
  });

  it('returns invalid_type for a non-member agencyType string (R2.4)', async () => {
    const tenantId = await seedTenant();
    const scope: ActingScope = { tenantId };
    const result: CreateAgencyResult = await createAgency(deps, scope, {
      name: 'Bureau of Fire',
      code: 'BFP',
      agencyType: 'NOT_A_REAL_TYPE',
    });
    expect(result.status).toBe('invalid_type');
  });

  it('returns invalid_type (not the submitted value) for a non-member agencyType (R2.5)', async () => {
    const tenantId = await seedTenant();
    const scope: ActingScope = { tenantId };
    // Ensure the error never echoes the submitted value
    const result: CreateAgencyResult = await createAgency(deps, scope, {
      name: 'Bureau of Fire',
      code: 'BFP',
      agencyType: 'HACK_TYPE',
    });
    expect(result.status).toBe('invalid_type');
    // The result must not echo the submitted value
    expect(JSON.stringify(result)).not.toContain('HACK_TYPE');
  });

  it('returns invalid_type for undefined/missing agencyType (R2.4/R2.5)', async () => {
    const tenantId = await seedTenant();
    const scope: ActingScope = { tenantId };
    // Pass undefined as agencyType to simulate a missing field from an API boundary
    const result: CreateAgencyResult = await createAgency(deps, scope, {
      name: 'Bureau of Fire',
      code: 'BFP',
      agencyType: undefined as unknown as string,
    });
    expect(result.status).toBe('invalid_type');
  });

  it('maps store tenant_not_found to tenant_not_found (R3.7)', async () => {
    const scope: ActingScope = { tenantId: 'nonexistent-tenant-id' };
    const result: CreateAgencyResult = await createAgency(deps, scope, {
      name: 'Bureau of Fire',
      code: 'BFP',
      agencyType: 'FIRE',
    });
    expect(result.status).toBe('tenant_not_found');
  });

  it('maps a 23505 duplicate collision to conflict (R3.4)', async () => {
    const tenantId = await seedTenant();
    const scope: ActingScope = { tenantId };
    // Create the first agency
    await createAgency(deps, scope, {
      name: 'Bureau of Fire',
      code: 'BFP',
      agencyType: 'FIRE',
    });
    // Create a duplicate (same name, case-insensitive)
    const result: CreateAgencyResult = await createAgency(deps, scope, {
      name: 'bureau of fire', // same name, different case â†’ 23505 per-tenant
      code: 'BFPDUP',
      agencyType: 'FIRE',
    });
    expect(result.status).toBe('conflict');
  });

  it('maps a 23505 code collision to conflict', async () => {
    const tenantId = await seedTenant();
    const scope: ActingScope = { tenantId };
    await createAgency(deps, scope, {
      name: 'Bureau of Fire',
      code: 'BFP',
      agencyType: 'FIRE',
    });
    const result: CreateAgencyResult = await createAgency(deps, scope, {
      name: 'BFP Duplicate',
      code: 'bfp', // same code, different case â†’ 23505 per-tenant
      agencyType: 'FIRE',
    });
    expect(result.status).toBe('conflict');
  });

  it('trims whitespace from name and code before persisting', async () => {
    const tenantId = await seedTenant();
    const scope: ActingScope = { tenantId };
    const result: CreateAgencyResult = await createAgency(deps, scope, {
      name: '  BFP  ',
      code: '  BFP  ',
      agencyType: 'FIRE',
    });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.agency.name).toBe('BFP');
      expect(result.agency.code).toBe('BFP');
    }
  });

  it('on success returns the persisted AgencyRecord with correct fields', async () => {
    const tenantId = await seedTenant();
    const scope: ActingScope = { tenantId };
    const result: CreateAgencyResult = await createAgency(deps, scope, {
      name: 'Bureau of Fire Protection',
      code: 'BFP',
      agencyType: 'FIRE',
    });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.agency.tenantId).toBe(tenantId);
      expect(result.agency.name).toBe('Bureau of Fire Protection');
      expect(result.agency.code).toBe('BFP');
      expect(result.agency.agencyType).toBe('FIRE');
      expect(result.agency.active).toBe(true);
      expect(typeof result.agency.id).toBe('string');
    }
  });

  it('accepts all five valid AgencyType values', async () => {
    const agencyTypes = ['FIRE', 'POLICE', 'MEDICAL', 'DRRM', 'OTHER'] as const;
    for (const [i, agencyType] of agencyTypes.entries()) {
      const tenantId = await seedTenant(`Tenant-${agencyType}-${i}`);
      const scope: ActingScope = { tenantId };
      const result: CreateAgencyResult = await createAgency(deps, scope, {
        name: `Agency ${agencyType}`,
        code: `T${i}`,
        agencyType,
      });
      expect(result.status).toBe('ok');
    }
  });
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// listAgenciesForTenant
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('listAgenciesForTenant', () => {
  it('returns only agencies belonging to the acting scope tenant', async () => {
    const tenantId1 = await seedTenant('Tenant Alpha');
    const tenantId2 = await seedTenant('Tenant Beta');
    const scope1: ActingScope = { tenantId: tenantId1 };
    const scope2: ActingScope = { tenantId: tenantId2 };

    await createAgency(deps, scope1, { name: 'Agency A1', code: 'A1', agencyType: 'FIRE' });
    await createAgency(deps, scope1, { name: 'Agency A2', code: 'A2', agencyType: 'POLICE' });
    await createAgency(deps, scope2, { name: 'Agency B1', code: 'B1', agencyType: 'MEDICAL' });

    const list1 = await listAgenciesForTenant(deps, scope1);
    const list2 = await listAgenciesForTenant(deps, scope2);

    expect(list1).toHaveLength(2);
    expect(list2).toHaveLength(1);
    expect(list1.every((a) => a.tenantId === tenantId1)).toBe(true);
    expect(list2.every((a) => a.tenantId === tenantId2)).toBe(true);
  });

  it('returns an empty array when the tenant has no agencies', async () => {
    const tenantId = await seedTenant();
    const scope: ActingScope = { tenantId };
    const list = await listAgenciesForTenant(deps, scope);
    expect(list).toHaveLength(0);
  });
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// renameAgency
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('renameAgency', () => {
  it('returns not_found for a missing agency id (R3.8)', async () => {
    const tenantId = await seedTenant();
    const scope: ActingScope = { tenantId };
    const result: RenameAgencyResult = await renameAgency(deps, scope, 'nonexistent-agency-id', {
      name: 'New Name',
    });
    expect(result.status).toBe('not_found');
  });

  it('returns cross_tenant when agency belongs to a different tenant (R7.4)', async () => {
    const tenantId1 = await seedTenant('Tenant Alpha');
    const tenantId2 = await seedTenant('Tenant Beta');
    const scope1: ActingScope = { tenantId: tenantId1 };

    // Create agency under tenant1
    const createResult = await createAgency(deps, scope1, {
      name: 'BFP Alpha',
      code: 'BFPA',
      agencyType: 'FIRE',
    });
    expect(createResult.status).toBe('ok');
    if (createResult.status !== 'ok') return;

    // Attempt rename from tenant2's scope
    const scope2: ActingScope = { tenantId: tenantId2 };
    const result: RenameAgencyResult = await renameAgency(deps, scope2, createResult.agency.id, {
      name: 'Hostile Rename',
    });
    expect(result.status).toBe('cross_tenant');
  });

  it('returns invalid for a renamed name that is too short (1 char) (R3.3)', async () => {
    const tenantId = await seedTenant();
    const scope: ActingScope = { tenantId };
    const createResult = await createAgency(deps, scope, {
      name: 'Bureau of Fire',
      code: 'BFP',
      agencyType: 'FIRE',
    });
    expect(createResult.status).toBe('ok');
    if (createResult.status !== 'ok') return;

    const result: RenameAgencyResult = await renameAgency(deps, scope, createResult.agency.id, {
      name: 'X',
    });
    expect(result.status).toBe('invalid');
  });

  it('returns invalid for a renamed name that is too long (65 chars) (R3.3)', async () => {
    const tenantId = await seedTenant();
    const scope: ActingScope = { tenantId };
    const createResult = await createAgency(deps, scope, {
      name: 'Bureau of Fire',
      code: 'BFP',
      agencyType: 'FIRE',
    });
    expect(createResult.status).toBe('ok');
    if (createResult.status !== 'ok') return;

    const result: RenameAgencyResult = await renameAgency(deps, scope, createResult.agency.id, {
      name: 'A'.repeat(65),
    });
    expect(result.status).toBe('invalid');
  });

  it('returns invalid for a renamed code that is too short (1 char) (R3.3)', async () => {
    const tenantId = await seedTenant();
    const scope: ActingScope = { tenantId };
    const createResult = await createAgency(deps, scope, {
      name: 'Bureau of Fire',
      code: 'BFP',
      agencyType: 'FIRE',
    });
    expect(createResult.status).toBe('ok');
    if (createResult.status !== 'ok') return;

    const result: RenameAgencyResult = await renameAgency(deps, scope, createResult.agency.id, {
      code: 'X',
    });
    expect(result.status).toBe('invalid');
  });

  it('returns invalid for a renamed code that is too long (13 chars) (R3.3)', async () => {
    const tenantId = await seedTenant();
    const scope: ActingScope = { tenantId };
    const createResult = await createAgency(deps, scope, {
      name: 'Bureau of Fire',
      code: 'BFP',
      agencyType: 'FIRE',
    });
    expect(createResult.status).toBe('ok');
    if (createResult.status !== 'ok') return;

    const result: RenameAgencyResult = await renameAgency(deps, scope, createResult.agency.id, {
      code: 'C'.repeat(13),
    });
    expect(result.status).toBe('invalid');
  });

  it('maps a 23505 name collision to conflict on rename (R3.4)', async () => {
    const tenantId = await seedTenant();
    const scope: ActingScope = { tenantId };

    await createAgency(deps, scope, { name: 'Agency Alpha', code: 'AA', agencyType: 'FIRE' });
    const r2 = await createAgency(deps, scope, {
      name: 'Agency Beta',
      code: 'AB',
      agencyType: 'POLICE',
    });
    expect(r2.status).toBe('ok');
    if (r2.status !== 'ok') return;

    // Rename Beta to Alpha (case-insensitive collision)
    const result: RenameAgencyResult = await renameAgency(deps, scope, r2.agency.id, {
      name: 'agency alpha',
    });
    expect(result.status).toBe('conflict');
  });

  it('maps a 23505 code collision to conflict on rename (R3.4)', async () => {
    const tenantId = await seedTenant();
    const scope: ActingScope = { tenantId };

    await createAgency(deps, scope, { name: 'Agency Alpha', code: 'AA', agencyType: 'FIRE' });
    const r2 = await createAgency(deps, scope, {
      name: 'Agency Beta',
      code: 'AB',
      agencyType: 'POLICE',
    });
    expect(r2.status).toBe('ok');
    if (r2.status !== 'ok') return;

    // Rename Beta's code to AA (collision)
    const result: RenameAgencyResult = await renameAgency(deps, scope, r2.agency.id, {
      code: 'aa',
    });
    expect(result.status).toBe('conflict');
  });

  it('on success returns the updated record with new name (R3.5)', async () => {
    const tenantId = await seedTenant();
    const scope: ActingScope = { tenantId };
    const createResult = await createAgency(deps, scope, {
      name: 'Bureau of Fire',
      code: 'BFP',
      agencyType: 'FIRE',
    });
    expect(createResult.status).toBe('ok');
    if (createResult.status !== 'ok') return;

    const result: RenameAgencyResult = await renameAgency(deps, scope, createResult.agency.id, {
      name: 'Bureau of Fire Protection',
    });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.agency.name).toBe('Bureau of Fire Protection');
      expect(result.agency.code).toBe('BFP'); // unchanged
      expect(result.agency.id).toBe(createResult.agency.id);
    }
  });
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// setAgencyActive
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('setAgencyActive', () => {
  it('returns not_found for a missing agency id (R3.8)', async () => {
    const tenantId = await seedTenant();
    const scope: ActingScope = { tenantId };
    const result: SetAgencyActiveResult = await setAgencyActive(
      deps,
      scope,
      'nonexistent-agency-id',
      false,
    );
    expect(result.status).toBe('not_found');
  });

  it('returns cross_tenant when the agency belongs to a different tenant (R7.4)', async () => {
    const tenantId1 = await seedTenant('Tenant Alpha');
    const tenantId2 = await seedTenant('Tenant Beta');
    const scope1: ActingScope = { tenantId: tenantId1 };

    const createResult = await createAgency(deps, scope1, {
      name: 'BFP Alpha',
      code: 'BFPA',
      agencyType: 'FIRE',
    });
    expect(createResult.status).toBe('ok');
    if (createResult.status !== 'ok') return;

    const scope2: ActingScope = { tenantId: tenantId2 };
    const result: SetAgencyActiveResult = await setAgencyActive(
      deps,
      scope2,
      createResult.agency.id,
      false,
    );
    expect(result.status).toBe('cross_tenant');
  });

  it('sets active to false (deactivate) and returns updated record (R3.6)', async () => {
    const tenantId = await seedTenant();
    const scope: ActingScope = { tenantId };
    const createResult = await createAgency(deps, scope, {
      name: 'Bureau of Fire',
      code: 'BFP',
      agencyType: 'FIRE',
    });
    expect(createResult.status).toBe('ok');
    if (createResult.status !== 'ok') return;

    const result: SetAgencyActiveResult = await setAgencyActive(
      deps,
      scope,
      createResult.agency.id,
      false,
    );
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.agency.active).toBe(false);
      expect(result.agency.id).toBe(createResult.agency.id);
    }
  });

  it('sets active to true (reactivate) and returns updated record (R3.6)', async () => {
    const tenantId = await seedTenant();
    const scope: ActingScope = { tenantId };
    const createResult = await createAgency(deps, scope, {
      name: 'Bureau of Fire',
      code: 'BFP',
      agencyType: 'FIRE',
    });
    expect(createResult.status).toBe('ok');
    if (createResult.status !== 'ok') return;

    // First deactivate
    await setAgencyActive(deps, scope, createResult.agency.id, false);
    // Then reactivate
    const result: SetAgencyActiveResult = await setAgencyActive(
      deps,
      scope,
      createResult.agency.id,
      true,
    );
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.agency.active).toBe(true);
    }
  });

  it('never deletes the row â€” only flips the boolean (R3.6)', async () => {
    const tenantId = await seedTenant();
    const scope: ActingScope = { tenantId };
    const createResult = await createAgency(deps, scope, {
      name: 'Bureau of Fire',
      code: 'BFP',
      agencyType: 'FIRE',
    });
    expect(createResult.status).toBe('ok');
    if (createResult.status !== 'ok') return;

    await setAgencyActive(deps, scope, createResult.agency.id, false);

    const list = await listAgenciesForTenant(deps, scope);
    // Row must still exist
    expect(list.some((a) => a.id === createResult.agency.id)).toBe(true);
  });

  it('is idempotent â€” setting active=false twice returns the same state', async () => {
    const tenantId = await seedTenant();
    const scope: ActingScope = { tenantId };
    const createResult = await createAgency(deps, scope, {
      name: 'Bureau of Fire',
      code: 'BFP',
      agencyType: 'FIRE',
    });
    expect(createResult.status).toBe('ok');
    if (createResult.status !== 'ok') return;

    await setAgencyActive(deps, scope, createResult.agency.id, false);
    const result: SetAgencyActiveResult = await setAgencyActive(
      deps,
      scope,
      createResult.agency.id,
      false,
    );
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.agency.active).toBe(false);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// provisionResponder (single-lgu-agency-network R3.1/R3.2, R4, R7.3)
// Agency is now REQUIRED; an AGENCY_ADMIN caller is bounded to its own agency.
// ────────────────────────────────────────────────────────────────────────────

describe('provisionResponder', () => {
  let provisionDeps: ResponderNetworkDeps & {
    auth: { store: MemoryAuthStore; now: () => number; secureCookies: boolean };
  };

  beforeEach(() => {
    store = createMemoryPlatformStore();
    authStore = createMemoryAuthStore({ now: () => NOW });
    provisionDeps = {
      store,
      auth: { store: authStore, now: () => NOW, secureCookies: false },
    };
  });

  async function seedTenantWithOffice(
    name = 'Provision Test DRRMO',
  ): Promise<{ tenantId: string; officeId: string }> {
    const tenant = await store.createTenantWithLgu({
      name,
      region: 'Region VII',
      province: 'Cebu',
      lguName: `${name} LGU Office`,
      lat: 10.3157,
      lon: 123.8854,
      now: NOW,
    });
    const officeId = await store.lguOfficeIdForTenant(tenant.id);
    if (officeId === null) throw new Error('lguOfficeIdForTenant returned null in test setup');
    return { tenantId: tenant.id, officeId };
  }

  /** Seed an active agency in the given tenant; returns its id. */
  async function seedAgency(tenantId: string, code = 'BFP'): Promise<string> {
    const result = await createAgency(
      { store },
      { tenantId },
      { name: `Agency ${code}`, code, agencyType: 'FIRE' },
    );
    if (result.status !== 'ok') throw new Error('seed agency failed');
    return result.agency.id;
  }

  const base = {
    email: 'new.responder@aira.test',
    role: 'RESPONDER' as const,
    password: 'Str0ng!Pass#2024',
    mustChangePassword: false,
  };

  it('returns invalid when officeId is omitted (R4.2)', async () => {
    const { tenantId } = await seedTenantWithOffice();
    const agencyId = await seedAgency(tenantId);
    const result = await provisionResponder(provisionDeps, { tenantId }, { ...base, agencyId });
    expect(result.status).toBe('invalid');
  });

  it('returns invalid when agency is omitted — agency is now required (R3.2)', async () => {
    const { tenantId, officeId } = await seedTenantWithOffice();
    const result = await provisionResponder(provisionDeps, { tenantId }, { ...base, officeId });
    expect(result.status).toBe('invalid');
    // Nothing is written on a rejected provision.
    expect(authStore.events.filter((e) => e.event === 'ACCOUNT_CREATED')).toHaveLength(0);
  });

  it('returns invalid when agencyId is explicitly null (R3.2)', async () => {
    const { tenantId, officeId } = await seedTenantWithOffice();
    const result = await provisionResponder(
      provisionDeps,
      { tenantId },
      {
        ...base,
        officeId,
        agencyId: null,
      },
    );
    expect(result.status).toBe('invalid');
  });

  it('returns office_not_found for an unrecognised officeId (R4.3)', async () => {
    const { tenantId } = await seedTenantWithOffice();
    const agencyId = await seedAgency(tenantId);
    const result = await provisionResponder(
      provisionDeps,
      { tenantId },
      {
        ...base,
        officeId: 'no-such-office-id',
        agencyId,
      },
    );
    expect(result.status).toBe('office_not_found');
  });

  it('returns office_cross_tenant when the office belongs to a different tenant (R4.4)', async () => {
    const { tenantId } = await seedTenantWithOffice();
    const { officeId: otherOfficeId } = await seedTenantWithOffice('Other DRRMO Tenant');
    const agencyId = await seedAgency(tenantId);
    const result = await provisionResponder(
      provisionDeps,
      { tenantId },
      {
        ...base,
        officeId: otherOfficeId,
        agencyId,
      },
    );
    expect(result.status).toBe('office_cross_tenant');
  });

  it('returns agency_not_found when agencyId does not exist (R4.5)', async () => {
    const { tenantId, officeId } = await seedTenantWithOffice();
    const result = await provisionResponder(
      provisionDeps,
      { tenantId },
      {
        ...base,
        officeId,
        agencyId: 'no-such-agency-id',
      },
    );
    expect(result.status).toBe('agency_not_found');
  });

  it('returns agency_cross_tenant when the agency belongs to a different tenant (R4.6)', async () => {
    const { tenantId, officeId } = await seedTenantWithOffice();
    const { tenantId: otherTenantId } = await seedTenantWithOffice('Other DRRMO Tenant');
    const otherAgencyId = await seedAgency(otherTenantId, 'OBFP');
    const result = await provisionResponder(
      provisionDeps,
      { tenantId },
      {
        ...base,
        officeId,
        agencyId: otherAgencyId,
      },
    );
    expect(result.status).toBe('agency_cross_tenant');
  });

  it('returns agency_inactive when the supplied agency is inactive (R4.7)', async () => {
    const { tenantId, officeId } = await seedTenantWithOffice();
    const agencyId = await seedAgency(tenantId);
    await setAgencyActive({ store }, { tenantId }, agencyId, false);
    const result = await provisionResponder(
      provisionDeps,
      { tenantId },
      {
        ...base,
        officeId,
        agencyId,
      },
    );
    expect(result.status).toBe('agency_inactive');
  });

  it('returns cross_agency when an AGENCY_ADMIN provisions into another agency (R7.3)', async () => {
    const { tenantId, officeId } = await seedTenantWithOffice();
    const ownAgencyId = await seedAgency(tenantId, 'BFP');
    const otherAgencyId = await seedAgency(tenantId, 'PNP');
    // The acting scope is bounded to the caller's own agency.
    const scope: ActingScope = { tenantId, agencyId: ownAgencyId };
    const result = await provisionResponder(provisionDeps, scope, {
      ...base,
      officeId,
      agencyId: otherAgencyId,
    });
    expect(result.status).toBe('cross_agency');
    expect(authStore.events.filter((e) => e.event === 'ACCOUNT_CREATED')).toHaveLength(0);
  });

  it('succeeds with a one-time password + ACCOUNT_CREATED audit on a valid office + agency (R4.1/R4.9)', async () => {
    const { tenantId, officeId } = await seedTenantWithOffice();
    const agencyId = await seedAgency(tenantId);
    const result = await provisionResponder(
      provisionDeps,
      { tenantId },
      {
        ...base,
        officeId,
        agencyId,
        email: 'firefighter@aira.test',
        callsign: 'FIRE-01',
      },
    );

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.responder.agencyId).toBe(agencyId);
      expect(result.responder.officeId).toBe(officeId);
      expect(result.password.length).toBeGreaterThan(0);
    }
    expect(authStore.events.filter((e) => e.event === 'ACCOUNT_CREATED')).toHaveLength(1);
  });

  it('an AGENCY_ADMIN may provision into its OWN agency (R7.3)', async () => {
    const { tenantId, officeId } = await seedTenantWithOffice();
    const agencyId = await seedAgency(tenantId);
    const scope: ActingScope = { tenantId, agencyId };
    const result = await provisionResponder(provisionDeps, scope, {
      ...base,
      officeId,
      agencyId,
      email: 'own.agency@aira.test',
    });
    expect(result.status).toBe('ok');
  });

  it('writes no coordinate into the ACCOUNT_CREATED audit entry (R4.9)', async () => {
    const { tenantId, officeId } = await seedTenantWithOffice();
    const agencyId = await seedAgency(tenantId);
    await provisionResponder(
      provisionDeps,
      { tenantId },
      {
        ...base,
        officeId,
        agencyId,
        email: 'nocoord@aira.test',
      },
    );
    for (const entry of authStore.events.filter((e) => e.event === 'ACCOUNT_CREATED')) {
      expect(JSON.stringify(entry)).not.toMatch(/\d{1,3}\.\d{4,}/);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// setAgencyCoverage / listAgencyCoverage (single-lgu-agency-network R5.2, R7.3)
// ────────────────────────────────────────────────────────────────────────────

describe('agency coverage service', () => {
  async function seedTenantOfficeAgency(): Promise<{
    tenantId: string;
    officeId: string;
    agencyId: string;
  }> {
    const tenant = await store.createTenantWithLgu({
      name: 'Coverage DRRMO',
      region: 'Region VII',
      province: 'Cebu',
      lguName: 'Coverage DRRMO LGU',
      lat: 10.3157,
      lon: 123.8854,
      now: NOW,
    });
    const officeId = await store.lguOfficeIdForTenant(tenant.id);
    if (officeId === null) throw new Error('no office');
    const created = await createAgency(
      { store },
      { tenantId: tenant.id },
      { name: 'Bureau of Fire Protection', code: 'BFP', agencyType: 'FIRE' },
    );
    if (created.status !== 'ok') throw new Error('seed agency failed');
    return { tenantId: tenant.id, officeId, agencyId: created.agency.id };
  }

  it('sets and lists coverage for the own agency (de-duplicated, full replace)', async () => {
    const { tenantId, officeId, agencyId } = await seedTenantOfficeAgency();
    const scope: ActingScope = { tenantId, agencyId };

    const set = await setAgencyCoverage(deps, scope, agencyId, [officeId, officeId]);
    expect(set.status).toBe('ok');
    if (set.status === 'ok') {
      expect(set.officeIds).toEqual([officeId]);
    }

    const list = await listAgencyCoverage(deps, scope, agencyId);
    expect(list.status).toBe('ok');
    if (list.status === 'ok') {
      expect(list.officeIds).toEqual([officeId]);
    }
  });

  it('rejects an office outside the acting LGU with invalid_office (same-LGU rule)', async () => {
    const { tenantId, agencyId } = await seedTenantOfficeAgency();
    const scope: ActingScope = { tenantId, agencyId };
    const result = await setAgencyCoverage(deps, scope, agencyId, ['office-not-in-lgu']);
    expect(result.status).toBe('invalid_office');
  });

  it('an AGENCY_ADMIN editing ANOTHER agency gets cross_agency (403-mapped)', async () => {
    const { tenantId, officeId, agencyId } = await seedTenantOfficeAgency();
    const otherAgency = await createAgency(
      { store },
      { tenantId },
      { name: 'Philippine National Police', code: 'PNP', agencyType: 'POLICE' },
    );
    if (otherAgency.status !== 'ok') throw new Error('seed other agency failed');

    // Acting bounded to BFP, but trying to edit PNP.
    const scope: ActingScope = { tenantId, agencyId };
    const result = await setAgencyCoverage(deps, scope, otherAgency.agency.id, [officeId]);
    expect(result.status).toBe('cross_agency');
  });

  it('an unknown / not-visible agency gets not_found (404-mapped)', async () => {
    const { tenantId, agencyId } = await seedTenantOfficeAgency();
    const scope: ActingScope = { tenantId, agencyId };
    const result = await listAgencyCoverage(deps, scope, 'no-such-agency');
    expect(result.status).toBe('not_found');
  });
});
