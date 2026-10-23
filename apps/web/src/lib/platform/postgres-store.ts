/**
 * SQL adapter for the platform tier: its own identity/sessions + tenant/office
 * management. Plain `pg`, parameterised. Separate from responder/citizen stores.
 */

import { query, queryOne, withTransaction } from '../db';
import type {
  CreateTenantInput,
  OfficePin,
  PlatformAdminRecord,
  PlatformSessionRecord,
  PlatformStore,
  TenantRecord,
  TenantStatus,
} from './types';

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
  };
}
