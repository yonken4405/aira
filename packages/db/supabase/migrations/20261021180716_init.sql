-- AIRA initial schema (PRODUCT.md §4, SECURITY.md §4/§5).
--
-- Ownership: schema changes are authored HERE (Supabase CLI migrations) and applied with
-- `supabase db reset` / `supabase db push`. Prisma is only a typed client - it never owns
-- migrations. No `auth.*` tables are referenced anywhere: Supabase Auth is disabled and AIRA
-- authenticates responders itself, so this schema moves to any Postgres host unchanged.

create extension if not exists pgcrypto;

-- Closed enums - MUST match packages/ui/src/categories.ts.
create type public.emergency_category as enum ('SUNOG', 'MEDIKAL', 'KRIMEN', 'BAHA');
create type public.incident_status as enum ('QUEUED', 'DISPATCHED', 'EN_ROUTE', 'ON_SCENE', 'RESOLVED');
create type public.incident_source as enum ('mesh', 'manual');

-- Responder accounts (RBAC). Citizens never have accounts or stored PII.
create type public.responder_role as enum ('UNIT', 'DISPATCHER', 'ADMIN');

create table public.responders (
  id            uuid primary key default gen_random_uuid(),
  callsign      text not null unique check (char_length(callsign) between 3 and 32),
  role          public.responder_role not null,
  -- argon2id hash, produced by the app's own auth layer (never Supabase Auth).
  password_hash text not null check (password_hash <> ''),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Opaque session tokens: only the hash is stored, so a DB leak cannot be replayed.
create table public.responder_sessions (
  id           uuid primary key default gen_random_uuid(),
  responder_id uuid not null references public.responders (id) on delete cascade,
  token_hash   text not null unique,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  constraint responder_sessions_expiry_after_creation check (expires_at > created_at)
);

create index responder_sessions_responder_id_idx
  on public.responder_sessions (responder_id);

create table public.incidents (
  id             uuid primary key default gen_random_uuid(),
  category       public.emergency_category not null,
  lat            double precision not null,
  lon            double precision not null,
  status         public.incident_status not null default 'QUEUED',
  source         public.incident_source not null default 'mesh',
  reported_at    timestamptz not null default now(),
  assigned_to_id uuid references public.responders (id) on delete set null,
  assigned_at    timestamptz,
  resolved_at    timestamptz,
  -- Responder-only operational note. Never citizen-supplied free text (PRODUCT.md §2).
  note           text,
  constraint incidents_lat_range check (lat between -90 and 90),
  constraint incidents_lon_range check (lon between -180 and 180),
  -- Coordinates are stored at 4 decimal places (~11 m) - SECURITY.md §5.
  constraint incidents_lat_4dp check (lat = round(lat::numeric, 4)::double precision),
  constraint incidents_lon_4dp check (lon = round(lon::numeric, 4)::double precision)
);

create index incidents_status_reported_at_idx
  on public.incidents (status, reported_at desc);

create index incidents_assigned_to_id_idx
  on public.incidents (assigned_to_id)
  where assigned_to_id is not null;

-- Keep updated_at honest without app-side bookkeeping.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger responders_touch_updated_at
  before update on public.responders
  for each row
  execute function public.touch_updated_at();

-- Deny-by-default for the Data API roles. AIRA's backend uses a direct Postgres connection,
-- so these roles get nothing (SECURITY.md §4). Guarded so the migration also runs on vanilla
-- Postgres instances where the Supabase roles do not exist.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon';
    execute 'revoke all on all sequences in schema public from anon';
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on all tables in schema public from authenticated';
    execute 'revoke all on all sequences in schema public from authenticated';
  end if;
end;
$$;
