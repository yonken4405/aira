-- Anonymous incident tracking tokens (SECURITY.md §10).
--
-- Lets an ACCOUNTLESS reporter follow one incident's status + the assigned unit's live
-- position, without any account or PII. The token is opaque (CSPRNG >=128 bits), scoped
-- to exactly ONE incident, expiring, and stored ONLY as a SHA-256 hash. A registered
-- citizen tracks via their session instead (§7/§9) and needs no token.

create table public.incident_tracking_tokens (
  id          uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents (id) on delete cascade,
  -- SHA-256 hex of the opaque token; the plaintext is delivered once to the device.
  token_hash  text not null unique check (char_length(token_hash) = 64),
  created_at  timestamptz not null default now(),
  -- Bounded lifetime; the read side also refuses a token for a resolved incident.
  expires_at  timestamptz not null,
  constraint incident_tracking_tokens_expiry_check check (expires_at > created_at)
);

create index incident_tracking_tokens_incident_idx
  on public.incident_tracking_tokens (incident_id);

-- Prune expired tokens (and those whose incident resolved) on a schedule.
create or replace function public.prune_tracking_tokens(retain interval default '1 hour')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from public.incident_tracking_tokens tt
   where tt.expires_at < now() - retain
      or exists (
        select 1 from public.incidents i
         where i.id = tt.incident_id and i.status = 'RESOLVED'
      );
  get diagnostics removed = row_count;
  return removed;
end;
$$;

comment on function public.prune_tracking_tokens(interval) is
  'Deletes expired / resolved-incident tracking tokens (SECURITY.md §10). Run on a schedule.';

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.incident_tracking_tokens from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.incident_tracking_tokens from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke all on public.incident_tracking_tokens from service_role;
  end if;
  if exists (select 1 from pg_roles where rolname = 'aira_app') then
    grant select, insert, delete on public.incident_tracking_tokens to aira_app;
    grant execute on function public.prune_tracking_tokens(interval) to aira_app;
  end if;
end;
$$;
