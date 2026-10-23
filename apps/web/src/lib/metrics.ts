/**
 * Oversight metrics for the DRRM officer dashboard (PRODUCT.md §5, DESIGN.md §5a).
 *
 * Pure aggregation over the office incident list. Read-only: metrics never expose
 * coordinates or citizen links, only counts and durations (SECURITY.md §5).
 */

import type { EmergencyCategoryId } from '@aira/ui';

import type { Incident, IncidentStatus } from './incidents';

export interface OfficeMetrics {
  readonly total: number;
  readonly byStatus: Readonly<Record<IncidentStatus, number>>;
  readonly byCategory: Readonly<Record<EmergencyCategoryId, number>>;
  /** Incidents still open (not RESOLVED). */
  readonly active: number;
  /** Distinct responders currently holding an open assignment. */
  readonly activeUnits: number;
  /** Mean minutes from report to resolution over resolved incidents (null if none). */
  readonly avgResolveMinutes: number | null;
  /** Incident count per office id (barangay heatmap input). */
  readonly byOffice: Readonly<Record<string, number>>;
}

const STATUSES: readonly IncidentStatus[] = [
  'QUEUED',
  'DISPATCHED',
  'EN_ROUTE',
  'ON_SCENE',
  'RESOLVED',
];
const CATEGORIES: readonly EmergencyCategoryId[] = ['SUNOG', 'MEDIKAL', 'KRIMEN', 'BAHA'];

export function computeMetrics(incidents: readonly Incident[]): OfficeMetrics {
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<
    IncidentStatus,
    number
  >;
  const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<
    EmergencyCategoryId,
    number
  >;
  const byOffice: Record<string, number> = {};
  const activeUnitIds = new Set<string>();

  let active = 0;
  let resolveMinutesSum = 0;
  let resolvedCount = 0;

  for (const incident of incidents) {
    byStatus[incident.status] += 1;
    byCategory[incident.category] += 1;
    byOffice[incident.officeId] = (byOffice[incident.officeId] ?? 0) + 1;

    if (incident.status !== 'RESOLVED') {
      active += 1;
      if (incident.assignedToId) {
        activeUnitIds.add(incident.assignedToId);
      }
    } else if (incident.resolvedAt) {
      const minutes =
        (new Date(incident.resolvedAt).getTime() - new Date(incident.reportedAt).getTime()) /
        60_000;
      if (Number.isFinite(minutes) && minutes >= 0) {
        resolveMinutesSum += minutes;
        resolvedCount += 1;
      }
    }
  }

  return {
    total: incidents.length,
    byStatus,
    byCategory,
    active,
    activeUnits: activeUnitIds.size,
    avgResolveMinutes: resolvedCount > 0 ? Math.round(resolveMinutesSum / resolvedCount) : null,
    byOffice,
  };
}
