# AIRA Responder Console (`apps/web`)

The responder/dispatcher web console and the internal platform-operator (superadmin) console.
Next.js 16 (App Router), Tailwind, MapLibre, Lucide. Authentication is **application-owned**
(argon2id + opaque session cookies) — not Supabase Auth.

There are three separate identity tiers. Each keeps its own table, session and cookie on the
server (they stay fully isolated), but responders and platform operators share a **single login
page** — `/login` figures out which tier an email belongs to and routes accordingly:

| Tier                                | Login page | Lands on             | What it manages                           |
| ----------------------------------- | ---------- | -------------------- | ----------------------------------------- |
| Responder / Dispatcher / DRRM admin | `/login`   | `/console`, `/admin` | Incidents, the responder roster, dispatch |
| Platform operator (superadmin)      | `/login`   | `/platform`          | Tenants (LGU offices), the nationwide map |
| Citizen                             | `/citizen` | `/citizen`           | Their own reports + medical profile       |

---

## Prerequisites

- **Node.js 20+** and **pnpm 12** (the repo pins `pnpm@12.6.0` via `packageManager`).
- **Docker** — only needed to run the local Postgres database. `pnpm check`/`build` do **not**
  need it, but logging in and seeding accounts do.

All commands below are run **from the repo root** (`c:\aira`) unless noted. They work the same on
Windows PowerShell, macOS and Linux.

---

## Step-by-step setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Start the local database

The schema lives in `packages/db` and is managed with the Supabase CLI (local Postgres only —
Supabase Auth/Storage/Realtime are all disabled). This starts Postgres 17 on
`127.0.0.1:54322` (user / password / database all `postgres`):

```bash
pnpm --filter @aira/db db:start
```

First run pulls Docker images, so give it a minute. Stop it later with
`pnpm --filter @aira/db db:stop`.

### 3. Apply the migrations

```bash
pnpm --filter @aira/db db:reset
```

This drops and recreates the schema from `packages/db/supabase/migrations/*.sql`, then loads the
seed data (one demo tenant + its four Region VII offices). It creates **no** user accounts — you
seed those in step 5.

### 4. Configure the web app environment

Copy the template and fill in two required values:

```bash
cp apps/web/.env.example apps/web/.env.local
```

`apps/web/.env.local` must set:

- **`DATABASE_URL`** — already correct for the local stack:
  `postgresql://postgres:postgres@127.0.0.1:54322/postgres`
- **`MEDICAL_ENCRYPTION_KEY`** — a 32-byte key (64 hex chars). The API builds its dependency
  container eagerly, so a missing key makes **every** authenticated route return 500, not just the
  medical ones. Generate one:

  ```bash
  node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
  ```

  Paste the output as the value:

  ```
  MEDICAL_ENCRYPTION_KEY="<paste the 64-hex key here>"
  ```

> `.env.local` is git-ignored. Never commit real secrets, and never reuse a dev key in production.

### 5. Seed dev accounts

With the database up (steps 2–3) and `.env.local` in place, create the known dev logins:

```bash
pnpm --filter @aira/web seed:accounts
```

This provisions four accounts, all sharing the password **`password123`**:

| Account                        | Email                | Callsign | Lands on    |
| ------------------------------ | -------------------- | -------- | ----------- |
| Platform operator (superadmin) | `admin@aira.dev`     | –        | `/platform` |
| DRRM administrator             | `drrm@aira.dev`      | –        | `/admin`    |
| Dispatcher                     | `dispatch@aira.dev`  | OPCEN-01 | `/console`  |
| Field responder                | `responder@aira.dev` | BFP-01   | `/console`  |

The script is **dev-only**: it hashes passwords with argon2id (never stores them in source) and
**refuses to run against a non-local database** unless you pass `--force`. It is idempotent — rerun
it any time (e.g. after another `db:reset`). To use your own password instead of the default:

```bash
pnpm --filter @aira/web seed:accounts -- --password 'something-else'
```

### 6. Run the console

```bash
pnpm dev
```

Open http://localhost:3000. All tiers sign in at the one page —
http://localhost:3000/login — with password `password123`.
Each account lands on its own console (`admin@aira.dev` → `/platform`, `drrm@aira.dev` → `/admin`,
the dispatcher/responder → `/console`).

---

## Quick reference

```bash
# Database (Docker required)
pnpm --filter @aira/db db:start     # start local Postgres on 127.0.0.1:54322
pnpm --filter @aira/db db:reset     # re-apply migrations + seed from scratch
pnpm --filter @aira/db db:stop      # stop the stack

# Accounts
pnpm --filter @aira/web seed:accounts          # seed the 4 dev logins (password123)
pnpm --filter @aira/web auth:create-responder  # create one responder/dispatcher/admin
pnpm --filter @aira/web platform:create-admin  # create one platform operator

# App
pnpm dev                            # web console on :3000
pnpm check                          # typecheck + tests (the gate before "done")
pnpm build                          # production build
```

### Reset everything from scratch

```bash
pnpm --filter @aira/db db:reset
pnpm --filter @aira/web seed:accounts
```

---

## Smoke test (optional)

A script exercises the full platform flow end-to-end over HTTP (platform login → create tenant →
bootstrap a tenant admin → responder email login → cross-tier isolation). With the dev server
running (`pnpm dev`) and accounts seeded:

```bash
node apps/web/scripts/smoke-platform.mjs
```

It targets http://localhost:3000 by default and cleans up the throwaway tenant it creates.

---

## Notifications (three channels)

The console delivers notifications over three channels, sent synchronously inside the
originating request with **fail-soft** semantics (a channel failure is recorded but never
breaks the action — see [SECURITY.md §13](../../SECURITY.md)):

- **In-app** — persisted and shown in the Notification Center (the header bell). Always
  delivered; it needs no configuration.
- **Email** — Gmail SMTP via nodemailer (`SMTP_*`).
- **Web push** — Web Push / VAPID via `web-push` (`VAPID_*`), using the service worker at
  `apps/web/public/sw.js` to receive push events in the browser.

Both external channels are **optional**: when their env vars are absent the channel degrades
to `not_attempted` and the app keeps working. Configure them in `apps/web/.env.local` — see
`apps/web/.env.example` for the full, commented list:

| Variable            | Channel  | Notes                                                      |
| ------------------- | -------- | ---------------------------------------------------------- |
| `SMTP_HOST`         | Email    | e.g. `smtp.gmail.com`                                      |
| `SMTP_PORT`         | Email    | optional, defaults to `587` (`465` = implicit TLS)         |
| `SMTP_USER`         | Email    | Gmail address; also the default From                       |
| `SMTP_PASS`         | Email    | Gmail **App Password**, never your real account password   |
| `SMTP_FROM`         | Email    | optional From address; defaults to `SMTP_USER`             |
| `VAPID_PUBLIC_KEY`  | Web push | also exposed to the browser to register the subscription   |
| `VAPID_PRIVATE_KEY` | Web push | server-only secret                                         |
| `VAPID_SUBJECT`     | Web push | a `mailto:` or https URL; defaults to `mailto:ops@aira.ph` |

### Generate VAPID keys locally

Web push needs a VAPID keypair. Generate one (run from `apps/web`):

```bash
npx web-push generate-vapid-keys
```

Paste the two values into `apps/web/.env.local` as `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`.
The **public** key is intentionally shipped to the browser/service worker to register the
push subscription — that is expected under the Web Push protocol and is not a secret. The
**private** key is server-only. `.env.example` ships a dev-only throwaway keypair so local
push works out of the box; **production must generate and set its own keys** and keep the
private key out of source control.

---

## Troubleshooting

- **Every login returns 500 / `encryption_key_not_configured`** — `MEDICAL_ENCRYPTION_KEY` is
  missing or the wrong length in `.env.local`. Regenerate it (step 4) and restart `pnpm dev`.
- **Authenticated routes return 503 `database_not_configured`** — `DATABASE_URL` is unset, or the
  database isn't running. Check `pnpm --filter @aira/db db:status`.
- **`seed:accounts` prints "No LGU office found"** — run `pnpm --filter @aira/db db:reset` first;
  the seed accounts attach to the demo tenant's office.
- **`seed:accounts` refuses to run** — it only targets a local database by design. Pass `--force`
  only if you genuinely mean to seed a remote one (you almost never do).
- **Port 3000 already in use** — an old `next dev` is still running. Stop it, or Next will fall back
  to another port and print the URL.
