-- Responder login by email; callsign becomes an optional display label.
--
-- Callsigns made login hard (operators had to invent + hand out unique ids). Email is
-- the login identifier now - globally unique, matching the citizen tier - while the
-- callsign stays as an OPTIONAL operational display name (map markers, queue, audit,
-- radio) with no uniqueness and no login role.

-- 1) Add the email login key -------------------------------------------------
-- On a fresh deployment the table is empty, so no backfill is needed. On a DB that
-- already holds responders, this backfills a deterministic placeholder derived from the
-- callsign so the NOT NULL + unique add succeeds; operators reset it during migration.
alter table public.responders
  add column email text;

update public.responders
   set email = lower(callsign) || '@placeholder.invalid'
 where email is null;

alter table public.responders
  alter column email set not null,
  add constraint responders_email_check check (char_length(email) between 3 and 254);

-- Globally unique, case-insensitive (one email = one responder account).
create unique index responders_email_lower_uniq on public.responders (lower(email));

-- 2) Callsign becomes optional display-only ----------------------------------
-- Drop the login-era constraints: the inline UNIQUE + length check from the init
-- migration (auto-named responders_callsign_key / responders_callsign_check) and the
-- upper-case check from the hardening migration. The column stays for display; it may
-- be null and need not be unique.
alter table public.responders
  drop constraint if exists responders_callsign_upper_check,
  drop constraint if exists responders_callsign_key,
  drop constraint if exists responders_callsign_check;

alter table public.responders
  alter column callsign drop not null;

-- A present callsign is still bounded; absence is allowed (fall back to email-local-part).
alter table public.responders
  add constraint responders_callsign_len_check
  check (callsign is null or char_length(callsign) between 1 and 32);
