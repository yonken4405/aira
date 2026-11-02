-- AIRA tenant-responder-network (PRODUCT.md multi-tenant revamp; R1.*, R2.2/R2.3, R9.1-R9.5).
-- New file: every earlier migration is already applied and is never edited (AGENTS.md rule 15).
--
-- 1) Recreate agencies, tenant-scoped, with a stable Agency_Type (OQ2 = RECREATE / R1 / R9).
--    Today public.agencies is a flat GLOBAL table (id, name, code, active) with no tenant
--    ownership. This feature makes each Tenant own its agency/station rows and adds the
--    closed Agency_Type taxonomy (FIRE | POLICE | MEDICAL | DRRM | OTHER) used as the
--    routing capability key. No pre-existing global agency rows are preserved (R9.1).
-- 2) Per-tenant case-insensitive uniqueness on name/code replaces the global indexes (R1.7-R1.11).
-- 3) tenant_capability_config: normalized per-tenant category -> agency-type mapping (R5.3/R5.4).
-- 4) Least privilege: the same deny-by-default pattern applied to every other business table.

-- 1) Recreate agencies, tenant-scoped, with Agency_Type ------------------------
-- Detach responders first so the drop is clean, then recreate and re-seed, then
-- re-point the FK. Dangling affiliations become DRRM_Generalists (R9.3).
alter table public.responders drop constraint if exists responders_agency_id_fkey;
update public.responders set agency_id = null;              -- dangling -> DRRM_Generalist (R9.3)

drop table if exists public.agencies cascade;               -- drop the global table (OQ2 / R9.1)

create table public.agencies (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,  -- R1.1/R1.2/R1.3
  name        text not null check (char_length(name) between 2 and 64),
  code        text not null check (char_length(code) between 2 and 12),
  agency_type text not null check (agency_type in ('FIRE', 'POLICE', 'MEDICAL', 'DRRM', 'OTHER')), -- R1.4/R1.5
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Per-tenant case-insensitive uniqueness (replaces the dropped global indexes, R1.7-R1.11).
-- Two different tenants may each hold an agency with the same case-insensitive name/code.
create unique index agencies_name_lower_per_tenant_uniq on public.agencies (tenant_id, lower(name));
create unique index agencies_code_lower_per_tenant_uniq on public.agencies (tenant_id, lower(code));
create index agencies_tenant_id_idx on public.agencies (tenant_id);

create trigger agencies_touch_updated_at
  before update on public.agencies
  for each row
  execute function public.touch_updated_at();

-- Re-seed BFP/PNP/EMS/DRRM for the seed tenant with their types (R2.2/R2.3/R9.2/R9.4); any
-- other seed org would be OTHER (R2.3). Codes stay as display-independent identifiers.
insert into public.agencies (tenant_id, name, code, agency_type) values
  ('7e000000-0000-4000-8000-000000000001', 'Bureau of Fire Protection', 'BFP', 'FIRE'),
  ('7e000000-0000-4000-8000-000000000001', 'Philippine National Police', 'PNP', 'POLICE'),
  ('7e000000-0000-4000-8000-000000000001', 'Emergency Medical Services', 'EMS', 'MEDICAL'),
  ('7e000000-0000-4000-8000-000000000001', 'City DRRM Rescue', 'DRRM', 'DRRM');

-- Re-attach the FK (nullable, on delete set null - unchanged semantics, R4.8/R9.3/R9.6).
alter table public.responders
  add constraint responders_agency_id_fkey
  foreign key (agency_id) references public.agencies (id) on delete set null;

-- 2) Per-tenant Capability_Config: a normalized (tenant, category, agency_type) table.
--    Normalized (not JSONB) because the update semantics are "replace the SET for ONE
--    category" (R5.4) - a delete-then-insert per category is exact, and uniqueness is
--    enforceable. A tenant with zero rows => the app applies Default_Capability_Config (R5.3).
create table public.tenant_capability_config (
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  category    text not null check (category in ('SUNOG', 'MEDIKAL', 'KRIMEN', 'BAHA')), -- frozen set
  agency_type text not null check (agency_type in ('FIRE', 'POLICE', 'MEDICAL', 'DRRM', 'OTHER')),
  primary key (tenant_id, category, agency_type)
);

create index tenant_capability_config_tenant_cat_idx
  on public.tenant_capability_config (tenant_id, category);

-- 3) Least privilege ----------------------------------------------------------
-- Deny-by-default for the Data API roles on both new tables. Guarded so the migration
-- also runs on vanilla Postgres without the Supabase roles present.
do $$
declare t text;
begin
  foreach t in array array['agencies', 'tenant_capability_config'] loop
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

-- agencies need update for rename/activate; capability needs insert+delete for the
-- per-category full-replace (delete-then-insert within a transaction).
grant select, insert, update, delete on public.agencies to aira_app;
grant select, insert, update, delete on public.tenant_capability_config to aira_app;
