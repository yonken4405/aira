-- AIRA auth + RBAC (PRODUCT.md §1/§4, SECURITY.md §4-§6).
-- New file: the init migration is already applied and is never edited.
--
-- 1) Role rename: UNIT (field team account) -> RESPONDER. Display names live in the
--    app's i18n, not in the database.
-- 2) agencies: root-admin CRUD list of responding organizations (BFP, PNP, EMS, ...).
-- 3) offices: one LGU root + barangays, per RA 10121 Sec. 12/15 (jurisdiction,
--    supervision of response teams, escalation from barangay to city).
-- 4) responders: office/agency scope, login lockout, forced password change.
-- 5) responder_sessions: sliding idle window + absolute expiry + revoke reason.
-- 6) incidents: jurisdiction office + assignment attribution.
-- 7) Append-only audit: auth_events, incident_events.
-- 8) Least-privilege app role (aira_app) and revocations for the Data API roles.

-- 1) Role rename --------------------------------------------------------------
alter type public.responder_role rename value 'UNIT' to 'RESPONDER';

-- 2) Agencies (CRUD) ----------------------------------------------------------
create table public.agencies (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 2 and 64),
  code       text not null check (char_length(code) between 2 and 12),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Case-insensitive uniqueness keeps "BFP" and "bfp" from both existing.
create unique index agencies_name_lower_uniq on public.agencies (lower(name));
create unique index agencies_code_lower_uniq on public.agencies (lower(code));

create trigger agencies_touch_updated_at
  before update on public.agencies
  for each row
  execute function public.touch_updated_at();

-- 3) Offices (jurisdiction) ---------------------------------------------------
create table public.offices (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 2 and 96),
  kind       text not null check (kind in ('LGU', 'BARANGAY')),
  parent_id  uuid references public.offices (id) on delete restrict,
  -- Optional centroid of the barangay hall / poblacion. Used only to route KRIMEN
  -- intake to the nearest tanod jurisdiction (no geofence tables). Not citizen PII.
  lat        double precision check (lat between -90 and 90),
  lon        double precision check (lon between -180 and 180),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint offices_kind_parent check (
    (kind = 'LGU' and parent_id is null) or
    (kind = 'BARANGAY' and parent_id is not null)
  ),
  -- Same 4 dp storage rule as incidents - SECURITY.md §5.
  constraint offices_lat_4dp check (lat is null or lat = round(lat::numeric, 4)::double precision),
  constraint offices_lon_4dp check (lon is null or lon = round(lon::numeric, 4)::double precision)
);

create unique index offices_name_lower_uniq on public.offices (lower(name));
-- One deployment serves one LGU (PRODUCT.md §1).
create unique index offices_one_lgu_per_deployment on public.offices (kind) where kind = 'LGU';
create index offices_parent_id_idx on public.offices (parent_id) where parent_id is not null;

create trigger offices_touch_updated_at
  before update on public.offices
  for each row
  execute function public.touch_updated_at();

-- 4) Responder scope + lockout ------------------------------------------------
-- The table is empty at this point in a fresh deployment, so the NOT NULL columns
-- need no backfill. On a DB that already holds rows this fails loudly on purpose.
alter table public.responders
  add column office_id uuid not null references public.offices (id) on delete restrict,
  add column agency_id uuid references public.agencies (id) on delete set null,
  add column must_change_password boolean not null default false,
  add column failed_attempts integer not null default 0,
  add column locked_until timestamptz,
  add column last_login_at timestamptz,
  add constraint responders_failed_attempts_check check (failed_attempts >= 0);

create index responders_office_id_idx on public.responders (office_id);
create index responders_agency_id_idx on public.responders (agency_id) where agency_id is not null;

-- 5) Session hardening --------------------------------------------------------
alter table public.responder_sessions
  add column last_seen_at timestamptz not null default now(),
  add column absolute_expires_at timestamptz not null default (now() + interval '24 hours'),
  add column revoked_reason text,
  add constraint responder_sessions_absolute_check check (absolute_expires_at >= created_at),
  add constraint responder_sessions_reason_check check (revoked_reason is null or char_length(revoked_reason) <= 64);

-- Supports the admin session view and cleanup of expired rows.
create index responder_sessions_live_idx
  on public.responder_sessions (expires_at)
  where revoked_at is null;

-- 6) Incidents: jurisdiction + attribution ------------------------------------
alter table public.incidents
  add column office_id uuid not null references public.offices (id) on delete restrict,
  add column assigned_by_id uuid references public.responders (id) on delete set null;

create index incidents_office_status_reported_idx
  on public.incidents (office_id, status, reported_at desc);

-- 7) Append-only audit ---------------------------------------------------------
-- No update/delete grants are given to these tables: history is written, never rewritten.
create table public.auth_events (
  id           uuid primary key default gen_random_uuid(),
  responder_id uuid references public.responders (id) on delete set null,
  session_id   uuid references public.responder_sessions (id) on delete set null,
  event        text not null check (event in (
    'LOGIN_SUCCESS', 'LOGIN_FAILURE', 'ACCOUNT_LOCKED', 'LOGOUT', 'SESSION_REVOKED',
    'PASSWORD_CHANGED', 'ACCOUNT_CREATED', 'ACCOUNT_UPDATED', 'ROLE_CHANGED'
  )),
  -- Present for attempts against callsigns that do not exist. Never citizen PII:
  -- civilians hold no accounts (PRODUCT.md §1).
  callsign     text,
  detail       text check (detail is null or char_length(detail) <= 200),
  created_at   timestamptz not null default now()
);

create index auth_events_created_at_idx on public.auth_events (created_at desc);
create index auth_events_responder_id_idx on public.auth_events (responder_id) where responder_id is not null;

create table public.incident_events (
  id             uuid primary key default gen_random_uuid(),
  incident_id    uuid not null references public.incidents (id) on delete cascade,
  actor_id       uuid references public.responders (id) on delete set null,
  event          text not null check (event in (
    'INTAKE', 'ROUTED', 'ESCALATED', 'ASSIGNED', 'REASSIGNED', 'STATUS', 'NOTE'
  )),
  from_office_id uuid references public.offices (id) on delete set null,
  to_office_id   uuid references public.offices (id) on delete set null,
  from_status    public.incident_status,
  to_status      public.incident_status,
  -- Sanitized operational detail. Never coordinates (SECURITY.md §5).
  detail         text check (detail is null or char_length(detail) <= 200),
  created_at     timestamptz not null default now()
);

create index incident_events_incident_created_idx on public.incident_events (incident_id, created_at desc);

-- 8) Least privilege ----------------------------------------------------------
-- Deny-by-default for the Data API roles on every business table, including the new
-- ones. Guarded so the migration also runs on vanilla Postgres without Supabase roles.
do $$
declare t text;
begin
  if to_regclass('public.incident_events') is not null then
    foreach t in array array[
      'agencies', 'offices', 'responders', 'responder_sessions',
      'incidents', 'auth_events', 'incident_events'
    ] loop
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
  end if;
end;
$$;

-- The app's own least-privilege role. It has no password: the web app connects as a
-- superuser locally, and production wiring will use this role with a real secret.
-- Audit tables are append-only through it; only responder_sessions can be deleted
-- (logout removes the row). No rights on mock_dispatch_status: mocks are gone.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'aira_app') then
    create role aira_app nologin;
  end if;
end;
$$;

grant usage on schema public to aira_app;
grant select, insert, update on
  public.agencies, public.offices, public.responders, public.responder_sessions,
  public.incidents, public.auth_events, public.incident_events
  to aira_app;
grant delete on public.responder_sessions to aira_app;
