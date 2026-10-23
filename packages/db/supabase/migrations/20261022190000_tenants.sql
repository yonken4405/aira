-- Multi-tenancy: subscribing offices as tenants (PRODUCT.md multi-tenant revamp).
--
-- AIRA becomes a platform: many LGU/barangay DRRM offices across the Philippines, each
-- a TENANT onboarded IN PERSON by the AIRA team (no self-serve signup, no billing on the
-- site). A tenant is simply active or suspended. Each tenant owns exactly one LGU office
-- tree (the one-LGU rule is now per-tenant, not per-database).
--
-- Platform operators (superadmins) manage tenants; DRRM users only ever see their own
-- tenant (tenant_id scoping is defense-in-depth over the existing office-subtree scope).

-- 1) Tenants ------------------------------------------------------------------
create table public.tenants (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 2 and 120),
  -- PH administrative region + province, for the nationwide operator map filters.
  region     text not null check (char_length(region) between 2 and 64),
  province   text not null check (char_length(province) between 2 and 64),
  -- Onboarded ("active") or switched off by an operator ("suspended").
  status     text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tenants_region_idx on public.tenants (region);
create index tenants_status_idx on public.tenants (status);
create unique index tenants_name_lower_uniq on public.tenants (lower(name));

create trigger tenants_touch_updated_at
  before update on public.tenants
  for each row
  execute function public.touch_updated_at();

-- 2) Offices gain a tenant owner + region/province for the map -----------------
-- The existing seed has exactly one LGU office; attach it to a default tenant so the
-- NOT NULL add succeeds without a manual backfill (see seed.sql for the fresh-DB path).
insert into public.tenants (id, name, region, province)
values ('7e000000-0000-4000-8000-000000000001', 'Cebu City DRRMO', 'Region VII', 'Cebu')
on conflict (id) do nothing;

alter table public.offices
  add column tenant_id uuid references public.tenants (id) on delete restrict,
  add column region    text check (region is null or char_length(region) between 2 and 64),
  add column province  text check (province is null or char_length(province) between 2 and 64);

update public.offices set tenant_id = '7e000000-0000-4000-8000-000000000001' where tenant_id is null;
alter table public.offices alter column tenant_id set not null;

create index offices_tenant_id_idx on public.offices (tenant_id);

-- 3) One LGU PER TENANT (was one LGU per deployment) ---------------------------
drop index if exists public.offices_one_lgu_per_deployment;
create unique index offices_one_lgu_per_tenant
  on public.offices (tenant_id)
  where kind = 'LGU';

-- 4) Least privilege -----------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.tenants from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.tenants from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke all on public.tenants from service_role;
  end if;
  if exists (select 1 from pg_roles where rolname = 'aira_app') then
    grant select, insert, update on public.tenants to aira_app;
  end if;
end;
$$;
