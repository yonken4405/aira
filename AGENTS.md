# AGENTS.md: AIRA Repository Context (read this FIRST)

> This file is the durable context hand-off for AI coding agents (OpenCode) and new engineers.
> It summarizes the governing documents. **Read the full files before making non-trivial changes.**
>
> | Document                     | Governs                                                         |
> | ---------------------------- | --------------------------------------------------------------- |
> | [PRODUCT.md](./PRODUCT.md)   | What we build, what is permanently removed, mesh payload format |
> | [DESIGN.md](./DESIGN.md)     | Operate Mode design system, tokens, mobile/web UI specs         |
> | [SECURITY.md](./SECURITY.md) | PII, encryption, input handling, RBAC, GPS rules                |
> | [TESTING.md](./TESTING.md)   | TDD mandate, test matrix, definition of done                    |
>
> `OpenCode.md` points here. **This file is the source of truth.**

---

## What this repo is

**AIRA (AI Responsive Alert)** is a resilient, offline-capable emergency reporting platform.

- `apps/mobile`: React Native/Expo citizen app. Offline-first, Android-first, **< 30 MB**.
  MVP screen: the 4-button SOS grid (Fire/Sunog, Medical/Medikal, Crime/Krimen, Flood/Baha) that logs the
  compressed mesh payload on press.
- `apps/web`: Next.js (App Router) responder console: live MapLibre map, incoming queue sidebar,
  responder routing panel. Skeletons on load, one unified toast system, confirmation dialogs, short-TTL
  private caching.
- `packages/ui` holds the shared core: category model, payload builder/validator (`buildSosPayload`,
  `serializeSosPayload`, `parseSosPayload`), i18n strings (`t()`, English primary), `cn()` helper, plus
  `@aira/ui/web` shadcn-style primitives (Button, EmergencyIcon/Lucide, Skeleton, Toast, ConfirmDialog).
- `packages/tailwind-config`: the **single shared Tailwind preset** (tokens) used by web + mobile.
- `packages/typescript-config`: shared strict tsconfig bases.
- `packages/db`: PostgreSQL via **Supabase CLI** (local stack + SQL migrations); Prisma is an optional
  typed client. **Not wired into the apps.** Supabase Auth is disabled, so AIRA owns authentication
  and the DB stays portable.

## Toolchain (pinned; do not bump casually)

Turborepo 2.11 · pnpm 12 workspaces (`node-linker=hoisted`) · Next.js 16.4 · React 19.3 ·
Tailwind CSS **3.4** (required by NativeWind) · Expo SDK 58 / RN 0.88 / NativeWind 4 ·
Vitest 5 (web + shared) · jest-expo 58 (mobile) · TypeScript 5.9 **strict** · Prisma 7.10 (optional
client) · Supabase CLI 2.121 (`packages/db` only) · Lucide icons · Radix primitives (alert dialog) · CVA.

```bash
pnpm install
pnpm dev            # turbo: web (next) + mobile (expo) concurrently
pnpm check          # typecheck + tests: run before claiming anything done
pnpm build          # build all
pnpm test           # all tests

pnpm --filter @aira/db db:start   # local Postgres (Docker required, not needed for check/build)
pnpm --filter @aira/db db:reset   # apply supabase/migrations/*.sql
```

---

## Hard rules for agents working here

1. **NO voice/STT, NO chat, NO LLM/AI features.** See PRODUCT.md §2: permanently removed. Do not add
   microphone/audio/recorder packages, transcript logic, chat UI, or AI SDKs "for later".
2. **Follow Operate Mode** (DESIGN.md): no gradients, glass, glow, bounce, mascots, decorative motion.
   Category color only where DESIGN.md allows. Use tokens from `@aira/tailwind-config`; no ad-hoc hex.
3. **SOS wording is fixed:** `SUNOG` (Fire), `MEDIKAL` (Medical), `KRIMEN` (Crime), `BAHA` (Flood).
   **English is the primary UI language; the Bisaya word is the secondary line** (Tagalog/Bisaya locales
   ship later via `@aira/ui` i18n; never by hardcoding strings in components).
4. **Mesh payload format is frozen:** `["SUNOG", 10.3157, 123.8854]`: positional, 3 elements,
   4 dp coordinates, zero PII. The IDs stay Bisaya but are identifiers, never display text. Always go
   through `@aira/ui` helpers; never re-implement or extend it.
5. **Security first** (SECURITY.md): zero PII in the **mesh payload** (always), deny-by-default RBAC,
   validation at every boundary, no coordinates in logs, no secrets in source. The optional
   registered-citizen tier introduces PII (identity/medical/live-location) **only** under the strict
   controls in SECURITY.md §7-§11 (encryption at rest, on-incident need-to-know reveal, ephemeral
   incident-scoped positions, opaque expiring tracking tokens). Never widen those.
6. **TDD/test-adjacent is mandatory** (TESTING.md): unit tests for utils, integration tests for API
   routes, component tests for UI, before any task is marked complete. `pnpm check` must be green.
7. **Backend scope (revised 2026-10-22).** The revamp (PRODUCT.md §1a/§1b/§5) puts the following
   explicitly **in scope**: wiring the DB into `apps/web`, live dispatch state, nearest-responder
   routing, citizen accounts + medical profiles, live responder position via **short-interval
   polling**, and anonymous tracking tokens. Still out of scope / separate: **WebSockets/SSE** (polling
   only for now), real LoRa/Bluetooth radio (hardware track), the responder mobile app (specced, built
   later), and anything in PRODUCT.md §2. Build to the documented interfaces; do not invent transports
   or persistence beyond what a task names.
8. **Offline-first tiering is law** (PRODUCT.md §1b). Classify every feature Tier 0 (mesh-only,
   anonymous SOS) / Tier 1 (local mesh) / Tier 2 (online enrichment). A Tier 2 feature must degrade to
   an honest "unavailable" state and must **never** block a Tier 0 action. The anonymous mesh payload
   is frozen and PII-free in every tier (rule 4).
9. **Code to `MeshTransport`.** Apps talk to the mesh only through the `MeshTransport` abstraction
   (send/subscribe/relay) with the mock implementation today. The real LoRa/Bluetooth radio is a
   separate, flagged hardware track; never inline radio/hardware code into app/console tasks.
10. **No new dependencies without checking**: verify version + peer deps on the registry first, install
    only what is needed, and keep the install-script allow-list (`pnpm-workspace.yaml`) minimal.
11. **Strict TypeScript**: keep `strict` + `noUncheckedIndexedAccess` errors clean; no `any`, no
    `@ts-ignore` (use `@ts-expect-error` with a reason if truly unavoidable).
12. **Never delete/rewrite these five markdown files** to make a task easier; they are the guardrails.
13. **UI states are not optional** (DESIGN.md §6): every async surface gets a layout-shaped skeleton, every
    asynchronous outcome goes through `useToast()`, irreversible actions go through `ConfirmDialog`.
    Icons come from Lucide via `@aira/ui/web`; no hand-rolled shapes, no emoji.
14. **Caching stays private and short-lived** (SECURITY.md §5): memory-only client TTL (10 s) with
    in-flight de-duplication; `Cache-Control: private, max-age=5, stale-while-revalidate=25`. Never
    `public`-cache or log coordinates.
15. **Supabase is a Postgres provider only** (SECURITY.md §4): Supabase Auth/Data API/Storage are
    disabled; no `@supabase/supabase-js` in the apps; no `service_role`/`anon` keys. Schema changes go
    through `supabase/migrations/*.sql`; Prisma never owns migrations.

---

## Change log (architectural decisions)

### 2026-11-03: **Single-LGU agency network (first-class agencies, coverage, coordination-only LDRRMO)**

- **Decision:** AIRA is repositioned as a **single-LGU product** (not a multi-tenant SaaS UI) in which
  **responding agencies are first-class organizations** cooperating under the LDRRMO's RA 10121
  **notify-and-coordinate** model. This is the **"soft single-LGU" (S1)** approach: the multi-tenant
  `tenants` / `tenant_id` columns and the tenant-bounded `OFFICE_SCOPE` CTEs are **retained unchanged**
  as defense-in-depth and simply resolve to the one LGU; only the multi-tenant **UX** is retired.
- **New role `AGENCY_ADMIN`** (added to the `responder_role` enum). The role model is now:
  `RESPONDER` (own assignments) · `DISPATCHER` (**agency-scoped**: reads/assigns only its own agency's
  units for incidents routed to that agency) · `AGENCY_ADMIN` (manages ONE agency's accounts + coverage,
  reads its own agency's incidents read-only, never dispatches) · `ADMIN` = **LDRRMO coordinator**
  (LGU-wide READ-ONLY oversight, sees all agencies, may send a coordination nudge, **never dispatches** —
  separation of duties). The principal + `Viewer` now carry `agencyId`/`agencyName`. UI copy relabels
  `ADMIN` as "LDRRMO coordinator".
- **A responder belongs to exactly one office (required) and one agency.** Agency is **required at the
  service layer** for every provisioned account (`provisionResponder`); the DB `agency_id` stays nullable
  to preserve the "DRRM generalist = null" routing semantics and the break-glass path.
- **Office↔agency coverage** (`agency_coverage(agency_id, office_id)`, new table) drives routing
  **prioritization only** — cross-jurisdiction response is allowed, ranked lower. Coverage is never an
  access control or hard filter.
- **Removed the editable capability map** (`tenant_capability_config` dropped; its UI, routes, client
  helpers, and i18n keys deleted). Routing now uses a **fixed built-in `CATEGORY_AGENCY_DEFAULT`** in
  `apps/web/src/lib/routing.ts` (`SUNOG→[FIRE], MEDIKAL→[MEDICAL], KRIMEN→[POLICE], BAHA→[]`), preserving
  today's default behavior exactly.
- **Retired the operator (platform) UX.** The `/platform` console pages and the operator
  tenant/office/agency/capability/responder **management** routes are removed, and `/login` no longer
  retries a platform login. The **break-glass superadmin tier is kept**: `platform_admins` /
  `platform_sessions`, the `platform:create-admin` CLI, and the `/api/platform/{login,session}` plumbing
  stay (the shipped notification / system-notice tier still authenticates through `authenticatePlatform`),
  but there is **no web console**.
- **New surfaces:** agency-scoped dispatch (routing suggestions + assign bounded to the dispatcher's own
  agency), a users/**org view** (`GET /api/admin/org`, scoped), a **coverage editor**
  (`GET/PUT /api/admin/agencies/[id]/coverage`), and an LDRRMO **coordination nudge**
  (`POST /api/admin/coordination/nudge`, coordinate-free). Fixed a latent bug: the admin roster's agency
  list is now **tenant-filtered** (`listAgencies(tenantId)`).
- **Schema:** one new migration
  `packages/db/supabase/migrations/20261022260000_single_lgu_agency_network.sql` (adds `AGENCY_ADMIN`,
  creates `agency_coverage`, drops `tenant_capability_config`, deny-by-default grants). Earlier migrations
  left byte-for-byte unchanged; verified under `db:reset`.
- **Impact recorded in docs:** PRODUCT.md, SECURITY.md, DESIGN.md, this log.
- **Not done (deliberately):** no second LGU / cross-LGU flows, no change to the frozen mesh payload or
  anonymous Tier-0 intake, and nothing from the out-of-scope tracks (WebSockets/SSE, real radio, responder
  mobile app, billing). TanStack Query was not introduced (not yet a dependency; existing hand-rolled
  client loaders retained per the web-data-fetching steering).

### 2026-10-22: **Tenant responder network (agencies, staffing, per-tenant capability)**

- **Decision:** a tenant now owns **its own agencies** and configures **its own** category→agency
  routing capability, instead of a flat global agency list and a hardcoded map. `public.agencies` is
  **recreated** tenant-scoped (`tenant_id NOT NULL`, per-tenant case-insensitive `name`/`code`
  uniqueness) and carries an **Agency_Type** from a stable closed taxonomy
  `{FIRE, POLICE, MEDICAL, DRRM, OTHER}` defined once in `packages/ui/src/agency-types.ts` and mirrored
  by a DB `CHECK`. A responder is staffed into a specific office + optional agency (both must share the
  acting tenant; an inactive/cross-tenant agency is refused); a no-agency responder is a DRRM
  generalist (`agency_id null`) capable of every category.
- **Capability_Config:** a per-tenant `tenant_capability_config` table maps each Emergency_Category to
  a set of capable Agency_Types; the pure `Routing_Engine` reads it plus each candidate's Agency_Type.
  The shipped **DEFAULT equals the legacy hardcoded mapping** (`SUNOG→[FIRE]`, `MEDIKAL→[MEDICAL]`,
  `KRIMEN→[POLICE]`, `BAHA→[]`), so **routing is unchanged under defaults**; an empty set means only
  DRRM generalists respond.
- **Two-tier authority, isolated server-side:** a **Platform_Operator** manages any tenant via
  `/api/platform/*` (acting tenant = explicit URL `tenantId`); a **DRRM_Admin** manages its own tenant
  only via `responder:manage` on `/api/admin/*` (acting tenant from the session, never a URL). Both
  call one shared tenant-scoped service; scope is deny-by-default and SQL-bounded. Cross-tenant rules:
  operator allowed across tenants; DRRM_Admin known-other-tenant → `403`, not-visible-in-tenant →
  `404`. The whole surface is **coordinate-free** (no coordinates in any request/response/error/log/
  audit) and Tier 2 (degrades to "unavailable" offline, never blocks Tier-0 SOS).
- **UI:** operator `AgencyNetworkPanel` (per-tenant, off `PlatformTenants`) and DRRM_Admin
  `AdminAgencyNetwork` (admin accounts tab), both Operate Mode: Skeleton on first load, unified toast
  outcomes, `ConfirmDialog`-gated deactivate, Lucide icons via `@aira/ui/web`, copy via `t()`.
  Agency_Type tokens are identifiers; labels resolve only through `t()`.
- **Schema:** one new migration `packages/db/supabase/migrations/20261022250000_tenant_responder_network.sql`
  (sorts after the prior latest on this branch, `20261022230000_...`); earlier migrations left
  byte-for-byte unchanged; `aira_app` gets the usual deny-by-default least-privilege grant; no Supabase
  Auth, no new keyed provider.
- **Impact recorded in docs:** PRODUCT.md §1c/§5, SECURITY.md §14, DESIGN.md §5a, this log.
- **Not done (deliberately):** no second LGU per tenant, no cross-tenant move/reparent, no change to the
  frozen mesh payload or anonymous Tier-0 intake (still resolves the first active LGU), and nothing from
  the out-of-scope tracks (WebSockets/SSE, real radio, responder mobile app, billing).

### 2026-10-22: **Web UX overhaul + three-channel notifications**

- **Decision:** the `apps/web` console gets a UI/IA overhaul plus a full notification system.
- **Theming:** design colors move from raw hex in `packages/tailwind-config` to **CSS-variable
  tokens** resolved per theme; a `data-theme="light|dark"` strategy with a pre-paint script
  (no FOUC), a `light`/`dark`/`system` toggle persisted in `localStorage['aira-theme']`, and
  WCAG AA light/dark pairings. Existing utility class names (`bg-ink`, `text-fg`, `text-status-*`,
  `emergency-*`) resolve unchanged.
- **App_Shell + IA consolidation:** one shared `App_Shell` and `NavLink` replace the hand-rolled
  `AdminHeader`/`PlatformHeader`/inline `Dashboard` header (zero legacy header usages). The four
  flat admin routes collapse into one deep-linkable **tabbed admin surface** (accounts / metrics /
  audit, each permission-gated); `/admin/overview` redirects to the shared map+queue
  (`IncidentConsole`); the chrome-less `/account/password` moves under the shell.
- **Common features:** **Profile**, **Settings** (theme + per-channel notification preferences),
  and a **Notification Center** (header bell + unread badge) on every authenticated tier.
- **Three-channel notification engine:** in-app (persisted) + email (Gmail SMTP, nodemailer) +
  web push (VAPID, `web-push` + `apps/web/public/sw.js`), sent **synchronously, fail-soft** inside
  the originating request (a channel failure never changes the action's result). Addressed to a
  `(tier, principal_id)` pair with **no shared user FK**; tenant-scoped sends resolve through the
  `OFFICE_SCOPE` CTE and deny out-of-subtree targeting atomically. New `civilian-broadcast`
  permission (DISPATCHER + ADMIN) and platform-tier `PLATFORM_CAN_SYSTEM_NOTICE` capability; the
  `CRITICAL_FORCES_ALL_CHANNELS` policy constant forces critical warnings past opt-out (in-app
  always forced). Schema is new SQL migrations in `packages/db` (no Supabase Auth).
- **Primitives + polish:** new accessible `Textarea`/`Checkbox`/`Radio`/`Switch`, auto-wired
  `Field` error a11y, and unified **toast / confirm / loading** coverage (logout toasts, confirm
  gating on suspend/status/unlock/activate/broadcast/notice, route-level skeletons).
- **New env + deps:** `SMTP_*` and `VAPID_*` (optional; documented in `apps/web/.env.example` and
  the `apps/web` README, no real secrets); `nodemailer` + `web-push`, isolated behind sender ports.
- **Impact recorded in docs:** PRODUCT.md, DESIGN.md, SECURITY.md §13, `apps/web` README +
  `.env.example`, this log.

### 2026-10-22: **Multi-tenant platform + email login**

- **Decision:** AIRA is multi-tenant SaaS. Many LGU/barangay DRRM offices are **tenants**,
  onboarded **in person** (no self-serve signup, no billing on the site); a tenant is
  `active`/`suspended`. The one-LGU rule is now per-tenant. Cross-tenant isolation is
  deny-by-default and hard-bounded in SQL (office-subtree scope carries `tenant_id`).
- **Platform-operator tier:** a third identity tier (`platform_admins` + own session
  cookie `aira_platform_session`) with **zero incident/citizen access**. It manages
  tenants/offices, views a nationwide office-pin map (filter by region, search by name),
  and bootstraps each tenant's first DRRM admin. First operator is CLI-provisioned
  (`platform:create-admin`); no public signup. Separation of duties: it cannot dispatch
  or read citizen data.
- **Login is by email:** responders and platform operators sign in by email (argon2id +
  lockout). The responder **callsign is now an optional display label** (map/queue/radio),
  not a credential and not unique; display falls back to the email local-part.
- **Single login page (UX, 2026-10-22):** `/login` is the one front door. The form tries the
  responder login, and on a plain `invalid` 401 retries the platform login, routing the user to
  their tier's console. A lockout/rate-limit/outage is authoritative and is **not** retried. The
  tiers stay fully isolated server-side (separate tables/sessions/cookies); only the UI is unified.
  The old `/platform/login` route now just redirects to `/login`.
- **Impact recorded in docs:** PRODUCT.md §1-multitenant/§1, SECURITY.md §4/§12, this log.
- **Not done (deliberately):** no billing/payment integration (in-person onboarding), no
  anonymous-mesh tenant routing yet (intake still resolves the first active LGU).

### 2026-10-22: **Offline-first revamp: two-tier citizen, DRRM dispatch, live tracking**

- **Decision:** AIRA becomes an offline-first DRRM 911 dispatch platform with a two-tier citizen model.
  Tier 0 (anonymous mesh SOS) is the frozen survival core and never depends on a server; an optional
  registered-citizen tier adds email/device-key identity, an opt-in encrypted **medical profile**, and
  an in-app **tracking view**. Registration is never a login wall (PRODUCT.md §6).
- **Dispatch:** dispatchers get **nearest-responder routing suggestions** (distance + category→agency
  capability + barangay jurisdiction, over the existing office hierarchy/centroids). **Admin = DRRM
  officer** gains read-only live map + oversight dashboards but still cannot dispatch (separation of
  duties; the ADMIN incident permissions are read-only + metrics).
- **Tracking:** responders stream an **ephemeral, incident-scoped** GPS position via **short-interval
  polling** (no WebSocket/SSE yet); dispatchers and the reporting citizen (via an **opaque, expiring,
  single-incident token**) see it. Medical info is revealed to the assigned responder **on-incident,
  need-to-know, audit-logged, auto-revoked on resolve**.
- **Navigation:** responder "Navigate" **deep-links to Google Maps** (coordinates only, no PII, no
  SDK). The responder mobile app/mode is **specced now, built later**; responders act from the web
  console until then.
- **Mesh:** apps code to a `MeshTransport` abstraction with a **mock** implementation; real
  LoRa/Bluetooth is a **separate flagged hardware track** and never blocks app/console work.
- **Impact recorded in docs:** PRODUCT.md §1/§1a/§1b/§5/§6, SECURITY.md §1/§7-§11, DESIGN.md
  (responder mobile mode, civilian tracking view, admin dashboards, offline states, live markers),
  AGENTS.md rules 5/7/14/15.

### 2026-10-22: **English-primary UI, Lucide/shadcn UI kit, async states, caching**

- **Decision:** English is the primary product language on both surfaces. Bisaya (`Sunog`/`Medikal`/
  `Krimen`/`Baha`) remains visible as the secondary label; Tagalog/Bisaya locales are a later dictionary
  phase. Payload IDs stay `SUNOG|MEDIKAL|KRIMEN|BAHA` (frozen wire format, never display text).
- **Copy centralization:** `packages/ui/src/i18n.ts` (`t()`, `categoryLabel()`): `AVAILABLE_LOCALES`
  ships `['en']`; `ceb`/`tl` dictionaries are scaffolded and fall back to English.
- **Icons:** hand-rolled shape markers / colored divs replaced with **Lucide** (shadcn's icon set) via
  `@aira/ui/web` → `EmergencyIcon` (Flame, HeartPulse, ShieldAlert, Waves).
- **UI kit:** shadcn-style primitives in `packages/ui/src/web/ui/`: `Button` (CVA variants), `Skeleton`,
  unified `ToastProvider`/`useToast`, `ConfirmDialog` (Radix AlertDialog). `PrimaryButton` removed.
- **Async UX:** layout-shaped skeletons on first load (queue/map/routing), refresh keeps rows visible with
  a spinner, blocking failure renders an error state with retry, dispatch is confirmation-gated and
  reports through the toast surface.
- **Caching:** client TTL cache (10 s) + in-flight de-duplication (`apps/web/src/lib/cache.ts`,
  `incidents-client.ts`); `GET /api/incidents` is `private, max-age=5, stale-while-revalidate=25`.
- **Impact recorded in docs:** PRODUCT.md §1/§3/§5, DESIGN.md §2-§7, SECURITY.md §5-§6, TESTING.md §2/§4,
  AGENTS.md rules 3/7/11-13.

### 2026-10-22: **Database: Supabase CLI, auth stays ours**

- **Decision:** `packages/db` uses the **Supabase CLI** for local Postgres + versioned SQL migrations
  (`supabase/config.toml`, `supabase/migrations/*.sql`). Prisma remains an optional typed client
  (`db:pull`/`generate`); it never owns migrations. `docker-compose.yml` removed.
- **Auth is NOT Supabase Auth:** `auth`, `storage`, `realtime`, `studio`, `edge_runtime` and `analytics`
  are disabled in the local stack. Responders authenticate against our own `responders` +
  `responder_sessions` tables (argon2id hashes, hashed opaque tokens), with no `auth.users` FK and no
  Supabase JWT - so the DB can move to any Postgres host without touching the apps.
- **Why:** portability (smooth DB migration), one tool for local dev + migrations, and no vendor lock-in
  on identity.
- **Impact recorded in docs:** PRODUCT.md §1/§5, SECURITY.md §4-§6, AGENTS.md rule 13, `packages/db/README.md`.
- **Not done (deliberately):** no auth implementation, no app→DB wiring, no RLS policies (Data API roles
  are revoked; the backend will use a direct least-privilege connection).

### 2026-10-21: **Pivot: dropped STT / LLM chatbot from the core workflow**

- **Decision:** All Voice-to-Text (STT) and local LLM/chatbot features removed from AIRA.
- **Why:** keep the app **under 30 MB**, run **flawlessly on low-end Android**, and because **no
  reliable offline Cebuano (Bisaya) STT exists**: an unreliable voice path is worse than none.
- **Replacement:** the citizen app relies 100% on the hyper-localized, zero-latency **Bisaya button
  grid** (SUNOG / MEDIKAL / KRIMEN / BAHA); the offline mesh payload is the hyper-compressed JSON
  array `["SUNOG", 10.3157, 123.8854]`.
- **Impact recorded in docs:** PRODUCT.md §2 (removed features list), DESIGN.md §4 (no microphone
  icons / chat bubbles / AI mascot), SECURITY.md §3 (STT sanitization rules replaced by closed-enum +
  boundary validation; no prompt-injection surface).
- **Code impact:** no voice/recorder/STT/chat/AI code or dependency exists anywhere in this repo;
  keep it that way (grep: `stt|voice|speech|microphone|chat|openai|llm` should only hit these docs).

### 2026-10-21: Initial scaffold

- Turborepo + pnpm monorepo: `apps/web`, `apps/mobile`, `packages/ui`, `packages/tailwind-config`,
  `packages/typescript-config`, `packages/db`.
- Design tokens centralized; shared payload helpers in `@aira/ui` with unit tests; responder intake
  route (`/api/incidents`) validates payloads; both app skeletons render (dashboard tested with the
  map mocked in jsdom).
