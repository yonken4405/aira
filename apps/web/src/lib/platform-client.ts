/**
 * Client access to the platform nationwide office pins. Office locations only - never
 * citizen data (SECURITY.md). Validated at the boundary.
 */

import { AGENCY_TYPES, isAgencyType, type AgencyType, type EmergencyCategoryId } from '@aira/ui';

export interface OfficePinView {
  readonly id: string;
  readonly tenantId: string;
  readonly tenantName: string;
  readonly name: string;
  readonly kind: 'LGU' | 'BARANGAY';
  readonly region: string | null;
  readonly province: string | null;
  readonly lat: number | null;
  readonly lon: number | null;
  readonly status: 'active' | 'suspended';
}

function parsePin(raw: unknown): OfficePinView | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.tenantId !== 'string' || typeof r.name !== 'string') {
    return null;
  }
  if (r.kind !== 'LGU' && r.kind !== 'BARANGAY') {
    return null;
  }
  const lat = typeof r.lat === 'number' && Number.isFinite(r.lat) ? r.lat : null;
  const lon = typeof r.lon === 'number' && Number.isFinite(r.lon) ? r.lon : null;
  return {
    id: r.id,
    tenantId: r.tenantId,
    tenantName: typeof r.tenantName === 'string' ? r.tenantName : '',
    name: r.name,
    kind: r.kind,
    region: typeof r.region === 'string' ? r.region : null,
    province: typeof r.province === 'string' ? r.province : null,
    lat,
    lon,
    status: r.status === 'suspended' ? 'suspended' : 'active',
  };
}

export function parseOfficePins(raw: unknown): readonly OfficePinView[] {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('invalid_offices_response');
  }
  const list = (raw as Record<string, unknown>).offices;
  if (!Array.isArray(list)) {
    throw new Error('invalid_offices_response');
  }
  return list.map(parsePin).filter((p): p is OfficePinView => p !== null);
}

export async function loadOfficePins(): Promise<readonly OfficePinView[]> {
  const response = await fetch('/api/platform/offices', {
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`offices_request_failed_${response.status}`);
  }
  return parseOfficePins(await response.json());
}

/** Pure filter used by the map: region match + case-insensitive text search. */
export function filterPins(
  pins: readonly OfficePinView[],
  options: { readonly region?: string | null; readonly search?: string },
): readonly OfficePinView[] {
  const region = options.region ?? null;
  const search = (options.search ?? '').trim().toLowerCase();
  return pins.filter((pin) => {
    if (region && pin.region !== region) {
      return false;
    }
    if (search.length > 0) {
      const haystack = `${pin.name} ${pin.tenantName} ${pin.province ?? ''}`.toLowerCase();
      if (!haystack.includes(search)) {
        return false;
      }
    }
    return true;
  });
}

/** Distinct regions present in the pin set, sorted - drives the filter dropdown. */
export function regionsOf(pins: readonly OfficePinView[]): readonly string[] {
  const set = new Set<string>();
  for (const pin of pins) {
    if (pin.region) {
      set.add(pin.region);
    }
  }
  return [...set].sort();
}

// ── Responder network: agencies, capability config, responder provisioning ──────
//
// Parse-at-boundary helpers + fetch wrappers for the OPERATOR tier (platform
// console). The operator is not tenant-bounded, so every helper takes an explicit
// `tenantId` and targets the `/api/platform/...` routes. The DRRM_Admin tier reuses
// the SAME parsers (see `admin-client.ts`) but derives its tenant from the session.
//
// Agency_Type tokens are identifiers, never display text (R2.6). Zero coordinates,
// zero PII beyond the responder identity returned by provisioning (SECURITY.md §1/§5).

/** The four frozen emergency categories, in wire order (PRODUCT.md §4). */
const CAPABILITY_CATEGORIES: readonly EmergencyCategoryId[] = [
  'SUNOG',
  'MEDIKAL',
  'KRIMEN',
  'BAHA',
];

/** A responder agency row, validated at the boundary. */
export interface AgencyView {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly code: string;
  readonly agencyType: AgencyType;
  readonly active: boolean;
}

/** The TOTAL four-key capability map: every frozen category → its capable Agency_Types. */
export type CapabilityConfigView = Readonly<Record<EmergencyCategoryId, readonly AgencyType[]>>;

/** The responder identity returned by a provision call. No coordinate, no password hash. */
export interface ProvisionedResponder {
  readonly id: string;
  readonly email: string;
  readonly callsign: string | null;
  readonly agencyId: string | null;
}

export interface ProvisionResult {
  readonly responder: ProvisionedResponder;
  readonly password: string;
}

function parseAgencyRow(raw: unknown): AgencyView | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const r = raw as Record<string, unknown>;
  if (
    typeof r.id !== 'string' ||
    typeof r.tenantId !== 'string' ||
    typeof r.name !== 'string' ||
    typeof r.code !== 'string'
  ) {
    return null;
  }
  if (!isAgencyType(r.agencyType)) {
    return null;
  }
  return {
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
    code: r.code,
    agencyType: r.agencyType,
    active: r.active !== false,
  };
}

/**
 * Parses the `{ agencies: AgencyRecord[] }` envelope. Malformed rows (missing fields
 * or an agencyType outside the frozen taxonomy) are dropped; a malformed envelope
 * throws `invalid_agencies_response`.
 */
export function parseAgencies(raw: unknown): readonly AgencyView[] {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('invalid_agencies_response');
  }
  const list = (raw as Record<string, unknown>).agencies;
  if (!Array.isArray(list)) {
    throw new Error('invalid_agencies_response');
  }
  return list.map(parseAgencyRow).filter((a): a is AgencyView => a !== null);
}

/** Keeps only taxonomy agency types from an unknown list; dedupe is left to the server. */
function toAgencyTypeList(raw: unknown): readonly AgencyType[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(isAgencyType);
}

/**
 * Parses the `{ capability: CapabilityConfig }` envelope into a TOTAL four-key map:
 * absent categories are filled with `[]` and each list is filtered to taxonomy types.
 * A malformed envelope throws `invalid_capability_response`.
 */
export function parseCapabilityConfig(raw: unknown): CapabilityConfigView {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('invalid_capability_response');
  }
  const capability = (raw as Record<string, unknown>).capability;
  if (typeof capability !== 'object' || capability === null) {
    throw new Error('invalid_capability_response');
  }
  const source = capability as Record<string, unknown>;
  // TOTAL four-key map keyed by the frozen categories in wire order; absent
  // categories collapse to [] and every list is filtered to taxonomy types.
  return {
    SUNOG: toAgencyTypeList(source.SUNOG),
    MEDIKAL: toAgencyTypeList(source.MEDIKAL),
    KRIMEN: toAgencyTypeList(source.KRIMEN),
    BAHA: toAgencyTypeList(source.BAHA),
  };
}

function parseResponderIdentity(raw: unknown): ProvisionedResponder | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.email !== 'string') {
    return null;
  }
  const callsign = typeof r.callsign === 'string' ? r.callsign : null;
  const agencyId = typeof r.agencyId === 'string' ? r.agencyId : null;
  return { id: r.id, email: r.email, callsign, agencyId };
}

/**
 * Parses the `{ responder: ResponderRecord, password: string }` provision-success
 * envelope. A missing/blank password or a malformed responder identity throws
 * `invalid_provision_response`.
 */
export function parseProvisionResult(raw: unknown): ProvisionResult {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('invalid_provision_response');
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.password !== 'string' || r.password.length === 0) {
    throw new Error('invalid_provision_response');
  }
  const responder = parseResponderIdentity(r.responder);
  if (responder === null) {
    throw new Error('invalid_provision_response');
  }
  return { responder, password: r.password };
}

// ── Operator fetch helpers (explicit tenantId, `/api/platform/...` routes) ───────

const JSON_HEADERS = {
  accept: 'application/json',
  'content-type': 'application/json',
} as const;

const GET_HEADERS = { accept: 'application/json' } as const;

export async function loadAgencies(tenantId: string): Promise<readonly AgencyView[]> {
  const response = await fetch(`/api/platform/tenants/${encodeURIComponent(tenantId)}/agencies`, {
    headers: GET_HEADERS,
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`agencies_request_failed_${response.status}`);
  }
  return parseAgencies(await response.json());
}

export async function createAgency(
  tenantId: string,
  input: { readonly name: string; readonly code: string; readonly agencyType: AgencyType },
): Promise<AgencyView> {
  const response = await fetch(`/api/platform/tenants/${encodeURIComponent(tenantId)}/agencies`, {
    method: 'POST',
    headers: JSON_HEADERS,
    credentials: 'same-origin',
    cache: 'no-store',
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(`agency_create_request_failed_${response.status}`);
  }
  return parseOneAgency(response);
}

/** Narrow helper so `createAgency`/`renameAgency`/`setAgencyActive` share agency parsing. */
async function parseOneAgency(response: Response): Promise<AgencyView> {
  const body = (await response.json()) as Record<string, unknown>;
  const agency = parseAgencyRow(body.agency);
  if (agency === null) {
    throw new Error('invalid_agency_response');
  }
  return agency;
}

export async function renameAgency(
  agencyId: string,
  patch: { readonly name?: string; readonly code?: string },
): Promise<AgencyView> {
  const response = await fetch(`/api/platform/agencies/${encodeURIComponent(agencyId)}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    credentials: 'same-origin',
    cache: 'no-store',
    body: JSON.stringify(patch),
  });
  if (!response.ok) {
    throw new Error(`agency_update_request_failed_${response.status}`);
  }
  return parseOneAgency(response);
}

export async function setAgencyActive(agencyId: string, active: boolean): Promise<AgencyView> {
  const response = await fetch(`/api/platform/agencies/${encodeURIComponent(agencyId)}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    credentials: 'same-origin',
    cache: 'no-store',
    body: JSON.stringify({ active }),
  });
  if (!response.ok) {
    throw new Error(`agency_update_request_failed_${response.status}`);
  }
  return parseOneAgency(response);
}

export async function loadCapability(tenantId: string): Promise<CapabilityConfigView> {
  const response = await fetch(`/api/platform/tenants/${encodeURIComponent(tenantId)}/capability`, {
    headers: GET_HEADERS,
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`capability_request_failed_${response.status}`);
  }
  return parseCapabilityConfig(await response.json());
}

export async function setCapability(
  tenantId: string,
  category: EmergencyCategoryId,
  agencyTypes: readonly AgencyType[],
): Promise<CapabilityConfigView> {
  const response = await fetch(`/api/platform/tenants/${encodeURIComponent(tenantId)}/capability`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    credentials: 'same-origin',
    cache: 'no-store',
    body: JSON.stringify({ category, agencyTypes }),
  });
  if (!response.ok) {
    throw new Error(`capability_update_request_failed_${response.status}`);
  }
  return parseCapabilityConfig(await response.json());
}

export async function provisionResponder(
  tenantId: string,
  input: {
    readonly email: string;
    readonly officeId: string;
    readonly agencyId?: string | null;
    readonly callsign?: string | null;
    readonly role?: string;
  },
): Promise<ProvisionResult> {
  const response = await fetch(`/api/platform/tenants/${encodeURIComponent(tenantId)}/responders`, {
    method: 'POST',
    headers: JSON_HEADERS,
    credentials: 'same-origin',
    cache: 'no-store',
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(`provision_request_failed_${response.status}`);
  }
  return parseProvisionResult(await response.json());
}

/** The frozen capability category list, re-exported for UI iteration in wire order. */
export { CAPABILITY_CATEGORIES };

/** Agency_Type taxonomy re-export so UI components import one definition. */
export { AGENCY_TYPES };
