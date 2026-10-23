-- AIRA citizen accounts (PRODUCT.md §1a, SECURITY.md §7).
--
-- The OPTIONAL registered-citizen tier. Entirely separate from responder identity:
-- a citizen session can never resolve to a responder principal or any responder
-- permission (SECURITY.md §7.2). Anonymous SOS (Tier 0) never touches these tables.
--
-- Identity is email or an opaque device key - NO phone number, NO telco/SMS
-- (SECURITY.md §7.1). Email verification is mocked in this phase.

-- 1) Citizens -----------------------------------------------------------------
create table public.citizens (
  id             uuid primary key default gen_random_uuid(),
  -- Lower-cased email, or null for a device-key-only account. Unique when present.
  email          text check (email is null or char_length(email) between 3 and 254),
  -- SHA-256 hash of the opaque device key, or null for an email account. Never the
  -- key itself (SECURITY.md §7.3).
  device_key_hash text check (device_key_hash is null or char_length(device_key_hash) = 64),
  -- argon2id hash of the password, or null for a device-key-only account.
  password_hash  text,
  -- Mocked email verification (SECURITY.md §7.1): true once "verified".
  email_verified boolean not null default false,
  active         boolean not null default true,
  failed_attempts integer not null default 0,
  locked_until   timestamptz,
  last_login_at  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- An account must be reachable by at least one identity.
  constraint citizens_identity_present check (email is not null or device_key_hash is not null),
  -- An email account must carry a password; a device-key account need not.
  constraint citizens_email_has_password check (email is null or password_hash is not null),
  constraint citizens_failed_attempts_check check (failed_attempts >= 0)
);

-- Case-insensitive uniqueness for emails that exist.
create unique index citizens_email_lower_uniq
  on public.citizens (lower(email))
  where email is not null;
create unique index citizens_device_key_uniq
  on public.citizens (device_key_hash)
  where device_key_hash is not null;

create trigger citizens_touch_updated_at
  before update on public.citizens
  for each row
  execute function public.touch_updated_at();

-- 2) Citizen sessions ---------------------------------------------------------
-- Same hardening as responder_sessions: only a token HASH at rest, idle + absolute
-- expiry, server-side revocation (SECURITY.md §7.4).
create table public.citizen_sessions (
  id                  uuid primary key default gen_random_uuid(),
  citizen_id          uuid not null references public.citizens (id) on delete cascade,
  token_hash          text not null unique,
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null,
  last_seen_at        timestamptz not null default now(),
  absolute_expires_at timestamptz not null default (now() + interval '24 hours'),
  revoked_at          timestamptz,
  revoked_reason      text check (revoked_reason is null or char_length(revoked_reason) <= 64),
  constraint citizen_sessions_absolute_check check (absolute_expires_at >= created_at)
);

create index citizen_sessions_live_idx
  on public.citizen_sessions (expires_at)
  where revoked_at is null;
create index citizen_sessions_citizen_idx on public.citizen_sessions (citizen_id);

-- 3) Least privilege ----------------------------------------------------------
-- Deny-by-default for Data API roles; the app role gets the minimum it needs.
-- Guarded so this also runs on vanilla Postgres without Supabase roles.
do $$
declare t text;
begin
  foreach t in array array['citizens', 'citizen_sessions'] loop
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on public.%I from anon', t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on public.%I from authenticated', t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('revoke all on public.%I from service_role', t);
    end if;
  end loop;
end;
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'aira_app') then
    grant select, insert, update on public.citizens to aira_app;
    grant select, insert, update, delete on public.citizen_sessions to aira_app;
  end if;
end;
$$;
