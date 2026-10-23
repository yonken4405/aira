/**
 * In-memory `IncidentsStore` for route tests (TESTING.md §4.3).
 */

import type { IncidentsStore } from '../../src/lib/incidents-store';
import type { Incident } from '../../src/lib/incidents';
import type { RoutingCandidate } from '../../src/lib/routing';
import { OFFICE_ID } from './fixtures';

export interface MemoryIncidentsStore extends IncidentsStore {
  readonly incidents: Incident[];
  readonly assignments: Array<{ incidentId: string; responderId: string; actorId: string }>;
  readonly medicalAccesses: Array<{ incidentId: string; actorId: string }>;
}

export interface MemoryIncidentsStoreOptions {
  readonly now: () => number;
  readonly officeId?: string;
  readonly incidents?: readonly Incident[];
  /** id -> callsign for responders that may be assigned. */
  readonly responders?: Readonly<Record<string, string>>;
  /** Routing candidates returned by `listRoutingCandidates`. */
  readonly candidates?: readonly RoutingCandidate[];
}

let sequence = 0;

export function createMemoryIncidentsStore(
  options: MemoryIncidentsStoreOptions,
): MemoryIncidentsStore {
  const officeId = options.officeId ?? OFFICE_ID;
  const incidents: Incident[] = [...(options.incidents ?? [])];
  const responders = options.responders ?? {};
  const candidates = options.candidates ?? [];
  const assignments: Array<{ incidentId: string; responderId: string; actorId: string }> = [];
  const medicalAccesses: Array<{ incidentId: string; actorId: string }> = [];
  const trackingTokens: Array<{ incidentId: string; tokenHash: string; expiresAt: number }> = [];

  function find(id: string): Incident | null {
    return incidents.find((incident) => incident.id === id) ?? null;
  }

  function replace(next: Incident): void {
    const index = incidents.findIndex((incident) => incident.id === next.id);
    if (index >= 0) {
      incidents[index] = next;
    }
  }

  return {
    incidents,
    assignments,
    medicalAccesses,

    async getDefaultOfficeId() {
      return officeId;
    },

    async listForOffice(requestedOfficeId) {
      return incidents.filter((incident) => incident.officeId === requestedOfficeId);
    },

    async listAssignedTo(responderId) {
      return incidents.filter((incident) => incident.assignedToId === responderId);
    },

    async findById(id) {
      return find(id);
    },

    async isInOfficeScope(incidentId, scopeOfficeId) {
      const incident = find(incidentId);
      return incident !== null && incident.officeId === scopeOfficeId;
    },

    async listRoutingCandidates() {
      return candidates;
    },

    async create(input) {
      sequence += 1;
      const incident: Incident = {
        id: `incident-${sequence}`,
        category: input.category,
        lat: input.lat,
        lon: input.lon,
        reportedAt: new Date(input.at).toISOString(),
        source: input.source ?? 'mesh',
        status: 'QUEUED',
        assignedToId: null,
        assignedToCallsign: null,
        officeId: input.officeId,
        note: null,
        resolvedAt: null,
        reporterCitizenId: input.reporterCitizenId ?? null,
      };

      incidents.unshift(incident);
      return incident;
    },

    async recordMedicalAccess(input) {
      medicalAccesses.push({ incidentId: input.incidentId, actorId: input.actorId });
    },

    async createTrackingToken(input) {
      trackingTokens.push({
        incidentId: input.incidentId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
      });
    },

    async resolveTrackingToken(tokenHash, nowMs) {
      const match = trackingTokens.find(
        (token) => token.tokenHash === tokenHash && token.expiresAt > nowMs,
      );
      return match?.incidentId ?? null;
    },

    async assign(input) {
      const incident = find(input.incidentId);
      if (!incident) {
        return { status: 'not_found' };
      }
      if (incident.status === 'RESOLVED') {
        return { status: 'final' };
      }

      const callsign = responders[input.responderId];
      if (!callsign) {
        return { status: 'assignee_not_found' };
      }

      assignments.push({
        incidentId: input.incidentId,
        responderId: input.responderId,
        actorId: input.actorId,
      });

      const updated: Incident = {
        ...incident,
        assignedToId: input.responderId,
        assignedToCallsign: callsign,
        status: incident.status === 'QUEUED' ? 'DISPATCHED' : incident.status,
      };

      replace(updated);
      return { status: 'ok', incident: updated };
    },

    async updateStatus(input) {
      const incident = find(input.incidentId);
      if (!incident) {
        return { status: 'not_found' };
      }
      if (incident.status !== input.from) {
        return { status: 'conflict' };
      }

      const updated: Incident = {
        ...incident,
        status: input.to,
        resolvedAt: input.to === 'RESOLVED' ? new Date(input.at).toISOString() : null,
      };

      replace(updated);
      return { status: 'ok', incident: updated };
    },
  };
}
