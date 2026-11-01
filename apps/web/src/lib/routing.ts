/**
 * Nearest-responder routing suggestions (PRODUCT.md §5, SECURITY.md §4).
 *
 * Pure, deterministic ranking of candidate responders for an incident. No live GPS
 * yet (that is Phase E): candidates are ranked by great-circle distance from a known
 * base position (the responder's office/barangay centroid), filtered by whether their
 * agency is capable of the incident's category and whether they fall inside the
 * incident's office jurisdiction subtree.
 *
 * This is a suggestion engine only. Authorisation still happens server-side in the
 * assign handler (SECURITY.md §4.1): a suggestion never grants access.
 */

import type { AgencyType, EmergencyCategoryId } from '@aira/ui';

import { haversineKm, type GeoPoint } from './geo';
import type { CapabilityConfig } from './platform/types';

/**
 * The default per-tenant capability configuration that reproduces the legacy
 * hardcoded `CATEGORY_AGENCY_CAPABILITY` behaviour (R5.8, R6.3, R9.7).
 * Under this config `isCapable` produces the identical result to the previous
 * agency-code map for every (category, agencyType) pair.
 */
export const DEFAULT_CAPABILITY_CONFIG: CapabilityConfig = {
  SUNOG: ['FIRE'],
  MEDIKAL: ['MEDICAL'],
  KRIMEN: ['POLICE'],
  BAHA: [], // flood/rescue: DRRM generalists (agency-less) lead
};

/** A responder considered for assignment, with the data routing needs. */
export interface RoutingCandidate {
  readonly id: string;
  readonly callsign: string;
  readonly role: 'RESPONDER' | 'DISPATCHER' | 'ADMIN';
  readonly officeId: string;
  readonly officeName: string;
  /** Agency type or null for a DRRM generalist (no affiliated agency). */
  readonly agencyType: AgencyType | null;
  readonly agencyName: string | null;
  /** Base position (office/barangay centroid). Null when the office has no centroid. */
  readonly base: GeoPoint | null;
}

export interface RoutingSuggestion {
  readonly candidate: RoutingCandidate;
  /** Distance from base to the incident, km. Null when the base is unknown. */
  readonly distanceKm: number | null;
  /** True when the agency is capable of this category (or a DRRM generalist). */
  readonly capable: boolean;
}

/**
 * True when a responder's agency type can handle the category under the given config.
 * - null agencyType = DRRM generalist: capable of any category (R6.2).
 * - non-null agencyType: capable iff present in config[category] (R6.1/R6.6).
 * - never throws, even on an unknown or empty capability set (R6.6).
 */
export function isCapable(
  category: EmergencyCategoryId,
  agencyType: AgencyType | null,
  config: CapabilityConfig,
): boolean {
  if (agencyType === null) {
    return true; // DRRM generalist responds to anything (R6.2).
  }
  const capable = config[category] ?? [];
  return (capable as readonly string[]).includes(agencyType);
}

/**
 * Rank candidates for an incident. Ordering (deny-by-default, most useful first):
 *   1. capable before not-capable;
 *   2. nearer before farther (unknown distance sorts last within its capability band);
 *   3. callsign as a stable tiebreak so the order is deterministic.
 *
 * Only field RESPONDERs are rankable assignees; dispatchers/admins are filtered out.
 */
export function rankResponders(
  category: EmergencyCategoryId,
  incident: GeoPoint,
  candidates: readonly RoutingCandidate[],
  config: CapabilityConfig,
): readonly RoutingSuggestion[] {
  const suggestions: RoutingSuggestion[] = candidates
    .filter((candidate) => candidate.role === 'RESPONDER')
    .map((candidate) => ({
      candidate,
      distanceKm: candidate.base ? haversineKm(candidate.base, incident) : null,
      capable: isCapable(category, candidate.agencyType, config),
    }));

  return suggestions.sort((a, b) => {
    if (a.capable !== b.capable) {
      return a.capable ? -1 : 1;
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
  config: CapabilityConfig,
): RoutingSuggestion | null {
  return rankResponders(category, incident, candidates, config)[0] ?? null;
}
