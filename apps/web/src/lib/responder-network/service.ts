/**
 * Responder-network service (tenant-scoped agency + capability management).
 *
 * Pure rules over an injected store. The acting scope is passed in explicitly so
 * neither the operator tier nor the DRRM_Admin tier can widen it. Mirrors the
 * platform/service.ts style: validate â†’ delegate â†’ map 23505 â†’ conflict.
 *
 * SECURITY: no PII, no coordinates, no echoing of submitted values in errors.
 *
 * Requirements: R2.4, R2.5, R3.2â€“R3.8, R4.1â€“R4.9, R5.1, R5.3â€“R5.5, R5.7â€“R5.9.
 */

import { isAgencyType } from '@aira/ui';

import type { AuthServiceDeps } from '../auth/service';
import { createResponder } from '../auth/service';
import { generatePassword } from '../auth/password';
import type { ResponderRecord } from '../auth/types';
import type { Role } from '../auth/rbac';
import type { AgencyRecord, PlatformStore } from '../platform/types';

// â”€â”€ Exported dependency / scope types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface ResponderNetworkDeps {
  readonly store: PlatformStore;
  readonly auth?: AuthServiceDeps;
}

/**
 * The acting scope for a management call. Always tenant-bounded. For an agency-scoped
 * caller (AGENCY_ADMIN), `agencyId` is set and the service refuses to read or write any
 * other agency (single-lgu-agency-network R5.2/R7.1/R7.3). For an unbounded caller
 * (the break-glass path), `agencyId` is omitted.
 */
export type ActingScope = { readonly tenantId: string; readonly agencyId?: string | null };

// â”€â”€ Result types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type CreateAgencyResult =
  | { readonly status: 'ok'; readonly agency: AgencyRecord }
  | { readonly status: 'invalid' } // name/code length out of range (R3.3)
  | { readonly status: 'invalid_type' } // agencyType not in taxonomy / missing (R2.4/R2.5)
  | { readonly status: 'tenant_not_found' } // target tenant absent (R3.7)
  | { readonly status: 'conflict' }; // per-tenant name/code 23505 (R3.4)

export type RenameAgencyResult =
  | { readonly status: 'ok'; readonly agency: AgencyRecord }
  | { readonly status: 'not_found' } // agency missing (R3.8)
  | { readonly status: 'invalid' } // name/code length out of range (R3.3)
  | { readonly status: 'cross_tenant' } // agency belongs to a different tenant (R7.4)
  | { readonly status: 'conflict' }; // 23505 on rename (R3.4)

export type SetAgencyActiveResult =
  | { readonly status: 'ok'; readonly agency: AgencyRecord }
  | { readonly status: 'not_found' } // agency missing (R3.8)
  | { readonly status: 'cross_tenant' }; // agency belongs to a different tenant (R7.4)

export type ProvisionResponderResult =
  | { readonly status: 'ok'; readonly responder: ResponderRecord; readonly password: string }
  | { readonly status: 'invalid' } // missing/blank officeId OR missing agency (R3.2/R4.2)
  | { readonly status: 'office_not_found' } // officeId unknown (R4.3)
  | { readonly status: 'office_cross_tenant' } // office belongs to another tenant (R4.4)
  | { readonly status: 'agency_not_found' } // agencyId unknown (R4.5)
  | { readonly status: 'agency_cross_tenant' } // agency belongs to another tenant (R4.6)
  | { readonly status: 'agency_inactive' } // agency.active === false (R4.7)
  | { readonly status: 'cross_agency' } // agency-bounded caller provisioning into another agency (R7.3)
  | { readonly status: 'conflict' }; // 23505 email duplicate

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function is23505(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505'
  );
}

// â”€â”€ Service functions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Create an agency within the acting tenant's scope.
 *
 * - Trims name + code before length checks.
 * - Validates agencyType against the closed taxonomy first (R2.4/R2.5).
 * - Never echoes the submitted agencyType value in the error result.
 * - Maps store's tenant_not_found and 23505 â†’ conflict.
 */
export async function createAgency(
  deps: ResponderNetworkDeps,
  scope: ActingScope,
  input: { readonly name: string; readonly code: string; readonly agencyType: string },
): Promise<CreateAgencyResult> {
  const name = (input.name ?? '').trim();
  const code = (input.code ?? '').trim();

  // Validate length before touching the store (R3.3).
  if (name.length < 2 || name.length > 64) {
    return { status: 'invalid' };
  }
  if (code.length < 2 || code.length > 12) {
    return { status: 'invalid' };
  }

  // Validate agencyType â€” must be in the closed taxonomy (R2.4/R2.5).
  // We never echo the submitted value in the error result.
  if (!isAgencyType(input.agencyType)) {
    return { status: 'invalid_type' };
  }

  try {
    const storeResult = await deps.store.createAgency({
      tenantId: scope.tenantId,
      name,
      code,
      agencyType: input.agencyType,
    });

    if (storeResult.status === 'tenant_not_found') {
      return { status: 'tenant_not_found' };
    }

    return { status: 'ok', agency: storeResult.agency };
  } catch (error) {
    if (is23505(error)) {
      return { status: 'conflict' };
    }
    throw error;
  }
}

/**
 * Rename and/or change the code of an agency that belongs to the acting tenant.
 *
 * - Resolves the agency first; null â†’ not_found.
 * - Enforces tenancy: wrong tenant â†’ cross_tenant (R7.4).
 * - Re-validates length for supplied fields (R3.3).
 * - Maps 23505 â†’ conflict (R3.4).
 */
export async function renameAgency(
  deps: ResponderNetworkDeps,
  scope: ActingScope,
  agencyId: string,
  patch: { readonly name?: string; readonly code?: string },
): Promise<RenameAgencyResult> {
  const agency = await deps.store.findAgencyById(agencyId);

  if (agency === null) {
    return { status: 'not_found' };
  }
  if (agency.tenantId !== scope.tenantId) {
    return { status: 'cross_tenant' };
  }

  // Trim and validate supplied fields (R3.3).
  const trimmedPatch: { name?: string; code?: string } = {};

  if (patch.name !== undefined) {
    const trimmedName = patch.name.trim();
    if (trimmedName.length < 2 || trimmedName.length > 64) {
      return { status: 'invalid' };
    }
    trimmedPatch.name = trimmedName;
  }
  if (patch.code !== undefined) {
    const trimmedCode = patch.code.trim();
    if (trimmedCode.length < 2 || trimmedCode.length > 12) {
      return { status: 'invalid' };
    }
    trimmedPatch.code = trimmedCode;
  }

  try {
    const updated = await deps.store.renameAgency(agencyId, trimmedPatch);
    if (updated === null) {
      // Race: the row was deleted between resolve and update.
      return { status: 'not_found' };
    }
    return { status: 'ok', agency: updated };
  } catch (error) {
    if (is23505(error)) {
      return { status: 'conflict' };
    }
    throw error;
  }
}

/**
 * Flip the active flag of an agency that belongs to the acting tenant.
 *
 * Never deletes the row â€” only updates the boolean (R3.6).
 */
export async function setAgencyActive(
  deps: ResponderNetworkDeps,
  scope: ActingScope,
  agencyId: string,
  active: boolean,
): Promise<SetAgencyActiveResult> {
  const agency = await deps.store.findAgencyById(agencyId);

  if (agency === null) {
    return { status: 'not_found' };
  }
  if (agency.tenantId !== scope.tenantId) {
    return { status: 'cross_tenant' };
  }

  const updated = await deps.store.setAgencyActive(agencyId, active);
  if (updated === null) {
    // Race: the row was deleted between resolve and update.
    return { status: 'not_found' };
  }
  return { status: 'ok', agency: updated };
}

/**
 * List all agencies belonging to the acting tenant.
 */
export async function listAgenciesForTenant(
  deps: ResponderNetworkDeps,
  scope: ActingScope,
): Promise<readonly AgencyRecord[]> {
  return deps.store.listAgenciesForTenant(scope.tenantId);
}

// â”€â”€ Agency coverage (single-lgu-agency-network R5) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type ListAgencyCoverageResult =
  | { readonly status: 'ok'; readonly officeIds: readonly string[] }
  | { readonly status: 'not_found' } // agency unknown / not visible in scope (404)
  | { readonly status: 'cross_agency' }; // known other agency in this LGU (403)

export type SetAgencyCoverageResult =
  | { readonly status: 'ok'; readonly officeIds: readonly string[] }
  | { readonly status: 'not_found' } // agency unknown / not visible in scope (404)
  | { readonly status: 'cross_agency' } // known other agency in this LGU (403)
  | { readonly status: 'invalid_office' }; // an office outside the LGU (same-LGU rule)

/**
 * Resolve an agency within the acting scope. Mirrors the cross-tenant discriminant used
 * elsewhere, one level down: an agency in another tenant, or absent entirely, is
 * `not_found` (404 — not visible); an agency in THIS LGU that is not the caller's own
 * agency (when the caller is agency-bounded) is `cross_agency` (403 — known other).
 */
async function resolveOwnAgency(
  deps: ResponderNetworkDeps,
  scope: ActingScope,
  agencyId: string,
): Promise<
  | { readonly status: 'ok'; readonly agency: AgencyRecord }
  | { readonly status: 'not_found' }
  | { readonly status: 'cross_agency' }
> {
  const agency = await deps.store.findAgencyById(agencyId);
  if (agency === null || agency.tenantId !== scope.tenantId) {
    return { status: 'not_found' };
  }
  // An agency-bounded caller may only touch its own agency (R5.2/R7.3).
  if (scope.agencyId !== undefined && scope.agencyId !== null && agency.id !== scope.agencyId) {
    return { status: 'cross_agency' };
  }
  return { status: 'ok', agency };
}

/** Read the office ids an agency covers, enforcing agency scope (R5.2/R7.3). */
export async function listAgencyCoverage(
  deps: ResponderNetworkDeps,
  scope: ActingScope,
  agencyId: string,
): Promise<ListAgencyCoverageResult> {
  const resolved = await resolveOwnAgency(deps, scope, agencyId);
  if (resolved.status !== 'ok') {
    return resolved;
  }
  const officeIds = await deps.store.listCoverage(agencyId);
  return { status: 'ok', officeIds };
}

/**
 * Full-replace an agency's office coverage (R5.1/R5.2). Coverage is prioritisation only.
 *
 * - Enforces agency scope: a bounded caller editing another agency → cross_agency (403);
 *   an unknown/not-visible agency → not_found (404).
 * - De-duplicates the submitted office ids.
 * - Same-LGU rule: every office must belong to the acting tenant, else invalid_office.
 */
export async function setAgencyCoverage(
  deps: ResponderNetworkDeps,
  scope: ActingScope,
  agencyId: string,
  officeIds: readonly string[],
): Promise<SetAgencyCoverageResult> {
  const resolved = await resolveOwnAgency(deps, scope, agencyId);
  if (resolved.status !== 'ok') {
    return resolved;
  }

  // De-duplicate before any validation or write (R5.1).
  const deduped = [...new Set(officeIds)];

  // Same-LGU rule: every office must resolve to the acting tenant (R5.1).
  for (const officeId of deduped) {
    const officeTenantId = await deps.store.findOfficeTenantId(officeId);
    if (officeTenantId === null || officeTenantId !== scope.tenantId) {
      return { status: 'invalid_office' };
    }
  }

  await deps.store.setCoverage(agencyId, deduped);
  const officeIdsAfter = await deps.store.listCoverage(agencyId);
  return { status: 'ok', officeIds: officeIdsAfter };
}

/**
 * Provision a responder into a specific office, affiliated with a REQUIRED agency, with
 * tenant- and agency-safety checks (single-lgu-agency-network R3.1/R3.2, R4, R7.3).
 *
 * Guards (in order):
 *  1. officeId blank/missing → invalid (R4.2)
 *  2. agencyId blank/missing → invalid — agency is now REQUIRED (R3.2)
 *  3. findOfficeTenantId → null → office_not_found (R4.3)
 *  4. officeTenantId !== scope.tenantId → office_cross_tenant (R4.4)
 *  5. agency: findAgencyById → null → agency_not_found (R4.5); wrong tenant →
 *     agency_cross_tenant (R4.6); inactive → agency_inactive (R4.7)
 *  6. an agency-bounded caller (AGENCY_ADMIN) provisioning into a DIFFERENT agency →
 *     cross_agency (R7.3)
 *  7. Generate one-time password, call createResponder (R4.1/R4.9)
 *
 * SECURITY: no coordinate is written into any result field or audit entry (R4.9).
 */
export async function provisionResponder(
  deps: ResponderNetworkDeps & { readonly auth: AuthServiceDeps },
  scope: ActingScope,
  input: {
    readonly email: string;
    readonly officeId?: string | null;
    readonly agencyId?: string | null;
    readonly callsign?: string | null;
    readonly role?: Role;
    readonly mustChangePassword?: boolean;
  },
): Promise<ProvisionResponderResult> {
  // R4.2: officeId must be present and non-blank.
  if (!input.officeId || input.officeId.trim() === '') {
    return { status: 'invalid' };
  }

  // R3.2: agency is now REQUIRED for every provisioned account.
  if (!input.agencyId || input.agencyId.trim() === '') {
    return { status: 'invalid' };
  }

  // R7.3: an agency-bounded caller may only provision into its own agency.
  if (
    scope.agencyId !== undefined &&
    scope.agencyId !== null &&
    input.agencyId !== scope.agencyId
  ) {
    return { status: 'cross_agency' };
  }

  // R4.3: the office must exist.
  const officeTenantId = await deps.store.findOfficeTenantId(input.officeId);
  if (officeTenantId === null) {
    return { status: 'office_not_found' };
  }

  // R4.4: the office must belong to the acting tenant.
  if (officeTenantId !== scope.tenantId) {
    return { status: 'office_cross_tenant' };
  }

  // R4.5–R4.7: validate the required agency.
  const agency = await deps.store.findAgencyById(input.agencyId);
  if (agency === null) {
    return { status: 'agency_not_found' };
  }
  if (agency.tenantId !== scope.tenantId) {
    return { status: 'agency_cross_tenant' };
  }
  if (!agency.active) {
    return { status: 'agency_inactive' };
  }

  // Generate a one-time password (shown exactly once to the admin, never stored in
  // plain text — createResponder hashes it before persisting).
  const password = generatePassword();

  const agencyId = input.agencyId;

  const result = await createResponder(deps.auth, {
    email: input.email,
    callsign: input.callsign ?? null,
    role: input.role ?? 'RESPONDER',
    officeId: input.officeId,
    agencyId,
    password,
    mustChangePassword: input.mustChangePassword ?? true,
  });

  if (result.status === 'ok') {
    // R4.1: return the created responder plus the one-time password (shown once).
    // R4.9: ACCOUNT_CREATED audit is appended by createResponder internally; no
    //        coordinate is written anywhere.
    return { status: 'ok', responder: result.responder, password };
  }

  if (result.status === 'conflict') {
    return { status: 'conflict' };
  }

  // invalid_email, invalid_callsign, or weak password â€” surface as invalid.
  return { status: 'invalid' };
}
