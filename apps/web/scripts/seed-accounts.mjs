/**
 * DEV-ONLY account seeding. Provisions a known set of accounts for local development so
 * you can sign in immediately after `db:reset`:
 *
 *   - 1 platform operator (superadmin)          -> CLI break-glass only (no web console)
 *   - 1 LDRRMO coordinator (ADMIN, read-only)   -> /admin
 *   - per agency: 1 AGENCY_ADMIN, 1 DISPATCHER  -> /admin, /console
 *     and 1 field RESPONDER                     -> /console
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

  // The LGU's agencies (single-lgu-agency-network). Each gets its own admin, dispatcher,
  // and field responder below. Keyed by code so station/display labels are stable.
  const agencyRows = (
    await client.query(`select id, code from public.agencies where tenant_id = $1 order by code`, [
      tenantId,
    ])
  ).rows;
  const agencyByCode = new Map(agencyRows.map((a) => [a.code, a.id]));

  // A barangay office to station field responders in (coverage realism). Falls back to
  // the LGU root when no barangay is seeded.
  const barangay = (
    await client.query(
      `select id from public.offices where tenant_id = $1 and kind = 'BARANGAY' order by name limit 1`,
      [tenantId],
    )
  ).rows[0];
  const fieldOfficeId = barangay?.id ?? office.id;

  // 1) Platform operator (superadmin). Retained as a CLI break-glass tier; it has no web
  //    console after this feature, but the dev seed keeps a recovery account available.
  await client.query(
    `insert into public.platform_admins (email, password_hash)
     values ($1, $2)
     on conflict (lower(email)) do update set password_hash = excluded.password_hash`,
    ['admin@aira.dev', passwordHash],
  );

  // 2) LDRRMO coordinator (the existing ADMIN role): tenant-wide, read-only, sees all
  //    agencies, no dispatch. Agency-less by design (coordination, not a line agency).
  const accounts = [
    { email: 'drrm@aira.dev', callsign: 'LDRRMO', role: 'ADMIN', agency: null, office: office.id },
  ];

  // 3) Per agency: an AGENCY_ADMIN + DISPATCHER (stationed at the LGU root) and a field
  //    RESPONDER (stationed at a barangay). Agency is required for these roles (R3).
  for (const { code, id } of agencyRows) {
    const slug = code.toLowerCase();
    accounts.push(
      {
        email: `${slug}.admin@aira.dev`,
        callsign: `${code}-ADMIN`,
        role: 'AGENCY_ADMIN',
        agency: id,
        office: office.id,
      },
      {
        email: `${slug}.dispatch@aira.dev`,
        callsign: `${code}-OPCEN`,
        role: 'DISPATCHER',
        agency: id,
        office: office.id,
      },
      {
        email: `${slug}.responder@aira.dev`,
        callsign: `${code}-01`,
        role: 'RESPONDER',
        agency: id,
        office: fieldOfficeId,
      },
    );
  }

  for (const a of accounts) {
    await client.query(
      `insert into public.responders (email, callsign, role, password_hash, office_id, agency_id, must_change_password)
       values ($1, $2, $3::responder_role, $4, $5, $6, false)
       on conflict (lower(email)) do update
         set password_hash = excluded.password_hash,
             role = excluded.role,
             office_id = excluded.office_id,
             agency_id = excluded.agency_id`,
      [a.email, a.callsign, a.role, passwordHash, a.office, a.agency],
    );
  }

  console.log('\nSeeded dev accounts:\n');
  console.log(`  Password (all accounts): ${password}\n`);
  console.log('  Platform operator  admin@aira.dev            (CLI break-glass only)');
  console.log('  LDRRMO coordinator drrm@aira.dev             -> /admin  (read-only)');
  for (const { code } of agencyRows) {
    const slug = code.toLowerCase();
    console.log(`  ${code} agency admin   ${`${slug}.admin@aira.dev`.padEnd(24)} -> /admin`);
    console.log(`  ${code} dispatcher     ${`${slug}.dispatch@aira.dev`.padEnd(24)} -> /console`);
    console.log(`  ${code} responder      ${`${slug}.responder@aira.dev`.padEnd(24)} -> /console`);
  }
  console.log('\nThese are DEV credentials. Never use this script against production.\n');
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  await client.end().catch(() => {});
}
