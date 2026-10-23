/**
 * Provision the FIRST platform operator / superadmin (no public signup path).
 *
 * The platform tier onboards tenant offices in person; its first account must be created
 * out of band, here. The password is generated (or supplied), hashed with argon2id in
 * this process, and shown once. The database only ever sees the hash.
 *
 * Usage:
 *   pnpm --filter @aira/web platform:create-admin -- --email ops@aira.ph
 *   pnpm --filter @aira/web platform:create-admin -- --email ops@aira.ph --password '...'
 *
 * Production: set DATABASE_URL to the least-privilege application role.
 */

import { randomInt } from 'node:crypto';
import { stdin, stdout, argv, exit } from 'node:process';
import { createInterface } from 'node:readline/promises';

import { Algorithm, hash } from '@node-rs/argon2';
import { Client } from 'pg';

const LOCAL_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
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
    if (!token.startsWith('--')) continue;
    const [rawKey, inlineValue] = token.slice(2).split('=');
    if (!rawKey) continue;
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
const rl = stdin.isTTY ? createInterface({ input: stdin, output: stdout }) : null;

async function ask(question, fallback) {
  if (!rl) return fallback;
  const answer = (await rl.question(`${question}${fallback ? ` [${fallback}]` : ''}: `)).trim();
  return answer === '' ? fallback : answer;
}

const client = new Client({
  connectionString: process.env.DATABASE_URL ?? LOCAL_URL,
  application_name: 'aira-create-platform-admin',
});

try {
  await client.connect();

  const email = (
    await ask('Platform admin email', typeof args.email === 'string' ? args.email : undefined)
  )
    ?.trim()
    .toLowerCase();

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) {
    fail('A valid email is required (e.g. --email ops@aira.ph).');
  }

  const suppliedPassword = typeof args.password === 'string' ? args.password : null;
  const password = suppliedPassword ?? generatePassword();
  if (password.length < 12) {
    fail('Passwords must be at least 12 characters.');
  }

  const passwordHash = await hash(password, ARGON2_OPTIONS);

  const inserted = await client.query(
    `insert into public.platform_admins (email, password_hash) values ($1, $2) returning id`,
    [email, passwordHash],
  );

  console.log(`\nCreated platform admin ${email}.`);
  console.log(`Account id: ${inserted.rows[0].id}`);
  if (suppliedPassword) {
    console.log('Password: the value supplied on the command line (not echoed).');
  } else {
    console.log(`\nOne-time password: ${password}`);
    console.log('Shown once. Deliver it over a trusted channel; it is not stored in plaintext.');
  }
  console.log('Sign in at /platform/login.\n');
} catch (error) {
  if (error?.code === '23505') {
    fail('That email already exists as a platform admin.');
  }
  fail(error instanceof Error ? error.message : String(error));
} finally {
  rl?.close();
  await client.end().catch(() => {});
}
