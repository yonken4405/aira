/**
 * Retention job (SECURITY.md §1.4/§5.4).
 *
 * Deletes resolved incidents past the retention window (coordinates must not live
 * forever) and prunes revoked/expired sessions. Both functions are security-definer
 * and take an interval, so the app role needs no DELETE on incident history.
 *
 * Usage:
 *   pnpm --filter @aira/db db:prune                  # 90 days incidents / 7 days sessions
 *   pnpm --filter @aira/db db:prune -- 30 days 3 days
 *
 * Run it from cron/systemd on the host that owns the database. It is intentionally a
 * shell job and not request-path logic.
 */

import { Client } from 'pg';

const LOCAL_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const connectionString = process.env.DATABASE_URL ?? LOCAL_URL;

const incidentRetain = process.argv[2] ?? '90 days';
const sessionRetain = process.argv[3] ?? '7 days';

const client = new Client({ connectionString, application_name: 'aira-prune' });

try {
  await client.connect();

  const incidents = await client.query(
    'select public.prune_resolved_incidents($1::interval) as removed',
    [incidentRetain],
  );
  const sessions = await client.query(
    'select public.prune_auth_sessions($1::interval) as removed',
    [sessionRetain],
  );

  console.log(
    `Pruned ${incidents.rows[0]?.removed ?? 0} resolved incident(s) older than ${incidentRetain}.`,
  );
  console.log(`Pruned ${sessions.rows[0]?.removed ?? 0} session(s) older than ${sessionRetain}.`);
} finally {
  await client.end();
}
