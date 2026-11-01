// @vitest-environment node
/**
 * TDD-RED (tenant-responder-network task 5.1): the Postgres `PlatformStore`
 * adapter's responder-network methods are not implemented yet (task 5.2), so
 * these tests MUST fail — the returned store object lacks the eight methods.
 *
 * The real `../db` module (pg Pool) is mocked so the adapter is exercised in
 * isolation: we assert the SQL statements it issues (loose substring matches)
 * and the parameter arrays it binds, and that it shapes rows into records
 * identically to the in-memory store. No database is touched.
 *
 * Requirements: 1.1, 3.2, 3.4, 3.5, 3.6, 5.1, 5.3, 5.4, 9.8
 */

import type { PoolClient } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createPostgresPlatformStore } from '../src/lib/platform/postgres-store';
import type { SqlParam } from '../src/lib/db';
import { query, queryOne, withTransaction } from '../src/lib/db';

vi.mock('../src/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  withTransaction: vi.fn(),
}));

/** Typed handles to the mocked db functions. */
const mockQuery = vi.mocked(query);
const mockQueryOne = vi.mocked(queryOne);
const mockWithTransaction = vi.mocked(withTransaction);

/**
 * A minimal mock `PoolClient`: `withTransaction` hands the adapter a client and
 * the adapter drives it with `client.query(text, values)` (as the real
 * `withTransaction` in db.ts does). We record every statement/params pair.
 */
interface TxCall {
  readonly text: string;
  readonly values: readonly unknown[];
}

function makeTxClient(responses: ReadonlyArray<{ rows: unknown[] }>): {
  readonly client: PoolClient;
  readonly calls: TxCall[];
} {
  const calls: TxCall[] = [];
  let index = 0;
  const client = {
    query: vi.fn(async (text: string, values: readonly unknown[] = []) => {
      calls.push({ text, values });
      const response = responses[index] ?? { rows: [] };
      index += 1;
      return response;
    }),
  } as unknown as PoolClient;
  return { client, calls };
}

/** Flatten an SQL string so substring assertions ignore whitespace/newlines. */
const flat = (sql: string): string => sql.replace(/\s+/g, ' ').trim().toLowerCase();

const lastQueryCall = (): { text: string; values: SqlParam[] } => {
  const call = mockQuery.mock.calls.at(-1);
  if (!call) {
    throw new Error('expected query() to have been called');
  }
  return { text: call[0] as string, values: (call[1] ?? []) as SqlParam[] };
};

const lastQueryOneCall = (): { text: string; values: SqlParam[] } => {
  const call = mockQueryOne.mock.calls.at(-1);
  if (!call) {
    throw new Error('expected queryOne() to have been called');
  }
  return { text: call[0] as string, values: (call[1] ?? []) as SqlParam[] };
};

const TENANT_ID = '7e000000-0000-4000-8000-000000000001';
const AGENCY_ID = 'a0000000-0000-4000-8000-000000000001';
const OFFICE_ID = 'o0000000-0000-4000-8000-000000000001';

const agencyRow = {
  id: AGENCY_ID,
  tenantId: TENANT_ID,
  name: 'Bureau of Fire',
  code: 'BFP',
  agencyType: 'FIRE' as const,
  active: true,
};

const expectedAgency = { ...agencyRow };

beforeEach(() => {
  mockQuery.mockReset();
  mockQueryOne.mockReset();
  mockWithTransaction.mockReset();
});

describe('postgres platform store — responder network', () => {
  describe('createAgency', () => {
    it('checks the tenant exists and does NOT insert when absent (tenant_not_found)', async () => {
      const store = createPostgresPlatformStore();
      // tenant-presence check returns no row
      mockQueryOne.mockResolvedValueOnce(null);

      const result = await store.createAgency({
        tenantId: TENANT_ID,
        name: 'Bureau of Fire',
        code: 'BFP',
        agencyType: 'FIRE',
      });

      expect(result).toEqual({ status: 'tenant_not_found' });

      // the presence check ran against public.tenants with the tenant id bound
      const check = mockQueryOne.mock.calls.find((c) =>
        flat(c[0] as string).includes('from public.tenants'),
      );
      expect(check).toBeDefined();
      expect((check?.[1] ?? []) as SqlParam[]).toContain(TENANT_ID);

      // nothing was inserted
      const insertRan = [...mockQueryOne.mock.calls, ...mockQuery.mock.calls].some((c) =>
        flat(c[0] as string).includes('insert into public.agencies'),
      );
      expect(insertRan).toBe(false);
    });

    it('inserts the agency and maps the row when the tenant exists', async () => {
      const store = createPostgresPlatformStore();
      // 1) tenant-presence check -> a row; 2) insert -> the new agency row
      mockQueryOne.mockResolvedValueOnce({ exists: 1 }).mockResolvedValueOnce(agencyRow);

      const result = await store.createAgency({
        tenantId: TENANT_ID,
        name: 'Bureau of Fire',
        code: 'BFP',
        agencyType: 'FIRE',
      });

      expect(result).toEqual({ status: 'ok', agency: expectedAgency });

      const insert = mockQueryOne.mock.calls.find((c) =>
        flat(c[0] as string).includes('insert into public.agencies'),
      );
      expect(insert).toBeDefined();
      const sql = flat(insert?.[0] as string);
      expect(sql).toContain('tenant_id');
      expect(sql).toContain('agency_type');
      expect(sql).toContain('returning');
      const params = (insert?.[1] ?? []) as SqlParam[];
      expect(params).toContain(TENANT_ID);
      expect(params).toContain('Bureau of Fire');
      expect(params).toContain('BFP');
      expect(params).toContain('FIRE');
    });

    it('lets a 23505 unique-violation from the insert bubble up unchanged', async () => {
      const store = createPostgresPlatformStore();
      mockQueryOne
        .mockResolvedValueOnce({ exists: 1 })
        .mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: '23505' }));

      await expect(
        store.createAgency({
          tenantId: TENANT_ID,
          name: 'Bureau of Fire',
          code: 'BFP',
          agencyType: 'FIRE',
        }),
      ).rejects.toMatchObject({ code: '23505' });
    });
  });

  describe('listAgenciesForTenant', () => {
    it('selects the tenant rows and maps them to AgencyRecords', async () => {
      const store = createPostgresPlatformStore();
      mockQuery.mockResolvedValueOnce([agencyRow]);

      const result = await store.listAgenciesForTenant(TENANT_ID);

      expect(result).toEqual([expectedAgency]);
      const { text, values } = lastQueryCall();
      expect(flat(text)).toContain('from public.agencies');
      expect(flat(text)).toContain('where tenant_id');
      expect(values).toContain(TENANT_ID);
    });
  });

  describe('findAgencyById', () => {
    it('returns the mapped record for a present id', async () => {
      const store = createPostgresPlatformStore();
      mockQueryOne.mockResolvedValueOnce(agencyRow);

      const result = await store.findAgencyById(AGENCY_ID);

      expect(result).toEqual(expectedAgency);
      const { text, values } = lastQueryOneCall();
      expect(flat(text)).toContain('from public.agencies');
      expect(flat(text)).toContain('where id');
      expect(values).toContain(AGENCY_ID);
    });

    it('returns null when the agency is absent', async () => {
      const store = createPostgresPlatformStore();
      mockQueryOne.mockResolvedValueOnce(null);

      await expect(store.findAgencyById(AGENCY_ID)).resolves.toBeNull();
    });
  });

  describe('findOfficeTenantId', () => {
    it('returns the tenant id for a present office', async () => {
      const store = createPostgresPlatformStore();
      mockQueryOne.mockResolvedValueOnce({ tenantId: TENANT_ID });

      const result = await store.findOfficeTenantId(OFFICE_ID);

      expect(result).toBe(TENANT_ID);
      const { text, values } = lastQueryOneCall();
      expect(flat(text)).toContain('from public.offices');
      expect(flat(text)).toContain('where id');
      expect(values).toContain(OFFICE_ID);
    });

    it('returns null when the office is absent', async () => {
      const store = createPostgresPlatformStore();
      mockQueryOne.mockResolvedValueOnce(null);

      await expect(store.findOfficeTenantId(OFFICE_ID)).resolves.toBeNull();
    });
  });

  describe('renameAgency', () => {
    it('issues an update ... returning and maps the row', async () => {
      const store = createPostgresPlatformStore();
      const renamed = { ...agencyRow, name: 'New Name', code: 'NEW' };
      mockQueryOne.mockResolvedValueOnce(renamed);

      const result = await store.renameAgency(AGENCY_ID, { name: 'New Name', code: 'NEW' });

      expect(result).toEqual(renamed);
      const { text, values } = lastQueryOneCall();
      expect(flat(text)).toContain('update public.agencies');
      expect(flat(text)).toContain('returning');
      expect(values).toContain(AGENCY_ID);
    });

    it('returns null for a missing id', async () => {
      const store = createPostgresPlatformStore();
      mockQueryOne.mockResolvedValueOnce(null);

      await expect(store.renameAgency(AGENCY_ID, { name: 'Nope' })).resolves.toBeNull();
    });

    it('lets a 23505 collision bubble up unchanged', async () => {
      const store = createPostgresPlatformStore();
      mockQueryOne.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));

      await expect(store.renameAgency(AGENCY_ID, { code: 'BFP' })).rejects.toMatchObject({
        code: '23505',
      });
    });
  });

  describe('setAgencyActive', () => {
    it('updates the active flag and returns the retained row', async () => {
      const store = createPostgresPlatformStore();
      const deactivated = { ...agencyRow, active: false };
      mockQueryOne.mockResolvedValueOnce(deactivated);

      const result = await store.setAgencyActive(AGENCY_ID, false);

      expect(result).toEqual(deactivated);
      const { text, values } = lastQueryOneCall();
      expect(flat(text)).toContain('update public.agencies');
      expect(flat(text)).toContain('active');
      expect(flat(text)).toContain('returning');
      expect(values).toContain(AGENCY_ID);
      expect(values).toContain(false);
    });

    it('returns null for a missing id', async () => {
      const store = createPostgresPlatformStore();
      mockQueryOne.mockResolvedValueOnce(null);

      await expect(store.setAgencyActive(AGENCY_ID, true)).resolves.toBeNull();
    });
  });

  describe('readCapabilityConfig', () => {
    it('folds (category, agency_type) rows into a Record<category, agencyType[]>', async () => {
      const store = createPostgresPlatformStore();
      mockQuery.mockResolvedValueOnce([
        { category: 'SUNOG', agencyType: 'FIRE' },
        { category: 'SUNOG', agencyType: 'DRRM' },
        { category: 'MEDIKAL', agencyType: 'MEDICAL' },
      ]);

      const result = await store.readCapabilityConfig(TENANT_ID);

      expect(result).not.toBeNull();
      expect(result?.SUNOG).toEqual(['FIRE', 'DRRM']);
      expect(result?.MEDIKAL).toEqual(['MEDICAL']);

      const { text, values } = lastQueryCall();
      expect(flat(text)).toContain('from public.tenant_capability_config');
      expect(flat(text)).toContain('where tenant_id');
      expect(values).toContain(TENANT_ID);
    });

    it('returns null when the tenant has zero capability rows', async () => {
      const store = createPostgresPlatformStore();
      mockQuery.mockResolvedValueOnce([]);

      await expect(store.readCapabilityConfig(TENANT_ID)).resolves.toBeNull();
    });
  });

  describe('setCapabilityForCategory', () => {
    it('replaces a single category inside a transaction then re-reads the full config', async () => {
      const store = createPostgresPlatformStore();

      // delete-one-category, insert FIRE, insert DRRM, then re-read the config
      const { client, calls } = makeTxClient([
        { rows: [] }, // delete
        { rows: [] }, // insert FIRE
        { rows: [] }, // insert DRRM
        {
          rows: [
            { category: 'SUNOG', agencyType: 'FIRE' },
            { category: 'SUNOG', agencyType: 'DRRM' },
          ],
        }, // re-read
      ]);

      mockWithTransaction.mockImplementationOnce(async (work) => work(client) as Promise<unknown>);

      const result = await store.setCapabilityForCategory(TENANT_ID, 'SUNOG', ['FIRE', 'DRRM']);

      // ran through the transaction seam
      expect(mockWithTransaction).toHaveBeenCalledTimes(1);

      const texts = calls.map((c) => flat(c.text));
      const deleteStmt = texts.find((t) =>
        t.includes('delete from public.tenant_capability_config'),
      );
      expect(deleteStmt).toBeDefined();
      const inserts = texts.filter((t) =>
        t.includes('insert into public.tenant_capability_config'),
      );
      expect(inserts.length).toBeGreaterThanOrEqual(1);

      // delete is bound to the tenant + category
      const deleteCall = calls.find((c) =>
        flat(c.text).includes('delete from public.tenant_capability_config'),
      );
      expect(deleteCall?.values).toContain(TENANT_ID);
      expect(deleteCall?.values).toContain('SUNOG');

      // the full config is returned (the SUNOG set we just wrote)
      expect(result.SUNOG).toEqual(['FIRE', 'DRRM']);
    });
  });
});
