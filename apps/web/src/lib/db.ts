/**
 * Postgres access for the responder console.
 *
 * Supabase is a Postgres provider only (SECURITY.md §4): this module speaks plain
 * `pg` to `DATABASE_URL`, so the application moves to any Postgres host unchanged.
 *
 * Server-only. Never import this from a client component, and never log the
 * connection string (SECURITY.md §6.4).
 */

import { Pool, type PoolClient } from 'pg';

export type SqlParam = string | number | boolean | Date | null;

let pool: Pool | null = null;

/** True when a database is configured; routes answer 503 instead of throwing. */
export function isDatabaseConfigured(): boolean {
  return typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.length > 0;
}

function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('database_not_configured');
  }

  if (!pool) {
    pool = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      application_name: 'aira-web',
    });
  }

  return pool;
}

/** Runs a parameterised query. Values are always bound, never interpolated. */
export async function query<T>(text: string, values: SqlParam[] = []): Promise<T[]> {
  const result = await getPool().query(text, values);
  return result.rows as T[];
}

/** Single-row variant; returns null instead of an empty array. */
export async function queryOne<T>(text: string, values: SqlParam[] = []): Promise<T | null> {
  const rows = await query<T>(text, values);
  return rows[0] ?? null;
}

/** Runs `work` inside a transaction, rolling back on any thrown error. */
export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();

  try {
    await client.query('begin');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      // The connection is already unusable; the original error is the useful one.
    }
    throw error;
  } finally {
    client.release();
  }
}
