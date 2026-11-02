/**
 * Nearest-responder routing suggestions (PRODUCT.md §5, SECURITY.md §4).
 *
 * Pure, deterministic ranking of candidate responders for an incident. No live GPS
 * yet (that is Phase E): candidates are ranked by great-circle distance from a known
 * base position (the responder's office/barangay centroid), filtered by whether their
 * agency is capable of the incident's category and prioritised by whether their agency
 * covers the incident's office (coverage is prioritisation only — cross-jurisdiction
 * response is allowed, ranked lower; R5.3/R5.4).
 *
 * This is a suggestion engine only. Authorisation still happens server-side in the
 * assign handler (SECURITY.md §4.1): a suggestion never grants access.
 */

import type { AgencyType, EmergencyCategoryId } from '@aira/ui';

import { haversineKm, type GeoPoint } from './geo';

/**
 * The fixed, built-in mapping from an emergency category to the capable Agency_Type(s).
 * This replaces the former editable per-tenant capability config (Requirement 9): the
 * map was effectively write-only because the dispatch path always used the default, so
 * collapsing it to a constant preserves today's behaviour exactly while removing a whole
 * table + UI. DRRM generalists (agency-less responders) always respond (see `isCapable`).
 */
export const CATEGORY_AGENCY_DEFAULT: Readonly<Record<EmergencyCategoryId, readonly AgencyType[]>> =
  {
    SUNOG: ['FIRE'],
    MEDIKAL: ['MEDICAL'],
    KRIMEN: ['POLICE'],
    BAHA: [], // flood/rescue: DRRM generalists (agency-less) lead
  };

/** A responder considered for assignment, with the data routing needs. */
export interface RoutingCandidate {
  readonly id: string;
  readonly callsign: string;
  readonly role: 'RESPONDER' | 'DISPATCHER' | 'ADMIN' | 'AGENCY_ADMIN';
  readonly officeId: string;
  readonly officeName: string;
  /** Owning agency id, or null for a DRRM generalist. Used by the store-layer agency filter. */
  readonly agencyId: string | null;
  /** Agency type or null for a DRRM generalist (no affiliated agency). */
  readonly agencyType: AgencyType | null;
  readonly agencyName: string | null;
  /** Base position (office/barangay centroid). Null when the office has no centroid. */
  readonly base: GeoPoint | null;
  /** True when the candidate's agency covers the incident's office (prioritisation only). */
  readonly coversIncidentOffice: boolean;
}

export interface RoutingSuggestion {
  readonly candidate: RoutingCandidate;
  /** Distance from base to the incident, km. Null when the base is unknown. */
  readonly distanceKm: number | null;
  /** True when the agency is capable of this category (or a DRRM generalist). */
  readonly capable: boolean;
}

/**
 * True when a responder's agency type can handle the category under the fixed map.
 * - null agencyType = DRRM generalist: capable of any category (R6.2).
 * - non-null agencyType: capable iff present in `CATEGORY_AGENCY_DEFAULT[category]`.
 * - never throws, even on an empty capability set (e.g. BAHA).
 */
export function isCapable(category: EmergencyCategoryId, agencyType: AgencyType | null): boolean {
  if (agencyType === null) {
    return true; // DRRM generalist responds to anything (R6.2).
  }
  const capable = CATEGORY_AGENCY_DEFAULT[category] ?? [];
  return (capable as readonly string[]).includes(agencyType);
}

/**
 * Rank candidates for an incident. Ordering (deny-by-default, most useful first):
 *   1. capable before not-capable;
 *   2. covering the incident's office before not covering (prioritisation only; R5.3/R5.4);
 *   3. nearer before farther (unknown distance sorts last within its band);
 *   4. callsign as a stable tiebreak so the order is deterministic.
 *
 * Only field RESPONDERs are rankable assignees; dispatchers/admins/agency-admins are
 * filtered out. Pure and deterministic: inputs are never mutated.
 */
export function rankResponders(
  category: EmergencyCategoryId,
  incident: GeoPoint,
  candidates: readonly RoutingCandidate[],
): readonly RoutingSuggestion[] {
  const suggestions: RoutingSuggestion[] = candidates
    .filter((candidate) => candidate.role === 'RESPONDER')
    .map((candidate) => ({
      candidate,
      distanceKm: candidate.base ? haversineKm(candidate.base, incident) : null,
      capable: isCapable(category, candidate.agencyType),
    }));

  return suggestions.sort((a, b) => {
    if (a.capable !== b.capable) {
      return a.capable ? -1 : 1;
    }
    if (a.candidate.coversIncidentOffice !== b.candidate.coversIncidentOffice) {
      return a.candidate.coversIncidentOffice ? -1 : 1;
    }
    if (a.distanceKm !== b.distanceKm) {
      if (a.distanceKm === null) {
        return 1;
      }
      if (b.distanceKm === null) {
        return -1;
      }
      return a.distanceKm - b.distanceKm;
    }
    return a.candidate.callsign.localeCompare(b.candidate.callsign);
  });
}

/** The single best suggestion, or null when there is no rankable candidate. */
export function bestSuggestion(
  category: EmergencyCategoryId,
  incident: GeoPoint,
  candidates: readonly RoutingCandidate[],
): RoutingSuggestion | null {
  return rankResponders(category, incident, candidates)[0] ?? null;
}
