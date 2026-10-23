/**
 * SQL-aware adapter for citizen accounts (SECURITY.md §7).
 *
 * Plain `pg` against `DATABASE_URL`; no Supabase client, no keys. Every statement is
 * parameterised. Separate from the responder store on purpose.
 */

import { query, queryOne } from '../db';
import type {
  CitizenLoginFailureResult,
  CitizenRecord,
  CitizenSessionRecord,
  CitizenStore,
  CreateCitizenInput,
} from './types';

interface CitizenRow {
  id: string;
  email: string | null;
  deviceKeyHash: string | null;
  passwordHash: string | null;
  emailVerified: boolean;
  active: boolean;
  failedAttempts: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
}

interface SessionRow {
  id: string;
  citizenId: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
}

const toMs = (value: Date | null): number | null => (value ? value.getTime() : null);

function mapCitizen(row: CitizenRow): CitizenRecord {
  return {
    id: row.id,
    email: row.email,
    deviceKeyHash: row.deviceKeyHash,
    passwordHash: row.passwordHash,
    emailVerified: row.emailVerified,
    active: row.active,
    failedAttempts: row.failedAttempts,
    lockedUntil: toMs(row.lockedUntil),
    lastLoginAt: toMs(row.lastLoginAt),
  };
}

function mapSession(row: SessionRow): CitizenSessionRecord {
  return {
    id: row.id,
    citizenId: row.citizenId,
    tokenHash: row.tokenHash,
    createdAt: row.createdAt.getTime(),
    expiresAt: row.expiresAt.getTime(),
    absoluteExpiresAt: row.absoluteExpiresAt.getTime(),
    lastSeenAt: row.lastSeenAt.getTime(),
    revokedAt: toMs(row.revokedAt),
  };
}

const CITIZEN_COLUMNS = `
  id,
  email,
  device_key_hash as "deviceKeyHash",
  password_hash as "passwordHash",
  email_verified as "emailVerified",
  active,
  failed_attempts as "failedAttempts",
  locked_until as "lockedUntil",
  last_login_at as "lastLoginAt"
`;

export function createPostgresCitizenStore(): CitizenStore {
  return {
    async findByEmail(email) {
      const row = await queryOne<CitizenRow>(
        `select ${CITIZEN_COLUMNS} from public.citizens where lower(email) = lower($1) limit 1`,
        [email],
      );
      return row ? mapCitizen(row) : null;
    },

    async findByDeviceKeyHash(deviceKeyHash) {
      const row = await queryOne<CitizenRow>(
        `select ${CITIZEN_COLUMNS} from public.citizens where device_key_hash = $1 limit 1`,
        [deviceKeyHash],
      );
      return row ? mapCitizen(row) : null;
    },

    async findById(id) {
      const row = await queryOne<CitizenRow>(
        `select ${CITIZEN_COLUMNS} from public.citizens where id = $1 limit 1`,
        [id],
      );
      return row ? mapCitizen(row) : null;
    },

    async create(input: CreateCitizenInput) {
      const row = await queryOne<CitizenRow>(
        `insert into public.citizens (email, device_key_hash, password_hash, email_verified)
         values ($1, $2, $3, $4)
         returning ${CITIZEN_COLUMNS}`,
        [input.email, input.deviceKeyHash, input.passwordHash, input.emailVerified],
      );
      if (!row) {
        throw new Error('citizen_insert_failed');
      }
      return mapCitizen(row);
    },

    async deleteCitizen(id) {
      await query(`delete from public.citizens where id = $1`, [id]);
    },

    async markLoginFailure(citizenId, options): Promise<CitizenLoginFailureResult> {
      const row = await queryOne<{ failedAttempts: number; lockedUntil: Date | null }>(
        `update public.citizens
            set failed_attempts = failed_attempts + 1,
                locked_until = case
                  when failed_attempts + 1 >= $2 then $3::timestamptz
                  else locked_until
                end
          where id = $1
        returning failed_attempts as "failedAttempts", locked_until as "lockedUntil"`,
        [citizenId, options.threshold, new Date(options.now + options.lockMs)],
      );
      return {
        failedAttempts: row?.failedAttempts ?? 0,
        lockedUntil: toMs(row?.lockedUntil ?? null),
      };
    },

    async markLoginSuccess(citizenId, now) {
      await query(
        `update public.citizens
            set failed_attempts = 0, locked_until = null, last_login_at = $2
          where id = $1`,
        [citizenId, new Date(now)],
      );
    },

    async createSession(input) {
      const row = await queryOne<{ id: string }>(
        `insert into public.citizen_sessions
           (citizen_id, token_hash, created_at, expires_at, last_seen_at, absolute_expires_at)
         values ($1, $2, $3, $4, $3, $5)
         returning id`,
        [
          input.citizenId,
          input.tokenHash,
          new Date(input.createdAt),
          new Date(input.expiresAt),
          new Date(input.absoluteExpiresAt),
        ],
      );
      if (!row) {
        throw new Error('citizen_session_insert_failed');
      }
      return { id: row.id };
    },

    async findSessionByTokenHash(tokenHash) {
      const row = await queryOne<SessionRow>(
        `select id,
                citizen_id as "citizenId",
                token_hash as "tokenHash",
                created_at as "createdAt",
                expires_at as "expiresAt",
                absolute_expires_at as "absoluteExpiresAt",
                last_seen_at as "lastSeenAt",
                revoked_at as "revokedAt"
           from public.citizen_sessions
          where token_hash = $1
          limit 1`,
        [tokenHash],
      );
      return row ? mapSession(row) : null;
    },

    async touchSession(id, input) {
      await query(
        `update public.citizen_sessions
            set last_seen_at = $2, expires_at = $3
          where id = $1 and revoked_at is null`,
        [id, new Date(input.lastSeenAt), new Date(input.expiresAt)],
      );
    },

    async revokeSession(id, input) {
      await query(
        `update public.citizen_sessions
            set revoked_at = $2, revoked_reason = $3
          where id = $1 and revoked_at is null`,
        [id, new Date(input.at), input.reason.slice(0, 64)],
      );
    },
  };
}
