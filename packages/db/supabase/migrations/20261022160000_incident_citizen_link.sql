-- Online-enriched SOS: link an incident to its reporting citizen (SECURITY.md §7/§8).
--
-- The mesh payload stays anonymous and PII-free (PRODUCT.md §4). This link is attached
-- OUT OF BAND, only when a logged-in citizen submits over the internet, so a responder
-- assigned to the incident can be granted an on-incident, need-to-know medical reveal.
-- It is nullable: the anonymous Tier 0 path never sets it.

alter table public.incidents
  add column reporter_citizen_id uuid references public.citizens (id) on delete set null;

create index incidents_reporter_citizen_idx
  on public.incidents (reporter_citizen_id)
  where reporter_citizen_id is not null;

-- Audit a responder reveal of a citizen's medical snapshot (SECURITY.md §8.3). The
-- detail never contains the profile body or coordinates - only that a reveal happened.
alter table public.incident_events
  drop constraint if exists incident_events_event_check;

-- Recreate the event check including MEDICAL_ACCESS. (The original constraint name is
-- the table + column + _check default; we re-add with the same semantics plus the new
-- value so history is append-only and fully typed.)
do $$
begin
  if exists (
    select 1 from information_schema.table_constraints
     where table_schema = 'public'
       and table_name = 'incident_events'
       and constraint_type = 'CHECK'
       and constraint_name = 'incident_events_event_check'
  ) then
    alter table public.incident_events drop constraint incident_events_event_check;
  end if;

  alter table public.incident_events
    add constraint incident_events_event_check check (event in (
      'INTAKE', 'ROUTED', 'ESCALATED', 'ASSIGNED', 'REASSIGNED', 'STATUS', 'NOTE',
      'MEDICAL_ACCESS'
    ));
end;
$$;
