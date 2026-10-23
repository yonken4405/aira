# Responder console: database setup

The console (`apps/web`) refuses to serve authenticated routes until `DATABASE_URL`
points at a Postgres database. When it is missing you'll see `database_not_configured`
(503 on API routes, and login cannot complete). This guide gets you from zero to a
working login.

AIRA owns its own auth and uses Postgres directly — there is **no Supabase Auth, no
`anon`/`service_role` key, and no Supabase client in the app** (SECURITY.md §4). So
"getting credentials" means (1) a Postgres connection string and (2) a responder
account you provision with the CLI. That's it.

---

## TL;DR

```bash
# 1. point the app at a database
cp apps/web/.env.example apps/web/.env.local     # then edit DATABASE_URL

# 2. (local only) start Postgres + apply schema + seed offices
pnpm --filter @aira/db db:start
pnpm --filter @aira/db db:reset

# 3. create a login
pnpm --filter @aira/web auth:create-responder -- --callsign ADMIN-1 --role ADMIN

# 4. run the console
pnpm --filter @aira/web dev      # http://localhost:3000
```

---

## Option A — Local database (recommended for development)

This uses the Supabase CLI purely as a local Postgres provider (`packages/db`). Supabase
Auth/Storage/Realtime/Studio are all disabled; you only get Postgres.

### Prerequisites

- **Docker Desktop** running (the local stack runs Postgres 17 in a container).
- Dependencies installed: `pnpm install` at the repo root.

### Steps

1. **Start the local stack.** From the repo root:

   ```bash
   pnpm --filter @aira/db db:start
   ```

   This boots Postgres on `127.0.0.1:54322` with database/user/password all `postgres`.

2. **Apply the schema and seed data.**

   ```bash
   pnpm --filter @aira/db db:reset
   ```

   This runs every migration in `packages/db/supabase/migrations/` and then the seed
   (`packages/db/supabase/seed.sql`). The seed creates the LGU office (Cebu City DRRMO),
   its barangays, the three agencies (BFP/PNP/EMS), and a few demo incidents.

   > The seed deliberately creates **no responder accounts** — no password hash ever
   > lives in the repo (SECURITY.md §1.6/§6.3). You create logins in step 4.

3. **Point the app at it.** Create `apps/web/.env.local`:

   ```bash
   cp apps/web/.env.example apps/web/.env.local
   ```

   The default `DATABASE_URL` in the template already matches the local stack:

   ```
   DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
   ```

4. **Create a responder account** (this is your login). The script hashes the password
   with argon2id in-process and prints it once; only the hash reaches the database.

   ```bash
   # Interactive — prompts for callsign, role, office, agency:
   pnpm --filter @aira/web auth:create-responder

   # Or non-interactive:
   pnpm --filter @aira/web auth:create-responder -- --callsign ADMIN-1 --role ADMIN
   pnpm --filter @aira/web auth:create-responder -- --callsign DUTY-1  --role DISPATCHER --office 1
   pnpm --filter @aira/web auth:create-responder -- --callsign K9-01   --role RESPONDER  --office "Barangay Lahug" --agency PNP
   ```

   It prints a one-time password. Copy it — you'll be forced to change it on first
   sign-in (unless you pass `--must-change=false`).

   | Role         | Lands on   | Can do                                                        |
   | ------------ | ---------- | ------------------------------------------------------------- |
   | `ADMIN`      | `/admin`   | Manage responder accounts, read the auth audit log. No queue. |
   | `DISPATCHER` | `/console` | Full office queue, routing, assignment, status on any.        |
   | `RESPONDER`  | `/console` | Only incidents assigned to them; status on their own.         |

5. **Run the console** and sign in with the callsign + one-time password:

   ```bash
   pnpm --filter @aira/web dev
   ```

Stop the local database later with `pnpm --filter @aira/db db:stop`.

---

## Option B — Hosted / remote Postgres

Any standard Postgres host works (managed Postgres, a Supabase project used _as a
database only_, RDS, etc.). You need a connection string and a way to run the SQL
migrations against it.

### Where the "credentials" come from

The only credential the app needs is a Postgres **connection string** in the form:

```
postgresql://<user>:<password>@<host>:<port>/<database>?sslmode=require
```

Get it from your provider's dashboard:

- **A Supabase project (Postgres only):** Project → _Connect_ → _Connection string_ →
  _URI_. Use the **pooled** connection string for the app runtime; use the **direct**
  connection string when running migrations. Do **not** copy the `anon` or
  `service_role` API keys — AIRA does not use them.
- **Generic managed Postgres (RDS, Cloud SQL, Neon, etc.):** take the host, port, user,
  password, and database name from the instance page and assemble the URL above. Most
  require TLS, so keep `?sslmode=require`.

Prefer a **least-privilege application role** rather than the superuser. The app needs
`SELECT`/`INSERT`/`UPDATE` on the AIRA tables and `EXECUTE` on the two prune functions —
it never needs `DROP`/`CREATE`. The migrations grant the right privileges to the
`aira_app` role.

### Steps

1. **Set the connection string** in `apps/web/.env.local`:

   ```
   DATABASE_URL="postgresql://aira_app:<password>@<host>:5432/<db>?sslmode=require"
   AIRA_PUBLIC_ORIGIN="https://<your-console-domain>"   # production only
   ```

2. **Apply the migrations** to the remote database. Point the Supabase CLI (or any SQL
   runner) at your host and run the files in `packages/db/supabase/migrations/` in
   order. Review them first — they are plain SQL and reviewed like code.

3. **Provision an account** against the remote DB by exporting the same URL for the
   script:

   ```bash
   # PowerShell
   $env:DATABASE_URL="postgresql://aira_app:<password>@<host>:5432/<db>?sslmode=require"
   pnpm --filter @aira/web auth:create-responder -- --callsign ADMIN-1 --role ADMIN

   # bash
   DATABASE_URL="postgresql://..." pnpm --filter @aira/web auth:create-responder -- --callsign ADMIN-1 --role ADMIN
   ```

4. **Build and start** the console with the env in place:

   ```bash
   pnpm --filter @aira/web build
   pnpm --filter @aira/web start
   ```

---

## Environment variables

| Variable             | Required | Purpose                                                                                            |
| -------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`       | Yes      | Postgres connection string. Missing → `database_not_configured` (503) and login fails.             |
| `AIRA_PUBLIC_ORIGIN` | No       | Canonical origin for same-origin checks on state-changing routes. Set in production; unset in dev. |
| `NODE_ENV`           | Auto     | Set by `next dev` / `next build`. Controls the `Secure` cookie flag — don't hardcode it.           |

Put real values in `apps/web/.env.local` (git-ignored). `apps/web/.env.example` is the
committed template — never commit a filled-in `.env.local`, and never add Supabase Auth
keys (SECURITY.md §4/§6.3).

---

## Troubleshooting

- **`database_not_configured` / 503 on `/api/...`** — `DATABASE_URL` is unset or empty.
  Confirm `apps/web/.env.local` exists and you restarted `next dev` after editing it.
- **Connection refused on `127.0.0.1:54322`** — the local stack isn't running. Run
  `pnpm --filter @aira/db db:start` (Docker must be up).
- **TLS / self-signed errors against a hosted DB** — add `?sslmode=require` to the URL.
- **`No offices exist` from the create-responder script** — run
  `pnpm --filter @aira/db db:reset` (or apply the seed) before creating accounts.
- **Can't log in after creating an account** — you're prompted to change the one-time
  password at first sign-in; that's expected. The account is also locked after 5 failed
  attempts for 15 minutes.
