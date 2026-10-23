-- AIRA auth/RBAC hardening (SECURITY.md §1.4, §4, §5).
--
-- Follow-up to 20261022030655_auth_rbac.sql. Adds:
--   1) a login normalisation guarantee (callsigns are upper-case, so lookups are
--      case-insensitive and unambiguous without a second index);
--   2) the retention job that finally makes "coordinates do not live forever"
--      enforceable now that incidents are persisted (SECURITY.md §1.4/§5.4);
--   3) session pruning, so expired/revoked rows cannot accumulate attacker data.

-- 1) Callsign normalisation ---------------------------------------------------
-- The app normalises at the boundary; this constraint keeps the invariant honest
-- for CLI provisioning and manual SQL. Existing rows are folded first.
update public.responders set callsign = upper(callsign) where callsign <> upper(callsign);

alter table public.responders
  add constraint responders_callsign_upper_check check (callsign = upper(callsign));

-- 2) Coordinate retention ------------------------------------------------------
-- Resolved incidents keep their coordinates for a bounded window, then the whole
-- row is removed (its incident_events cascade). Security-definer so the app role
-- needs no DELETE privilege on incident history: the only deletable shape is a
-- resolved incident past the window. search_path is pinned per SECURITY.md §4.
create or replace function public.prune_resolved_incidents(retain interval default '90 days')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from public.incidents
   where status = 'RESOLVED'
     and resolved_at is not null
     and resolved_at < now() - retain;

  get diagnostics removed = row_count;
  return removed;
end;
$$;

comment on function public.prune_resolved_incidents(interval) is
  'Deletes resolved incidents past the retention window (SECURITY.md §1.4). Run on a schedule.';

-- 3) Session pruning -----------------------------------------------------------
-- Revoked or long-expired sessions carry no value and are removed after a week.
create or replace function public.prune_auth_sessions(retain interval default '7 days')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from public.responder_sessions
   where (revoked_at is not null and revoked_at < now() - retain)
      or (revoked_at is null and absolute_expires_at < now() - retain);

  get diagnostics removed = row_count;
  return removed;
end;
$$;

comment on function public.prune_auth_sessions(interval) is
  'Deletes revoked/expired sessions past the retention window. Run on a schedule.';

-- 4) Least privilege -----------------------------------------------------------
-- The app may only run the two guarded jobs; it still holds no DELETE on the
-- append-only audit tables or on incident rows.
grant execute on function public.prune_resolved_incidents(interval) to aira_app;
grant execute on function public.prune_auth_sessions(interval) to aira_app;
