# Implementation Plan: single-lgu-agency-network

## Overview

This plan turns the approved `requirements.md` + `design.md` into incremental, test-first steps. It
reshapes AIRA into a **single-LGU** product with **first-class agency organizations**, per-agency
dispatch, office↔agency coverage (prioritization only), a users/org view, removal of the editable
capability map, and retirement of the operator UX (superadmin kept as CLI break-glass). The
multi-tenant schema and tenant-bounded scope CTEs are retained unchanged (S1 soft single-LGU).

**Gate command.** `pnpm check` (turbo typecheck + test across all packages) MUST be green before any
task is considered done. While iterating, use per-package runs:
`pnpm --filter @aira/web test -- <name>`, `pnpm --filter @aira/web typecheck`,
`pnpm --filter @aira/ui test`.

**TDD discipline.** Each task writes failing test(s) first (`.1`), then implements to green (`.2`,
and `.3` for routes). Sub-tasks marked `*` are optional property tests and are not implemented by the
executor.

**Test seams.** Service/handler/store logic is tested against the in-memory stores via the existing
harness (no Postgres). The routing engine is a pure function. New store methods go to BOTH the
Postgres and in-memory adapters. Component tests are map-free (jsdom), mocking as the existing
component tests do.

**Conventions.** All copy via `packages/ui/src/i18n.ts` `t()`; Agency_Type labels via `t()` only;
Lucide via `@aira/ui/web`; tokens from `@aira/tailwind-config`; strict TS, no `any`/`@ts-ignore`;
coordinate-free management surfaces. Prefer TanStack Query for new client data fetching per the
`web-data-fetching` steering.

**Git.** Branch `feat/single-lgu-agency-network` off the current `feat/tenant-responder-network`
HEAD (contains the committed fixes) before starting.

---

## Tasks

### Phase 1 — Fixed routing map (remove capability config from the engine) (R6, R9.3)

- [ ] 1. Replace the per-tenant capability config with a fixed built-in map
  - [ ] 1.1 Write failing unit tests for the fixed map + new routing signatures
    - Update `apps/web/tests/routing.test.ts`: assert `CATEGORY_AGENCY_DEFAULT` equals
      `{SUNOG:['FIRE'],MEDIKAL:['MEDICAL'],KRIMEN:['POLICE'],BAHA:[]}`; `isCapable(category, type)`
      (no config arg) matches the legacy result for every pair; `rankResponders(category, incident,
candidates)` (no config arg) orders capable→covering→nearer→callsign; `RoutingCandidate` gains
      `coversIncidentOffice: boolean`; purity/determinism preserved.
    - _Requirements: 6.2, 6.3, 6.7, 9.3_
  - [ ] 1.2 Implement the fixed map + coverage-aware ranking
    - Edit `apps/web/src/lib/routing.ts`: add `CATEGORY_AGENCY_DEFAULT`; drop the `config` params from
      `isCapable`/`rankResponders`/`bestSuggestion`; add `coversIncidentOffice` to `RoutingCandidate`
      and the covering-first sort tier; remove `CapabilityConfig` import/usage from routing.
    - _Requirements: 6.2, 6.3, 6.7, 9.3_
  - [ ]* 1.3 Property test — capability + coverage ordering invariant
    - A capable+covering candidate never ranks below an equally-distant capable non-covering one;
      null agencyType is always capable; two identical runs identical; inputs unmutated.
    - **Validates: Requirements 5.3, 5.4, 6.7**

### Phase 2 — Schema migration + seed (R10, R9.1)

- [ ] 2. Add the single-lgu-agency-network migration and update seeds
  - Create `packages/db/supabase/migrations/20261022260000_single_lgu_agency_network.sql`:
    `alter type public.responder_role add value if not exists 'AGENCY_ADMIN'` (first statement);
    create `public.agency_coverage (agency_id, office_id, created_at, pk(agency_id, office_id))` with
    `on delete cascade` FKs + `agency_coverage_office_idx`; `drop table if exists
public.tenant_capability_config`; deny-by-default grants + `grant select, insert, delete on
public.agency_coverage to aira_app`. If the combined file trips the enum "unsafe use" rule under
    `db:reset`, split into `...260000_add_agency_admin_role.sql` + `...261000_agency_coverage_...sql`.
    Verify with `pnpm --filter @aira/db db:reset` (Docker).
  - Update `packages/db/supabase/seed.sql`: keep the one tenant/offices/agencies; add realistic
    `agency_coverage` rows (e.g. BFP covers all barangays; PNP covers all; EMS covers the LGU root).
  - Update `apps/web/scripts/seed-accounts.mjs`: seed, per agency, an `AGENCY_ADMIN`, a `DISPATCHER`,
    and a `RESPONDER` (agency-affiliated, office-stationed); no credential material in SQL.
  - _Requirements: 3.1, 5.1, 9.1, 10.1, 10.2, 10.3, 10.5_

### Phase 3 — Principal carries agency (R3.3)

- [ ] 3. Thread agency onto the principal and Viewer
  - [ ] 3.1 Write failing tests for principal/session agency fields
    - Extend auth service/session tests: `principalFrom` copies `agencyId`/`agencyName`;
      `AuthenticatedPrincipal` and `Viewer` expose them; `/api/auth/session` projects `agencyName`.
    - _Requirements: 3.3_
  - [ ] 3.2 Implement agency on principal + Viewer
    - Edit `apps/web/src/lib/auth/types.ts` (add `agencyId`/`agencyName` to `AuthenticatedPrincipal`,
      `agencyName` to `Viewer`); `auth/service.ts` `principalFrom`; `platform/service.ts` bootstrap
      principal; the session/viewer projection. (`ResponderRecord` already carries agency.)
    - _Requirements: 3.3_

### Phase 4 — RBAC: new role + agency-scoped permissions (R4)

- [ ] 4. Add AGENCY_ADMIN and the agency-scoped permission matrix
  - [ ] 4.1 Write failing tests for the new role matrix
    - Update `rbac` tests: `ROLES` includes `AGENCY_ADMIN`; new permissions present; exhaustive
      `can()` over the matrix in design §3; `DISPATCHER` has `incident:assign:agency` not bare
      `incident:assign`; `ADMIN` has no assign/status; `landingFor(AGENCY_ADMIN|ADMIN)='/admin'`.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.4a, 4.5, 4.6, 4.7_
  - [ ] 4.2 Implement the role + permissions
    - Edit `apps/web/src/lib/auth/rbac.ts`: add `AGENCY_ADMIN` to `ROLES`; add permissions
      `incident:read:agency`, `incident:assign:agency`, `agency:manage`, `coverage:manage`,
      `agency:read:all`, `coordination:nudge`; rewrite `ROLE_PERMISSIONS` per design §3; update
      `landingFor`. Keep `isRole` exhaustive.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.4a, 4.5, 4.6, 4.7_

### Phase 5 — Store layer: coverage + agency-scoped reads (R5, R6, R7.5)

- [ ] 5. Coverage store + agency-scoped incident/roster queries
  - [ ] 5.1 Write failing store tests (in-memory + postgres)
    - `agency_coverage`: `listCoverage`/`setCoverage` (full replace, dedupe)/`coversOffice`;
      `listRoutingCandidates(officeId, { agencyId })` filters to the agency and projects
      `coversIncidentOffice`; `listForAgency(agencyType, ...)`; `listResponders(tenantId,{agencyId})`;
      `listAgencies(tenantId)` is tenant-filtered (bug C). Adapter equivalence.
    - _Requirements: 5.1, 5.2, 5.6, 6.3, 6.5, 7.1, 7.5_
  - [ ] 5.2 Implement the store methods (both adapters)
    - Edit `apps/web/src/lib/incidents-store.ts`, `apps/web/src/lib/platform/postgres-store.ts`,
      `apps/web/src/lib/auth/postgres-store.ts`, and the in-memory equivalents; add coverage methods;
      agency-filter candidates/roster; fix `listAgencies` signature to take `tenantId`.
    - _Requirements: 5.1, 5.2, 5.6, 6.3, 6.5, 7.1, 7.5_

### Phase 6 — Service layer: coverage + agency-scoped provisioning; drop capability (R3.2, R5.2, R7.3, R9)

- [ ] 6. Responder-network service: coverage, agency-required provisioning, capability removal
  - [ ] 6.1 Write failing service tests
    - `setAgencyCoverage(deps, scope, agencyId, officeIds)`: own-agency ok; cross-agency → 403-mapped
      `cross_agency`; unknown → `not_found`; dedupe; same-LGU. `provisionResponder`: agency now
      required (`invalid` when absent); AGENCY_ADMIN scope limited to own agency. Assert the capability
      service functions are gone (compile-time removal) and nothing imports them.
    - _Requirements: 3.2, 5.2, 7.3, 9.2, 9.3_
  - [ ] 6.2 Implement the service changes
    - Edit `apps/web/src/lib/responder-network/service.ts`: remove `readCapabilityConfig`/
      `setCapabilityForCategory`/`toTotalConfig`/`CapabilityConfig` usage; add `setAgencyCoverage` +
      `listAgencyCoverage`; make `provisionResponder` agency-required and agency-scope-aware.
    - _Requirements: 3.2, 5.2, 7.3, 9.2, 9.3_

### Phase 7 — Handlers + routes: dispatch, coverage, org, nudge; remove capability routes (R6, R7, R8, R9.2)

- [ ] 7. Agency-scoped dispatch + management handlers/routes
  - [ ] 7.1 Write failing integration tests
    - Dispatcher: routing suggestions + assignee + queue are own-agency only; assigning a
      non-own-agency unit → 403; status within agency ok. LDRRMO ADMIN: read-only queue across LGU,
      `agency:read:all` list, `coordination:nudge` send; no assign (403). AGENCY_ADMIN: coverage GET/PUT
      own agency (cross-agency 403/404), provision own-agency account, org GET scoped. Removed
      `/api/admin/capability` → 404. Coordinate-free (logger spy).
    - _Requirements: 6.3, 6.4, 6.5, 7.1, 7.2, 7.3, 7.4, 8.1, 8.3, 9.2_
  - [ ] 7.2 Implement handlers
    - Edit `apps/web/src/lib/api/incidents-handlers.ts` (branch dispatch/queue/routing on role +
      agency scope; drop the `DEFAULT_CAPABILITY_CONFIG` arg), `apps/web/src/lib/api/admin-handlers.ts`
      (coverage GET/PUT, org GET, nudge POST, agency-required provisioning, fix `listAgencies(tenantId)`);
      remove capability handlers.
    - _Requirements: 6.3, 6.4, 6.5, 7.1, 7.2, 7.3, 7.4, 8.1, 8.3, 9.2_
  - [ ] 7.3 Add/remove routes
    - Add `apps/web/app/api/admin/agencies/[id]/coverage/route.ts` (GET/PUT),
      `apps/web/app/api/admin/org/route.ts` (GET), `apps/web/app/api/admin/coordination/nudge/route.ts`
      (POST). Remove `apps/web/app/api/admin/capability/**`.
    - _Requirements: 5.2, 8.1, 9.2_

### Phase 8 — Retire operator UX + single login (R2)

- [ ] 8. Remove the platform console and platform login retry
  - [ ] 8.1 Write failing tests for the single-login + removed routes
    - `/login` posts only `/api/auth/login` (no platform retry); removed platform routes → 404; the
      superadmin CLI path is unaffected (unit-level, no HTTP).
    - _Requirements: 2.3, 2.5_
  - [ ] 8.2 Remove operator UX
    - Delete `apps/web/app/platform/**` pages, `apps/web/app/api/platform/**` console routes, the
      operator `PlatformTenants.tsx` + `AgencyNetworkPanel.tsx` + capability client helpers + dead
      i18n keys; simplify `apps/web/app/login/LoginForm.tsx` to responder-only. Keep
      `platform_admins`/`platform_sessions`, `platform:create-admin`, and the internal `PlatformStore`
      methods still used by admin surfaces.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.6, 2.7_

### Phase 9 — UI: admin surface per role, org view, coverage editor (R4.7, R8)

- [ ] 9. Role-aware admin surface + org/coverage UI
  - [ ] 9.1 Write failing component tests
    - `AdminSurface` tabs per role (ADMIN vs AGENCY_ADMIN); `OrgView` scoped render + first-load
      Skeleton + toast; `AgencyCoverage` barangay checklist full-replace + ConfirmDialog + unavailable
      state; provisioning form requires agency. Map-free; copy via `t()`; icons via `@aira/ui/web`.
    - _Requirements: 4.7, 8.1, 8.2, 8.3, 8.4, 8.5_
  - [ ] 9.2 Implement the UI
    - Edit `AdminSurface.tsx` (role-aware tabs), add `OrgView.tsx` + `AgencyCoverage.tsx`, update
      `AdminResponders.tsx` (agency required; AGENCY_ADMIN sees own-agency roster), remove the
      capability editor section; wire client data fetching per the TanStack steering where available.
    - _Requirements: 4.7, 8.1, 8.2, 8.3, 8.4, 8.5_
  - [ ]* 9.3 Property test — agency isolation on every management action
    - For any management request, an AGENCY_ADMIN/DISPATCHER acting outside its agency is refused
      (403 known / 404 not-visible) and nothing is read or written.
    - **Validates: Requirements 7.1, 7.3**

### Phase 10 — Backend checkpoint

- [ ] 10. Checkpoint — backend green
  - `pnpm --filter @aira/web test`, `pnpm --filter @aira/web typecheck`, `pnpm --filter @aira/ui test`.
  - _Requirements: 4, 5, 6, 7, 9_

### Phase 11 — Documentation

- [ ] 11. Update governing docs
  - PRODUCT.md (single-LGU product, agency orgs, coverage, per-agency dispatch, capability map
    removed); SECURITY.md (single-LGU scoping, agency-scoped roles, coordination-only LDRRMO,
    CLI-only superadmin, coordinate-free management); DESIGN.md (org view, coverage editor, role-aware
    admin surface); AGENTS.md dated changelog entry (new role, `agency_coverage`, dropped capability
    map, migration `20261022260000`).
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

### Phase 12 — Full-suite checkpoint + final gate

- [ ] 12. Checkpoint — full suite + format
  - `pnpm check` green (watch for PBT timeout flakiness; apply the `PBT_TIMEOUT_MS = 60_000` pattern if
    a slow property test trips), then `pnpm format`.
  - _Requirements: 10.4_

---

## Notes

- Tasks marked `*` are optional property-based tests and may be skipped for a faster path.
- Each `.1` sub-task establishes failing tests before the `.2` implementation.
- Checkpoints (10, 12) enforce `pnpm check` green.
- The whole API is tested against the in-memory stores — no Postgres/network for the default run;
  the migration is verified via `db:reset` in Task 2 only.
- This feature supersedes the editable capability map and operator console from
  `tenant-responder-network`; the `agencies` table + `Agency_Type` taxonomy are retained.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3", "3.1"] },
    { "id": 3, "tasks": ["3.2"] },
    { "id": 4, "tasks": ["4.1"] },
    { "id": 5, "tasks": ["4.2"] },
    { "id": 6, "tasks": ["5.1"] },
    { "id": 7, "tasks": ["5.2"] },
    { "id": 8, "tasks": ["6.1"] },
    { "id": 9, "tasks": ["6.2"] },
    { "id": 10, "tasks": ["7.1"] },
    { "id": 11, "tasks": ["7.2"] },
    { "id": 12, "tasks": ["7.3", "8.1"] },
    { "id": 13, "tasks": ["8.2"] },
    { "id": 14, "tasks": ["9.1"] },
    { "id": 15, "tasks": ["9.2", "9.3"] },
    { "id": 16, "tasks": ["10"] },
    { "id": 17, "tasks": ["11"] },
    { "id": 18, "tasks": ["12"] }
  ]
}
```
