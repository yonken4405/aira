# Implementation Plan: tenant-responder-network

## Overview

This plan turns the approved `requirements.md` + `design.md` (the source of truth) into incremental,
test-first coding steps. It connects a tenant's responding organizations and responders to its already-shipped
Office_Tree and makes the category→agency capability that drives routing configurable per tenant. It extends
the shipped platform spine — `route → handler (platform-auth OR responder-auth) → shared service fn →
store (postgres | in-memory)` — adding tenant-scoped agencies with a stable Agency_Type, tenant-safe responder
provisioning, and a per-tenant Capability_Config, with the Routing_Engine reading that config plus each
candidate's Agency_Type (default-equals-legacy). No new scope and no new transport/persistence beyond what a
task names; the frozen mesh payload, Tier-0 SOS, one-LGU-per-tenant rule, and Supabase-as-Postgres are
preserved by construction.

**Gate command.** `pnpm check` (turbo typecheck + test across all packages) MUST be green before any task is
considered done. While iterating, use per-package runs: `pnpm --filter @aira/web test -- <name>`,
`pnpm --filter @aira/web typecheck`, and `pnpm --filter @aira/ui test`.

**TDD discipline.** Every task writes failing test(s) first, then the implementation to green. Test and
implementation are paired in adjacent sub-tasks: the `.1` sub-task writes the failing tests, the `.2`
implements to green (with `.3` for routes where a handler and its route are separate).

**Test seams.**

- Service / handler / store logic is tested against the in-memory `PlatformStore`
  (`apps/web/tests/support/memory-platform-store.ts`) via the existing harness, mirroring
  `apps/web/tests/api-platform.test.ts` — no Postgres. New store methods are added to BOTH the postgres store
  and the in-memory store (the in-memory impl is required so the API is testable without a DB).
- The Routing_Engine is tested as a pure function (`isCapable` / `rankResponders`) with no I/O.
- MapLibre/jsdom is not needed here (this feature has no map); component tests mock as the existing component
  tests do (`admin-responders.test.tsx` / `platform-tenants-offices.test.tsx`).
- Property tests use `fast-check` (already an `apps/web` devDependency) + vitest, **≥ 100 iterations**, one
  property per test, in its own file, tagged
  `// Feature: tenant-responder-network, Property {n}: {text}`.

**Conventions.** All user-visible copy goes through `packages/ui/src/i18n.ts` via `t()` (no literals in
components); Agency_Type labels resolve through `t()` only (identifiers, never display text). Lucide icons via
`@aira/ui/web`; tokens from `@aira/tailwind-config`; strict TS, no `any`, no `@ts-ignore`. Sub-tasks marked `*`
(property tests and genuinely-optional hardening) are optional and are NOT implemented by the executor; all
unmarked sub-tasks are implemented.

---

## Tasks

### Phase 1 — Shared Agency_Type definition (R2.1, R2.6)

- [x] 1. Add the shared Agency_Type taxonomy to `@aira/ui`
  - [x] 1.1 Write failing unit tests for the Agency_Type taxonomy
    - Add a `@aira/ui` unit test (new `packages/ui/src/__tests__/agency-types.test.ts` or the existing barrel
      test location) asserting: `AGENCY_TYPES` is exactly the five tokens `['FIRE','POLICE','MEDICAL','DRRM',
'OTHER']` in order; `isAgencyType` returns true for each member and false for a non-member string, a
      number, `null`, and `undefined`; and a **lockstep assertion** that the TS taxonomy equals the DB CHECK
      list (assert the five tokens as the canonical set the migration's `agency_type in (...)` CHECK must
      mirror — R2.1).
    - _Requirements: 2.1, 2.6_
  - [x] 1.2 Implement `agency-types.ts` and export it from the barrel
    - Create `packages/ui/src/agency-types.ts` with `AGENCY_TYPES` (`as const`), `type AgencyType`, the
      private `AGENCY_TYPE_SET`, and `isAgencyType(value: unknown): value is AgencyType`; re-export all three
      from the `@aira/ui` barrel so both the Platform_API and the Routing_Engine consume one definition.
    - _Requirements: 2.1, 2.6_

### Phase 2 — Database migration (R1.*, R2.2/R2.3, R9.1-R9.5)

- [x] 2. Add the tenant-responder-network migration (schema file only)
  - Create `packages/db/supabase/migrations/20261022250000_tenant_responder_network.sql` (timestamp-prefixed
    strictly after `20261022240000`, following the repo naming; earlier migrations are never edited — AGENTS.md
    rule 15, R1.6/R9.5). The file: detaches `responders_agency_id_fkey` and sets dangling
    `responders.agency_id = null` (R9.3); `drop table if exists public.agencies cascade` and **recreates**
    `agencies` with `tenant_id uuid not null references public.tenants(id) on delete restrict`
    (R1.1/R1.2/R1.3), `name text check char_length 2..64`, `code text check char_length 2..12`, `agency_type
text check (agency_type in ('FIRE','POLICE','MEDICAL','DRRM','OTHER'))` (R1.4/R1.5), `active boolean not
null default true`, timestamps + `touch_updated_at` trigger; drops the global
    `agencies_name_lower_uniq`/`agencies_code_lower_uniq` by virtue of the recreate and adds **per-tenant**
    `agencies_name_lower_per_tenant_uniq (tenant_id, lower(name))` and `agencies_code_lower_per_tenant_uniq
(tenant_id, lower(code))` plus `agencies_tenant_id_idx` (R1.7-R1.11); re-seeds BFP→FIRE / PNP→POLICE /
    EMS→MEDICAL / DRRM→DRRM for the seed tenant `7e000000-0000-4000-8000-000000000001` (any other seed org →
    OTHER) (R2.2/R2.3/R9.2/R9.4); re-adds the nullable `responders_agency_id_fkey` `on delete set null`
    (R4.8/R9.3/R9.6); creates the normalized `tenant_capability_config (tenant_id, category, agency_type,
primary key (tenant_id, category, agency_type))` with the frozen-category + agency-type CHECKs and a
    `(tenant_id, category)` index (R5.3/R5.4); and applies the deny-by-default grant pattern — revoke from
    anon/authenticated/service_role, `grant select, insert, update, delete` to `aira_app` on both new tables
    (R1.12).
  - Schema-file only: do NOT run `db:reset`. The per-tenant uniqueness + agency_type CHECK are mirrored in the
    in-memory store (task 4) so the `23505 → 409` and taxonomy paths are exercised without a DB.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 2.2, 2.3, 9.1, 9.2, 9.3, 9.4, 9.5_

### Phase 3 — Store port + domain types (design "PlatformStore port additions")

- [x] 3. Add responder-network domain types and extend the PlatformStore port
  - Edit `apps/web/src/lib/platform/types.ts`: import `AgencyType` + `EmergencyCategoryId` from `@aira/ui`; add
    `AgencyRecord`, `CapabilityConfig` (`Readonly<Record<EmergencyCategoryId, readonly AgencyType[]>>`), and
    `CreateAgencyStoreInput`; add to the `PlatformStore` interface the methods `createAgency`,
    `listAgenciesForTenant`, `findAgencyById`, `renameAgency`, `setAgencyActive`, `findOfficeTenantId`,
    `readCapabilityConfig`, and `setCapabilityForCategory` with the documented signatures (including the
    discriminated `{ status: 'ok' | 'tenant_not_found' }` create result and the `23505`-throwing rename).
  - Types-only change; typecheck must stay green. No standalone test task (the interface is exercised by tasks
    4 and 5).
  - _Requirements: 1.1, 3.1, 3.2, 3.5, 3.6, 5.1, 5.2, 5.3, 5.4, 9.8_

- [x] 4. Implement the in-memory store methods (TDD)
  - [x] 4.1 Write failing tests for the in-memory store
    - Extend `apps/web/tests/platform-store.test.ts` asserting: `createAgency` returns `tenant_not_found` for
      an unknown tenant and `{ status: 'ok', agency }` for a present tenant, persisting `tenantId`/trimmed
      `name`/trimmed `code`/`agencyType`/`active:true`; a **per-tenant** case-insensitive duplicate `name` or
      `code` throws `Object.assign(new Error('dup'), { code: '23505' })` while the same value in a different
      tenant succeeds; `listAgenciesForTenant` returns only that tenant's agencies; `findAgencyById` and
      `findOfficeTenantId` return the row/tenant or null; `renameAgency` updates name/code (throwing `23505`
      on collision) and returns null for a missing id; `setAgencyActive` flips the flag, retains the row, and
      returns null for a missing id; `readCapabilityConfig` returns `null` when no rows exist;
      `setCapabilityForCategory` de-duplicates, full-replaces exactly one category's set, leaves the other
      three unchanged, and is idempotent on a repeated identical call.
    - _Requirements: 1.1, 1.7, 1.8, 1.9, 1.10, 3.2, 3.4, 3.5, 3.6, 5.3, 5.4, 5.5, 9.8_
  - [x] 4.2 Implement the in-memory store methods
    - Edit `apps/web/tests/support/memory-platform-store.ts` to implement all eight methods over `Map`s
      (`agencies: Map<id, AgencyRecord>`, `capability: Map<tenantId, Map<category, Set<AgencyType>>>`),
      enforcing the same per-tenant case-insensitive `name`/`code` uniqueness by throwing
      `{ code: '23505' }`, proving tenant existence for `createAgency`, and returning the identical
      discriminated outcomes to the postgres adapter (R9.8).
    - _Requirements: 1.1, 1.7, 1.8, 1.9, 1.10, 3.2, 3.4, 3.5, 3.6, 5.3, 5.4, 5.5, 9.8_

- [x] 5. Implement the postgres store methods (TDD)
  - [x] 5.1 Write failing tests for the postgres store methods
    - Extend `apps/web/tests/platform-postgres-store.test.ts` against mocked `query`/`queryOne`/
      `withTransaction` (the existing pattern), asserting: `createAgency` runs a present-tenant check
      (`select 1 from public.tenants`) distinguishing `tenant_not_found` from the insert, inserts
      `(tenant_id, name, code, agency_type, active=true)`, and lets a `23505` bubble up unchanged;
      `readCapabilityConfig` maps rows into a `Record<category, agencyType[]>` and returns `null` for zero
      rows; `setCapabilityForCategory` runs inside `withTransaction` as delete-one-category-then-insert and
      re-reads the full config; `renameAgency`/`setAgencyActive`/`findAgencyById`/`findOfficeTenantId`/
      `listAgenciesForTenant` issue the expected statements and shape results identically to the in-memory
      store.
    - _Requirements: 1.1, 3.2, 3.4, 3.5, 3.6, 5.1, 5.3, 5.4, 9.8_
  - [x] 5.2 Implement the postgres store methods
    - Edit `apps/web/src/lib/platform/postgres-store.ts`: implement all eight methods per 5.1 — `createAgency`
      with the present-tenant guard + `23505` bubble, `readCapabilityConfig` row→record mapping with `null`
      for none, `setCapabilityForCategory` as a transactional per-category full-replace returning the whole
      config, and the agency read/rename/activate + office→tenant lookups — behavior-compatible with the
      in-memory adapter (R9.8).
    - _Requirements: 1.1, 3.2, 3.4, 3.5, 3.6, 5.1, 5.3, 5.4, 9.8_
  - [x]* 5.3 Write property test — store adapter equivalence
    - **Property 13: Store adapter equivalence** — for any sequence of agency/responder/capability create,
      read, rename, and activation operations with identical inputs, the in-memory and Postgres stores return
      the same discriminated outcome and persisted result (incl. `23505 → conflict`, `tenant_not_found`, and
      `cross_tenant`/`not_found` distinctions); model-based, replaying one op sequence against both adapters.
    - **Validates: Requirements 9.8**

### Phase 4 — Routing engine change (R6.*, R9.6, R9.7)

- [x] 6. Re-key the Routing_Engine on Capability_Config + Agency_Type (TDD)
  - [x] 6.1 Write failing tests for the new routing signatures
    - Update `apps/web/tests/routing.test.ts` to the new signatures: `isCapable(category, agencyType, config)`
      (null agencyType ⇒ capable of anything; a type present in `config[category]` ⇒ capable; a type absent /
      empty set / outside taxonomy ⇒ non-capable, never throwing); `rankResponders(category, incident,
candidates, config)` preserves the precedence (capable band, then known-before-unknown base distance /
      nearer-before-farther, then `callsign.localeCompare` tiebreak), filters to `role === 'RESPONDER'`, is
      pure (deep-frozen inputs unchanged, two identical runs identical), and under `DEFAULT_CAPABILITY_CONFIG`
      reproduces the legacy `CATEGORY_AGENCY_CAPABILITY` result for every (category, type) pair. Assert
      `DEFAULT_CAPABILITY_CONFIG` equals `{ SUNOG:['FIRE'], MEDIKAL:['MEDICAL'], KRIMEN:['POLICE'], BAHA:[] }`
      and that `RoutingCandidate` now carries `agencyType: AgencyType | null`.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 9.6, 9.7_
  - [x] 6.2 Implement the routing-engine changes
    - Edit `apps/web/src/lib/routing.ts`: change `isCapable` and `rankResponders` to the new signatures;
      swap `RoutingCandidate.agencyCode: string | null` for `agencyType: AgencyType | null`; export
      `DEFAULT_CAPABILITY_CONFIG`; remove the module-level `CATEGORY_AGENCY_CAPABILITY` dependency from the
      predicate while copying the `.sort` comparator verbatim (ordering/role-filter/purity untouched).
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 9.6, 9.7_
  - [x] 6.3 Update the routing-candidate source and dispatcher path to the new signature
    - Edit `apps/web/src/lib/incidents-store.ts` so `listRoutingCandidates` projects `a.agency_type as
"agencyType"` instead of `a.code as "agencyCode"`; edit `apps/web/src/lib/api/incidents-handlers.ts` so
      the dispatcher path resolves the **incident tenant's** config via `readCapabilityConfig(incidentTenantId)`
      (falling back to `DEFAULT_CAPABILITY_CONFIG`) and passes it into `rankResponders`. Update every other
      existing caller of `rankResponders`/`isCapable` and any routing fixtures/clients to the new signature so
      `pnpm check` stays green.
    - _Requirements: 6.1, 6.3, 9.7_
  - [x]* 6.4 Write property test — capability determination
    - **Property 8: Capability determination (generalist, default-equals-legacy, unresolved)** — null type ⇒
      capable of every category; under `Default_Capability_Config` the result equals the legacy
      `CATEGORY_AGENCY_CAPABILITY` for every (category, type) pair; a non-null type absent from
      `config[category]` (empty set or outside taxonomy) ⇒ non-capable, never throwing.
    - **Validates: Requirements 5.9, 6.2, 6.3, 6.6, 9.6**
  - [x]* 6.5 Write property test — ranking precedence and determinism
    - **Property 9: Ranking precedence and determinism** — the result respects pairwise the capable-band →
      known-before-unknown/nearer-before-farther → `callsign.localeCompare` precedence; two identical runs are
      identical and inputs are not mutated (deep-frozen).
    - **Validates: Requirements 6.4, 6.7**
  - [x]* 6.6 Write property test — only RESPONDER candidates are suggested
    - **Property 10: Only RESPONDER candidates are suggested** — every suggestion has `role === 'RESPONDER'`;
      no `DISPATCHER`/`ADMIN` candidate appears.
    - **Validates: Requirements 6.5**

### Phase 5 — Service module (design "Service functions")

- [x] 7. Implement agency + capability service functions (TDD)
  - [x] 7.1 Write failing tests for the agency + capability service fns
    - Add `apps/web/tests/responder-network-service.test.ts` (service over the in-memory store) covering:
      `createAgency` trims + validates name 2..64 / code 2..12 (`invalid`), rejects a non-member/missing
      `agencyType` (`invalid_type`) without echoing the value, maps the store's `tenant_not_found`, maps
      `23505 → conflict`, and on success returns the persisted record; `renameAgency`/`setAgencyActive`
      resolve the agency first, return `not_found` for a missing id, `cross_tenant` when the agency's
      `tenant_id` differs from the acting scope, re-run length + `23505→conflict` on rename, and flip only the
      boolean on activate (no delete); `readCapabilityConfig` returns the stored config or the
      `Default_Capability_Config` when none stored (total four-key map); `setCapabilityForCategory` rejects a
      non-frozen category or non-taxonomy type (`invalid`), de-duplicates, full-replaces one category, and is
      idempotent.
    - _Requirements: 2.4, 2.5, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 5.1, 5.3, 5.4, 5.5, 5.7, 5.8, 5.9_
  - [x] 7.2 Implement the agency + capability service fns
    - Create `apps/web/src/lib/responder-network/service.ts` with `ActingScope`, the discriminated result
      types, and `createAgency` / `renameAgency` / `setAgencyActive` / `listAgenciesForTenant` /
      `readCapabilityConfig` / `setCapabilityForCategory`, mirroring `createTenant`'s validation + `23505 →
conflict` mapping and filling absent categories with `DEFAULT_CAPABILITY_CONFIG` so reads are total.
    - _Requirements: 2.4, 2.5, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 5.1, 5.3, 5.4, 5.5, 5.7, 5.8, 5.9_
  - [x] 7.3 Write failing tests for `provisionResponder`
    - Extend `responder-network-service.test.ts`: missing `officeId` → `invalid` (R4.2); unknown office →
      `office_not_found` (R4.3); office in another tenant → `office_cross_tenant` (R4.4); supplied agency
      unknown → `agency_not_found` (R4.5); agency in another tenant → `agency_cross_tenant` (R4.6); inactive
      agency → `agency_inactive` (R4.7); no `agencyId` ⇒ created with `agency_id null` as a DRRM_Generalist
      (R4.8); success composes `createResponder` returning the one-time password + `ACCOUNT_CREATED` audit
      unchanged, with no coordinate written (R4.1/R4.9).
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9_
  - [x] 7.4 Implement `provisionResponder`
    - Add `provisionResponder(deps, scope, input)` to `responder-network/service.ts` composing the existing
      `createResponder` behind the tenant-safety checks (resolve office via `findOfficeTenantId`, agency via
      `findAgencyById`, enforce scope/active), surfacing `createResponder`'s result (password, audit, `409`)
      unchanged for the DRRM_Generalist and affiliated paths.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9_
  - [x]* 7.5 Write property test — Agency_Type validation accepts exactly the taxonomy
    - **Property 1: Agency_Type validation accepts exactly the taxonomy** — a create/rename/capability request
      accepts a value iff it is in `{FIRE,POLICE,MEDICAL,DRRM,OTHER}`; any other (incl. missing) is rejected
      with a generic `invalid_agency_type`, no row changes, and the error never echoes the value.
    - **Validates: Requirements 1.4, 1.5, 2.4, 2.5**
  - [x]* 7.6 Write property test — per-tenant case-insensitive name/code uniqueness
    - **Property 2: Per-tenant case-insensitive name/code uniqueness** — two distinct tenants may each hold an
      agency with a case-equal `name`/`code`; a create/rename giving one tenant a case-insensitive duplicate →
      `409 agency_exists`, no row changed, pre-existing row intact.
    - **Validates: Requirements 1.7, 1.8, 1.9, 1.10, 3.4**
  - [x]* 7.7 Write property test — agency create/rename/activate round-trip + length validation
    - **Property 3: Agency create/rename/activate round-trip + length validation** — create succeeds iff
      trimmed name ∈ 2..64 and trimmed code ∈ 2..12 (valid type, tenant exists); success persists exactly one
      matching row; rename reads back the trimmed values; `setAgencyActive(b)` reads back `active === b` and
      retains the row (idempotent on repeat); out-of-range length → `400 invalid_agency`, no write.
    - **Validates: Requirements 3.2, 3.3, 3.5, 3.6**
  - [x]* 7.8 Write property test — responder staffing is tenant-safe
    - **Property 4: Responder staffing is tenant-safe** — `provisionResponder` creates exactly one responder
      iff the office exists and is in the acting tenant and (if an agency is supplied) the agency exists,
      shares the office's tenant, and is active; every other case refuses (office-other-tenant→403,
      agency-other-tenant/inactive→400, unknown office/agency→404) and creates nothing; no agency ⇒
      `agency_id` null.
    - **Validates: Requirements 4.2, 4.3, 4.4, 4.6, 4.7, 4.8**
  - [x]* 7.9 Write property test — capability update is a de-duplicated full replace
    - **Property 5: Capability update is a de-duplicated full replace (idempotent)** — after
      `setCapabilityForCategory` the stored set equals the set of distinct submitted types exactly (replace,
      not merge), the other three categories are unchanged, read-after-write matches, and a repeated identical
      update leaves the config unchanged.
    - **Validates: Requirements 5.2, 5.4, 5.5**
  - [x]* 7.10 Write property test — capability read is total with default fallback
    - **Property 6: Capability read is total with default fallback** — a read returns a total map keyed
      exactly by `{SUNOG,MEDIKAL,KRIMEN,BAHA}`; a tenant with no stored config reads back exactly
      `Default_Capability_Config`.
    - **Validates: Requirements 5.1, 5.3, 9.7**
  - [x]* 7.11 Write property test — capability update validation
    - **Property 7: Capability update validation** — an update is accepted iff the category is in the frozen
      set and every submitted type is in the taxonomy; otherwise `400 invalid_capability` and the stored
      config is unchanged.
    - **Validates: Requirements 5.7**

### Phase 6 — Handlers + routes (both tiers) (design "Route shapes" + "Handlers")

- [x] 8. Implement the operator-tier handlers + routes (TDD)
  - [x] 8.1 Write failing integration tests for the operator routes
    - Add `apps/web/tests/api-platform-responder-network.test.ts` mirroring `api-platform.test.ts` over the
      in-memory store: for `POST/GET /api/platform/tenants/[id]/agencies`, `PATCH
/api/platform/agencies/[agencyId]`, `GET/PATCH /api/platform/tenants/[id]/capability`, `POST
/api/platform/tenants/[id]/responders` assert the full status table (201/200/400
      `invalid_agency|invalid_agency_type|invalid_capability|invalid_responder|invalid_json`/404
      `tenant_not_found|agency_not_found|office_not_found`/409 `agency_exists`/403 `forbidden` office-other-
      tenant); 401 without a platform cookie and 401 with a responder/citizen cookie (cross-tier isolation,
      reuse the cross-tier helper) (R7.1); 403 `forbidden_origin` on cross-site mutation with no write (R7.3);
      **operator cross-tenant allowed** (acting on another tenant's resource succeeds) (R7.2); a successful
      provision returns the one-time password + appends `ACCOUNT_CREATED` (R4.1/R4.9); a logger spy asserts no
      coordinate value is ever logged (R7.6).
    - _Requirements: 3.1, 3.2, 3.5, 3.6, 3.7, 3.8, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 5.1, 5.2, 5.6, 5.7, 7.1, 7.2, 7.3, 7.6_
  - [x] 8.2 Implement the operator-tier handlers
    - Edit `apps/web/src/lib/api/platform-handlers.ts`: add `handlePlatformCreateAgency`,
      `handlePlatformListAgencies`, `handlePlatformUpdateAgency`, `handlePlatformReadCapability`,
      `handlePlatformSetCapability`, `handlePlatformProvisionResponder`, each `isSameOrigin`→403 (mutations)
      → `requirePlatform`→401 → `readJsonObject`→400 → call the shared service with
      `scope = { tenantId }` (from the route) → map results to the status-code table →
      `NO_STORE_HEADERS`/`PRIVATE_CACHE_HEADERS`; `notifySafe` post-success hook carries only identity
      (never coordinates).
    - _Requirements: 3.1, 3.2, 3.5, 3.6, 3.7, 3.8, 4.1, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 5.1, 5.2, 5.7, 7.1, 7.2, 7.3, 7.6_
  - [x] 8.3 Add the operator routes
    - Create `apps/web/app/api/platform/tenants/[id]/agencies/route.ts` (`POST` + `GET`),
      `apps/web/app/api/platform/agencies/[agencyId]/route.ts` (`PATCH`),
      `apps/web/app/api/platform/tenants/[id]/capability/route.ts` (`GET` + `PATCH`), and
      `apps/web/app/api/platform/tenants/[id]/responders/route.ts` (`POST`), each with
      `export const runtime='nodejs'` / `dynamic='force-dynamic'`, the `getAppDeps()`→503 wrapper, `await
ctx.params`, delegating to the handlers.
    - _Requirements: 3.1, 4.1, 5.1, 5.2_

- [x] 9. Implement the DRRM_Admin-tier handlers + routes (TDD)
  - [x] 9.1 Write failing integration tests for the admin routes
    - Extend `api-platform-responder-network.test.ts` (or add `apps/web/tests/api-admin-responder-network.test.ts`
      mirroring `api-admin.test.ts`): for `POST/GET /api/admin/agencies`, `PATCH /api/admin/agencies/[id]`,
      `GET/PATCH /api/admin/capability`, and the extended `POST /api/admin/responders` assert the same status
      table scoped to the session tenant; 401 without a responder session and 401 with a platform/citizen
      cookie (cross-tier isolation) (R7.1); 403 for a non-`responder:manage` role (R7.2); **DRRM_Admin
      cross-tenant rejected** — a resource known to belong to another tenant → **403** on id-bearing routes
      (agency edit/activate, responder office) (R7.4) and a resource not visible in-tenant → **404** on
      own-tenant-keyed reads/writes (capability, agency list) (R7.5); an unauthorized capability update leaves
      the config unchanged (R5.6); 403 `forbidden_origin` on cross-site mutation (R7.3); the tenant is read
      from `principal.tenantId` and never from a URL.
    - _Requirements: 3.1, 3.2, 3.5, 3.6, 4.1, 4.4, 5.1, 5.2, 5.6, 7.1, 7.2, 7.3, 7.4, 7.5, 7.7_
  - [x] 9.2 Implement the DRRM_Admin-tier handlers
    - Edit `apps/web/src/lib/api/admin-handlers.ts`: add `handleAdminCreateAgency`, `handleAdminListAgencies`,
      `handleAdminUpdateAgency`, `handleAdminReadCapability`, `handleAdminSetCapability`, and extend the
      existing responder-create handler, each `isSameOrigin`→403 → `authenticate`→401 →
      `requirePermission('responder:manage')`→403 → call the **same** shared service with
      `scope = { tenantId: context.principal.tenantId }`; map the service's `cross_tenant` vs `not_found`
      discriminant to 403 (id-bearing routes) vs 404 (own-tenant-keyed routes) per the R7.4/R7.5 rule.
    - _Requirements: 3.1, 3.2, 3.5, 3.6, 4.1, 4.4, 5.1, 5.2, 7.1, 7.2, 7.3, 7.4, 7.5, 7.7_
  - [x] 9.3 Add the DRRM_Admin routes
    - Create `apps/web/app/api/admin/agencies/route.ts` (`POST` + `GET`),
      `apps/web/app/api/admin/agencies/[id]/route.ts` (`PATCH`), and
      `apps/web/app/api/admin/capability/route.ts` (`GET` + `PATCH`), each the standard `getAppDeps()`→503
      wrapper with `await ctx.params`; wire the extended handler into the existing
      `apps/web/app/api/admin/responders/route.ts`.
    - _Requirements: 3.1, 4.1, 5.1, 5.2_
  - [x]* 9.4 Write property test — tenant isolation on every management action
    - **Property 11: Tenant isolation on every management action** — an operator scope may act on any tenant's
      resource; a DRRM_Admin scope may act only on its own tenant's resources (known-other-tenant → 403,
      not-visible-in-tenant → 404); in either refusal nothing is read or modified.
    - **Validates: Requirements 7.4, 7.5, 7.7**
  - [x]* 9.5 Write property test — no coordinate ever leaves a management action
    - **Property 12: No coordinate ever leaves a management action** — for any management request/response
      (success or error) and any audit entry, the serialized output contains no coordinate value; payloads
      carry only identity/status fields.
    - **Validates: Requirements 7.6, 4.9**

### Phase 7 — Backend checkpoint

- [x] 10. Checkpoint — backend green
  - Run `pnpm --filter @aira/web test` and `pnpm --filter @aira/web typecheck` (plus `pnpm --filter @aira/ui
test` for the taxonomy); ensure all taxonomy/store/service/routing/handler tests pass. Ask the user if
    questions arise.
  - _Requirements: 3.1, 5.1, 6.1, 7.1_

### Phase 8 — Client + UI (design "Client + UI")

- [x] 11. Add agency/capability client helpers and i18n keys (TDD)
  - [x] 11.1 Write failing tests for the client parsers
    - Add client tests (mirroring `platform-client.test.ts`) for the parse-at-boundary helpers: an
      `AgencyRecord[]` parser (shape + rejection of malformed input), a `CapabilityConfig` parser (total
      four-key map, agency-type lists), and the provision-response parser (responder + one-time password).
    - _Requirements: 5.1, plus the client-facing bits of 3/4_
  - [x] 11.2 Implement the client helpers + i18n keys
    - Edit `apps/web/src/lib/platform-client.ts` (operator) and add a small admin client helper (DRRM_Admin)
      with `loadAgencies(tenantId?)`, `createAgency`, `renameAgency`, `setAgencyActive`, `loadCapability
(tenantId?)`, `setCapability(category, agencyTypes)`, `provisionResponder(...)`, all using
      `credentials: 'same-origin'` + `cache: 'no-store'`; add all new copy keys to `packages/ui/src/i18n.ts`
      (`agencyTypeFire|Police|Medical|Drrm|Other`, `agencyNetworkTitle`, `agenciesTitle`, `addAgency`,
      `agencyNameLabel`, `agencyCodeLabel`, `agencyTypeLabel`, `agencyActiveLabel`, `renameAgency`,
      `deactivateAgency`, `deactivateAgencyTitle`, `deactivateAgencyBody`, `activateAgency`, `agencyCreated`,
      `agencyCreateFailed`, `agencyRenamed`, `agencyUpdateFailed`, `capabilityTitle`, `capabilityCategory`,
      `capabilitySaved`, `capabilitySaveFailed`, `capabilityUnavailable`, `staffResponderTitle`).
    - _Requirements: 2.6, 5.1, 8.1, plus the client-facing bits of 3/4_

- [x] 12. Implement the operator `AgencyNetworkPanel` (TDD)
  - [x] 12.1 Write failing component tests for `AgencyNetworkPanel`
    - Component-test (jsdom, map-free): first-load `Skeleton` for agencies/capability (R8.2); add-agency form
      posts and on success toasts via `useToast()` + refetches (R8.3); a generic coordinate-free failure toast
      leaves data unchanged (R8.4); rename inline; deactivate gated by `ConfirmDialog`, mutation only after
      confirm, cancel aborts with no network call (R8.5/R8.6); capability editor renders one row per frozen
      category with five Agency_Type toggles, an empty set is allowed, toggling PATCHes a full-replace;
      offline/timeout surfaces an "unavailable" toast (R8.7); every label resolves through `t()` and icons
      come from `@aira/ui/web` (R8.1/R2.6).
    - _Requirements: 2.6, 5.4, 5.9, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_
  - [x] 12.2 Implement `AgencyNetworkPanel` and hang it off `PlatformTenants`
    - Create `apps/web/src/components/AgencyNetworkPanel.tsx` (agencies list/add/rename/deactivate, capability
      editor of per-category Agency_Type `Checkbox` toggles, responder staffing form reusing the
      `AdminResponders` create-form shape with tenant-scoped office/agency `Select`s and a once-shown one-time
      password), using Lucide icons via `@aira/ui/web`, tokens, `t()`, `Skeleton`, `useToast`, and
      `ConfirmDialog`; wire it into `apps/web/src/components/PlatformTenants.tsx` as a per-tenant expandable
      panel (same toggle pattern as `OfficeTreePanel`). Never blocks the Tier-0 SOS path.
    - _Requirements: 2.6, 3.1, 4.1, 5.1, 5.2, 5.4, 5.9, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_
- [x] 13. Implement the DRRM_Admin agency + capability editors (TDD)
  - [x] 13.1 Write failing component tests for the admin editors
    - Component-test (jsdom, mirroring `admin-responders.test.tsx`): tenant-scoped agencies + capability
      editors (no tenant picker) render the first-load `Skeleton`, success/failure toasts with data unchanged
      on failure, `ConfirmDialog`-gated deactivate, and the existing responder create-form's agency `Select`
      now lists the tenant's agencies from `GET /api/admin/agencies`; labels via `t()`, icons via
      `@aira/ui/web`.
    - _Requirements: 2.6, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_
  - [x] 13.2 Implement the DRRM_Admin editors in `AdminResponders`/admin tabs
    - Edit `apps/web/src/components/AdminResponders.tsx` (and the admin tabbed surface as the design places
      them) to add the tenant-scoped agencies + capability editors using the admin client helper, reusing the
      same Operate Mode primitives; point the responder create-form's agency `Select` at the tenant's
      agencies. Never blocks the Tier-0 SOS path.
    - _Requirements: 2.6, 3.1, 4.1, 5.1, 5.2, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

### Phase 9 — Full-suite checkpoint

- [x] 14. Checkpoint — full suite green
  - Run `pnpm check`; ensure typecheck + all tests across packages pass. Ask the user if questions arise.
  - _Requirements: 6.1, 8.1, 8.2_

### Phase 10 — Documentation

- [x] 15. Update governing documentation
  - Edit `SECURITY.md` to record the responder-network tenant isolation and the **two-tier authority** model
    (Platform_Operator cross-tenant; DRRM_Admin own-tenant via `responder:manage`), deny-by-default +
    SQL-bounded scope, and the no-coordinate-in-logs/URLs/errors rule on the new endpoints; update `PRODUCT.md`
    (category→agency capability is now per-tenant configurable; agencies are tenant-owned; routing unchanged
    under the shipped default); update `DESIGN.md` (operator `AgencyNetworkPanel` + DRRM_Admin agency/
    capability editors following skeleton/toast/ConfirmDialog/Lucide/token rules); add a `2026-10-22`
    change-log entry to `AGENTS.md` summarizing the feature and the new migration after `20261022240000`.
  - _Requirements: 7.4, 7.5, 7.6, 7.7_

### Final gate

- [x] 16. Final checkpoint — run the quality gate
  - Run `pnpm check` (must be green), then `pnpm format`. Ask the user if questions arise.
  - _Requirements: 3.1, 5.1, 6.1, 7.1_

## Notes

- Tasks marked with `*` are optional property-based tests (Properties 1–13) and can be skipped for a faster
  MVP; all other sub-tasks are implemented.
- Every `.1` sub-task establishes failing tests before the `.2` implementation, setting the TDD pattern for
  the whole plan.
- Each task references the specific acceptance criteria it satisfies for traceability.
- Checkpoints (10, 14, 16) ensure incremental validation; `pnpm check` must stay green after every task.
- The whole API is tested against the in-memory `PlatformStore` + fakes — no Postgres, no network required for
  the default test run; the Postgres-backed equivalence/schema checks run only when a DB is configured.
- This feature has no map and no coordinates in any payload; UI component tests are map-free.
- Property coverage by owning phase: P1–P7 (service, task 7), P8–P10 (routing, task 6), P11–P12 (handlers,
  task 9), P13 (store equivalence, task 5).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["3"] },
    { "id": 3, "tasks": ["4.1", "5.1", "6.1"] },
    { "id": 4, "tasks": ["4.2", "5.2", "6.2"] },
    { "id": 5, "tasks": ["5.3", "6.3", "6.4", "6.5", "6.6"] },
    { "id": 6, "tasks": ["7.1", "7.3"] },
    { "id": 7, "tasks": ["7.2", "7.4"] },
    { "id": 8, "tasks": ["7.5", "7.6", "7.7", "7.8", "7.9", "7.10", "7.11"] },
    { "id": 9, "tasks": ["8.1"] },
    { "id": 10, "tasks": ["8.2"] },
    { "id": 11, "tasks": ["8.3", "9.1"] },
    { "id": 12, "tasks": ["9.2"] },
    { "id": 13, "tasks": ["9.3", "9.4", "9.5"] },
    { "id": 14, "tasks": ["11.1"] },
    { "id": 15, "tasks": ["11.2"] },
    { "id": 16, "tasks": ["12.1", "13.1"] },
    { "id": 17, "tasks": ["12.2", "13.2"] },
    { "id": 18, "tasks": ["15"] }
  ]
}
```
