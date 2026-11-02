# Design: single-lgu-agency-network

## Overview

This design turns AIRA's responder console into a **single-LGU** product where **agencies are
first-class organizations** that cooperate under the LDRRMO, following the RA 10121
notify-and-coordinate model. It is additive and surgical on the data layer (the multi-tenant schema
and tenant-bounded scope CTEs are retained, S1 "soft single-LGU"), and it reshapes the role model,
the incident routing/dispatch path, and the admin UX.

It builds directly on the shipped spine:
`route → handler (responder-auth) → shared service fn → store (postgres | in-memory)`,
removing the operator-tier branch of that spine and the editable capability map.

### Design goals

- Keep the proven tenant-isolation boundaries **unchanged** (they resolve to the one LGU).
- Make **agency a real scope**: thread `agencyId` onto the principal; add `AGENCY_ADMIN`; make
  `DISPATCHER` agency-scoped.
- Keep **routing pure and deterministic**, now coverage-aware and driven by a **fixed** category→type
  map (no per-tenant config).
- Preserve separation of duties: **LDRRMO coordinates, agencies dispatch**.
- Remove dead/confusing surfaces (operator console, capability editor) without weakening security.

### Non-goals

- No schema teardown of `tenants`/`tenant_id` (S1). No second LGU. No new transports. No mesh-payload
  change.

---

## Architecture

### Identity tiers after this feature

| Tier                     | Table / cookie                          | Web entry                         | Purpose                            |
| ------------------------ | --------------------------------------- | --------------------------------- | ---------------------------------- |
| Responder (all roles)    | `responders` / `aira_session`           | `/login` → `/console` or `/admin` | The whole product UX               |
| Citizen                  | `citizens` / `aira_citizen_session`     | mobile app                        | Unchanged                          |
| Superadmin (break-glass) | `platform_admins` / `platform_sessions` | **CLI only**                      | Recovery/bootstrap; no web console |

The superadmin tier's **tables, service, store, and CLI remain**; its **web routes and pages are
removed**. The shared `PlatformStore` persists as an internal module (office pins, agency reads,
provisioning helpers) consumed by retained admin surfaces.

### Role → scope → permission model

Roles (`responder_role` enum): `RESPONDER`, `DISPATCHER`, `AGENCY_ADMIN` (new), `ADMIN` (= LDRRMO
coordinator). `CITIZEN` stays app-only.

```
LGU (one retained tenant row; implicit in UI)
 ├─ Office tree: LGU root → barangays        [OFFICE_SCOPE, unchanged]
 ├─ Agencies (FIRE/POLICE/MEDICAL/DRRM/OTHER)
 │    ├─ AGENCY_ADMIN  → agency scope: own agency's people + coverage + incidents
 │    ├─ DISPATCHER    → agency scope: assign own agency's units for agency-routed incidents
 │    └─ RESPONDER     → self scope: own assignments; one agency + one office
 │    └─ agency_coverage(agency_id, office_id)  → prioritization only
 └─ ADMIN (LDRRMO)     → LGU scope (OFFICE_SCOPE), READ-ONLY incidents, sees ALL agencies, no dispatch
```

Two scope primitives:

- **OFFICE_SCOPE** (existing): recursive office subtree seeded at `principal.officeId`, hard-bounded
  by tenant. Used by `ADMIN` (whole LGU, read-only) and by intake/queue as today.
- **AGENCY_SCOPE** (new, simple predicate): `responders.agency_id = principal.agencyId`. Used by
  `DISPATCHER`/`AGENCY_ADMIN` for roster, routing candidates, assignee picker, and the agency queue.

### Request flow (incident lifecycle, single LGU)

```
Citizen app → POST /api/incidents (frozen payload, anonymous)
  → office_id = getDefaultOfficeId()   [unchanged]
  → incident QUEUED
Routing/coordination:
  category → CATEGORY_AGENCY_DEFAULT → capable agency type(s)
  agency DISPATCHER queue = incidents whose capable type == dispatcher.agencyType
    (coverage of the incident office prioritizes; cross-coverage allowed)
  DISPATCHER routing suggestions = own-agency RESPONDERs, ranked:
    covering-office-first → nearer-first → callsign tiebreak
  DISPATCHER assigns own-agency unit → DISPATCHED (+ audit)
LDRRMO ADMIN: read-only across the whole LGU; sees all agencies; may send a nudge/help request.
```

---

## Components and Interfaces

### 1. Shared taxonomy & fixed routing map (`@aira/ui`, `apps/web/src/lib/routing.ts`)

- Keep `AGENCY_TYPES` / `AgencyType` / `isAgencyType` in `@aira/ui` (unchanged source of truth).
- Replace the per-tenant `CapabilityConfig` plumbing with a single fixed map:

```ts
// routing.ts
export const CATEGORY_AGENCY_DEFAULT: Readonly<Record<EmergencyCategoryId, readonly AgencyType[]>> =
  {
    SUNOG: ['FIRE'],
    MEDIKAL: ['MEDICAL'],
    KRIMEN: ['POLICE'],
    BAHA: [], // DRRM generalists (agency-less or DRRM type) lead
  };

export function isCapable(category: EmergencyCategoryId, agencyType: AgencyType | null): boolean;
// null agencyType = DRRM generalist → always capable
// else capable iff agencyType ∈ CATEGORY_AGENCY_DEFAULT[category]
```

- `rankResponders` drops its `config` parameter and gains coverage awareness:

```ts
export interface RoutingCandidate {
  readonly id: string;
  readonly callsign: string | null;
  readonly role: 'RESPONDER' | 'DISPATCHER' | 'ADMIN' | 'AGENCY_ADMIN';
  readonly officeId: string;
  readonly officeName: string;
  readonly agencyType: AgencyType | null;
  readonly agencyName: string | null;
  readonly base: GeoPoint | null;
  readonly coversIncidentOffice: boolean; // NEW: agency covers the incident's office
}

export function rankResponders(
  category: EmergencyCategoryId,
  incident: GeoPoint,
  candidates: readonly RoutingCandidate[],
): readonly RoutingSuggestion[];
// Order: capable-first → covering-first → nearer-first → callsign tiebreak. Pure, deterministic.
```

Rationale: the capability map was effectively write-only (the dispatch path hardcoded the default).
Collapsing to a fixed constant preserves exact current behavior and removes a whole table + UI.

### 2. Principal carries agency (`apps/web/src/lib/auth/*`, `platform/service.ts`)

- `AuthenticatedPrincipal` gains `agencyId: string | null` and `agencyName: string | null`.
- `Viewer` gains `agencyName: string | null` (for display).
- `principalFrom(responder, sessionId)` (in **both** `auth/service.ts` and `platform/service.ts`'s
  bootstrap path) copies `responder.agencyId` / `responder.agencyName` (already present on
  `ResponderRecord`).
- Session resolution and `/api/auth/session` project the new fields.

### 3. RBAC (`apps/web/src/lib/auth/rbac.ts`)

```ts
export const ROLES = ['RESPONDER', 'DISPATCHER', 'AGENCY_ADMIN', 'ADMIN'] as const;

// New permissions
('incident:read:agency'); // dispatcher/agency-admin: incidents routed to own agency
('incident:assign:agency'); // dispatcher: assign own-agency units (replaces bare incident:assign check at the agency layer)
('agency:manage'); // agency-admin: manage own agency's accounts
('coverage:manage'); // agency-admin: manage own agency's coverage
('agency:read:all'); // LDRRMO admin: see all agencies (coordination)
('coordination:nudge'); // LDRRMO admin: send a help-request/nudge
```

Grant table (summary):

- `RESPONDER`: `incident:read:own`, `incident:status:own`, `session:revoke:own`,
  `account:change-password` (unchanged).
- `DISPATCHER`: `incident:read:agency`, `incident:assign:agency`, `incident:status:any` (within
  agency), `responder:read` (own agency), `metrics:read`, `session:revoke:own`,
  `account:change-password`.
- `AGENCY_ADMIN`: `agency:manage`, `coverage:manage`, `responder:read` (own agency),
  `incident:read:agency` (read-only), `metrics:read`, `audit:read` (own agency), session/pw.
- `ADMIN` (LDRRMO coordinator): `incident:read:office` (whole LGU, read-only), `metrics:read`,
  `responder:read`, `responder:manage`, `agency:read:all`, `coordination:nudge`, `audit:read`,
  `session:revoke:any`, session/pw. **No** `incident:assign*` / `incident:status:*` (coordination
  only).
- `CITIZEN`: `incident:submit` (unchanged).

`landingFor`: `ADMIN` and `AGENCY_ADMIN` → `/admin`; `DISPATCHER`/`RESPONDER` → `/console`.

Note: the existing `incident:assign` / `incident:status:any` checks move to agency-scoped variants;
`DISPATCHER` keeps functional dispatch but bounded to its agency at the store layer.

### 4. Schema migration (`packages/db/supabase/migrations/20261022260000_single_lgu_agency_network.sql`)

Ordered strictly after `20261022250000`. Earlier migrations untouched.

```sql
-- (a) Add the new role. ALTER TYPE ... ADD VALUE cannot run in a txn block with dependent
--     statements, so this migration is authored so the enum add is committed before any
--     statement references 'AGENCY_ADMIN'. (supabase runs each migration file; we keep the
--     ADD VALUE as the first statement and avoid referencing the new value in the same file.)
alter type public.responder_role add value if not exists 'AGENCY_ADMIN';

-- (b) agency_coverage — prioritization link, same-LGU enforced via FKs to tenant-scoped rows.
create table public.agency_coverage (
  agency_id uuid not null references public.agencies (id) on delete cascade,
  office_id uuid not null references public.offices (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (agency_id, office_id)
);
create index agency_coverage_office_idx on public.agency_coverage (office_id);
-- Same-tenant consistency is enforced in the service layer (both rows already carry tenant_id);
-- a DB trigger is unnecessary for a single-LGU deployment and is omitted for simplicity.

-- (c) Drop the editable capability map (Requirement 9).
drop table if exists public.tenant_capability_config;

-- (d) Least privilege for the new table.
-- revoke from anon/authenticated/service_role (guarded); grant select/insert/delete to aira_app.
```

Agencies now **require** an agency on responders at the application layer (the DB `agency_id` stays
nullable to keep the break-glass/legacy path and the "DRRM generalist = null" routing semantics; the
service enforces "agency required" for the new provisioning flows). Documented explicitly.

Migration-safety note: if `ADD VALUE` + the `create table` in one file trips the "unsafe use of new
value" rule on the local stack, split into two migration files (`...260000_add_agency_admin_role.sql`
then `...261000_agency_coverage_and_drop_capability.sql`). The task will verify under `db:reset` and
split only if required.

### 5. Store layer

New / changed methods (both Postgres and in-memory adapters, kept behavior-identical):

- `agency_coverage`:
  - `listCoverage(agencyId): Promise<readonly string[]>` (office ids)
  - `setCoverage(agencyId, officeIds): Promise<void>` (full replace within the agency)
  - `coversOffice(agencyId, officeId): Promise<boolean>`
- Agency-scoped incident reads (incidents store):
  - `listForAgency(agencyType, coverageOfficeIds?)` — queue of incidents whose capable type matches,
    coverage used for ordering not filtering.
  - `listRoutingCandidates(officeId, { agencyId })` — gains an optional agency filter; when present,
    restricts to `r.agency_id = $agencyId` and projects `coversIncidentOffice` via a join on
    `agency_coverage`.
- Roster:
  - `listResponders(tenantId, { agencyId? })` — agency filter for `AGENCY_ADMIN`.
  - Fix `listAgencies()` → `listAgencies(tenantId)` (Requirement 7.5 / bug C).
- Org view:
  - `listOrg(tenantId, { agencyId? })` — offices + agencies + members grouped, scoped.

### 6. Service layer (`apps/web/src/lib/responder-network/service.ts` + incidents/auth services)

- Remove `readCapabilityConfig` / `setCapabilityForCategory` / `toTotalConfig` and the
  `CapabilityConfig` types.
- `provisionResponder` gains **agency-required** validation and an **agency-scope** check: an
  `AGENCY_ADMIN` caller may only create accounts in its own agency; office must be in the LGU.
- New `setAgencyCoverage(deps, scope, agencyId, officeIds)` with agency-scope enforcement
  (`cross_agency` → 403, unknown → 404), de-duplicating office ids, same-LGU validation.
- Incident dispatch handlers branch on role:
  - `DISPATCHER` → agency-scoped candidates/assignee/queue; assign rejects non-own-agency unit.
  - `ADMIN` → read-only office-scope queue; `agency:read:all` list; `coordination:nudge` send.

### 7. HTTP routes

Removed (Requirement 2/9):

- `apps/web/app/api/platform/**` operator routes (tenants, offices, agencies, capability,
  responders, login/session for the console) — except the retained CLI path has no HTTP route anyway.
- `apps/web/app/api/admin/capability/**`.
- Platform login retry in `/login`.

Added / changed:

- `GET/PUT /api/admin/agencies/[id]/coverage` — agency coverage (AGENCY_ADMIN own agency; ADMIN
  read-only all).
- `GET /api/admin/org` — the users/org view (scoped).
- `POST /api/admin/coordination/nudge` — LDRRMO help-request (coordinate-free payload).
- `/api/admin/responders` provisioning now requires an agency and enforces agency scope for
  `AGENCY_ADMIN`.
- `/api/incidents` routing/assign/queue handlers branch on role per §6.

Retained: all responder/citizen/incident/tracking/notification routes not listed above.

### 8. UI

Removed:

- `/platform` pages, `PlatformTenants.tsx`, `AgencyNetworkPanel.tsx` (operator), the capability editor
  (`AdminAgencyNetwork` capability section + operator capability UI), and their client helpers +
  dead i18n keys.

Added / changed (Operate Mode throughout: Skeleton, `useToast`, `ConfirmDialog`, Lucide via
`@aira/ui/web`, copy via `t()`, no coordinates):

- **Admin surface** (`AdminSurface.tsx`) tabs adapt to role:
  - `ADMIN` (LDRRMO): Accounts (all), Org view, Agencies (read-all + nudge), Metrics, Audit.
  - `AGENCY_ADMIN`: Accounts (own agency), Coverage editor (own agency), Org view (own agency),
    Metrics, Audit (own agency).
- **Org/Users view** (`OrgView.tsx`, new): roster + hierarchy tree, scoped.
- **Coverage editor** (`AgencyCoverage.tsx`, new): barangay checklist for the agency; full-replace
  save; ConfirmDialog on large changes optional.
- **Dispatch console** (`/console`): unchanged shell; routing suggestions + assignee picker now
  agency-scoped server-side (no UI contract change beyond showing a "covers area" affordance).
- **Agency provisioning form**: agency becomes a required field for `AGENCY_ADMIN`; for the LDRRMO
  `ADMIN`, agency is a required selector among all agencies.

### 9. Data model summary

```
tenants (retained; one active row = the LGU)
offices (tenant_id, kind, parent_id, lat/lon)         [unchanged]
agencies (tenant_id, name, code, agency_type, active) [unchanged schema]
agency_coverage (agency_id, office_id)                [NEW]
responders (office_id NOT NULL, agency_id nullable-in-DB/required-in-app, role incl AGENCY_ADMIN)
incidents (office_id, assigned_to_id, status, ...)    [unchanged]
platform_admins / platform_sessions                   [retained, CLI-only]
tenant_capability_config                               [DROPPED]
```

---

## Error Handling

- Cross-agency access by `AGENCY_ADMIN`/`DISPATCHER`: `403 forbidden` when the target is known to be
  another agency; `404` when not visible in the caller's agency scope (mirrors the existing
  cross-tenant discriminant).
- Assigning a non-own-agency unit: `403 forbidden`.
- Provisioning without an agency (new requirement): `400 invalid_responder` (agency required).
- Coverage edit for another agency: `403`; unknown office/agency: `404`.
- Removed platform routes: `404` (route absent), never `401`.
- Coordinate-free: no handler logs a request body for the management surfaces; no coordinate appears
  in any management response/error/audit.

## Testing Strategy

- **Unit**: fixed `CATEGORY_AGENCY_DEFAULT` + `isCapable`; coverage-aware `rankResponders` ordering
  (capable → covering → nearer → callsign), purity/determinism.
- **RBAC**: exhaustive `can()` over the new role×permission matrix; `landingFor`.
- **Store**: `agency_coverage` CRUD + `coversOffice`; agency-filtered `listRoutingCandidates`/
  `listResponders`/`listForAgency`; postgres↔in-memory equivalence; `listAgencies(tenantId)` filter.
- **Service**: `provisionResponder` agency-required + agency-scope; `setAgencyCoverage` scope/dedupe;
  removal of capability functions.
- **Integration (API)**: dispatcher sees/assigns only own agency; cross-agency assign → 403; agency
  admin manages only own agency (403/404 discriminant); LDRRMO read-only + sees all + nudge; removed
  routes → 404; coordinate-free (logger spy).
- **Component (jsdom, map-free)**: Org view scoped render + skeleton/toast; coverage editor
  full-replace + ConfirmDialog; admin surface tabs per role; single-login (no platform retry).
- **Property tests** (optional `*`, ≥100 iters): agency isolation on every management action;
  coverage-prioritization invariant (a covering capable unit never ranks below an equally-distant
  non-covering one); no-coordinate invariant.
- **Migration**: `db:reset` applies the new migration + seed cleanly (enum add safe); split the
  migration only if the local stack rejects the combined file.

## Migration / rollout notes

- S1 keeps all tenant columns, so there is **no data backfill risk** beyond the enum add and the
  dropped capability table.
- `db:reset` is destructive locally and is the intended way to pick up the new migration + seed.
- The break-glass superadmin continues to be provisioned via `platform:create-admin` (CLI), not seed
  SQL.

## Impact on prior feature (`tenant-responder-network`)

- Removes: editable capability map (table/UI/routes/client/i18n), operator agency console,
  per-tenant capability routing re-key.
- Keeps: the `agencies` table + `Agency_Type` taxonomy, tenant-scoped agency uniqueness, the shared
  `PlatformStore` (internal), and the coordinate-free management discipline.
- Governing docs updated to supersede the multi-tenant assertions with the single-LGU model.
