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

import { isAgencyType, isEmergencyCategoryId, type AgencyType } from '@aira/ui';

import type { AuthServiceDeps } from '../auth/service';
import { createResponder } from '../auth/service';
import { generatePassword } from '../auth/password';
import type { ResponderRecord } from '../auth/types';
import type { Role } from '../auth/rbac';
import type { AgencyRecord, CapabilityConfig, PlatformStore } from '../platform/types';
import { DEFAULT_CAPABILITY_CONFIG } from '../routing';

// â”€â”€ Exported dependency / scope types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface ResponderNetworkDeps {
  readonly store: PlatformStore;
  readonly auth?: AuthServiceDeps;
}

export type ActingScope = { readonly tenantId: string };

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

export type SetCapabilityResult =
  { readonly status: 'ok'; readonly capability: CapabilityConfig } | { readonly status: 'invalid' }; // category or type outside taxonomy (R5.7)

export type ProvisionResponderResult =
  | { readonly status: 'ok'; readonly responder: ResponderRecord; readonly password: string }
  | { readonly status: 'invalid' } // missing/blank officeId (R4.2)
  | { readonly status: 'office_not_found' } // officeId unknown (R4.3)
  | { readonly status: 'office_cross_tenant' } // office belongs to another tenant (R4.4)
  | { readonly status: 'agency_not_found' } // agencyId unknown (R4.5)
  | { readonly status: 'agency_cross_tenant' } // agency belongs to another tenant (R4.6)
  | { readonly status: 'agency_inactive' } // agency.active === false (R4.7)
  | { readonly status: 'conflict' }; // 23505 email duplicate

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function is23505(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505'
  );
}

/**
 * Build a total CapabilityConfig from a partial (or null) stored config by filling
 * any absent/empty category with its DEFAULT_CAPABILITY_CONFIG value so the result
 * always covers all four frozen categories (R5.3).
 *
 * The in-memory store's `readCapabilityConfig` returns `[]` for categories that were
 * never explicitly stored (rather than `null`/`undefined`), so we treat both `null`
 * and an empty array as "not yet set" and substitute the default. This is safe because
 * the default value for any category that can be explicitly zeroed (e.g. BAHA=[]) is
 * already `[]`, so the substitution is a no-op for those cases.
 */
function toTotalConfig(stored: CapabilityConfig | null): CapabilityConfig {
  if (stored === null) {
    // No stored config at all -- return a copy of the full default.
    return { ...DEFAULT_CAPABILITY_CONFIG };
  }
  // Read each category defensively. The in-memory adapter returns `[]` for an
  // unconfigured category, but the Postgres adapter folds only the categories that
  // have stored rows, so an unconfigured category is `undefined` here. Treat both
  // `undefined` and `[]` as "not set" and fall back to the default, so the result is
  // always a total four-key map and never dereferences an absent category.
  const pick = (
    value: readonly AgencyType[] | undefined,
    fallback: readonly AgencyType[],
  ): readonly AgencyType[] => (value && value.length > 0 ? value : fallback);
  return {
    SUNOG: pick(stored.SUNOG, DEFAULT_CAPABILITY_CONFIG.SUNOG),
    MEDIKAL: pick(stored.MEDIKAL, DEFAULT_CAPABILITY_CONFIG.MEDIKAL),
    KRIMEN: pick(stored.KRIMEN, DEFAULT_CAPABILITY_CONFIG.KRIMEN),
    BAHA: pick(stored.BAHA, DEFAULT_CAPABILITY_CONFIG.BAHA),
  };
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

/**
 * Read the full Capability_Config for the acting tenant.
 *
 * Always returns a total four-key map: missing categories are filled from
 * DEFAULT_CAPABILITY_CONFIG so the routing engine never receives a partial config (R5.3).
 */
export async function readCapabilityConfig(
  deps: ResponderNetworkDeps,
  scope: ActingScope,
): Promise<CapabilityConfig> {
  const stored = await deps.store.readCapabilityConfig(scope.tenantId);
  return toTotalConfig(stored);
}

/**
 * Full-replace the agency-type set for exactly one category within the acting tenant.
 *
 * - Validates the category against the frozen set (R5.7).
 * - Validates every submitted type against the taxonomy (R5.7).
 * - De-duplicates the submitted set before persisting (R5.4).
 * - Returns the whole updated total config.
 * - An empty set is valid â€” DRRM generalists then lead for that category (R5.9).
 */
export async function setCapabilityForCategory(
  deps: ResponderNetworkDeps,
  scope: ActingScope,
  category: string,
  agencyTypes: readonly string[],
): Promise<SetCapabilityResult> {
  // Validate the category against the frozen four-value set (R5.7).
  if (!isEmergencyCategoryId(category)) {
    return { status: 'invalid' };
  }

  // Validate every supplied agency type (R5.7). Fail before any write.
  if (!agencyTypes.every(isAgencyType)) {
    return { status: 'invalid' };
  }

  // De-duplicate while preserving first-occurrence order (R5.4).
  const deduped = [...new Set(agencyTypes)];

  const updatedStored = await deps.store.setCapabilityForCategory(
    scope.tenantId,
    category,
    deduped,
  );

  // The store returns the stored (possibly partial) config; make it total.
  return { status: 'ok', capability: toTotalConfig(updatedStored) };
}

/**
 * Provision a responder into a specific office and optionally affiliate with an agency,
 * with tenant-safety checks on both (R4.1â€“R4.9).
 *
 * Guards (in order):
 *  1. officeId blank/missing â†’ invalid (R4.2)
 *  2. findOfficeTenantId â†’ null â†’ office_not_found (R4.3)
 *  3. officeTenantId !== scope.tenantId â†’ office_cross_tenant (R4.4)
 *  4. agencyId supplied and non-null:
 *     a. findAgencyById â†’ null â†’ agency_not_found (R4.5)
 *     b. agency.tenantId !== scope.tenantId â†’ agency_cross_tenant (R4.6)
 *     c. !agency.active â†’ agency_inactive (R4.7)
 *  5. No agencyId â†’ DRRM_Generalist (agency_id null) (R4.8)
 *  6. Generate one-time password, call createResponder (R4.1/R4.9)
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

  // R4.3: the office must exist.
  const officeTenantId = await deps.store.findOfficeTenantId(input.officeId);
  if (officeTenantId === null) {
    return { status: 'office_not_found' };
  }

  // R4.4: the office must belong to the acting tenant.
  if (officeTenantId !== scope.tenantId) {
    return { status: 'office_cross_tenant' };
  }

  // R4.5â€“R4.7: validate supplied agency.
  if (input.agencyId !== undefined && input.agencyId !== null) {
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
  }

  // Generate a one-time password (shown exactly once to the admin, never stored in
  // plain text â€” createResponder hashes it before persisting).
  const password = generatePassword();

  // R4.8: no agencyId â†’ agency_id null (DRRM_Generalist).
  const agencyId = input.agencyId ?? null;

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
