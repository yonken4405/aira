-- Platform operators / superadmins (multi-tenant platform tier).
--
-- The AIRA team that onboards tenant offices IN PERSON. A platform admin is a THIRD,
-- fully separate identity tier (alongside responders and citizens): its session can
-- never resolve to a responder or citizen principal, and it holds ZERO incident access.
-- It manages tenants/offices and bootstraps each tenant's first DRRM admin - billing/ops,
-- not emergency operations (separation of duties, SECURITY.md §4).
--
-- There is NO public signup path: the first platform admin is seeded/CLI-provisioned.

create table public.platform_admins (
  id             uuid primary key default gen_random_uuid(),
  email          text not null check (char_length(email) between 3 and 254),
  password_hash  text not null,
  active         boolean not null default true,
  failed_attempts integer not null default 0,
  locked_until   timestamptz,
  last_login_at  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint platform_admins_failed_attempts_check check (failed_attempts >= 0)
);

create unique index platform_admins_email_lower_uniq on public.platform_admins (lower(email));

create trigger platform_admins_touch_updated_at
  before update on public.platform_admins
  for each row
  execute function public.touch_updated_at();

create table public.platform_sessions (
  id                  uuid primary key default gen_random_uuid(),
  admin_id            uuid not null references public.platform_admins (id) on delete cascade,
  token_hash          text not null unique,
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null,
  last_seen_at        timestamptz not null default now(),
  absolute_expires_at timestamptz not null default (now() + interval '24 hours'),
  revoked_at          timestamptz,
  revoked_reason      text check (revoked_reason is null or char_length(revoked_reason) <= 64),
  constraint platform_sessions_absolute_check check (absolute_expires_at >= created_at)
);

create index platform_sessions_live_idx
  on public.platform_sessions (expires_at)
  where revoked_at is null;
create index platform_sessions_admin_idx on public.platform_sessions (admin_id);

do $$
declare t text;
begin
  foreach t in array array['platform_admins', 'platform_sessions'] loop
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
  if exists (select 1 from pg_roles where rolname = 'aira_app') then
    grant select, insert, update on public.platform_admins to aira_app;
    grant select, insert, update, delete on public.platform_sessions to aira_app;
  end if;
end;
$$;
