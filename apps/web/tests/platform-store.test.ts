/**
 * @vitest-environment node
 *
 * In-memory `PlatformStore` responder-network methods (tenant-responder-network).
 *
 * TDD-RED: the in-memory adapter (`createMemoryPlatformStore`) does NOT implement the
 * eight new port methods yet (task 4.2). These tests exercise the documented behavior
 * from design.md ("PlatformStore port additions" + "In-memory implementation notes")
 * and are expected to FAIL until the store is implemented — the methods are declared on
 * the `PlatformStore` interface, so the store object simply lacks them at runtime
 * (undefined-is-not-a-function).
 *
 * Requirements: R1.1, R1.7-R1.10, R3.2/3.4/3.5/3.6, R5.3/5.4/5.5, R9.8.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { AgencyType, EmergencyCategoryId } from '@aira/ui';

import {
  createMemoryPlatformStore,
  type MemoryPlatformStore,
} from './support/memory-platform-store';

const NOW = 1_700_000_000_000;

let store: MemoryPlatformStore;

beforeEach(() => {
  store = createMemoryPlatformStore();
});

/** Seed a tenant + its LGU office; return the tenant id and the LGU office id. */
async function seedTenant(overrides: {
  name: string;
  lguName?: string;
  region?: string;
  province?: string;
}): Promise<{ tenantId: string; lguOfficeId: string }> {
  const tenant = await store.createTenantWithLgu({
    name: overrides.name,
    region: overrides.region ?? 'Region VII',
    province: overrides.province ?? 'Cebu',
    lguName: overrides.lguName ?? `${overrides.name} LGU`,
    lat: 10.3157,
    lon: 123.8854,
    now: NOW,
  });
  const lguOfficeId = await store.lguOfficeIdForTenant(tenant.id);
  if (lguOfficeId === null) {
    throw new Error('seed_lgu_office_missing');
  }
  return { tenantId: tenant.id, lguOfficeId };
}

describe('createAgency', () => {
  it('returns tenant_not_found for an unknown tenant id (R1.1)', async () => {
    const result = await store.createAgency({
      tenantId: 'tenant-does-not-exist',
      name: 'Bureau of Fire',
      code: 'BFP',
      agencyType: 'FIRE',
    });
    expect(result).toEqual({ status: 'tenant_not_found' });
  });

  it('persists a trimmed agency for a present tenant (R1.1, R3.2)', async () => {
    const { tenantId } = await seedTenant({ name: 'Cebu City' });

    const result = await store.createAgency({
      tenantId,
      name: '  Bureau of Fire Protection  ',
      code: '  BFP  ',
      agencyType: 'FIRE',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      throw new Error('expected ok');
    }
    const { agency } = result;
    expect(agency.tenantId).toBe(tenantId);
    expect(agency.name).toBe('Bureau of Fire Protection');
    expect(agency.code).toBe('BFP');
    expect(agency.agencyType).toBe('FIRE');
    expect(agency.active).toBe(true);
    expect(typeof agency.id).toBe('string');
    expect(agency.id.length).toBeGreaterThan(0);
  });

  it('throws 23505 on a per-tenant case-insensitive duplicate name (R1.7-R1.10, R3.4)', async () => {
    const { tenantId } = await seedTenant({ name: 'Cebu City' });
    const ok = await store.createAgency({
      tenantId,
      name: 'Bureau of Fire',
      code: 'BFP',
      agencyType: 'FIRE',
    });
    expect(ok.status).toBe('ok');

    await expect(
      store.createAgency({
        tenantId,
        name: 'bureau OF fire',
        code: 'BFP2',
        agencyType: 'FIRE',
      }),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('throws 23505 on a per-tenant case-insensitive duplicate code (R1.7-R1.10, R3.4)', async () => {
    const { tenantId } = await seedTenant({ name: 'Cebu City' });
    await store.createAgency({
      tenantId,
      name: 'Bureau of Fire',
      code: 'BFP',
      agencyType: 'FIRE',
    });

    await expect(
      store.createAgency({
        tenantId,
        name: 'Fire Station Two',
        code: 'bfp',
        agencyType: 'FIRE',
      }),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('allows the same name/code under a different tenant (R1.7-R1.10, R3.4)', async () => {
    const a = await seedTenant({ name: 'Cebu City' });
    const b = await seedTenant({ name: 'Mandaue City' });

    const first = await store.createAgency({
      tenantId: a.tenantId,
      name: 'Bureau of Fire',
      code: 'BFP',
      agencyType: 'FIRE',
    });
    const second = await store.createAgency({
      tenantId: b.tenantId,
      name: 'Bureau of Fire',
      code: 'BFP',
      agencyType: 'FIRE',
    });

    expect(first.status).toBe('ok');
    expect(second.status).toBe('ok');
  });
});

describe('listAgenciesForTenant', () => {
  it('returns only the given tenant agencies (R3.2)', async () => {
    const a = await seedTenant({ name: 'Cebu City' });
    const b = await seedTenant({ name: 'Mandaue City' });

    await store.createAgency({
      tenantId: a.tenantId,
      name: 'Cebu Fire',
      code: 'CFP',
      agencyType: 'FIRE',
    });
    await store.createAgency({
      tenantId: a.tenantId,
      name: 'Cebu Police',
      code: 'CPD',
      agencyType: 'POLICE',
    });
    await store.createAgency({
      tenantId: b.tenantId,
      name: 'Mandaue Fire',
      code: 'MFP',
      agencyType: 'FIRE',
    });

    const listA = await store.listAgenciesForTenant(a.tenantId);
    const listB = await store.listAgenciesForTenant(b.tenantId);

    expect(listA).toHaveLength(2);
    expect(listA.every((agency) => agency.tenantId === a.tenantId)).toBe(true);
    expect(listB).toHaveLength(1);
    expect(listB[0]?.tenantId).toBe(b.tenantId);
  });
});

describe('findAgencyById', () => {
  it('returns the record or null', async () => {
    const { tenantId } = await seedTenant({ name: 'Cebu City' });
    const created = await store.createAgency({
      tenantId,
      name: 'Cebu Fire',
      code: 'CFP',
      agencyType: 'FIRE',
    });
    if (created.status !== 'ok') {
      throw new Error('expected ok');
    }

    const found = await store.findAgencyById(created.agency.id);
    expect(found).toEqual(created.agency);
    expect(await store.findAgencyById('agency-missing')).toBeNull();
  });
});

describe('findOfficeTenantId', () => {
  it('returns the office tenant id, or null for unknown (R3.2)', async () => {
    const { tenantId, lguOfficeId } = await seedTenant({ name: 'Cebu City' });

    expect(await store.findOfficeTenantId(lguOfficeId)).toBe(tenantId);
    expect(await store.findOfficeTenantId('office-missing')).toBeNull();
  });
});

describe('renameAgency', () => {
  it('updates name and code and returns the updated record (R3.5)', async () => {
    const { tenantId } = await seedTenant({ name: 'Cebu City' });
    const created = await store.createAgency({
      tenantId,
      name: 'Cebu Fire',
      code: 'CFP',
      agencyType: 'FIRE',
    });
    if (created.status !== 'ok') {
      throw new Error('expected ok');
    }

    const updated = await store.renameAgency(created.agency.id, {
      name: 'Cebu City Fire',
      code: 'CCFP',
    });

    expect(updated).not.toBeNull();
    expect(updated?.name).toBe('Cebu City Fire');
    expect(updated?.code).toBe('CCFP');
    expect(updated?.id).toBe(created.agency.id);
    expect(updated?.tenantId).toBe(tenantId);
  });

  it('throws 23505 on collision with another agency in the same tenant (R3.4, R3.5)', async () => {
    const { tenantId } = await seedTenant({ name: 'Cebu City' });
    await store.createAgency({
      tenantId,
      name: 'Cebu Fire',
      code: 'CFP',
      agencyType: 'FIRE',
    });
    const second = await store.createAgency({
      tenantId,
      name: 'Cebu Police',
      code: 'CPD',
      agencyType: 'POLICE',
    });
    if (second.status !== 'ok') {
      throw new Error('expected ok');
    }

    await expect(store.renameAgency(second.agency.id, { name: 'cebu FIRE' })).rejects.toMatchObject(
      { code: '23505' },
    );
  });

  it('returns null for a missing id (R3.5)', async () => {
    expect(await store.renameAgency('agency-missing', { name: 'Nope' })).toBeNull();
  });
});

describe('setAgencyActive', () => {
  it('flips active to false, retains the row, and returns the updated record (R3.6)', async () => {
    const { tenantId } = await seedTenant({ name: 'Cebu City' });
    const created = await store.createAgency({
      tenantId,
      name: 'Cebu Fire',
      code: 'CFP',
      agencyType: 'FIRE',
    });
    if (created.status !== 'ok') {
      throw new Error('expected ok');
    }

    const updated = await store.setAgencyActive(created.agency.id, false);
    expect(updated).not.toBeNull();
    expect(updated?.active).toBe(false);
    expect(updated?.id).toBe(created.agency.id);

    const stillFindable = await store.findAgencyById(created.agency.id);
    expect(stillFindable).not.toBeNull();
    expect(stillFindable?.active).toBe(false);
  });

  it('returns null for a missing id (R3.6)', async () => {
    expect(await store.setAgencyActive('agency-missing', false)).toBeNull();
  });
});

describe('capability config', () => {
  it('readCapabilityConfig returns null when nothing is stored (R5.3)', async () => {
    const { tenantId } = await seedTenant({ name: 'Cebu City' });
    expect(await store.readCapabilityConfig(tenantId)).toBeNull();
  });

  it('setCapabilityForCategory de-duplicates and full-replaces one category (R5.4/R5.5)', async () => {
    const { tenantId } = await seedTenant({ name: 'Cebu City' });

    const category: EmergencyCategoryId = 'SUNOG';
    const submitted: readonly AgencyType[] = ['FIRE', 'FIRE', 'POLICE'];

    const config = await store.setCapabilityForCategory(tenantId, category, submitted);

    // de-duplicated set-like result, order-insensitive
    expect(new Set(config.SUNOG)).toEqual(new Set<AgencyType>(['FIRE', 'POLICE']));
    expect(config.SUNOG).toHaveLength(2);

    // only SUNOG is touched; other categories remain absent/empty
    expect(config.MEDIKAL ?? []).toEqual([]);
    expect(config.KRIMEN ?? []).toEqual([]);
    expect(config.BAHA ?? []).toEqual([]);

    // read-after-write reflects the stored SUNOG set
    const read = await store.readCapabilityConfig(tenantId);
    expect(read).not.toBeNull();
    expect(new Set(read?.SUNOG ?? [])).toEqual(new Set<AgencyType>(['FIRE', 'POLICE']));

    // idempotent on a repeated identical call
    const again = await store.setCapabilityForCategory(tenantId, category, submitted);
    expect(new Set(again.SUNOG)).toEqual(new Set<AgencyType>(['FIRE', 'POLICE']));
    expect(again.SUNOG).toHaveLength(2);
  });

  it('full-replaces exactly one category, leaving others unchanged (R5.4)', async () => {
    const { tenantId } = await seedTenant({ name: 'Cebu City' });

    await store.setCapabilityForCategory(tenantId, 'SUNOG', ['FIRE']);
    const config = await store.setCapabilityForCategory(tenantId, 'MEDIKAL', ['MEDICAL']);

    expect(new Set(config.SUNOG)).toEqual(new Set<AgencyType>(['FIRE']));
    expect(new Set(config.MEDIKAL)).toEqual(new Set<AgencyType>(['MEDICAL']));

    // replacing SUNOG does not disturb MEDIKAL
    const replaced = await store.setCapabilityForCategory(tenantId, 'SUNOG', ['FIRE', 'DRRM']);
    expect(new Set(replaced.SUNOG)).toEqual(new Set<AgencyType>(['FIRE', 'DRRM']));
    expect(new Set(replaced.MEDIKAL)).toEqual(new Set<AgencyType>(['MEDICAL']));
  });
});
