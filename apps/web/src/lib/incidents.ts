/**
 * Incident domain model (PRODUCT.md §4, SECURITY.md §5).
 *
 * Rows are structured payloads only - citizens never send text, so there is no
 * free-text field from the public surface. Coordinates are WGS84 at 4 decimal
 * places, enforced by the database.
 */

import type { EmergencyCategoryId } from '@aira/ui';

import type { GeoPoint } from './geo';

export const INCIDENT_STATUSES = [
  'QUEUED',
  'DISPATCHED',
  'EN_ROUTE',
  'ON_SCENE',
  'RESOLVED',
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const INCIDENT_SOURCES = ['mesh', 'manual'] as const;
/** `mesh` = relayed from the offline mesh; `manual` = entered by an operator. */
export type IncidentSource = (typeof INCIDENT_SOURCES)[number];

export interface Incident {
  readonly id: string;
  readonly category: EmergencyCategoryId;
  /** WGS84, 4 dp - SECURITY.md §5. */
  readonly lat: number;
  readonly lon: number;
  readonly reportedAt: string;
  readonly source: IncidentSource;
  readonly status: IncidentStatus;
  readonly assignedToId: string | null;
  /** Callsign of the assigned responder, joined for display. */
  readonly assignedToCallsign: string | null;
  readonly officeId: string;
  /** Responder-only operational note (sanitised before display, SECURITY.md §3). */
  readonly note: string | null;
  readonly resolvedAt: string | null;
  /**
   * Reporting citizen, set ONLY for an online submission by a logged-in citizen
   * (out-of-band, never from the mesh payload - SECURITY.md §7/§8). Null for anonymous
   * Tier 0 alerts. Server-internal: stripped from every browser response (the dispatcher
   * never receives the citizen link), so it is optional on the shared shape.
   */
  readonly reporterCitizenId?: string | null;
}

/** Forward-only status graph. A resolved incident is final. */
const ALLOWED_TRANSITIONS: Readonly<Record<IncidentStatus, readonly IncidentStatus[]>> = {
  QUEUED: ['DISPATCHED', 'RESOLVED'],
  DISPATCHED: ['EN_ROUTE', 'ON_SCENE', 'RESOLVED'],
  EN_ROUTE: ['ON_SCENE', 'RESOLVED'],
  ON_SCENE: ['RESOLVED'],
  RESOLVED: [],
};

export function isIncidentStatus(value: unknown): value is IncidentStatus {
  return typeof value === 'string' && (INCIDENT_STATUSES as readonly string[]).includes(value);
}

export function isIncidentSource(value: unknown): value is IncidentSource {
  return typeof value === 'string' && (INCIDENT_SOURCES as readonly string[]).includes(value);
}

export function canTransition(from: IncidentStatus, to: IncidentStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Statuses a field responder may report on their own assignment. */
export const RESPONDER_UPDATABLE_STATUSES: readonly IncidentStatus[] = [
  'EN_ROUTE',
  'ON_SCENE',
  'RESOLVED',
];

/** Mock responder station position (Cebu City) - NOT a live GPS fix. */
export const RESPONDER_ORIGIN: GeoPoint = { lat: 10.3233, lon: 123.9017 };
