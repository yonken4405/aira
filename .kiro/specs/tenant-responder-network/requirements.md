# Requirements Document

## Introduction

AIRA is a multi-tenant DRRM 911 dispatch platform. The just-shipped `tenant-office-management`
feature lets a Platform_Operator grow a tenant's Office_Tree by adding BARANGAY offices under the
tenant's single LGU. That feature is deliberately narrow: it only shapes _where_ a tenant has
offices. It does not describe _who responds_ from those offices. This feature closes that gap by
connecting the emergency-responding organizations (firefighters/BFP, police/PNP, medical/EMS, DRRM
rescue) and their responders to a tenant's offices, and by making the category→agency capability
that drives routing configurable per tenant instead of hardcoded.

Three capabilities ship together as one coherent surface, layered onto the existing office tree
without changing its shape:

1. **Tenant-scoped agency presence.** Today `public.agencies` is a flat GLOBAL table (id, name,
   code, active) with no tenant ownership. This feature makes each tenant own its agency/station
   rows. A small, stable, shared **agency-type** taxonomy (FIRE / POLICE / MEDICAL / DRRM / OTHER)
   becomes the capability key; the human-named rows (e.g. "Cebu City Fire Station") are per-tenant
   and carry a type. Operators/admins create, rename, and activate/deactivate a tenant's agencies.

2. **Responder provisioning into a specific office + agency.** Responder creation already takes an
   `officeId` and a nullable `agencyId` (`createResponder` in the auth service). This feature makes
   that staffing tenant-safe: a responder may only be placed into an office belonging to its
   tenant, and any agency chosen for that responder must belong to the same tenant.

3. **Per-tenant category→agency capability configuration.** The hardcoded
   `CATEGORY_AGENCY_CAPABILITY` map in `apps/web/src/lib/routing.ts` (SUNOG→BFP, MEDIKAL→EMS,
   KRIMEN→PNP, BAHA→DRRM-generalist) becomes a per-tenant mapping from SOS category → capable
   agency-type(s). The routing engine reads that per-tenant configuration and the responder's
   agency-type instead of the hardcoded agency-code map. Agency-less responders remain DRRM
   generalists capable of any category (the always-present fallback), and the shipped default
   configuration mirrors today's behavior so routing is unchanged out of the box.

This feature is an online, operator/admin-facing management surface and is therefore **Tier 2**: it
must degrade to an honest "unavailable" state when offline and must never block the frozen Tier-0
anonymous mesh SOS. It changes neither the frozen mesh payload nor the one-LGU-per-tenant office
shape. All new management actions respect deny-by-default RBAC, tenant isolation bounded in SQL,
boundary validation, audit logging, and the rule that coordinates never appear in logs or URLs.

### In Scope

- Tenant ownership of agencies: a new `tenant_id` on agency rows plus a stable agency-type taxonomy.
- Management (create / rename / activate / deactivate) of a tenant's agencies, scoped to that tenant.
- Per-tenant case-insensitive uniqueness of agency name and code (mirroring the office-name-per-tenant
  decision), replacing the global uniqueness indexes.
- Tenant-safe responder provisioning into a specific office + agency.
- A per-tenant, configurable mapping from SOS category to capable agency-type(s).
- A routing engine that consumes the per-tenant capability configuration and agency-type, preserving
  the agency-less DRRM-generalist fallback and today's behavior under the default configuration.
- Tenant isolation, deny-by-default RBAC, boundary validation, and audit logging for every new action.
- Operate Mode management UI (skeletons, toasts, ConfirmDialog, Lucide icons, tokens, `t()` copy) that
  degrades honestly offline (Tier 2).
- A migration that recreates the agencies table in its tenant-scoped shape (no pre-existing global agency
  rows preserved) while keeping real responders and routing behavior working.

### Out of Scope

- A second LGU per tenant, or any change to the office-tree shape (frozen one-LGU-per-tenant rule).
- Moving/reparenting an agency or responder across tenants, or changing an agency's/responder's `tenant_id`.
- Any change to the frozen mesh payload, the anonymous Tier-0 SOS path, or the mesh transport abstraction.
- WebSockets/SSE, real LoRa/Bluetooth radio, the responder mobile app, and anything in PRODUCT.md §2
  (voice/STT/chat/LLM/AI).
- Changing which tenant/LGU anonymous mesh intake resolves to (intake still resolves the first active LGU).
- Any new paid/keyed third-party provider.

### Resolved Decisions

- **OQ1 — Ownership of agency management and responder staffing: BOTH.** Both the Platform_Operator
  (across any Tenant) and the Tenant's own DRRM_Admin (self-serve, bounded to its own Tenant) may manage
  agencies, provision responders, and configure capability. The DRRM_Admin is bounded to its own Tenant;
  the Platform_Operator is not cross-tenant-bounded.
- **OQ2 — Migration of existing global agencies: RECREATE.** Existing global Agency rows are not preserved.
  The migration drops and recreates the agencies table with tenant ownership, Agency_Type, and per-tenant
  uniqueness from the start; no data-preservation guarantee for pre-existing global Agency rows is required.
- **OQ3 — Level at which agency presence is modeled: TENANT/LGU level.** Agency presence is modeled at the
  Tenant level (the Tenant's LGU has stations covering the whole jurisdiction). There is no per-office
  agency-presence table. Responders are still assigned to a specific Office and optionally affiliated with
  one of the Tenant's agencies.

## Glossary

- **Platform_Operator**: A superadmin principal authenticated by the `aira_platform_session` cookie. Manages
  tenants/offices and bootstraps a tenant's first DRRM Admin. Carries no role, no `incident:*` access, and no
  citizen/medical access (SECURITY.md §12). May manage the responder network (agencies, responder staffing,
  capability) across any Tenant (not cross-tenant-bounded).
- **DRRM_Admin**: A tenant-scoped ADMIN responder (the DRRM officer). Holds `responder:manage` and audit/
  metrics read, and read-only incident oversight; holds no dispatch permission (SECURITY.md §4). May manage
  the responder network (agencies, responder staffing, capability) within its own Tenant only.
- **Tenant**: A subscribing LGU/barangay DRRM organization (`public.tenants`): `name`, `region`, `province`,
  `status ∈ {active, suspended}`. Onboarded in person.
- **Office**: A row in `public.offices` owned by exactly one Tenant (`tenant_id` NOT NULL), with
  `kind ∈ {LGU, BARANGAY}`.
- **Office_Tree**: A Tenant's single LGU_Office plus its Barangay_Offices (unchanged by this feature).
- **Agency**: A responding organization/station owned by exactly one Tenant (e.g. "Cebu City Fire Station").
  Carries a `name`, a `code`, an `active` flag, and an Agency_Type.
- **Agency_Type**: A value from the stable closed taxonomy `{FIRE, POLICE, MEDICAL, DRRM, OTHER}` used as the
  routing capability key. Seeded BFP → FIRE, PNP → POLICE, EMS → MEDICAL, DRRM → DRRM.
- **Responder**: A tenant-scoped account (`public.responders`) placed in exactly one Office (`office_id` NOT
  NULL) and optionally affiliated with one Agency (`agency_id` nullable).
- **DRRM_Generalist**: A Responder with no Agency (`agency_id IS NULL`). Capable of every SOS category; the
  always-present fallback the office keeps (preserved from today's routing).
- **Emergency_Category**: One frozen SOS category id: `SUNOG`, `MEDIKAL`, `KRIMEN`, or `BAHA` (identifiers,
  never display text).
- **Capability_Config**: A per-tenant mapping from each Emergency_Category to the set of Agency_Types capable
  of responding to it. Replaces the hardcoded `CATEGORY_AGENCY_CAPABILITY` map.
- **Default_Capability_Config**: The shipped default Capability_Config that mirrors today's behavior: SUNOG →
  {FIRE}, MEDIKAL → {MEDICAL}, KRIMEN → {POLICE}, BAHA → {} (DRRM_Generalist leads).
- **Routing_Engine**: The pure ranking logic in `apps/web/src/lib/routing.ts` (`isCapable`,
  `rankResponders`, `bestSuggestion`) that suggests responders for an incident.
- **Platform_API**: The `/api/platform/*` and tenant-scoped management request handlers serving the operator/
  admin consoles over the spine `route → platform-handler → service fn → store (postgres | in-memory)`.
- **Same_Origin_Guard**: The mutation-time check that rejects cross-origin requests with `403 forbidden_origin`.
- **Tenant_Isolation**: The deny-by-default rule, bounded in SQL, that no request may read or write an agency,
  responder, office, or configuration belonging to a different Tenant.

## Requirements

### Requirement 1: Tenant-scoped agencies with a stable agency-type

**User Story:** As a platform maintainer, I want each Agency to belong to exactly one Tenant and to carry a stable Agency_Type, so that responding organizations are isolated per tenant and routing has a consistent capability key.

#### Acceptance Criteria

1. THE AIRA_Database SHALL store every Agency with a `tenant_id` referencing exactly one existing row in `public.tenants(id)`.
2. IF an Agency row is written with a null `tenant_id` or a `tenant_id` that does not match an existing `public.tenants(id)`, THEN THE AIRA_Database SHALL reject the write and SHALL leave existing Agency rows unchanged.
3. IF a request attempts to delete a Tenant that still has one or more associated Agency rows, THEN THE AIRA_Database SHALL reject the deletion and SHALL retain both the Tenant and its Agency rows.
4. THE AIRA_Database SHALL store every Agency with an Agency_Type whose value is exactly one of the closed set `{FIRE, POLICE, MEDICAL, DRRM, OTHER}`.
5. IF an Agency row is written with an Agency_Type value that is not exactly one of `{FIRE, POLICE, MEDICAL, DRRM, OTHER}`, THEN THE AIRA_Database SHALL reject the write and SHALL leave existing Agency rows unchanged.
6. THE AIRA_Database schema change SHALL be introduced as a single new timestamp-prefixed migration file under `packages/db/supabase/migrations` and SHALL leave every migration file that existed before this change byte-for-byte unchanged.
7. THE AIRA_Database SHALL enforce case-insensitive uniqueness of an Agency `name` within a single Tenant and SHALL permit two different Tenants to each hold an Agency with the same case-insensitive `name`.
8. IF an Agency row is written whose case-insensitive `name` already exists for the same `tenant_id`, THEN THE AIRA_Database SHALL reject the write and SHALL retain the existing Agency row.
9. THE AIRA_Database SHALL enforce case-insensitive uniqueness of an Agency `code` within a single Tenant and SHALL permit two different Tenants to each hold an Agency with the same case-insensitive `code`.
10. IF an Agency row is written whose case-insensitive `code` already exists for the same `tenant_id`, THEN THE AIRA_Database SHALL reject the write and SHALL retain the existing Agency row.
11. THE migration SHALL remove the global `agencies_name_lower_uniq` and `agencies_code_lower_uniq` indexes and SHALL replace them with per-tenant case-insensitive uniqueness constraints on `name` and `code`.
12. THE migration SHALL grant the `aira_app` role the same deny-by-default least-privilege access pattern applied to other business tables.

### Requirement 2: Agency-type taxonomy as the capability key

**User Story:** As a routing maintainer, I want a small closed Agency_Type taxonomy that maps the seeded organizations onto types, so that capability is expressed by type rather than by free-form codes.

#### Acceptance Criteria

1. THE AIRA_System SHALL define Agency_Type as the closed set of exactly five values `{FIRE, POLICE, MEDICAL, DRRM, OTHER}` and SHALL expose it as a single shared definition consumed by both the Platform_API and the Routing_Engine.
2. WHEN the migration writes the seed agency rows, THE migration SHALL assign Agency_Type FIRE to the BFP row, POLICE to the PNP row, MEDICAL to the EMS row, and DRRM to the DRRM row.
3. IF the migration writes a seed agency row that does not match any of the BFP, PNP, EMS, or DRRM rows, THEN THE migration SHALL assign Agency_Type OTHER to that row.
4. IF a management request supplies an Agency_Type value not a member of the closed five-value set, THEN THE Platform_API SHALL reject the request with HTTP status 400, SHALL return a generic error identifier that does not echo the submitted value, and SHALL NOT insert or update any Agency.
5. IF a management request omits the Agency_Type field, THEN THE Platform_API SHALL reject the request with HTTP status 400, SHALL return a generic error identifier, and SHALL NOT insert or update any Agency.
6. THE AIRA_System SHALL treat Agency_Type values as identifiers and SHALL source every human-facing Agency_Type label from the `@aira/ui` `t()` helper rather than from a hardcoded display string.

### Requirement 3: Manage a tenant's agencies

**User Story:** As an authorized manager, I want to create, rename, and activate or deactivate a Tenant's agencies, so that the tenant's responding organizations reflect reality as it changes.

#### Acceptance Criteria

1. THE Platform_API SHALL expose endpoints to create an Agency for a specified Tenant, to list a Tenant's agencies, to rename an Agency, and to change an Agency's `active` flag.
2. WHEN an authorized manager submits a valid Agency with a target Tenant id, a name, a code, and an Agency_Type, THE Platform_API SHALL insert exactly one Agency row with `tenant_id` equal to the target Tenant id and SHALL return the persisted Agency with HTTP status 201.
3. IF a submitted Agency name has a trimmed length outside 2 to 64 characters inclusive, or a submitted Agency code has a trimmed length outside 2 to 12 characters inclusive, THEN THE Platform_API SHALL reject the request with HTTP status 400, SHALL return a generic error identifier, and SHALL NOT insert or modify any Agency row.
4. IF a submitted Agency name or code on a create or rename request collides case-insensitively with an existing Agency of the same Tenant other than the Agency being renamed, THEN THE Platform_API SHALL reject the request with HTTP status 409, SHALL return a generic error identifier, and SHALL NOT insert or modify any Agency row.
5. WHEN an authorized manager submits a valid rename for an existing Agency, THE Platform_API SHALL update that Agency's name to the submitted value and SHALL return the persisted Agency with HTTP status 200.
6. WHEN an authorized manager changes an Agency's `active` flag, THE Platform_API SHALL set that Agency's `active` flag to the submitted boolean value, SHALL retain the Agency row, and SHALL return the persisted Agency with HTTP status 200.
7. IF a create request targets a Tenant that does not exist, THEN THE Platform_API SHALL reject the request with HTTP status 404 and SHALL NOT insert any Agency row.
8. IF a rename or activation request targets an Agency that does not exist, THEN THE Platform_API SHALL reject the request with HTTP status 404 and SHALL NOT modify any Agency row.

### Requirement 4: Provision responders into a specific office and agency, tenant-safely

**User Story:** As an authorized manager, I want to staff a Responder into a specific Office and optionally affiliate it with an Agency, so that the tenant's responders are assigned to real jurisdictions and organizations without crossing tenant boundaries.

#### Acceptance Criteria

1. WHEN an authorized manager provisions a Responder with a target Office id and an optional Agency id and all validations pass, THE Platform_API SHALL create exactly one Responder with that `office_id` and `agency_id`, SHALL return the created Responder's identity together with a one-time password shown exactly once, and SHALL leave the Responder's role to the existing provisioning path.
2. IF the provisioning request omits a target Office id, THEN THE Platform_API SHALL reject the request with HTTP status 400, SHALL return a generic error identifier, and SHALL NOT create the Responder.
3. IF the target Office id does not reference an existing Office, THEN THE Platform_API SHALL reject the request with HTTP status 404, SHALL return a generic error identifier, and SHALL NOT create the Responder.
4. IF the target Office belongs to a Tenant other than the acting management scope's Tenant, THEN THE Platform_API SHALL reject the request with HTTP status 403, SHALL return a generic error identifier, and SHALL NOT create the Responder.
5. IF a supplied Agency id does not reference an existing Agency, THEN THE Platform_API SHALL reject the request with HTTP status 404, SHALL return a generic error identifier, and SHALL NOT create the Responder.
6. IF a supplied Agency id references an Agency belonging to a Tenant other than the target Office's Tenant, THEN THE Platform_API SHALL reject the request with HTTP status 400, SHALL return a generic error identifier, and SHALL NOT create the Responder.
7. IF a supplied Agency id references an Agency whose `active` flag is false, THEN THE Platform_API SHALL reject the request with HTTP status 400, SHALL return a generic error identifier, and SHALL NOT create the Responder.
8. WHERE a Responder is provisioned with no Agency id, THE Platform_API SHALL create the Responder as a DRRM_Generalist with `agency_id` null.
9. WHEN a Responder is created, THE Platform_API SHALL append an `ACCOUNT_CREATED` entry to the authentication audit trail and SHALL NOT include any coordinate in that entry.

### Requirement 5: Configure per-tenant category-to-agency-type capability

**User Story:** As an authorized manager, I want to configure which Agency_Types are capable of each SOS category for my Tenant, so that routing reflects the tenant's actual responding structure.

#### Acceptance Criteria

1. THE Platform_API SHALL expose an endpoint to read a Tenant's Capability_Config returning the mapping of each Emergency_Category in the frozen set `{SUNOG, MEDIKAL, KRIMEN, BAHA}` to its set of capable Agency_Types.
2. THE Platform_API SHALL expose an endpoint to update the set of capable Agency_Types for one specified Emergency_Category within a specified Tenant.
3. WHEN a Tenant has no stored Capability_Config, THE Platform_API SHALL return the Default_Capability_Config for that Tenant.
4. WHEN an authorized manager sets the capable Agency_Types for an Emergency_Category, THE Platform_API SHALL replace the entire stored set of capable Agency_Types for that Emergency_Category within the Tenant, de-duplicate repeated Agency_Types in the submitted set, and return the updated Capability_Config.
5. WHEN an authorized manager submits an update request identical to the Tenant's currently stored mapping for that Emergency_Category, THE Platform_API SHALL leave the stored Capability_Config unchanged and return the current Capability_Config.
6. IF an update request is not submitted by an authorized manager for the specified Tenant, THEN THE Platform_API SHALL reject the request with an authorization error indicating the caller is not permitted and SHALL NOT persist any change.
7. IF an update request names an Emergency_Category outside the frozen set `{SUNOG, MEDIKAL, KRIMEN, BAHA}`, or names one or more Agency_Types outside the closed taxonomy, THEN THE Platform_API SHALL reject the request with HTTP status 400 and an error indicating the invalid category or agency type, and SHALL NOT persist any change.
8. THE Default_Capability_Config SHALL map SUNOG to `{FIRE}`, MEDIKAL to `{MEDICAL}`, KRIMEN to `{POLICE}`, and BAHA to the empty set.
9. WHERE an Emergency_Category is mapped to the empty set of Agency_Types, THE Routing_Engine SHALL treat only DRRM_Generalists as capable for that category.

### Requirement 6: Route using per-tenant capability and agency-type

**User Story:** As a dispatcher, I want responder suggestions to use my Tenant's Capability_Config and each responder's Agency_Type, so that suggestions match the tenant's configured structure while behaving exactly as before when the default configuration is in effect.

#### Acceptance Criteria

1. WHEN the Routing_Engine ranks candidates for an incident, THE Routing_Engine SHALL determine each candidate's capability for the incident's Emergency_Category from the incident Tenant's Capability_Config and the candidate's Agency_Type.
2. WHILE ranking candidates, THE Routing_Engine SHALL treat every DRRM_Generalist (a candidate with no Agency_Type) as capable of every Emergency_Category regardless of the Capability_Config.
3. WHILE a Tenant uses the Default_Capability_Config, THE Routing_Engine SHALL produce, for every candidate and every Emergency_Category, the identical capability result (capable or non-capable) that the previous hardcoded `CATEGORY_AGENCY_CAPABILITY` map produced.
4. WHEN the Routing_Engine orders candidates, THE Routing_Engine SHALL apply this precedence in order: (a) capable candidates before non-capable candidates; (b) within the same capability band, a candidate with a known base distance before a candidate with an unknown base distance, and among candidates with known base distances the nearer great-circle base distance before the farther; (c) a stable, case-sensitive lexicographic callsign comparison as the final tiebreak so that two runs over the same input yield the same ordering.
5. WHEN the Routing_Engine ranks candidates, THE Routing_Engine SHALL include only candidates whose role is RESPONDER and SHALL exclude all other roles from the suggestion results.
6. IF a candidate's Agency_Type is present but cannot be resolved against the Capability_Config, THEN THE Routing_Engine SHALL treat that candidate as non-capable for every Emergency_Category and SHALL complete ranking without raising an error, while a candidate with no Agency_Type (DRRM_Generalist) remains capable per criterion 2.
7. THE Routing_Engine SHALL remain a pure, deterministic function: given identical inputs (Emergency_Category, incident position, Capability_Config, and candidate set) it SHALL return an identical ordered result and SHALL NOT mutate its inputs.

### Requirement 7: Enforce tenant isolation, RBAC, and audit on every management action

**User Story:** As a security owner, I want every agency, responder, and capability action gated by authority and bounded to a single tenant, so that no tier or tenant can read or alter another tenant's responding network.

#### Acceptance Criteria

1. IF a management request arrives without a valid session for an authorized tier, THEN THE Platform_API SHALL reject the request with HTTP status 401, SHALL return a generic error identifier, and SHALL NOT read or modify any Agency, Responder, or Capability_Config.
2. IF a session lacks the permission required for the requested management action under deny-by-default RBAC, THEN THE Platform_API SHALL reject the request with HTTP status 403, SHALL return a generic error identifier, and SHALL NOT read or modify any Agency, Responder, or Capability_Config; a Platform_Operator session holds management authority across any Tenant and SHALL NOT be rejected solely because the referenced resource belongs to a Tenant other than the operator's own.
3. IF a mutating management request fails the Same_Origin_Guard, THEN THE Platform_API SHALL reject the request with HTTP status 403, SHALL return a generic error identifier, and SHALL NOT perform the mutation.
4. IF a DRRM_Admin request references an Agency, Responder, Office, or Capability_Config that exists and is known to belong to a Tenant other than the DRRM_Admin's own Tenant, THEN THE Platform_API SHALL reject the request with HTTP status 403, SHALL return a generic error identifier, and SHALL NOT read or modify the referenced resource.
5. IF a DRRM_Admin request references an Agency, Responder, Office, or Capability_Config that is not visible within the DRRM_Admin's own Tenant, THEN THE Platform_API SHALL reject the request with HTTP status 404, SHALL return a generic error identifier, and SHALL NOT read or modify any resource.
6. WHEN an agency or responder management action succeeds, THE Platform_API SHALL append an account action entry to the authentication audit trail recording the acting principal reference, the action type, and the target resource identifier, and SHALL NOT write any coordinate into logs, error messages, or URLs.
7. THE Platform_API SHALL authorize a DRRM_Admin management request only for resources within the DRRM_Admin's own Tenant, and SHALL authorize a Platform_Operator management request for resources in any Tenant.

### Requirement 8: Operate Mode management UI with honest offline degradation

**User Story:** As an authorized manager, I want to manage agencies, staff responders, and set capability from a console that follows Operate Mode and degrades honestly offline, so that the surface is consistent, usable, and never blocks the anonymous SOS path.

#### Acceptance Criteria

1. THE management console SHALL render agency, responder, and capability surfaces using Lucide icons via `@aira/ui/web`, tokens from `@aira/tailwind-config`, and copy via the `@aira/ui` `t()` helper, with no hardcoded display strings and no emoji.
2. WHILE agency, responder roster, or capability data is loading for the first time, THE management console SHALL render a layout-shaped skeleton for that surface.
3. WHEN a management action completes successfully, THE management console SHALL report the outcome through `useToast()` using a message that excludes any coordinate values.
4. IF a management action fails, THEN THE management console SHALL report the failure through `useToast()` using a message that indicates the action did not complete, excludes any coordinate values, and SHALL leave the affected agency, responder, or capability data unchanged from its pre-action state.
5. WHERE a destructive management action is offered (deactivating an Agency or a Responder), THE management console SHALL gate the action behind a `ConfirmDialog` and SHALL perform the mutation only after explicit confirmation.
6. WHEN a destructive management action's `ConfirmDialog` is dismissed or cancelled, THE management console SHALL abort the action and SHALL leave the affected agency or responder unchanged from its pre-action state.
7. IF the management surface is offline or the Platform_API does not return a response within 10 seconds or returns an unreachable-status result, THEN THE management console SHALL present an "unavailable" state through `useToast()` and SHALL NOT block, delay, or alter the frozen Tier-0 anonymous mesh SOS path.

### Requirement 9: Backward compatibility and migration path

**User Story:** As a platform maintainer, I want the agencies table recreated in its tenant-scoped shape and real responders to keep working after this feature ships, so that the migration introduces tenant-scoped agencies cleanly without any pre-existing global agency data to protect.

#### Acceptance Criteria

1. WHEN the agency migration runs, THE migration SHALL recreate the agencies table with `tenant_id` NOT NULL, Agency_Type NOT NULL, and per-tenant case-insensitive uniqueness constraints in effect from the start, without preserving or backfilling any pre-existing global Agency row.
2. WHEN the agency migration writes its seed agency rows, THE migration SHALL assign FIRE to the seeded BFP row, POLICE to the seeded PNP row, MEDICAL to the seeded EMS row, DRRM to the seeded DRRM row, and OTHER to every seeded row not matching one of those organizations.
3. WHEN the agency migration runs, THE migration SHALL preserve every real Responder's `office_id` unchanged, and WHERE a Responder's affiliated Agency no longer exists after recreation, THE migration SHALL reset that Responder's `agency_id` to null so that the Responder becomes a DRRM_Generalist.
4. WHEN the agency migration runs, THE migration SHALL re-seed any seed or fixture Responder consistently with the recreated seed agency rows so that seeded affiliations remain resolvable.
5. THE agency migration SHALL be introduced as a new timestamp-prefixed migration file under `packages/db/supabase/migrations` and SHALL leave every earlier migration file unchanged.
6. THE AIRA_System SHALL treat every DRRM_Generalist (a Responder with `agency_id` null) as capable of every Emergency_Category after the migration.
7. WHEN a Tenant has no stored Capability_Config after the migration, THE AIRA_System SHALL apply the Default_Capability_Config so that the Routing_Engine produces the same capability result for every candidate and category as the previous hardcoded `CATEGORY_AGENCY_CAPABILITY` map produced.
8. THE in-memory platform store used by the test suite SHALL return the same success/failure outcome and the same persisted result as the Postgres store for every agency, responder, and capability create, read, rename, and activation-change operation this feature adds.
