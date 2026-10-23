/**
 * Provision a responder account (SECURITY.md §4.4 / §6.3).
 *
 * No credential material lives in the repository: the password is either generated
 * here or supplied by the operator, hashed with argon2id in this process, and shown
 * once on stdout. The database only ever sees the hash.
 *
 * Usage (local stack):
 *   pnpm --filter @aira/web auth:create-responder
 *   pnpm --filter @aira/web auth:create-responder -- --email duty@cebu.gov.ph --role DISPATCHER
 *   pnpm --filter @aira/web auth:create-responder -- --email officer@cebu.gov.ph --role ADMIN
 *
 * Login is by EMAIL. Callsign is an OPTIONAL operational display label.
 * Flags: --email (required), --callsign (optional), --role (RESPONDER|DISPATCHER|ADMIN),
 *        --office, --agency, --password (omit to generate), --must-change=false
 *
 * Production: set DATABASE_URL to the least-privilege application role.
 */

import { randomInt } from 'node:crypto';
import { stdin, stdout, argv, exit } from 'node:process';
import { createInterface } from 'node:readline/promises';

import { Algorithm, hash } from '@node-rs/argon2';
import { Client } from 'pg';

const LOCAL_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const ROLES = ['RESPONDER', 'DISPATCHER', 'ADMIN'];
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const PASSWORD_LENGTH = 20;

const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) {
      continue;
    }

    const [rawKey, inlineValue] = token.slice(2).split('=');
    if (!rawKey) {
      continue;
    }

    if (inlineValue !== undefined) {
      parsed[rawKey] = inlineValue;
      continue;
    }

    const next = args[index + 1];
    if (next && !next.startsWith('--')) {
      parsed[rawKey] = next;
      index += 1;
    } else {
      parsed[rawKey] = true;
    }
  }
  return parsed;
}

function generatePassword() {
  let password = '';
  for (let index = 0; index < PASSWORD_LENGTH; index += 1) {
    password += ALPHABET[randomInt(ALPHABET.length)];
  }
  return password;
}

function fail(message) {
  console.error(`\n${message}\n`);
  exit(1);
}

const args = parseArgs(argv.slice(2));
const interactive = stdin.isTTY;
const rl = interactive ? createInterface({ input: stdin, output: stdout }) : null;

async function ask(question, fallback) {
  if (!rl) {
    return fallback;
  }
  const answer = (await rl.question(`${question}${fallback ? ` [${fallback}]` : ''}: `)).trim();
  return answer === '' ? fallback : answer;
}

const client = new Client({
  connectionString: process.env.DATABASE_URL ?? LOCAL_URL,
  application_name: 'aira-create-responder',
});

try {
  await client.connect();

  const offices = (
    await client.query(
      `select id, name, kind
         from public.offices
        where active
        order by case when kind = 'LGU' then 0 else 1 end, name asc`,
    )
  ).rows;

  if (offices.length === 0) {
    fail('No offices exist. Run `pnpm --filter @aira/db db:reset` (or seed) first.');
  }

  if (!args.office && rl) {
    console.log('\nOffices:');
    offices.forEach((office, index) => {
      console.log(`  ${index + 1}. ${office.name} (${office.kind})`);
    });
    console.log('');
  }

  const email = (await ask('Email', typeof args.email === 'string' ? args.email : undefined))
    ?.trim()
    .toLowerCase();

  if (!email) {
    fail('An email is required (e.g. --email juan@cebu.gov.ph). It is the login identifier.');
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) {
    fail('Enter a valid email address.');
  }

  // Callsign is an OPTIONAL operational display label (map/queue/radio), not a login.
  const callsignInput = (
    await ask(
      'Callsign (optional display label)',
      typeof args.callsign === 'string' ? args.callsign : '',
    )
  )?.trim();
  const callsign = callsignInput && callsignInput.length > 0 ? callsignInput : null;
  if (callsign !== null && !/^[A-Za-z0-9][A-Za-z0-9-]{0,31}$/.test(callsign)) {
    fail('Callsigns use letters, digits and dashes (1-32 characters).');
  }

  const role = (await ask('Role (RESPONDER|DISPATCHER|ADMIN)', args.role ?? 'RESPONDER'))
    ?.trim()
    .toUpperCase();

  if (!ROLES.includes(role)) {
    fail(`Unknown role "${role}". Use one of: ${ROLES.join(', ')}.`);
  }

  const officeHint = String(args.office ?? (await ask('Office (number, name or id)', '1')));
  const office =
    offices[Number(officeHint) - 1] ??
    offices.find((row) => row.name.toLowerCase() === officeHint.toLowerCase()) ??
    offices.find((row) => row.id === officeHint) ??
    offices.find((row) => row.id.startsWith(officeHint));

  if (!office) {
    fail(`Office "${officeHint}" was not found.`);
  }

  const agencies = (
    await client.query('select id, name, code from public.agencies where active order by name asc')
  ).rows;

  const agencyHint =
    args.agency === undefined
      ? await ask(
          `Agency (${agencies.map((row, index) => `${index + 1}=${row.code}`).join(', ')}, blank for none)`,
          '',
        )
      : String(args.agency);

  let agency = null;
  if (agencyHint) {
    agency =
      agencies[Number(agencyHint) - 1] ??
      agencies.find((row) => row.code.toLowerCase() === String(agencyHint).toLowerCase()) ??
      agencies.find((row) => row.id === agencyHint) ??
      agencies.find((row) => row.id.startsWith(String(agencyHint))) ??
      null;

    if (!agency) {
      fail(`Agency "${agencyHint}" was not found.`);
    }
  }

  const suppliedPassword = typeof args.password === 'string' ? args.password : null;
  const password = suppliedPassword ?? generatePassword();

  if (password.length < 12) {
    fail('Passwords must be at least 12 characters.');
  }

  const mustChange = String(args['must-change'] ?? 'true') !== 'false';
  const passwordHash = await hash(password, ARGON2_OPTIONS);

  const inserted = await client.query(
    `insert into public.responders
       (email, callsign, role, password_hash, office_id, agency_id, must_change_password)
     values ($1, $2, $3::responder_role, $4, $5, $6, $7)
     returning id`,
    [email, callsign, role, passwordHash, office.id, agency?.id ?? null, mustChange],
  );

  await client.query(
    `insert into public.auth_events (responder_id, event, callsign, detail)
     values ($1, 'ACCOUNT_CREATED', $2, 'cli_provisioning')`,
    [inserted.rows[0].id, email],
  );

  const label = callsign ? `${callsign} <${email}>` : email;
  console.log(
    `\nCreated ${label} (${role}) at ${office.name}${agency ? ` / ${agency.code}` : ''}.`,
  );
  console.log(`Account id: ${inserted.rows[0].id}`);
  console.log(`Sign in with the email: ${email}`);

  if (suppliedPassword) {
    console.log('Password: the value supplied on the command line (not echoed).');
  } else {
    console.log(`\nOne-time password: ${password}`);
    console.log('Shown once. Deliver it over a trusted channel; it is not stored in plaintext.');
  }

  if (mustChange) {
    console.log('The responder must set a new password at first sign-in.\n');
  }
} catch (error) {
  if (error?.code === '23505') {
    fail('That email already exists. One email = one responder account.');
  }
  fail(error instanceof Error ? error.message : String(error));
} finally {
  rl?.close();
  await client.end().catch(() => {});
}
