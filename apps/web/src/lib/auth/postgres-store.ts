/**
 * The only SQL-aware module in the auth layer.
 *
 * Plain `pg` against `DATABASE_URL`; no Supabase client, no Data API, no keys
 * (SECURITY.md §4/§5.7). Every statement is parameterised.
 */

import { query, queryOne } from '../db';
import { isRole } from './rbac';
import type {
  AdminResponderRow,
  AgencySummary,
  AuthEventInput,
  AuthEventRecord,
  AuthEventType,
  AuthStore,
  CreateResponderInput,
  LoginFailureResult,
  OfficeSummary,
  ResponderRecord,
  ResponderSessionRecord,
  UpdateResponderPatch,
} from './types';

interface ResponderRow {
  id: string;
  email: string;
  callsign: string | null;
  role: string;
  passwordHash: string;
  active: boolean;
  tenantId: string;
  officeId: string;
  officeName: string;
  agencyId: string | null;
  agencyName: string | null;
  mustChangePassword: boolean;
  failedAttempts: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
}

interface SessionRow {
  id: string;
  responderId: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
}

interface AuthEventRow {
  id: string;
  responderId: string | null;
  sessionId: string | null;
  event: string;
  callsign: string | null;
  detail: string | null;
  createdAt: Date;
}

interface AdminResponderSqlRow extends ResponderRow {
  sessionCount: string | number;
}

function toMs(value: Date | null): number | null {
  return value ? value.getTime() : null;
}

function mapResponder(row: ResponderRow): ResponderRecord {
  if (!isRole(row.role)) {
    // A role outside the closed enum means the schema and the app disagree; fail closed.
    throw new Error('unknown_responder_role');
  }

  return {
    id: row.id,
    email: row.email,
    callsign: row.callsign,
    role: row.role,
    passwordHash: row.passwordHash,
    active: row.active,
    tenantId: row.tenantId,
    officeId: row.officeId,
    officeName: row.officeName,
    agencyId: row.agencyId,
    agencyName: row.agencyName,
    mustChangePassword: row.mustChangePassword,
    failedAttempts: row.failedAttempts,
    lockedUntil: toMs(row.lockedUntil),
    lastLoginAt: toMs(row.lastLoginAt),
  };
}

function mapSession(row: SessionRow): ResponderSessionRecord {
  return {
    id: row.id,
    responderId: row.responderId,
    tokenHash: row.tokenHash,
    createdAt: row.createdAt.getTime(),
    expiresAt: row.expiresAt.getTime(),
    absoluteExpiresAt: row.absoluteExpiresAt.getTime(),
    lastSeenAt: row.lastSeenAt.getTime(),
    revokedAt: toMs(row.revokedAt),
  };
}

const RESPONDER_COLUMNS = `
  r.id,
  r.email,
  r.callsign,
  r.role,
  r.password_hash as "passwordHash",
  r.active,
  o.tenant_id as "tenantId",
  r.office_id as "officeId",
  o.name as "officeName",
  r.agency_id as "agencyId",
  a.name as "agencyName",
  r.must_change_password as "mustChangePassword",
  r.failed_attempts as "failedAttempts",
  r.locked_until as "lockedUntil",
  r.last_login_at as "lastLoginAt"
`;

export function createPostgresAuthStore(): AuthStore {
  async function findResponderById(id: string): Promise<ResponderRecord | null> {
    const row = await queryOne<ResponderRow>(
      `select ${RESPONDER_COLUMNS}
         from public.responders r
         join public.offices o on o.id = r.office_id
         left join public.agencies a on a.id = r.agency_id
        where r.id = $1
        limit 1`,
      [id],
    );
    return row ? mapResponder(row) : null;
  }

  return {
    async findResponderByEmail(email) {
      const row = await queryOne<ResponderRow>(
        `select ${RESPONDER_COLUMNS}
           from public.responders r
           join public.offices o on o.id = r.office_id
           left join public.agencies a on a.id = r.agency_id
          where lower(r.email) = lower($1)
          limit 1`,
        [email],
      );
      return row ? mapResponder(row) : null;
    },

    findResponderById,

    async markLoginFailure(responderId, options): Promise<LoginFailureResult> {
      const row = await queryOne<{ failedAttempts: number; lockedUntil: Date | null }>(
        `update public.responders
            set failed_attempts = failed_attempts + 1,
                locked_until = case
                  when failed_attempts + 1 >= $2 then $3::timestamptz
                  else locked_until
                end
          where id = $1
        returning failed_attempts as "failedAttempts", locked_until as "lockedUntil"`,
        [responderId, options.threshold, new Date(options.now + options.lockMs)],
      );

      return {
        failedAttempts: row?.failedAttempts ?? 0,
        lockedUntil: toMs(row?.lockedUntil ?? null),
      };
    },

    async markLoginSuccess(responderId, now) {
      await query(
        `update public.responders
            set failed_attempts = 0, locked_until = null, last_login_at = $2
          where id = $1`,
        [responderId, new Date(now)],
      );
    },

    async createSession(input) {
      const row = await queryOne<{ id: string }>(
        `insert into public.responder_sessions
           (responder_id, token_hash, created_at, expires_at, last_seen_at, absolute_expires_at)
         values ($1, $2, $3, $4, $3, $5)
         returning id`,
        [
          input.responderId,
          input.tokenHash,
          new Date(input.createdAt),
          new Date(input.expiresAt),
          new Date(input.absoluteExpiresAt),
        ],
      );

      if (!row) {
        throw new Error('session_insert_failed');
      }
      return { id: row.id };
    },

    async findSessionByTokenHash(tokenHash) {
      const row = await queryOne<SessionRow>(
        `select id,
                responder_id as "responderId",
                token_hash as "tokenHash",
                created_at as "createdAt",
                expires_at as "expiresAt",
                absolute_expires_at as "absoluteExpiresAt",
                last_seen_at as "lastSeenAt",
                revoked_at as "revokedAt"
           from public.responder_sessions
          where token_hash = $1
          limit 1`,
        [tokenHash],
      );
      return row ? mapSession(row) : null;
    },

    async touchSession(id, input) {
      await query(
        `update public.responder_sessions
            set last_seen_at = $2, expires_at = $3
          where id = $1 and revoked_at is null`,
        [id, new Date(input.lastSeenAt), new Date(input.expiresAt)],
      );
    },

    async revokeSession(id, input) {
      await query(
        `update public.responder_sessions
            set revoked_at = $2, revoked_reason = $3
          where id = $1 and revoked_at is null`,
        [id, new Date(input.at), input.reason.slice(0, 64)],
      );
    },

    async revokeResponderSessions(responderId, input) {
      const rows = await query<{ id: string }>(
        `update public.responder_sessions
            set revoked_at = $2, revoked_reason = $3
          where responder_id = $1
            and revoked_at is null
            and ($4::uuid is null or id <> $4::uuid)
        returning id`,
        [responderId, new Date(input.at), input.reason.slice(0, 64), input.exceptSessionId ?? null],
      );
      return rows.length;
    },

    async updatePassword(responderId, input) {
      await query(
        `update public.responders
            set password_hash = $2, must_change_password = $3
          where id = $1`,
        [responderId, input.passwordHash, input.mustChangePassword],
      );
    },

    async createResponder(input: CreateResponderInput) {
      const row = await queryOne<{ id: string }>(
        `insert into public.responders
           (email, callsign, role, password_hash, office_id, agency_id, must_change_password)
         values ($1, $2, $3::responder_role, $4, $5, $6, $7)
         returning id`,
        [
          input.email,
          input.callsign,
          input.role,
          input.passwordHash,
          input.officeId,
          input.agencyId,
          input.mustChangePassword,
        ],
      );

      if (!row) {
        throw new Error('responder_insert_failed');
      }

      const created = await findResponderById(row.id);
      if (!created) {
        throw new Error('responder_read_after_insert_failed');
      }
      return created;
    },

    async updateResponder(id: string, patch: UpdateResponderPatch) {
      const row = await queryOne<{ id: string }>(
        `update public.responders
            set role = coalesce($2::responder_role, role),
                active = coalesce($3::boolean, active),
                must_change_password = coalesce($4::boolean, must_change_password),
                locked_until = case when $5::boolean then null else locked_until end,
                failed_attempts = case when $5::boolean then 0 else failed_attempts end
          where id = $1
        returning id`,
        [
          id,
          patch.role ?? null,
          patch.active ?? null,
          patch.mustChangePassword ?? null,
          patch.unlock === true,
        ],
      );

      return row ? findResponderById(row.id) : null;
    },

    async updateOwnProfile(id: string, patch: { readonly callsign: string | null }) {
      const row = await queryOne<{ id: string }>(
        `update public.responders
            set callsign = $2
          where id = $1
        returning id`,
        [id, patch.callsign],
      );

      return row ? findResponderById(row.id) : null;
    },

    async listResponders(tenantId: string): Promise<readonly AdminResponderRow[]> {
      const rows = await query<AdminResponderSqlRow>(
        `select ${RESPONDER_COLUMNS},
                (select count(*)
                   from public.responder_sessions s
                  where s.responder_id = r.id
                    and s.revoked_at is null
                    and s.expires_at > now()) as "sessionCount"
           from public.responders r
           join public.offices o on o.id = r.office_id
           left join public.agencies a on a.id = r.agency_id
          where o.tenant_id = $1
          order by r.active desc, r.email asc`,
        [tenantId],
      );

      return rows.map((row) => ({
        ...mapResponder(row),
        sessionCount: Number(row.sessionCount),
      }));
    },

    async listAssignableResponders(officeId) {
      const rows = await query<{
        id: string;
        email: string;
        callsign: string | null;
        role: string;
        officeName: string;
        agencyName: string | null;
      }>(
        `with recursive scope as (
           select id from public.offices where id = $1
           union all
           select o.id from public.offices o join scope s on o.parent_id = s.id
         )
         select r.id,
                r.email,
                r.callsign,
                r.role,
                o.name as "officeName",
                a.name as "agencyName"
           from public.responders r
           join public.offices o on o.id = r.office_id
           left join public.agencies a on a.id = r.agency_id
          where r.active
            and r.office_id in (select id from scope)
          order by r.email asc`,
        [officeId],
      );
      return rows.map((row) => ({
        id: row.id,
        email: row.email,
        callsign: row.callsign,
        displayName:
          row.callsign && row.callsign.trim().length > 0
            ? row.callsign
            : (row.email.split('@')[0] ?? row.email),
        role: isRole(row.role) ? row.role : 'RESPONDER',
        officeName: row.officeName,
        agencyName: row.agencyName,
      }));
    },

    async listOffices(tenantId: string): Promise<readonly OfficeSummary[]> {
      const rows = await query<{ id: string; name: string; kind: string }>(
        `select id, name, kind
           from public.offices
          where active and tenant_id = $1
          order by case when kind = 'LGU' then 0 else 1 end, name asc`,
        [tenantId],
      );

      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        kind: row.kind === 'LGU' ? 'LGU' : 'BARANGAY',
      }));
    },

    async listAgencies(): Promise<readonly AgencySummary[]> {
      return query<AgencySummary>(
        `select id, name, code from public.agencies where active order by name asc`,
      );
    },

    async appendAuthEvent(input: AuthEventInput) {
      await query(
        `insert into public.auth_events (responder_id, session_id, event, callsign, detail, created_at)
         values ($1, $2, $3, $4, $5, coalesce($6, now()))`,
        [
          input.responderId ?? null,
          input.sessionId ?? null,
          input.event,
          input.callsign ?? null,
          input.detail ? input.detail.slice(0, 200) : null,
          input.at ? new Date(input.at) : null,
        ],
      );
    },

    async listAuthEvents(input): Promise<readonly AuthEventRecord[]> {
      const rows = await query<AuthEventRow>(
        `select id,
                responder_id as "responderId",
                session_id as "sessionId",
                event,
                callsign,
                detail,
                created_at as "createdAt"
           from public.auth_events
          where ($1::timestamptz is null or created_at < $1::timestamptz)
          order by created_at desc
          limit $2`,
        [input.before ? new Date(input.before) : null, input.limit],
      );

      return rows.map((row) => ({
        id: row.id,
        responderId: row.responderId,
        sessionId: row.sessionId,
        event: row.event as AuthEventType,
        callsign: row.callsign,
        detail: row.detail,
        createdAt: row.createdAt.getTime(),
      }));
    },
  };
}
