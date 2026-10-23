-- Citizen account-deletion delete semantics (SECURITY.md §7.5, R10).
--
-- DECISION / NOTE (mobile-citizen-account design §"the one backend addition"):
-- Deleting a citizen identity row from public.citizens must reap every row that
-- belongs to that account, and must leave anonymous reports untouched. This
-- migration records that decision and GUARANTEES the cascade is in place.
--
-- Delete semantics for a citizen account:
--
--   * public.citizen_sessions.citizen_id
--       -> ON DELETE CASCADE. Session rows are reaped with the account, so a
--          deleted account leaves no live or stale session behind. (The service
--          also revokes the current session explicitly; the row deletion is the
--          authoritative removal.)
--
--   * public.citizen_medical_profiles.citizen_id
--       -> ON DELETE CASCADE. There is ONE encrypted medical row per citizen
--          (AES-256-GCM envelope). Emergency CONTACTS are NOT a separate table:
--          they live INSIDE that single encrypted row. Deleting the identity
--          therefore removes the medical row and, with it, every emergency
--          contact. No separate contact delete is needed. (SECURITY.md §8.2)
--
--   * public.incidents.reporter_citizen_id
--       -> ON DELETE SET NULL, BY DESIGN - NOT cascade. Anonymous mesh incidents
--          carry NO citizen_id at all (Tier 0 is PII-free), and online-enriched
--          incidents only hold an out-of-band link. An account delete must never
--          destroy incident history; the link is simply detached. Anonymous
--          incidents are untouched by an account delete. (R10.5, PRODUCT.md §4)
--
-- As of migrations 20261022140000 (citizen_accounts) and 20261022150000
-- (citizen_medical), both dependent FKs were already created WITH
-- `on delete cascade`, so for a schema built from those migrations this file is
-- a no-op confirmation. The guarded blocks below only act if a constraint is
-- somehow missing the cascade, making the cascade intent explicit and the
-- migration safe to run against either shape without erroring.

-- 1) citizen_sessions.citizen_id -> ON DELETE CASCADE (idempotent guard) -------
do $$
begin
  if exists (
    select 1
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'public'
       and t.relname = 'citizen_sessions'
       and c.contype = 'f'
       and c.confrelid = 'public.citizens'::regclass
       and c.confdeltype <> 'c'   -- 'c' = cascade; act only if NOT already cascade
  ) then
    alter table public.citizen_sessions
      drop constraint if exists citizen_sessions_citizen_id_fkey;
    alter table public.citizen_sessions
      add constraint citizen_sessions_citizen_id_fkey
      foreign key (citizen_id) references public.citizens (id) on delete cascade;
  end if;
end;
$$;

-- 2) citizen_medical_profiles.citizen_id -> ON DELETE CASCADE (idempotent guard)
do $$
begin
  if exists (
    select 1
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'public'
       and t.relname = 'citizen_medical_profiles'
       and c.contype = 'f'
       and c.confrelid = 'public.citizens'::regclass
       and c.confdeltype <> 'c'   -- act only if NOT already cascade
  ) then
    alter table public.citizen_medical_profiles
      drop constraint if exists citizen_medical_profiles_citizen_id_fkey;
    alter table public.citizen_medical_profiles
      add constraint citizen_medical_profiles_citizen_id_fkey
      foreign key (citizen_id) references public.citizens (id) on delete cascade;
  end if;
end;
$$;

-- incidents.reporter_citizen_id is intentionally LEFT ALONE: ON DELETE SET NULL
-- is the desired behaviour (anonymous/online incidents survive an account delete).
