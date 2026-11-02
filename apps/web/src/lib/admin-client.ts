/**
 * DRRM_Admin (responder-tier ADMIN) client for the responder-network surfaces.
 *
 * Unlike the operator client (`platform-client.ts`), an admin is tenant-bounded: the
 * server derives the acting tenant from the session principal, so NONE of these
 * helpers take a `tenantId`. They target the `/api/admin/...` routes and reuse the
 * SAME parse-at-boundary helpers exported by `platform-client.ts` (never a second
 * copy of the parsing logic). Agency_Type tokens are identifiers, never display text.
 */

import type { AgencyType } from '@aira/ui';

import { parseAgencies, type AgencyView } from './platform-client';

const JSON_HEADERS = {
  accept: 'application/json',
  'content-type': 'application/json',
} as const;

const GET_HEADERS = { accept: 'application/json' } as const;

async function parseOneAgency(response: Response): Promise<AgencyView> {
  const body = (await response.json()) as Record<string, unknown>;
  // Reuse the shared agency-row validation by wrapping the single row in the
  // list envelope the parser expects; a malformed row yields an empty array.
  const [agency] = parseAgencies({ agencies: [body.agency] });
  if (!agency) {
    throw new Error('invalid_agency_response');
  }
  return agency;
}

export async function loadAgencies(): Promise<readonly AgencyView[]> {
  const response = await fetch('/api/admin/agencies', {
    headers: GET_HEADERS,
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`agencies_request_failed_${response.status}`);
  }
  return parseAgencies(await response.json());
}

export async function createAgency(input: {
  readonly name: string;
  readonly code: string;
  readonly agencyType: AgencyType;
}): Promise<AgencyView> {
  const response = await fetch('/api/admin/agencies', {
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

export async function renameAgency(
  agencyId: string,
  patch: { readonly name?: string; readonly code?: string },
): Promise<AgencyView> {
  const response = await fetch(`/api/admin/agencies/${encodeURIComponent(agencyId)}`, {
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
  const response = await fetch(`/api/admin/agencies/${encodeURIComponent(agencyId)}`, {
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
