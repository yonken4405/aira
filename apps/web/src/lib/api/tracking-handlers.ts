/**
 * Live-tracking handlers (SECURITY.md §9).
 *
 * PUT /api/responders/me/position - a responder streams their current fix for an
 * incident they are actively assigned to (purpose-bound, §9.1).
 *
 * GET /api/incidents/:id/tracking - the assigned responder's latest live position plus
 * the incident status, served to a dispatcher in the office subtree OR the reporting
 * citizen for that one incident (§9.3). No cross-incident or cross-citizen exposure.
 */

import { can } from '../auth/rbac';
import { hashSessionToken, isSessionToken } from '../auth/session';
import { readLivePosition, recordPosition } from '../tracking/service';
import type { AppDeps } from './deps';
import { authenticateCitizen } from './citizen-handlers';
import {
  errorResponse,
  isSameOrigin,
  jsonResponse,
  NO_STORE_HEADERS,
  readJsonObject,
} from './http';
import { authenticate } from './session-guard';

function isCoordinate(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -max && value <= max;
}

export async function handlePutPosition(request: Request, deps: AppDeps): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse(403, 'forbidden_origin');
  }

  const context = await authenticate(request, deps);
  if (!context.ok) {
    return context.response;
  }

  const { principal } = context;
  // Only a field responder streams a position (dispatchers coordinate, admins oversee).
  if (!can(principal.role, 'incident:status:own')) {
    return errorResponse(403, 'forbidden');
  }

  const body = await readJsonObject(request);
  if (
    !body ||
    typeof body.incidentId !== 'string' ||
    body.incidentId.length > 64 ||
    !isCoordinate(body.lat, 90) ||
    !isCoordinate(body.lon, 180)
  ) {
    return errorResponse(400, 'invalid_position');
  }

  const incident = await deps.incidents.findById(body.incidentId);
  if (!incident) {
    return errorResponse(404, 'incident_not_found');
  }
  // Purpose-bound: only the currently-assigned responder, only while active (§9.1).
  if (incident.assignedToId !== principal.responderId) {
    return errorResponse(404, 'incident_not_found');
  }
  if (incident.status === 'RESOLVED') {
    return errorResponse(409, 'incident_final');
  }

  await recordPosition(deps.tracking, {
    responderId: principal.responderId,
    incidentId: body.incidentId,
    lat: body.lat,
    lon: body.lon,
  });

  return new Response(null, { status: 204, headers: { ...NO_STORE_HEADERS } });
}

/** Shared projection: incident status + the assigned unit's live position (if any). */
async function trackingPayload(
  deps: AppDeps,
  incident: {
    readonly id: string;
    readonly status: string;
    readonly assignedToCallsign: string | null;
  },
): Promise<Record<string, unknown>> {
  const position = await readLivePosition(deps.tracking, incident.id);
  return {
    ok: true,
    incidentId: incident.id,
    status: incident.status,
    assignedToCallsign: incident.assignedToCallsign,
    position,
  };
}

export async function handleGetTracking(
  request: Request,
  deps: AppDeps,
  incidentId: string,
): Promise<Response> {
  const incident = await deps.incidents.findById(incidentId);
  if (!incident) {
    return errorResponse(404, 'incident_not_found');
  }

  // Path 1: a responder session. A dispatcher may track any incident in their office
  // subtree; a field responder may track their own assignment.
  const responder = await authenticate(request, deps);
  if (responder.ok) {
    const { principal } = responder;
    const canOffice =
      can(principal.role, 'incident:read:office') &&
      (await deps.incidents.isInOfficeScope(incidentId, principal.officeId));
    const canOwn =
      can(principal.role, 'incident:read:own') && incident.assignedToId === principal.responderId;

    if (canOffice || canOwn) {
      return jsonResponse(await trackingPayload(deps, incident), 200, { ...NO_STORE_HEADERS });
    }
    return errorResponse(403, 'forbidden');
  }

  // Path 2: the reporting citizen, for their own incident only (§9.3).
  const citizen = await authenticateCitizen(request, deps);
  if (citizen && incident.reporterCitizenId && incident.reporterCitizenId === citizen.citizenId) {
    return jsonResponse(await trackingPayload(deps, incident), 200, { ...NO_STORE_HEADERS });
  }

  // Path 3: an anonymous reporter's opaque tracking token, scoped to THIS incident only
  // (SECURITY.md §10). The token resolves to an incident id; it must match the path id.
  const token = new URL(request.url).searchParams.get('token');
  if (isSessionToken(token)) {
    const tokenIncidentId = await deps.incidents.resolveTrackingToken(
      hashSessionToken(token),
      deps.now(),
    );
    if (tokenIncidentId === incidentId) {
      return jsonResponse(await trackingPayload(deps, incident), 200, { ...NO_STORE_HEADERS });
    }
  }

  return errorResponse(401, 'unauthenticated');
}
