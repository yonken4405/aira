# Requirements: single-lgu-agency-network

## Introduction

This feature reshapes the AIRA responder console from a multi-tenant SaaS with lightweight
"agency tags" into a **single-LGU product** in which **responding agencies (BFP, PNP, EMS, DRRM,
...) are first-class cooperating organizations**, each with its own admin and dispatcher,
coordinated by the LGU's LDRRMO under the RA 10121 **notify-and-coordinate** model.

It supersedes parts of the shipped `tenant-responder-network` feature: the editable per-tenant
capability map and the multi-tenant operator (platform) **UX** are removed. The multi-tenant
**schema and scope boundaries are retained internally** as defense-in-depth (they simply always
resolve to the one LGU) — this is the "soft single-LGU" (S1) approach.

### Product framing (why)

- The likely buyer is a PDRRMO/CDRRMO/MDRRMO that wants its data in its own instance, not a shared
  cloud. So AIRA is sold as **one deployment = one LGU**.
- Real-world responders belong to their own line agencies (BFP, PNP under DILG; EMS/health; LGU DRRM
  rescue). The LDRRMO operations center **notifies and coordinates**; each agency **decides and
  dispatches its own units**. The system models that, not a single commander over all units.
- Agency units routinely respond **outside their home barangay** (e.g. a fire truck crossing into a
  neighboring barangay). Jurisdiction therefore drives **prioritization**, never a hard restriction.

### Decisions locked with the product owner

1. **S1 soft single-LGU** — keep `tenants`, every `tenant_id` column, and the tenant-bounded
   `OFFICE_SCOPE` CTEs unchanged; retire only the operator UX.
2. **Keep the superadmin tier as CLI-only break-glass** — `platform_admins` + `platform_sessions`
   tables and the `platform:create-admin` CLI remain; the `/platform` console, tenant onboarding,
   and the `/login` platform-retry are removed.
3. **Agency is a first-class org** with its own `AGENCY_ADMIN` and its own (agency-scoped)
   `DISPATCHER`.
4. **A responder belongs to exactly one office (required) and exactly one agency.**
5. **Office↔agency coverage** (`agency_coverage`) exists and drives **prioritization only**;
   cross-jurisdiction response is allowed but ranked lower.
6. **LDRRMO coordinator (the existing `ADMIN` role) is read-only coordination** — it sees all
   agencies and may nudge/request help, but **cannot dispatch** another agency's units.
7. **Remove the editable capability map**; replace with a fixed built-in `CATEGORY → AGENCY_TYPE`
   default used for "which agency type(s) to notify/prioritize."
8. Provide a **users/org view** (roster + hierarchy), scoped to the viewer's authority.
9. Fix the latent bug where the admin roster's agency list is **not tenant-filtered**.

### Glossary

- **LGU** — the single local-government unit this deployment serves. Represented by the one retained
  `tenants` row; never shown as a "tenant" in the UI.
- **Office** — a node in the jurisdiction tree: the LDRRMO/LGU root and its barangays
  (`offices.kind ∈ {LGU, BARANGAY}`).
- **Agency** — a responding organization within the LGU (`agencies`, with a closed
  `Agency_Type ∈ {FIRE, POLICE, MEDICAL, DRRM, OTHER}`).
- **Agency coverage** — the set of offices (barangays) an agency normally serves
  (`agency_coverage`). Used only to prioritize routing suggestions.
- **Category→type map** — the fixed built-in mapping from an emergency category to the capable
  agency type(s): `SUNOG→FIRE`, `MEDIKAL→MEDICAL`, `KRIMEN→POLICE`, `BAHA→∅` (DRRM generalists lead).
- **Roles** — `RESPONDER`, `DISPATCHER` (agency-scoped), `AGENCY_ADMIN` (new), `ADMIN` (= LDRRMO
  coordinator, tenant-wide read-only), `CITIZEN` (app-only, unchanged).
- **Break-glass superadmin** — the retained platform-admin account, reachable only via CLI, with no
  web console.

---

## Requirements

### Requirement 1: Single-LGU product (soft retirement of multi-tenancy)

**User Story:** As the product owner, I want AIRA to behave as a single-LGU product so that a
PDRRMO buyer sees one coherent organization, while the proven tenant-isolation boundaries remain in
the code as defense-in-depth.

#### Acceptance Criteria

1. THE System SHALL retain the `tenants` table, every existing `tenant_id` column, and the
   tenant-bounded `OFFICE_SCOPE` recursive CTEs unchanged in behavior.
2. THE System SHALL continue to resolve all server-side scope against the single active LGU tenant,
   so that every existing tenant-isolation test remains valid.
3. THE System SHALL NOT present any "tenant", "onboard office", or multi-tenant concept in the
   responder/admin UI.
4. WHERE a surface previously displayed tenant-level controls, THE System SHALL replace them with
   single-LGU equivalents (the LGU is implicit).
5. THE System SHALL keep the anonymous mesh SOS path (Tier 0) frozen and unaffected by this feature.
6. THE System SHALL NOT introduce any new multi-tenant runtime behavior (no second LGU, no
   cross-tenant flows).

### Requirement 2: Retire the operator (platform) UX; keep superadmin as CLI break-glass

**User Story:** As the LGU operator, I want a single responder sign-in and no SaaS operator console,
while a protected break-glass superadmin still exists for recovery.

#### Acceptance Criteria

1. THE System SHALL remove the `/platform` console pages (tenants console, nationwide map, operator
   profile/settings) and their routes.
2. THE System SHALL remove the operator-tier agency, capability, and tenant management HTTP routes
   and handlers that exist solely for the retired console.
3. THE `/login` page SHALL authenticate only the responder tier and SHALL NOT retry a platform
   login.
4. THE System SHALL retain the `platform_admins` and `platform_sessions` tables and the
   `platform:create-admin` CLI as a documented break-glass mechanism with no web entry point.
5. WHEN a request reaches any removed platform route, THE System SHALL respond `404` (route absent),
   not `401`.
6. THE System SHALL preserve the responder session cookie (`aira_session`) and the citizen session
   cookie unchanged; it SHALL remove reliance on `aira_platform_session` from the web UI flow.
7. THE System SHALL keep the shared `PlatformStore` as an internal persistence module where its
   non-operator methods (e.g. office pins, agency reads) are still used by retained surfaces.

### Requirement 3: Agency as a first-class organization

**User Story:** As a PDRRMO, I want each responding agency to be a real organization in the system
with its own members and administrator so that agencies manage themselves under LGU coordination.

#### Acceptance Criteria

1. THE System SHALL model every responder account as belonging to exactly one Agency (required) and
   exactly one Office (required).
2. WHEN an account is provisioned without an agency, THE System SHALL reject it with a validation
   error (agency is now required for responder/dispatcher/agency-admin roles).
3. THE System SHALL expose each account's agency (id, name, type) on the authenticated principal and
   on the browser-facing Viewer.
4. THE System SHALL retain the closed `Agency_Type` taxonomy `{FIRE, POLICE, MEDICAL, DRRM, OTHER}`
   as the single source of truth in `@aira/ui`, mirrored by the DB CHECK.
5. THE System SHALL resolve an account's tenant from its office (unchanged), so a single-LGU
   deployment needs no explicit tenant on the account.
6. WHERE an agency is deactivated, THE System SHALL prevent new accounts from being attached to it
   while preserving existing rows.

### Requirement 4: Roles and permissions for the agency-org model

**User Story:** As a user of the console, I want my role to grant exactly the access my job needs,
scoped to my agency where appropriate, with clear separation of duties.

#### Acceptance Criteria

1. THE System SHALL define the roles `RESPONDER`, `DISPATCHER`, `AGENCY_ADMIN`, and `ADMIN`
   (LDRRMO coordinator), plus the app-only `CITIZEN`.
2. THE `AGENCY_ADMIN` role SHALL manage accounts and coverage **only within its own agency** and
   SHALL see incidents relevant to its own agency; it SHALL NOT dispatch.
3. THE `DISPATCHER` role SHALL be **agency-scoped**: it SHALL read and assign only its own agency's
   units and the incidents routed to its agency.
4. THE `ADMIN` (LDRRMO coordinator) role SHALL have **tenant-wide read-only** incident/metrics
   oversight, SHALL see **all agencies**, and SHALL be able to send a coordination nudge/help
   request; it SHALL NOT assign or advance incident status (no dispatch — separation of duties,
   RA 10121).
   4a. THE `ADMIN` role MAY retain account/audit management as today, subject to Requirement 7 scoping.
5. THE `RESPONDER` role SHALL read and advance only incidents assigned to it (unchanged).
6. THE System SHALL deny by default: any action whose permission is not granted to the caller's role
   SHALL return `403`.
7. WHEN a user signs in, THE System SHALL route them to a landing surface appropriate to their role
   (field/dispatch console vs. admin surface).

### Requirement 5: Office↔agency coverage (prioritization, not restriction)

**User Story:** As an agency admin, I want to declare which barangays my agency covers so that
routing prioritizes my units for incidents in my area, while still allowing cross-area response.

#### Acceptance Criteria

1. THE System SHALL persist agency coverage as a set of `(agency_id, office_id)` links where both
   belong to the same LGU.
2. THE System SHALL allow an `AGENCY_ADMIN` (and the break-glass/CLI path) to add and remove its own
   agency's coverage links; it SHALL reject coverage edits for another agency with `403`.
3. WHEN ranking routing suggestions for an incident, THE System SHALL prioritize candidates whose
   agency covers the incident's office above candidates whose agency does not.
4. THE System SHALL still include non-covering candidates in the suggestions (cross-jurisdiction
   response is allowed), ranked below covering candidates.
5. THE System SHALL NOT use coverage as an access control or a hard filter — coverage affects
   ordering only.
6. WHERE an office or agency referenced by a coverage link is removed, THE System SHALL remove the
   dependent coverage links (cascade) without orphaning.

### Requirement 6: Per-agency dispatch and incident routing

**User Story:** As an agency dispatcher, I want to see and assign only my agency's units for
incidents routed to my agency so that each agency runs its own response.

#### Acceptance Criteria

1. WHEN an incident is created at intake, THE System SHALL resolve its office exactly as today
   (the single active LGU office tree root) with no change to the frozen payload.
2. THE System SHALL determine the capable agency type(s) for an incident category using the fixed
   built-in `CATEGORY → AGENCY_TYPE` map (no per-tenant stored config).
3. WHEN a `DISPATCHER` requests routing suggestions, THE System SHALL return only candidates from the
   dispatcher's own agency, ranked by coverage-first then nearer-first then a stable tiebreak.
4. WHEN a `DISPATCHER` assigns a unit, THE System SHALL reject assigning a unit that is not in the
   dispatcher's own agency with `403`.
5. THE System SHALL scope a `DISPATCHER`'s incident queue to incidents routed to its agency (by the
   category→type map and the agency's coverage/jurisdiction), while the `ADMIN` coordinator sees all
   incidents read-only.
6. THE System SHALL keep assignment, status transitions, and the assignment audit trail otherwise
   unchanged, including the one-citizen medical-reveal rules.
7. THE routing engine SHALL remain a pure function with deterministic ordering and SHALL NOT read or
   require a per-tenant capability config.

### Requirement 7: Scoped visibility (agency hierarchy vs. LGU coordination)

**User Story:** As an agency admin or dispatcher, I want to see only my agency's people and
incidents, while the LDRRMO coordinator sees the whole LGU.

#### Acceptance Criteria

1. THE System SHALL scope an `AGENCY_ADMIN`'s and `DISPATCHER`'s roster/queue reads to their own
   agency.
2. THE System SHALL scope the `ADMIN` coordinator's reads to the whole LGU (office subtree), read-only
   for incidents.
3. WHEN an `AGENCY_ADMIN` attempts to read or modify another agency's account, coverage, or incident,
   THE System SHALL respond `403` (known-other-agency) or `404` (not visible), consistently with the
   existing cross-scope discriminant pattern.
4. THE System SHALL ensure no coordinate value appears in any agency-management request, response,
   error, log, or audit entry (coordinate-free management surface, unchanged from the prior feature).
5. THE System SHALL fix the existing admin roster agency list so it is filtered to the acting LGU's
   agencies (no cross-tenant leak).

### Requirement 8: Users / organization view

**User Story:** As an admin, I want to see all the people in my scope organized by agency and office
so that I understand the hierarchy and can manage accounts.

#### Acceptance Criteria

1. THE System SHALL provide a view listing accounts with their role, agency, and office.
2. THE System SHALL present the hierarchy: the LGU and its office tree, and each agency with its
   members grouped by role.
3. THE System SHALL scope the view: an `AGENCY_ADMIN` sees only its own agency's members; the `ADMIN`
   coordinator sees all agencies and the full office tree.
4. THE view SHALL follow Operate Mode: a layout-shaped Skeleton on first load, unified toast on async
   outcomes, Lucide icons via `@aira/ui/web`, all copy via `t()`, and no coordinates.
5. THE view SHALL degrade to an honest "unavailable" state offline and SHALL NOT block any Tier-0
   action.

### Requirement 9: Remove the editable capability map

**User Story:** As a maintainer, I want the unused editable capability map gone so the system is
simpler and routing behavior is predictable.

#### Acceptance Criteria

1. THE System SHALL remove the `tenant_capability_config` table and its grants via a new migration
   (earlier migrations are never edited).
2. THE System SHALL remove the capability editor UI from every surface and the capability read/write
   HTTP routes/handlers.
3. THE System SHALL replace all capability-config consumption with the fixed built-in
   `CATEGORY → AGENCY_TYPE` map, preserving today's default behavior exactly
   (`SUNOG→[FIRE], MEDIKAL→[MEDICAL], KRIMEN→[POLICE], BAHA→[]`).
4. THE System SHALL remove the capability client parsers/helpers and their i18n keys that are no
   longer referenced.

### Requirement 10: Migrations, seed, and quality gate

**User Story:** As a developer, I want the schema change to apply cleanly and the dev environment to
seed a realistic single-LGU org so I can run and test locally.

#### Acceptance Criteria

1. THE System SHALL add a single new timestamp-ordered migration after the latest existing one that:
   adds `AGENCY_ADMIN` to the `responder_role` enum, creates `agency_coverage`, drops
   `tenant_capability_config`, and applies deny-by-default grants to new objects.
2. WHERE adding an enum value cannot run inside a transaction with dependent statements, THE System
   SHALL structure the migration so it applies cleanly under `supabase db reset`.
3. THE System SHALL update `seed.sql` and `seed-accounts.mjs` to seed, for the one LGU: the agencies,
   an `AGENCY_ADMIN` and a `DISPATCHER` and a `RESPONDER` per seeded agency, and realistic
   `agency_coverage` rows — without seeding credential material into SQL.
4. THE System SHALL keep `pnpm check` (typecheck + tests across packages) green at the end of each
   phase and at completion, followed by `pnpm format`.
5. THE System SHALL retain the responder account for the break-glass superadmin seeding via the CLI,
   not via `seed.sql`.

### Requirement 11: Documentation

**User Story:** As a future maintainer, I want the governing docs to reflect the single-LGU
agency-org model so the guardrails match reality.

#### Acceptance Criteria

1. THE System SHALL update PRODUCT.md to describe the single-LGU product, agency organizations,
   office↔agency coverage, per-agency dispatch, and the removal of the editable capability map.
2. THE System SHALL update SECURITY.md to describe single-LGU scoping, the agency-scoped roles,
   coordination-only LDRRMO, the retained-but-CLI-only superadmin, and the coordinate-free
   management surface.
3. THE System SHALL update DESIGN.md for the users/org view and the agency management surfaces under
   Operate Mode.
4. THE System SHALL add a dated change-log entry to AGENTS.md summarizing the feature, the new role,
   the coverage table, the removed capability map, and the new migration.
5. THE System SHALL NOT delete or weaken the five governing markdown files to simplify a task.

---

## Open questions (resolved)

- **SaaS vs single-LGU** → single-LGU (S1 soft). Resolved.
- **Superadmin** → keep as CLI break-glass. Resolved.
- **LDRRMO dispatch** → coordination-only, no dispatch, no break-glass override. Resolved.
- **Office↔agency link** → yes, as coverage; prioritization only, cross-area allowed. Resolved.
- **Capability map** → remove (A1). Resolved.

## Out of scope

- Any second LGU, cross-LGU flows, or managed multi-LGU cloud (the schema keeps the seam, the product
  does not expose it).
- WebSockets/SSE, real LoRa/Bluetooth radio, the responder mobile app (separate tracks).
- Billing/payments.
- Changing the frozen mesh payload or the anonymous Tier-0 intake.
