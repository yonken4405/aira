/**
 * DEV-ONLY account seeding. Provisions a known set of accounts for local development so
 * you can sign in immediately after `db:reset`:
 *
 *   - 1 platform operator (superadmin)        -> /platform
 *   - 1 DRRM admin, 1 dispatcher, 1 responder -> /admin and /console
 *
 * Passwords are hashed with argon2id here (never stored in SQL/source). The dev password
 * is printed once below. REFUSES to run against a non-local database unless
 * --force is passed, so it can never seed weak known credentials into production.
 *
 * Usage:
 *   pnpm --filter @aira/web seed:accounts
 *   pnpm --filter @aira/web seed:accounts -- --password 'my dev password here'
 */

import { argv, env, exit } from 'node:process';

import { Algorithm, hash } from '@node-rs/argon2';
import { Client } from 'pg';

const LOCAL_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const DEFAULT_PASSWORD = 'password123';
const DEFAULT_TENANT_ID = '7e000000-0000-4000-8000-000000000001';
// Dev seed passwords are intentionally weak + shared for convenience. This is only safe
// because the script refuses to run against a non-local database (see the guard below).
const MIN_PASSWORD_LENGTH = 6;

const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

function parseArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (!token.startsWith('--')) continue;
    const [key, inline] = token.slice(2).split('=');
    if (!key) continue;
    if (inline !== undefined) {
      parsed[key] = inline;
    } else if (args[i + 1] && !args[i + 1].startsWith('--')) {
      parsed[key] = args[i + 1];
      i += 1;
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}

function fail(message) {
  console.error(`\n${message}\n`);
  exit(1);
}

const args = parseArgs(argv.slice(2));
const connectionString = env.DATABASE_URL ?? LOCAL_URL;
const isLocal = /@(127\.0\.0\.1|localhost)[:/]/.test(connectionString);
if (!isLocal && args.force !== true) {
  fail('Refusing to seed dev accounts against a non-local database. Pass --force to override.');
}

const password = typeof args.password === 'string' ? args.password : DEFAULT_PASSWORD;
if (password.length < MIN_PASSWORD_LENGTH) {
  fail(`The dev password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
}
const tenantId = typeof args.tenant === 'string' ? args.tenant : DEFAULT_TENANT_ID;

const client = new Client({ connectionString, application_name: 'aira-seed-accounts' });

try {
  await client.connect();

  const passwordHash = await hash(password, ARGON2_OPTIONS);

  // The tenant's LGU office anchors the DRRM accounts.
  const office = (
    await client.query(
      `select id from public.offices where tenant_id = $1 and kind = 'LGU' limit 1`,
      [tenantId],
    )
  ).rows[0];
  if (!office) {
    fail(
      `No LGU office found for tenant ${tenantId}. Run \`pnpm --filter @aira/db db:reset\` first.`,
    );
  }

  const bfp = (await client.query(`select id from public.agencies where code = 'BFP' limit 1`))
    .rows[0];

  // 1) Platform operator (superadmin).
  await client.query(
    `insert into public.platform_admins (email, password_hash)
     values ($1, $2)
     on conflict (lower(email)) do update set password_hash = excluded.password_hash`,
    ['admin@aira.dev', passwordHash],
  );

  // 2-4) DRRM admin, dispatcher, field responder (email login; callsign = display label).
  const responders = [
    { email: 'drrm@aira.dev', callsign: null, role: 'ADMIN', agency: null },
    { email: 'dispatch@aira.dev', callsign: 'OPCEN-01', role: 'DISPATCHER', agency: null },
    { email: 'responder@aira.dev', callsign: 'BFP-01', role: 'RESPONDER', agency: bfp?.id ?? null },
  ];

  for (const r of responders) {
    await client.query(
      `insert into public.responders (email, callsign, role, password_hash, office_id, agency_id, must_change_password)
       values ($1, $2, $3::responder_role, $4, $5, $6, false)
       on conflict (lower(email)) do update set password_hash = excluded.password_hash, role = excluded.role`,
      [r.email, r.callsign, r.role, passwordHash, office.id, r.agency],
    );
  }

  console.log('\nSeeded dev accounts:\n');
  console.log(`  Password (all accounts): ${password}\n`);
  console.log('  Platform operator  admin@aira.dev      -> /platform');
  console.log('  DRRM admin         drrm@aira.dev       -> /admin');
  console.log('  Dispatcher         dispatch@aira.dev   -> /console');
  console.log('  Responder          responder@aira.dev  -> /console');
  console.log('\nThese are DEV credentials. Never use this script against production.\n');
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  await client.end().catch(() => {});
}
