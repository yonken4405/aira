-- Responder live positions (SECURITY.md §9).
--
-- EPHEMERAL, purpose-bound location. A responder streams a position ONLY while holding
-- an active assignment; there is no ambient, always-on tracking. Stored at 4 dp
-- (~11 m, SECURITY.md §5.1), only the latest fix per (responder, incident), with a
-- short TTL so a stale fix is never served as "live". Pruned on resolve.
--
-- Coordinates here are responder staff positions, not citizen PII, but still obey the
-- no-logging / precision rules of §5.

create table public.responder_positions (
  responder_id uuid not null references public.responders (id) on delete cascade,
  incident_id  uuid not null references public.incidents (id) on delete cascade,
  lat          double precision not null check (lat between -90 and 90),
  lon          double precision not null check (lon between -180 and 180),
  -- Latest fix time; the read side treats anything older than the TTL as stale.
  updated_at   timestamptz not null default now(),
  -- 4 dp storage rule (SECURITY.md §5.1), same as incidents/offices.
  constraint responder_positions_lat_4dp check (lat = round(lat::numeric, 4)::double precision),
  constraint responder_positions_lon_4dp check (lon = round(lon::numeric, 4)::double precision),
  -- One latest fix per responder per incident.
  primary key (responder_id, incident_id)
);

-- Serve "the latest live position for this incident" cheaply.
create index responder_positions_incident_idx
  on public.responder_positions (incident_id, updated_at desc);

-- Prune positions whose incident is resolved or that have gone stale past a window.
-- security-definer so the app needs no broad DELETE: the only deletable shape is a
-- position attached to a resolved incident or older than the retention window.
create or replace function public.prune_responder_positions(retain interval default '1 hour')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from public.responder_positions p
   where p.updated_at < now() - retain
      or exists (
        select 1 from public.incidents i
         where i.id = p.incident_id and i.status = 'RESOLVED'
      );
  get diagnostics removed = row_count;
  return removed;
end;
$$;

comment on function public.prune_responder_positions(interval) is
  'Deletes stale or resolved-incident responder positions (SECURITY.md §9.2). Run on a schedule.';

-- Least privilege: Data API roles denied; app may read/write/delete positions and run
-- the prune job.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.responder_positions from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.responder_positions from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke all on public.responder_positions from service_role;
  end if;
  if exists (select 1 from pg_roles where rolname = 'aira_app') then
    grant select, insert, update, delete on public.responder_positions to aira_app;
    grant execute on function public.prune_responder_positions(interval) to aira_app;
  end if;
end;
$$;
