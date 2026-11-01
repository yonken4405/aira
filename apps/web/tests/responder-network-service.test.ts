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

// ── Service under test (does NOT exist yet → tests fail) ────────────────────
import {
  createAgency,
  listAgenciesForTenant,
  provisionResponder,
  readCapabilityConfig,
  renameAgency,
  setAgencyActive,
  setCapabilityForCategory,
  type ActingScope,
  type CreateAgencyResult,
  type RenameAgencyResult,
  type ResponderNetworkDeps,
  type SetAgencyActiveResult,
  type SetCapabilityResult,
} from '../src/lib/responder-network/service';

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// ────────────────────────────────────────────────────────────────────────────
// createAgency
// ────────────────────────────────────────────────────────────────────────────

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
      name: 'bureau of fire', // same name, different case → 23505 per-tenant
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
      code: 'bfp', // same code, different case → 23505 per-tenant
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

// ────────────────────────────────────────────────────────────────────────────
// listAgenciesForTenant
// ────────────────────────────────────────────────────────────────────────────

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

// ────────────────────────────────────────────────────────────────────────────
// renameAgency
// ────────────────────────────────────────────────────────────────────────────

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

// ────────────────────────────────────────────────────────────────────────────
// setAgencyActive
// ────────────────────────────────────────────────────────────────────────────

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

  it('never deletes the row — only flips the boolean (R3.6)', async () => {
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

  it('is idempotent — setting active=false twice returns the same state', async () => {
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
// readCapabilityConfig
// ────────────────────────────────────────────────────────────────────────────

describe('readCapabilityConfig', () => {
  it('returns a total four-key config when no capability is stored (DEFAULT_CAPABILITY_CONFIG) (R5.3/R5.8)', async () => {
    const tenantId = await seedTenant();
    const scope: ActingScope = { tenantId };
    const config = await readCapabilityConfig(deps, scope);

    // Must be a total map covering all four frozen categories (R5.1/R5.3)
    expect(Object.keys(config)).toHaveLength(4);
    expect(config).toHaveProperty('SUNOG');
    expect(config).toHaveProperty('MEDIKAL');
    expect(config).toHaveProperty('KRIMEN');
    expect(config).toHaveProperty('BAHA');
  });

  it('fills absent categories with the DEFAULT_CAPABILITY_CONFIG values (R5.8)', async () => {
    const tenantId = await seedTenant();
    const scope: ActingScope = { tenantId };
    const config = await readCapabilityConfig(deps, scope);

    // DEFAULT_CAPABILITY_CONFIG = { SUNOG: ['FIRE'], MEDIKAL: ['MEDICAL'], KRIMEN: ['POLICE'], BAHA: [] }
    expect(config.SUNOG).toEqual(['FIRE']);
    expect(config.MEDIKAL).toEqual(['MEDICAL']);
    expect(config.KRIMEN).toEqual(['POLICE']);
    expect(config.BAHA).toEqual([]);
  });

  it('returns the stored value when a category IS set (R5.1)', async () => {
    const tenantId = await seedTenant();
    const scope: ActingScope = { tenantId };

    // Set a category capability
    await setCapabilityForCategory(deps, scope, 'BAHA', ['DRRM', 'FIRE']);

    const config = await readCapabilityConfig(deps, scope);
    // BAHA should now have the stored value, not the default empty array
    expect(config.BAHA).toContain('DRRM');
    expect(config.BAHA).toContain('FIRE');
    expect(config.BAHA).toHaveLength(2);
  });

  it('is total even after some categories are set and some are not', async () => {
    const tenantId = await seedTenant();
    const scope: ActingScope = { tenantId };

    // Only set SUNOG
    await setCapabilityForCategory(deps, scope, 'SUNOG', ['FIRE', 'DRRM']);

    const config = await readCapabilityConfig(deps, scope);
    // All four keys must be present
    expect(Object.keys(config)).toHaveLength(4);
    // The unset ones fall back to default
    expect(config.MEDIKAL).toEqual(['MEDICAL']);
    expect(config.KRIMEN).toEqual(['POLICE']);
    expect(config.BAHA).toEqual([]);
    // The set one has the stored value
    expect(config.SUNOG).toContain('FIRE');
    expect(config.SUNOG).toContain('DRRM');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// setCapabilityForCategory
// ────────────────────────────────────────────────────────────────────────────

describe('setCapabilityForCategory', () => {
  it('returns invalid for a non-frozen category string (R5.7)', async () => {
    const tenantId = await seedTenant();
    const scope: ActingScope = { tenantId };
    const result: SetCapabilityResult = await setCapabilityForCategory(
      deps,
      scope,
      'NOT_A_CATEGORY' as never,
      ['FIRE'],
    );
    expect(result.status).toBe('invalid');
  });

  it('returns invalid for a non-taxonomy agency type in the list (R5.7)', async () => {
    const tenantId = await seedTenant();
    const scope: ActingScope = { tenantId };
    const result: SetCapabilityResult = await setCapabilityForCategory(deps, scope, 'SUNOG', [
      'FIRE',
      'NOT_REAL_TYPE',
    ] as never);
    expect(result.status).toBe('invalid');
  });

  it('de-duplicates the submitted agency types (R5.4)', async () => {
    const tenantId = await seedTenant();
    const scope: ActingScope = { tenantId };
    const result: SetCapabilityResult = await setCapabilityForCategory(deps, scope, 'SUNOG', [
      'FIRE',
      'FIRE',
      'DRRM',
      'DRRM',
    ]);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      const sunogTypes = result.capability.SUNOG;
      // De-duplicated: only unique values
      const unique = [...new Set(sunogTypes)];
      expect(sunogTypes).toHaveLength(unique.length);
    }
  });

  it('full-replaces one category without touching the others (R5.4)', async () => {
    const tenantId = await seedTenant();
    const scope: ActingScope = { tenantId };

    // Set initial state for KRIMEN
    await setCapabilityForCategory(deps, scope, 'KRIMEN', ['POLICE', 'DRRM']);

    // Now update only SUNOG
    const result: SetCapabilityResult = await setCapabilityForCategory(deps, scope, 'SUNOG', [
      'FIRE',
    ]);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      // SUNOG is updated
      expect(result.capability.SUNOG).toEqual(['FIRE']);
      // KRIMEN is unchanged
      expect(result.capability.KRIMEN).toContain('POLICE');
      expect(result.capability.KRIMEN).toContain('DRRM');
    }
  });

  it('is idempotent — a repeated identical update leaves config unchanged (R5.5)', async () => {
    const tenantId = await seedTenant();
    const scope: ActingScope = { tenantId };

    const first: SetCapabilityResult = await setCapabilityForCategory(deps, scope, 'BAHA', [
      'DRRM',
    ]);
    const second: SetCapabilityResult = await setCapabilityForCategory(deps, scope, 'BAHA', [
      'DRRM',
    ]);

    expect(first.status).toBe('ok');
    expect(second.status).toBe('ok');
    if (first.status === 'ok' && second.status === 'ok') {
      expect(second.capability.BAHA).toEqual(first.capability.BAHA);
    }
  });

  it('allows setting an empty set (DRRM generalists lead, R5.9)', async () => {
    const tenantId = await seedTenant();
    const scope: ActingScope = { tenantId };
    const result: SetCapabilityResult = await setCapabilityForCategory(deps, scope, 'BAHA', []);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.capability.BAHA).toEqual([]);
    }
  });

  it('returns the full four-key config after an update (R5.1)', async () => {
    const tenantId = await seedTenant();
    const scope: ActingScope = { tenantId };
    const result: SetCapabilityResult = await setCapabilityForCategory(deps, scope, 'MEDIKAL', [
      'MEDICAL',
    ]);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(Object.keys(result.capability)).toHaveLength(4);
      expect(result.capability).toHaveProperty('SUNOG');
      expect(result.capability).toHaveProperty('MEDIKAL');
      expect(result.capability).toHaveProperty('KRIMEN');
      expect(result.capability).toHaveProperty('BAHA');
    }
  });

  it('accepts all four frozen category ids', async () => {
    const tenantId = await seedTenant();
    const scope: ActingScope = { tenantId };
    for (const category of ['SUNOG', 'MEDIKAL', 'KRIMEN', 'BAHA'] as const) {
      const result: SetCapabilityResult = await setCapabilityForCategory(deps, scope, category, [
        'DRRM',
      ]);
      expect(result.status).toBe('ok');
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// provisionResponder
// (task 7.3 TDD-RED — provisionResponder is NOT yet exported from the service
//  module; every test in this block will fail with TypeError until task 7.4)
// ────────────────────────────────────────────────────────────────────────────

describe('provisionResponder', () => {
  /**
   * Each test in this block constructs a `provisionDeps` that combines the
   * platform store (for office/agency resolution) with an auth service dep
   * (for `createResponder` + `ACCOUNT_CREATED` audit).  Task 7.4 will add
   * `auth: AuthServiceDeps` to `ResponderNetworkDeps`; until then the extra
   * field is present so the tests drive the required signature.
   */

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

  // ── helpers ──────────────────────────────────────────────────────────────

  /** Seed a tenant + its LGU office; returns { tenantId, officeId }. */
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

  /** Seed a second tenant (different from the acting scope). */
  async function seedOtherTenant(): Promise<{ tenantId: string; officeId: string }> {
    return seedTenantWithOffice('Other DRRMO Tenant');
  }

  // ── R4.2: missing officeId → invalid ─────────────────────────────────────

  it('returns invalid when officeId is omitted (R4.2)', async () => {
    const { tenantId } = await seedTenantWithOffice();
    const scope: ActingScope = { tenantId };

    const result = await provisionResponder(provisionDeps, scope, {
      email: 'new.responder@aira.test',
      role: 'RESPONDER',
      password: 'Str0ng!Pass#2024',
      mustChangePassword: false,
    } as Parameters<typeof provisionResponder>[2]);

    expect(result.status).toBe('invalid');
  });

  it('returns invalid when officeId is an empty string (R4.2)', async () => {
    const { tenantId } = await seedTenantWithOffice();
    const scope: ActingScope = { tenantId };

    const result = await provisionResponder(provisionDeps, scope, {
      officeId: '',
      email: 'new.responder@aira.test',
      role: 'RESPONDER',
      password: 'Str0ng!Pass#2024',
      mustChangePassword: false,
    } as Parameters<typeof provisionResponder>[2]);

    expect(result.status).toBe('invalid');
  });

  // ── R4.3: unknown officeId → office_not_found ─────────────────────────────

  it('returns office_not_found for an unrecognised officeId (R4.3)', async () => {
    const { tenantId } = await seedTenantWithOffice();
    const scope: ActingScope = { tenantId };

    const result = await provisionResponder(provisionDeps, scope, {
      officeId: 'no-such-office-id',
      email: 'new.responder@aira.test',
      role: 'RESPONDER',
      password: 'Str0ng!Pass#2024',
      mustChangePassword: false,
    } as Parameters<typeof provisionResponder>[2]);

    expect(result.status).toBe('office_not_found');
  });

  it('creates no responder when officeId is unknown (R4.3)', async () => {
    const { tenantId } = await seedTenantWithOffice();
    const scope: ActingScope = { tenantId };

    await provisionResponder(provisionDeps, scope, {
      officeId: 'no-such-office-id',
      email: 'new.responder@aira.test',
      role: 'RESPONDER',
      password: 'Str0ng!Pass#2024',
      mustChangePassword: false,
    } as Parameters<typeof provisionResponder>[2]);

    // authStore should have zero responders created
    expect(authStore.events.filter((e) => e.event === 'ACCOUNT_CREATED')).toHaveLength(0);
  });

  // ── R4.4: office belongs to another tenant → office_cross_tenant → 403 ───

  it('returns office_cross_tenant when office belongs to a different tenant (R4.4)', async () => {
    const { tenantId } = await seedTenantWithOffice();
    const { officeId: otherOfficeId } = await seedOtherTenant();
    const scope: ActingScope = { tenantId }; // acting as tenant 1

    const result = await provisionResponder(provisionDeps, scope, {
      officeId: otherOfficeId, // but the office belongs to tenant 2
      email: 'new.responder@aira.test',
      role: 'RESPONDER',
      password: 'Str0ng!Pass#2024',
      mustChangePassword: false,
    } as Parameters<typeof provisionResponder>[2]);

    expect(result.status).toBe('office_cross_tenant');
  });

  it('creates no responder when office belongs to a different tenant (R4.4)', async () => {
    const { tenantId } = await seedTenantWithOffice();
    const { officeId: otherOfficeId } = await seedOtherTenant();
    const scope: ActingScope = { tenantId };

    await provisionResponder(provisionDeps, scope, {
      officeId: otherOfficeId,
      email: 'new.responder@aira.test',
      role: 'RESPONDER',
      password: 'Str0ng!Pass#2024',
      mustChangePassword: false,
    } as Parameters<typeof provisionResponder>[2]);

    expect(authStore.events.filter((e) => e.event === 'ACCOUNT_CREATED')).toHaveLength(0);
  });

  // ── R4.5: supplied agencyId unknown → agency_not_found ───────────────────

  it('returns agency_not_found when agencyId does not exist (R4.5)', async () => {
    const { tenantId, officeId } = await seedTenantWithOffice();
    const scope: ActingScope = { tenantId };

    const result = await provisionResponder(provisionDeps, scope, {
      officeId,
      agencyId: 'no-such-agency-id',
      email: 'new.responder@aira.test',
      role: 'RESPONDER',
      password: 'Str0ng!Pass#2024',
      mustChangePassword: false,
    } as Parameters<typeof provisionResponder>[2]);

    expect(result.status).toBe('agency_not_found');
  });

  it('creates no responder when agencyId is unknown (R4.5)', async () => {
    const { tenantId, officeId } = await seedTenantWithOffice();
    const scope: ActingScope = { tenantId };

    await provisionResponder(provisionDeps, scope, {
      officeId,
      agencyId: 'no-such-agency-id',
      email: 'new.responder@aira.test',
      role: 'RESPONDER',
      password: 'Str0ng!Pass#2024',
      mustChangePassword: false,
    } as Parameters<typeof provisionResponder>[2]);

    expect(authStore.events.filter((e) => e.event === 'ACCOUNT_CREATED')).toHaveLength(0);
  });

  // ── R4.6: agency belongs to a different tenant → agency_cross_tenant ─────

  it('returns agency_cross_tenant when agency belongs to a different tenant (R4.6)', async () => {
    const { tenantId, officeId } = await seedTenantWithOffice();
    const { tenantId: otherTenantId } = await seedOtherTenant();
    const scope: ActingScope = { tenantId };

    // Create an agency under the OTHER tenant
    const otherScope: ActingScope = { tenantId: otherTenantId };
    const agencyResult = await createAgency({ store }, otherScope, {
      name: 'Other BFP',
      code: 'OBFP',
      agencyType: 'FIRE',
    });
    expect(agencyResult.status).toBe('ok');
    if (agencyResult.status !== 'ok') return;

    const result = await provisionResponder(provisionDeps, scope, {
      officeId,
      agencyId: agencyResult.agency.id, // agency of tenant 2, but acting as tenant 1
      email: 'new.responder@aira.test',
      role: 'RESPONDER',
      password: 'Str0ng!Pass#2024',
      mustChangePassword: false,
    } as Parameters<typeof provisionResponder>[2]);

    expect(result.status).toBe('agency_cross_tenant');
  });

  it('creates no responder when agency belongs to a different tenant (R4.6)', async () => {
    const { tenantId, officeId } = await seedTenantWithOffice();
    const { tenantId: otherTenantId } = await seedOtherTenant();
    const scope: ActingScope = { tenantId };

    const otherScope: ActingScope = { tenantId: otherTenantId };
    const agencyResult = await createAgency({ store }, otherScope, {
      name: 'Other PNP',
      code: 'OPNP',
      agencyType: 'POLICE',
    });
    expect(agencyResult.status).toBe('ok');
    if (agencyResult.status !== 'ok') return;

    await provisionResponder(provisionDeps, scope, {
      officeId,
      agencyId: agencyResult.agency.id,
      email: 'new.responder@aira.test',
      role: 'RESPONDER',
      password: 'Str0ng!Pass#2024',
      mustChangePassword: false,
    } as Parameters<typeof provisionResponder>[2]);

    expect(authStore.events.filter((e) => e.event === 'ACCOUNT_CREATED')).toHaveLength(0);
  });

  // ── R4.7: agency is inactive → agency_inactive ────────────────────────────

  it('returns agency_inactive when the supplied agency is inactive (R4.7)', async () => {
    const { tenantId, officeId } = await seedTenantWithOffice();
    const scope: ActingScope = { tenantId };

    // Create and then deactivate an agency
    const agencyResult = await createAgency({ store }, scope, {
      name: 'Inactive BFP',
      code: 'IBFP',
      agencyType: 'FIRE',
    });
    expect(agencyResult.status).toBe('ok');
    if (agencyResult.status !== 'ok') return;

    await setAgencyActive({ store }, scope, agencyResult.agency.id, false);

    const result = await provisionResponder(provisionDeps, scope, {
      officeId,
      agencyId: agencyResult.agency.id,
      email: 'new.responder@aira.test',
      role: 'RESPONDER',
      password: 'Str0ng!Pass#2024',
      mustChangePassword: false,
    } as Parameters<typeof provisionResponder>[2]);

    expect(result.status).toBe('agency_inactive');
  });

  it('creates no responder when agency is inactive (R4.7)', async () => {
    const { tenantId, officeId } = await seedTenantWithOffice();
    const scope: ActingScope = { tenantId };

    const agencyResult = await createAgency({ store }, scope, {
      name: 'Inactive EMS',
      code: 'IEMS',
      agencyType: 'MEDICAL',
    });
    expect(agencyResult.status).toBe('ok');
    if (agencyResult.status !== 'ok') return;

    await setAgencyActive({ store }, scope, agencyResult.agency.id, false);

    await provisionResponder(provisionDeps, scope, {
      officeId,
      agencyId: agencyResult.agency.id,
      email: 'new.responder@aira.test',
      role: 'RESPONDER',
      password: 'Str0ng!Pass#2024',
      mustChangePassword: false,
    } as Parameters<typeof provisionResponder>[2]);

    expect(authStore.events.filter((e) => e.event === 'ACCOUNT_CREATED')).toHaveLength(0);
  });

  // ── R4.8: no agencyId → DRRM_Generalist with agency_id null ──────────────

  it('creates a DRRM_Generalist (agency_id null) when no agencyId is supplied (R4.8)', async () => {
    const { tenantId, officeId } = await seedTenantWithOffice();
    const scope: ActingScope = { tenantId };

    const result = await provisionResponder(provisionDeps, scope, {
      officeId,
      // no agencyId supplied
      email: 'generalist@aira.test',
      role: 'RESPONDER',
      password: 'Str0ng!Pass#2024',
      mustChangePassword: false,
    } as Parameters<typeof provisionResponder>[2]);

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.responder.agencyId).toBeNull();
    }
  });

  it('creates a DRRM_Generalist (agency_id null) when agencyId is explicitly null (R4.8)', async () => {
    const { tenantId, officeId } = await seedTenantWithOffice();
    const scope: ActingScope = { tenantId };

    const result = await provisionResponder(provisionDeps, scope, {
      officeId,
      agencyId: null,
      email: 'generalist2@aira.test',
      role: 'RESPONDER',
      password: 'Str0ng!Pass#2024',
      mustChangePassword: false,
    } as Parameters<typeof provisionResponder>[2]);

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.responder.agencyId).toBeNull();
    }
  });

  // ── R4.1 + R4.9: success — valid office + agency, creates responder + OTP + ACCOUNT_CREATED ──

  it('returns ok with the created responder and a one-time password on success (R4.1)', async () => {
    const { tenantId, officeId } = await seedTenantWithOffice();
    const scope: ActingScope = { tenantId };

    // Create an active agency for this tenant
    const agencyResult = await createAgency({ store }, scope, {
      name: 'Bureau of Fire Protection',
      code: 'BFP',
      agencyType: 'FIRE',
    });
    expect(agencyResult.status).toBe('ok');
    if (agencyResult.status !== 'ok') return;

    const result = await provisionResponder(provisionDeps, scope, {
      officeId,
      agencyId: agencyResult.agency.id,
      email: 'firefighter@aira.test',
      callsign: 'FIRE-01',
      role: 'RESPONDER',
      password: 'Str0ng!Pass#2024',
      mustChangePassword: true,
    } as Parameters<typeof provisionResponder>[2]);

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.responder).toBeDefined();
      expect(typeof result.responder.id).toBe('string');
      expect(result.responder.email).toBe('firefighter@aira.test');
      expect(result.responder.agencyId).toBe(agencyResult.agency.id);
      expect(result.responder.officeId).toBe(officeId);
      // One-time password shown exactly once (R4.1)
      expect(typeof result.password).toBe('string');
      expect(result.password.length).toBeGreaterThan(0);
    }
  });

  it('appends ACCOUNT_CREATED to the auth store events on success (R4.9)', async () => {
    const { tenantId, officeId } = await seedTenantWithOffice();
    const scope: ActingScope = { tenantId };

    const agencyResult = await createAgency({ store }, scope, {
      name: 'Philippine National Police',
      code: 'PNP',
      agencyType: 'POLICE',
    });
    expect(agencyResult.status).toBe('ok');
    if (agencyResult.status !== 'ok') return;

    await provisionResponder(provisionDeps, scope, {
      officeId,
      agencyId: agencyResult.agency.id,
      email: 'officer@aira.test',
      role: 'RESPONDER',
      password: 'Str0ng!Pass#2024',
      mustChangePassword: true,
    } as Parameters<typeof provisionResponder>[2]);

    const created = authStore.events.filter((e) => e.event === 'ACCOUNT_CREATED');
    expect(created.length).toBeGreaterThanOrEqual(1);
  });

  it('does not write any coordinate into the ACCOUNT_CREATED audit entry (R4.9)', async () => {
    const { tenantId, officeId } = await seedTenantWithOffice();
    const scope: ActingScope = { tenantId };

    await provisionResponder(provisionDeps, scope, {
      officeId,
      // no agencyId — DRRM_Generalist
      email: 'nocoord@aira.test',
      role: 'RESPONDER',
      password: 'Str0ng!Pass#2024',
      mustChangePassword: false,
    } as Parameters<typeof provisionResponder>[2]);

    const created = authStore.events.filter((e) => e.event === 'ACCOUNT_CREATED');
    for (const entry of created) {
      const serialised = JSON.stringify(entry);
      // Coordinates look like floating-point numbers with 4+ decimal places
      expect(serialised).not.toMatch(/\d{1,3}\.\d{4,}/);
    }
  });

  it('the one-time password is shown exactly once (not stored in plain text) (R4.1)', async () => {
    const { tenantId, officeId } = await seedTenantWithOffice();
    const scope: ActingScope = { tenantId };

    const result = await provisionResponder(provisionDeps, scope, {
      officeId,
      email: 'otp.check@aira.test',
      role: 'RESPONDER',
      password: 'Str0ng!Pass#2024',
      mustChangePassword: true,
    } as Parameters<typeof provisionResponder>[2]);

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      // The password field must be present in the result (shown once to the admin)
      expect(result.password).toBeTruthy();
      // The responder record itself must NOT store the plaintext password
      expect((result.responder as unknown as Record<string, unknown>)['password']).toBeUndefined();
      expect((result.responder as unknown as Record<string, unknown>)['passwordHash']).not.toBe(
        result.password,
      );
    }
  });
});
