-- AIRA single-lgu-agency-network (PRODUCT.md single-LGU revamp; R3.1, R5.1, R9.1, R10.1/R10.2).
-- New file: every earlier migration is already applied and is never edited (AGENTS.md rule 15).
-- Sorts strictly after 20261022250000_tenant_responder_network.sql.
--
-- This migration is additive and surgical (S1 "soft single-LGU"): the multi-tenant schema
-- (tenants, every tenant_id column, the tenant-bounded OFFICE_SCOPE CTEs) is retained
-- unchanged and simply resolves to the one LGU. It:
--   (a) adds the AGENCY_ADMIN responder role (first-class agency organisations, R3/R4);
--   (b) adds agency_coverage, an office<->agency prioritisation link (R5, prioritisation
--       only, never a hard filter);
--   (c) drops the editable per-tenant capability map (R9) — routing now uses the fixed
--       built-in CATEGORY_AGENCY_DEFAULT in apps/web/src/lib/routing.ts;
--   (d) applies the usual deny-by-default least-privilege grants to the new table.
--
-- Enum-safety note: `alter type ... add value` cannot run in the SAME transaction that then
-- references the new value. This file never references 'AGENCY_ADMIN' (coverage links the
-- agency and office, not the role), so the combined file is safe under `supabase db reset`.
-- If a local stack still rejects the combined file with an "unsafe use of new value" error,
-- split into 20261022260000_add_agency_admin_role.sql + 20261022261000_agency_coverage_...sql
-- (design.md §4). Verified here with `pnpm --filter @aira/db db:reset`.

-- (a) New role: AGENCY_ADMIN (LDRRMO coordinator stays ADMIN; DISPATCHER becomes
--     agency-scoped at the app layer). Idempotent.
alter type public.responder_role add value if not exists 'AGENCY_ADMIN';

-- (b) agency_coverage — the set of offices (barangays/LGU root) an agency normally serves.
--     Both FKs cascade so a removed office or agency never orphans a coverage row (R5.6).
--     Same-LGU consistency is enforced in the service layer (both rows already carry
--     tenant_id); a DB trigger is unnecessary for a single-LGU deployment (design.md §4).
create table public.agency_coverage (
  agency_id  uuid not null references public.agencies (id) on delete cascade,
  office_id  uuid not null references public.offices (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (agency_id, office_id)
);

create index agency_coverage_office_idx on public.agency_coverage (office_id);

-- (c) Drop the editable capability map (R9.1). Routing is now a fixed built-in map; the
--     table, its routes, UI, and client helpers are removed by this feature.
drop table if exists public.tenant_capability_config;

-- (d) Least privilege for the new table. Deny-by-default for the Data API roles (guarded so
--     the migration also runs on vanilla Postgres without the Supabase roles present).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.agency_coverage from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.agency_coverage from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke all on public.agency_coverage from service_role;
  end if;
end;
$$;

-- Coverage is a full-replace set per agency: select to read, insert/delete to replace.
grant select, insert, delete on public.agency_coverage to aira_app;
