-- Citizen medical profile + emergency contacts (SECURITY.md §8).
--
-- Sensitive HEALTH PII. The entire profile is stored as a SINGLE encrypted envelope
-- (AES-256-GCM, app-side) in `ciphertext`; the database never sees plaintext allergies,
-- conditions, medications, blood type, or contact details. Only the owning citizen can
-- read/write it, and a responder sees a minimised snapshot only on-incident
-- (SECURITY.md §8.3, wired in a later task).
--
-- One row per citizen; absence of a row is the normal "no profile" state.

create table public.citizen_medical_profiles (
  citizen_id uuid primary key references public.citizens (id) on delete cascade,
  -- Opaque AES-256-GCM envelope (v1.<nonce>.<tag>.<ciphertext>, base64url). Never
  -- indexed, never searched - it is unreadable without the app key (SECURITY.md §8.2).
  ciphertext text not null check (char_length(ciphertext) between 16 and 20000),
  -- Monotonic version to support optimistic concurrency on the owner's edits.
  version    integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger citizen_medical_touch_updated_at
  before update on public.citizen_medical_profiles
  for each row
  execute function public.touch_updated_at();

-- Least privilege: deny Data API roles, grant the app read/write (no delete needed -
-- clearing a profile overwrites it; account deletion cascades from citizens).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.citizen_medical_profiles from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.citizen_medical_profiles from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke all on public.citizen_medical_profiles from service_role;
  end if;
  if exists (select 1 from pg_roles where rolname = 'aira_app') then
    grant select, insert, update, delete on public.citizen_medical_profiles to aira_app;
  end if;
end;
$$;
