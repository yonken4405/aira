# `@aira/db`: PostgreSQL via Supabase CLI (future-proofing)

Not consumed by `apps/web` or `apps/mobile` yet. No database is required for `pnpm check`,
`pnpm test` or `pnpm build`.

## Why Supabase CLI

- **Local Postgres + versioned SQL migrations** with one tool (`supabase start`,
  `supabase migration new`, `supabase db reset`).
- **Not Supabase Auth.** Supabase Auth is disabled in `supabase/config.toml`, there is no
  `auth.users` reference anywhere, and no Supabase JWT is used. Responders authenticate against
  `responders` + `responder_sessions` (argon2id password hashes, hashed opaque session tokens);
  see SECURITY.md §4. That keeps the schema portable: point `DATABASE_URL` at any Postgres host
  and nothing else changes.
- Storage, Realtime, Studio, Edge Runtime and Analytics are also disabled; AIRA only needs
  Postgres.

## Setup

```bash
pnpm --filter @aira/db db:start        # local Postgres 17 on 127.0.0.1:54322 (Docker required)
cp packages/db/.env.example packages/db/.env
pnpm --filter @aira/db db:reset        # apply supabase/migrations/*.sql from scratch
pnpm --filter @aira/db generate        # optional: Prisma client -> src/generated
```

Stop the stack with `pnpm --filter @aira/db db:stop`.

## Working with the schema

| Task                | Command                                                  |
| ------------------- | -------------------------------------------------------- |
| New migration       | `pnpm --filter @aira/db db:migration:new -- add_table_x` |
| Apply from scratch  | `pnpm --filter @aira/db db:reset`                        |
| Refresh Prisma view | `pnpm --filter @aira/db db:pull`                         |
| Prisma Studio       | `pnpm --filter @aira/db db:studio`                       |

SQL migrations are the source of truth. Prisma mirrors them for typed access only; do **not** run
`prisma migrate` or `prisma db push`.

## Invariants

- Categories are the closed enum `SUNOG | MEDIKAL | KRIMEN | BAHA` (PRODUCT.md §4).
- Coordinates are WGS84 at 4 decimal places, enforced by a `CHECK` (~11 m, SECURITY.md §5).
- No citizen PII columns exist, and no free-text citizen input can reach the database.
- `anon` / `authenticated` (Data API roles) are revoked from all tables; tables are not
  auto-exposed. Access is direct Postgres from the backend only.
