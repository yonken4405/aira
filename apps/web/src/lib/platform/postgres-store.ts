/**
 * SQL adapter for the platform tier: its own identity/sessions + tenant/office
 * management. Plain `pg`, parameterised. Separate from responder/citizen stores.
 */

import { query, queryOne, withTransaction } from '../db';
import type {
  AgencyRecord,
  CreateAgencyStoreInput,
  CreateTenantInput,
  OfficePin,
  PlatformAdminRecord,
  PlatformSessionRecord,
  PlatformStore,
  TenantRecord,
  TenantStatus,
} from './types';
import type { AgencyType } from '@aira/ui';

interface AdminRow {
  id: string;
  email: string;
  passwordHash: string;
  active: boolean;
  failedAttempts: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
}

interface SessionRow {
  id: string;
  adminId: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
}

interface TenantRow {
  id: string;
  name: string;
  region: string;
  province: string;
  status: string;
  createdAt: Date;
}

interface AgencyRow {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  agencyType: string;
  active: boolean;
}

const toMs = (value: Date | null): number | null => (value ? value.getTime() : null);

const mapAdmin = (row: AdminRow): PlatformAdminRecord => ({
  id: row.id,
  email: row.email,
  passwordHash: row.passwordHash,
  active: row.active,
  failedAttempts: row.failedAttempts,
  lockedUntil: toMs(row.lockedUntil),
  lastLoginAt: toMs(row.lastLoginAt),
});

const mapSession = (row: SessionRow): PlatformSessionRecord => ({
  id: row.id,
  adminId: row.adminId,
  tokenHash: row.tokenHash,
  createdAt: row.createdAt.getTime(),
  expiresAt: row.expiresAt.getTime(),
  absoluteExpiresAt: row.absoluteExpiresAt.getTime(),
  lastSeenAt: row.lastSeenAt.getTime(),
  revokedAt: toMs(row.revokedAt),
});

const mapTenant = (row: TenantRow): TenantRecord => ({
  id: row.id,
  name: row.name,
  region: row.region,
  province: row.province,
  status: row.status === 'suspended' ? 'suspended' : 'active',
  createdAt: row.createdAt.getTime(),
});

const ADMIN_COLUMNS = `
  id, email, password_hash as "passwordHash", active,
  failed_attempts as "failedAttempts", locked_until as "lockedUntil", last_login_at as "lastLoginAt"
`;
const TENANT_COLUMNS = `id, name, region, province, status, created_at as "createdAt"`;
const AGENCY_COLUMNS = `id, tenant_id as "tenantId", name, code, agency_type as "agencyType", active`;

const mapAgency = (row: AgencyRow): AgencyRecord => ({
  id: row.id,
  tenantId: row.tenantId,
  name: row.name,
  code: row.code,
  agencyType: row.agencyType as AgencyType,
  active: row.active,
});

export function createPostgresPlatformStore(): PlatformStore {
  return {
    async findAdminByEmail(email) {
      const row = await queryOne<AdminRow>(
        `select ${ADMIN_COLUMNS} from public.platform_admins where lower(email) = lower($1) limit 1`,
        [email],
      );
      return row ? mapAdmin(row) : null;
    },

    async findAdminById(id) {
      const row = await queryOne<AdminRow>(
        `select ${ADMIN_COLUMNS} from public.platform_admins where id = $1 limit 1`,
        [id],
      );
      return row ? mapAdmin(row) : null;
    },

    async markLoginFailure(adminId, options) {
      const row = await queryOne<{ failedAttempts: number; lockedUntil: Date | null }>(
        `update public.platform_admins
            set failed_attempts = failed_attempts + 1,
                locked_until = case when failed_attempts + 1 >= $2 then $3::timestamptz else locked_until end
          where id = $1
        returning failed_attempts as "failedAttempts", locked_until as "lockedUntil"`,
        [adminId, options.threshold, new Date(options.now + options.lockMs)],
      );
      return {
        failedAttempts: row?.failedAttempts ?? 0,
        lockedUntil: toMs(row?.lockedUntil ?? null),
      };
    },

    async markLoginSuccess(adminId, now) {
      await query(
        `update public.platform_admins set failed_attempts = 0, locked_until = null, last_login_at = $2 where id = $1`,
        [adminId, new Date(now)],
      );
    },

    async createSession(input) {
      const row = await queryOne<{ id: string }>(
        `insert into public.platform_sessions
           (admin_id, token_hash, created_at, expires_at, last_seen_at, absolute_expires_at)
         values ($1, $2, $3, $4, $3, $5)
         returning id`,
        [
          input.adminId,
          input.tokenHash,
          new Date(input.createdAt),
          new Date(input.expiresAt),
          new Date(input.absoluteExpiresAt),
        ],
      );
      if (!row) {
        throw new Error('platform_session_insert_failed');
      }
      return { id: row.id };
    },

    async findSessionByTokenHash(tokenHash) {
      const row = await queryOne<SessionRow>(
        `select id, admin_id as "adminId", token_hash as "tokenHash",
                created_at as "createdAt", expires_at as "expiresAt",
                absolute_expires_at as "absoluteExpiresAt", last_seen_at as "lastSeenAt",
                revoked_at as "revokedAt"
           from public.platform_sessions where token_hash = $1 limit 1`,
        [tokenHash],
      );
      return row ? mapSession(row) : null;
    },

    async touchSession(id, input) {
      await query(
        `update public.platform_sessions set last_seen_at = $2, expires_at = $3 where id = $1 and revoked_at is null`,
        [id, new Date(input.lastSeenAt), new Date(input.expiresAt)],
      );
    },

    async revokeSession(id, input) {
      await query(
        `update public.platform_sessions set revoked_at = $2, revoked_reason = $3 where id = $1 and revoked_at is null`,
        [id, new Date(input.at), input.reason.slice(0, 64)],
      );
    },

    async listTenants() {
      const rows = await query<TenantRow>(
        `select ${TENANT_COLUMNS} from public.tenants order by name asc`,
      );
      return rows.map(mapTenant);
    },

    async createTenantWithLgu(input: CreateTenantInput & { readonly now: number }) {
      return withTransaction(async (client) => {
        const tenant = await client.query(
          `insert into public.tenants (name, region, province) values ($1, $2, $3) returning ${TENANT_COLUMNS}`,
          [input.name, input.region, input.province],
        );
        const tenantRow = tenant.rows[0] as TenantRow | undefined;
        if (!tenantRow) {
          throw new Error('tenant_insert_failed');
        }

        await client.query(
          `insert into public.offices (tenant_id, name, kind, parent_id, lat, lon, region, province)
           values ($1, $2, 'LGU', null, $3, $4, $5, $6)`,
          [tenantRow.id, input.lguName, input.lat, input.lon, input.region, input.province],
        );

        return mapTenant(tenantRow);
      });
    },

    async setTenantStatus(tenantId, status: TenantStatus) {
      const row = await queryOne<TenantRow>(
        `update public.tenants set status = $2 where id = $1 returning ${TENANT_COLUMNS}`,
        [tenantId, status],
      );
      return row ? mapTenant(row) : null;
    },

    async listOfficePins(): Promise<readonly OfficePin[]> {
      return query<OfficePin>(
        `select o.id,
                o.tenant_id as "tenantId",
                t.name as "tenantName",
                o.name,
                o.kind,
                o.region,
                o.province,
                o.lat,
                o.lon,
                t.status
           from public.offices o
           join public.tenants t on t.id = o.tenant_id
          where o.active
          order by t.name asc, case when o.kind = 'LGU' then 0 else 1 end, o.name asc`,
      );
    },

    async lguOfficeIdForTenant(tenantId) {
      const row = await queryOne<{ id: string }>(
        `select id from public.offices where tenant_id = $1 and kind = 'LGU' and active limit 1`,
        [tenantId],
      );
      return row?.id ?? null;
    },

    async createAgency(input: CreateAgencyStoreInput) {
      const tenantExists = await queryOne<{ exists: number }>(
        `select 1 as exists from public.tenants where id = $1`,
        [input.tenantId],
      );
      if (!tenantExists) {
        return { status: 'tenant_not_found' as const };
      }
      const row = await queryOne<AgencyRow>(
        `insert into public.agencies (tenant_id, name, code, agency_type, active)
         values ($1, $2, $3, $4, true)
         returning ${AGENCY_COLUMNS}`,
        [input.tenantId, input.name, input.code, input.agencyType],
      );
      if (!row) {
        throw new Error('agency_insert_failed');
      }
      return { status: 'ok' as const, agency: mapAgency(row) };
    },

    async listAgenciesForTenant(tenantId: string) {
      const rows = await query<AgencyRow>(
        `select ${AGENCY_COLUMNS} from public.agencies where tenant_id = $1 order by name asc`,
        [tenantId],
      );
      return rows.map(mapAgency);
    },

    async findAgencyById(agencyId: string) {
      const row = await queryOne<AgencyRow>(
        `select ${AGENCY_COLUMNS} from public.agencies where id = $1`,
        [agencyId],
      );
      return row ? mapAgency(row) : null;
    },

    async findOfficeTenantId(officeId: string) {
      const row = await queryOne<{ tenantId: string }>(
        `select tenant_id as "tenantId" from public.offices where id = $1`,
        [officeId],
      );
      return row?.tenantId ?? null;
    },

    async renameAgency(
      agencyId: string,
      patch: { readonly name?: string; readonly code?: string },
    ) {
      const setParts: string[] = [];
      const values: unknown[] = [];
      let paramIndex = 1;

      if (patch.name !== undefined) {
        setParts.push(`name = $${paramIndex}`);
        values.push(patch.name);
        paramIndex += 1;
      }
      if (patch.code !== undefined) {
        setParts.push(`code = $${paramIndex}`);
        values.push(patch.code);
        paramIndex += 1;
      }
      if (setParts.length === 0) {
        return null;
      }

      values.push(agencyId);
      const row = await queryOne<AgencyRow>(
        `update public.agencies set ${setParts.join(', ')}, updated_at = now() where id = $${paramIndex} returning ${AGENCY_COLUMNS}`,
        values as import('../db').SqlParam[],
      );
      return row ? mapAgency(row) : null;
    },

    async setAgencyActive(agencyId: string, active: boolean) {
      const row = await queryOne<AgencyRow>(
        `update public.agencies set active = $1, updated_at = now() where id = $2 returning ${AGENCY_COLUMNS}`,
        [active, agencyId],
      );
      return row ? mapAgency(row) : null;
    },

    // ── Agency coverage (single-lgu-agency-network R5) ───────────────────────

    async listCoverage(agencyId: string) {
      const rows = await query<{ officeId: string }>(
        `select office_id as "officeId" from public.agency_coverage where agency_id = $1 order by office_id asc`,
        [agencyId],
      );
      return rows.map((row) => row.officeId);
    },

    async setCoverage(agencyId: string, officeIds: readonly string[]) {
      // Full-replace within a transaction: delete the agency's links, then insert the
      // de-duplicated set. Coverage is prioritisation only (never an access control).
      const deduped = [...new Set(officeIds)];
      await withTransaction(async (client) => {
        await client.query(`delete from public.agency_coverage where agency_id = $1`, [agencyId]);
        for (const officeId of deduped) {
          await client.query(
            `insert into public.agency_coverage (agency_id, office_id) values ($1, $2)
             on conflict (agency_id, office_id) do nothing`,
            [agencyId, officeId],
          );
        }
      });
    },

    async coversOffice(agencyId: string, officeId: string) {
      const row = await queryOne<{ one: number }>(
        `select 1 as one from public.agency_coverage where agency_id = $1 and office_id = $2 limit 1`,
        [agencyId, officeId],
      );
      return row !== null;
    },
  };
}
