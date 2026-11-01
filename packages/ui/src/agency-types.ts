/**
 * Agency_Type - the closed five-value taxonomy shared by BOTH the DB and the app
 * (Routing_Engine + `@aira/ui`). Defined ONCE here and re-exported from the
 * `@aira/ui` barrel so the Platform_API and the Routing_Engine consume one
 * definition (R2.1, R2.6).
 *
 * These tokens are IDENTIFIERS, never display text: human labels come only from
 * `t()` (keys `agencyType*`), never from a hardcoded display string (R2.6,
 * AGENTS.md rule 3).
 *
 * The five tokens MUST stay in lockstep with the DB CHECK list in the migration
 * `20261022250000_tenant_responder_network.sql`
 * (`agency_type in ('FIRE','POLICE','MEDICAL','DRRM','OTHER')`); a unit test
 * asserts they match.
 */

export const AGENCY_TYPES = ['FIRE', 'POLICE', 'MEDICAL', 'DRRM', 'OTHER'] as const;

export type AgencyType = (typeof AGENCY_TYPES)[number];

const AGENCY_TYPE_SET: ReadonlySet<string> = new Set(AGENCY_TYPES);

export function isAgencyType(value: unknown): value is AgencyType {
  return typeof value === 'string' && AGENCY_TYPE_SET.has(value);
}
