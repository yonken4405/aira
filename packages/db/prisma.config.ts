import { defineConfig } from 'prisma/config';

// Prisma 7 project config.
//
// Supabase CLI owns the database: local Postgres (`supabase start`) + SQL migrations under
// `supabase/migrations`. Prisma is an optional typed client only - never run `prisma migrate`
// or `prisma db push` here; use `supabase migration new` + `supabase db reset`.
//
// Prisma 7 moved the connection URL out of `schema.prisma`. The fallback matches the local
// Supabase stack (supabase/config.toml → db.port = 54322); override with DATABASE_URL for any
// other Postgres host (see .env.example).
const LOCAL_SUPABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres?schema=public';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL ?? LOCAL_SUPABASE_URL,
  },
});
