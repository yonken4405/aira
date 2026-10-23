-- Notification system + citizen area linkage (web-ux-and-notifications R9-R16).
--
-- A three-channel notification system (In_App / Email / Web_Push) layered over AIRA's
-- three ISOLATED identity tiers (responders, platform_admins, citizens). Each tier is
-- keyed by its own UUID with NO shared users table and NO foreign key across tiers.
-- A notification recipient is therefore modeled as the pair (recipient_tier,
-- recipient_id): the tier discriminator plus that tier's own principal id. There is
-- deliberately no cross-tier FK on recipient_id (see the comment on
-- public.notifications.recipient_id below) - the (tier, id) pair alone identifies the
-- principal, mirroring how the three identity tiers are separately keyed (R9.4, R9.5).
--
-- All timestamps are timestamptz defaulting to now() (UTC). SQL migrations in
-- packages/db are the schema source of truth; no Supabase Auth (R9.6).

-- 1) Enums --------------------------------------------------------------------
-- The three isolated identity tiers, as a notification recipient discriminator.
create type public.notification_tier as enum ('responders', 'platform_admins', 'citizens');
-- The three delivery channels, In_App first in the fixed send order (R10.8).
create type public.notification_channel as enum ('in_app', 'email', 'web_push');
-- Exactly the delivery-outcome set from R9.2.
create type public.delivery_outcome as enum ('sent', 'failed', 'skipped', 'not_attempted');

-- 2) Notifications ------------------------------------------------------------
create table public.notifications (
  id             uuid primary key default gen_random_uuid(),
  recipient_tier public.notification_tier not null,
  -- The tier-scoped principal id (responders.id | platform_admins.id | citizens.id).
  -- NO cross-tier foreign key: the three identity tiers live in separate tables with
  -- no shared users table, so a single FK cannot reference all three. The
  -- (recipient_tier, recipient_id) pair is the authoritative principal reference
  -- (R9.4, R9.5); isolation is enforced in app logic + the always-(tier,id)-scoped
  -- queries, never by a DB-level FK that would couple the tiers.
  recipient_id   uuid not null,
  type           text not null,
  title          text not null,
  body           text not null,
  data           jsonb not null default '{}',
  critical       boolean not null default false,
  read           boolean not null default false,
  created_at     timestamptz not null default now()
);

-- Reverse-chronological list + unread count, always scoped to one (tier, principal).
create index notifications_recipient_created_idx
  on public.notifications (recipient_tier, recipient_id, created_at desc);

-- 3) Delivery outcomes --------------------------------------------------------
-- One row per channel per notification: the PK (notification_id, channel) enforces
-- exactly one recorded outcome per channel per notification (R10.8).
create table public.notification_deliveries (
  notification_id uuid not null references public.notifications (id) on delete cascade,
  channel         public.notification_channel not null,
  outcome         public.delivery_outcome not null,
  -- true when a Critical_Warning forced delivery on a channel the recipient had
  -- opted out of (R14.4).
  overridden      boolean not null default false,
  recorded_at     timestamptz not null default now(),
  primary key (notification_id, channel)
);

-- 4) Channel preferences ------------------------------------------------------
-- Per-principal per-channel opt-in/opt-out, keyed by the same (tier, id) pair.
-- In_App opt-out for Critical_Warnings is rejected in app logic (R14.5); the column
-- stays a plain boolean here.
create table public.channel_preferences (
  recipient_tier public.notification_tier not null,
  recipient_id   uuid not null,
  in_app         boolean not null default true,
  email          boolean not null default true,
  web_push       boolean not null default true,
  updated_at     timestamptz not null default now(),
  primary key (recipient_tier, recipient_id)
);

create trigger channel_preferences_touch_updated_at
  before update on public.channel_preferences
  for each row
  execute function public.touch_updated_at();

-- 5) Push subscriptions -------------------------------------------------------
-- A browser Web Push subscription bound to exactly one tier principal (R9.4).
create table public.push_subscriptions (
  id             uuid primary key default gen_random_uuid(),
  recipient_tier public.notification_tier not null,
  recipient_id   uuid not null,
  endpoint       text not null,
  p256dh         text not null,
  auth           text not null,
  created_at     timestamptz not null default now(),
  unique (recipient_tier, recipient_id, endpoint)
);

create index push_subscriptions_recipient_idx
  on public.push_subscriptions (recipient_tier, recipient_id);

-- 6) Civilian broadcast audit (R13.7) ----------------------------------------
-- One row per broadcast attempt (accepted or denied), for the audit trail.
create table public.civilian_broadcasts (
  id               uuid primary key default gen_random_uuid(),
  sender_id        uuid not null,
  sender_role      text not null,
  tenant_id        uuid not null references public.tenants (id) on delete cascade,
  granularity      text not null check (granularity in ('tenant', 'barangay')),
  -- The specific barangay office when granularity = 'barangay'; null for whole-tenant.
  -- set null on office delete keeps the audit row intact.
  target_office_id uuid references public.offices (id) on delete set null,
  recipient_count  integer not null default 0,
  outcome          text not null check (outcome in ('accepted', 'denied')),
  -- Populated with the targeting-violation reason when outcome = 'denied'.
  violation        text,
  created_at       timestamptz not null default now()
);

-- 7) System notice audit (R15.6) ---------------------------------------------
-- The platform-tier sender id + UTC timestamp for each system-wide notice.
create table public.system_notices (
  id         uuid primary key default gen_random_uuid(),
  sender_id  uuid not null,
  created_at timestamptz not null default now()
);

-- 8) Citizen area linkage (R13.4) --------------------------------------------
-- Civilian-broadcast targeting resolves recipients through the OFFICE_SCOPE recursive
-- CTE (bounded by tenant_id). Citizens currently carry no office/tenant membership, so
-- add a nullable area linkage: an area-bound citizen can then be resolved as a
-- recipient when their office falls within the sender's Office_Subtree. Nullable
-- because existing/anonymous citizens have no area; only area-bound citizens receive
-- scoped broadcasts. on delete set null preserves the citizen if the area is removed.
alter table public.citizens
  add column tenant_id uuid references public.tenants (id) on delete set null,
  add column office_id uuid references public.offices (id) on delete set null;

-- Partial indexes: only area-bound citizens participate in scope resolution.
create index citizens_tenant_id_idx on public.citizens (tenant_id) where tenant_id is not null;
create index citizens_office_id_idx on public.citizens (office_id) where office_id is not null;

-- 9) Least privilege ----------------------------------------------------------
-- Deny-by-default for the Supabase Data API roles (guarded so this also runs on
-- vanilla Postgres without those roles); the app role gets only what it needs.
do $$
declare t text;
begin
  foreach t in array array[
    'notifications', 'notification_deliveries', 'channel_preferences',
    'push_subscriptions', 'civilian_broadcasts', 'system_notices'
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
end;
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'aira_app') then
    -- notifications: insert (create), select (list/count), update (read-state).
    grant select, insert, update on public.notifications to aira_app;
    -- deliveries: insert one outcome per channel, select for audit.
    grant select, insert on public.notification_deliveries to aira_app;
    -- preferences: insert + update (upsert), select.
    grant select, insert, update on public.channel_preferences to aira_app;
    -- subscriptions: insert/select + delete for unsubscribe.
    grant select, insert, update, delete on public.push_subscriptions to aira_app;
    -- audit tables: insert + select only.
    grant select, insert on public.civilian_broadcasts to aira_app;
    grant select, insert on public.system_notices to aira_app;
  end if;
end;
$$;
