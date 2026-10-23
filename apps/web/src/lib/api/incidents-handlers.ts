/**
 * `/api/incidents` handlers.
 *
 * POST is the public citizen intake (closed enum payload, no account, no PII).
 * Everything else requires a responder session and is scoped in SQL by role.
 */

import { parseSosPayload, t } from '@aira/ui';

import { can } from '../auth/rbac';
import { notifyOne, notifySafe } from '../notifications/service';
import {
  canTransition,
  isIncidentStatus,
  RESPONDER_UPDATABLE_STATUSES,
  type IncidentStatus,
} from '../incidents';
import { rankResponders } from '../routing';
import { readSnapshotFor } from '../medical/service';
import { createSessionToken, hashSessionToken } from '../auth/session';
import { authenticateCitizen } from './citizen-handlers';

/** Anonymous tracking token lifetime (SECURITY.md §10): bounded, short. */
export const TRACKING_TOKEN_TTL_MS = 6 * 60 * 60 * 1000;
import type { AppDeps } from './deps';
import {
  clientFingerprint,
  errorResponse,
  isSameOrigin,
  jsonResponse,
  NO_STORE_HEADERS,
  PRIVATE_CACHE_HEADERS,
  readJsonObject,
} from './http';
import { authenticate, requireAnyPermission, requirePermission } from './session-guard';
import type { Incident } from '../incidents';

/**
 * Browser-facing incident shape. `reporterCitizenId` is server-internal (it links an
 * incident to a citizen's health profile) and is stripped from every response so the
 * dispatcher console never receives the citizen link (SECURITY.md §7/§8).
 */
function toWireIncident(incident: Incident): Omit<Incident, 'reporterCitizenId'> {
  const { reporterCitizenId: _reporterCitizenId, ...wire } = incident;
  return wire;
}

export async function handleListIncidents(request: Request, deps: AppDeps): Promise<Response> {
  const context = await authenticate(request, deps);
  if (!context.ok) {
    return context.response;
  }

  const { principal } = context;
  const forbidden = requireAnyPermission(principal, ['incident:read:office', 'incident:read:own']);
  if (forbidden) {
    return forbidden;
  }

  const incidents = can(principal.role, 'incident:read:office')
    ? await deps.incidents.listForOffice(principal.officeId)
    : await deps.incidents.listAssignedTo(principal.responderId);

  return jsonResponse({ ok: true, incidents: incidents.map(toWireIncident) }, 200, {
    ...PRIVATE_CACHE_HEADERS,
  });
}

/**
 * Citizen intake. Public by design: residents hold no account (SECURITY.md §4), so
 * the payload itself is the only credential and it carries zero PII.
 */
export async function handleIntake(request: Request, deps: AppDeps): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse(403, 'forbidden_origin');
  }

  const limit = deps.intakeLimiter.consume(clientFingerprint(request));
  if (!limit.allowed) {
    return jsonResponse({ ok: false, error: 'rate_limited' }, 429, {
      'retry-after': String(limit.retryAfterSeconds),
    });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return errorResponse(400, 'invalid_json');
  }

  const parsed = parseSosPayload(raw);
  if (!parsed.ok) {
    return errorResponse(400, parsed.reason);
  }

  const officeId = await deps.incidents.getDefaultOfficeId();
  if (!officeId) {
    return errorResponse(503, 'office_not_configured');
  }

  // Online enrichment (SECURITY.md §7/§8): if a logged-in citizen submitted this, link
  // the incident to them OUT OF BAND. The mesh payload itself is still anonymous; this
  // link only exists for online submissions and only enables the on-incident medical
  // reveal. An anonymous submission leaves it null.
  const reporter = await authenticateCitizen(request, deps);

  const [category, lat, lon] = parsed.payload;
  const createdAt = deps.now();
  const incident = await deps.incidents.create({
    category,
    lat,
    lon,
    officeId,
    source: 'mesh',
    reporterCitizenId: reporter?.citizenId ?? null,
    at: createdAt,
  });

  // Anonymous reporters get a one-time opaque tracking token so they can follow this
  // one incident without an account (SECURITY.md §10). A logged-in citizen tracks via
  // their session and needs no token.
  let trackingToken: string | null = null;
  if (!reporter) {
    const token = createSessionToken();
    await deps.incidents.createTrackingToken({
      incidentId: incident.id,
      tokenHash: hashSessionToken(token),
      createdAt,
      expiresAt: createdAt + TRACKING_TOKEN_TTL_MS,
    });
    trackingToken = token;
  }

  return jsonResponse({ ok: true, incident: toWireIncident(incident), trackingToken }, 201, {
    ...NO_STORE_HEADERS,
  });
}

export async function handleAssignIncident(
  request: Request,
  deps: AppDeps,
  incidentId: string,
): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse(403, 'forbidden_origin');
  }

  const context = await authenticate(request, deps);
  if (!context.ok) {
    return context.response;
  }

  const forbidden = requirePermission(context.principal, 'incident:assign');
  if (forbidden) {
    return forbidden;
  }

  const body = await readJsonObject(request);
  if (!body || typeof body.responderId !== 'string' || body.responderId.length > 64) {
    return errorResponse(400, 'invalid_responder_id');
  }
  const responderId = body.responderId;

  const incident = await deps.incidents.findById(incidentId);
  if (!incident) {
    return errorResponse(404, 'incident_not_found');
  }

  if (!(await deps.incidents.isInOfficeScope(incidentId, context.principal.officeId))) {
    // Out-of-scope rows are indistinguishable from missing ones.
    return errorResponse(404, 'incident_not_found');
  }

  const outcome = await deps.incidents.assign({
    incidentId,
    responderId,
    actorId: context.principal.responderId,
    at: deps.now(),
  });

  if (outcome.status === 'not_found') {
    return errorResponse(404, 'incident_not_found');
  }
  if (outcome.status === 'final') {
    return errorResponse(409, 'incident_final');
  }
  if (outcome.status === 'assignee_not_found') {
    return errorResponse(400, 'invalid_responder_id');
  }

  // Post-success event hook (R11.1, R11.4): notify ONLY the assigned responder —
  // never the acting dispatcher. Fail-soft so a notification failure can never
  // change this already-committed 200 (R10.5).
  await notifySafe(() =>
    notifyOne(
      deps.notifications,
      { tier: 'responders', principalId: responderId },
      {
        type: 'incident.assigned',
        data: { incidentId },
        title: t('notifyIncidentAssignedTitle'),
        body: t('notifyIncidentAssignedBody'),
      },
      { critical: false },
    ),
  );

  return jsonResponse({ ok: true, incident: toWireIncident(outcome.incident) }, 200, {
    ...NO_STORE_HEADERS,
  });
}

export async function handleUpdateStatus(
  request: Request,
  deps: AppDeps,
  incidentId: string,
): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse(403, 'forbidden_origin');
  }

  const context = await authenticate(request, deps);
  if (!context.ok) {
    return context.response;
  }

  const body = await readJsonObject(request);
  const status = body?.status;
  if (!isIncidentStatus(status)) {
    return errorResponse(400, 'invalid_status');
  }

  const incident = await deps.incidents.findById(incidentId);
  if (!incident) {
    return errorResponse(404, 'incident_not_found');
  }

  const { principal } = context;
  const isOwnAssignment = incident.assignedToId === principal.responderId;
  const canManageAny = can(principal.role, 'incident:status:any');
  const canManageOwn = can(principal.role, 'incident:status:own') && isOwnAssignment;

  if (!canManageAny && !canManageOwn) {
    // Responders only ever act on their own assignment; scoping is not a UI concern.
    return errorResponse(403, 'forbidden');
  }

  if (canManageOwn && !canManageAny && !RESPONDER_UPDATABLE_STATUSES.includes(status)) {
    return errorResponse(403, 'forbidden_status');
  }

  if (canManageAny && !(await deps.incidents.isInOfficeScope(incidentId, principal.officeId))) {
    return errorResponse(404, 'incident_not_found');
  }

  if (!canTransition(incident.status, status)) {
    return errorResponse(409, 'invalid_transition', { from: incident.status, to: status });
  }

  const outcome = await deps.incidents.updateStatus({
    incidentId,
    from: incident.status,
    to: status as IncidentStatus,
    actorId: principal.responderId,
    at: deps.now(),
  });

  if (outcome.status === 'not_found') {
    return errorResponse(404, 'incident_not_found');
  }
  if (outcome.status === 'conflict') {
    return errorResponse(409, 'status_conflict');
  }

  return jsonResponse({ ok: true, incident: toWireIncident(outcome.incident) }, 200, {
    ...NO_STORE_HEADERS,
  });
}

/**
 * Ranked nearest-responder suggestions for an incident (dispatcher routing action).
 * Suggestions never grant access - assignment is still authorised server-side.
 */
export async function handleRoutingSuggestions(
  request: Request,
  deps: AppDeps,
  incidentId: string,
): Promise<Response> {
  const context = await authenticate(request, deps);
  if (!context.ok) {
    return context.response;
  }

  const forbidden = requirePermission(context.principal, 'incident:assign');
  if (forbidden) {
    return forbidden;
  }

  const incident = await deps.incidents.findById(incidentId);
  if (!incident) {
    return errorResponse(404, 'incident_not_found');
  }
  if (!(await deps.incidents.isInOfficeScope(incidentId, context.principal.officeId))) {
    return errorResponse(404, 'incident_not_found');
  }

  const candidates = await deps.incidents.listRoutingCandidates(context.principal.officeId);
  const suggestions = rankResponders(
    incident.category,
    { lat: incident.lat, lon: incident.lon },
    candidates,
  );

  // Project to the browser shape: no base coordinates leave the server (the dispatcher
  // sees the distance, not the responder's home position - SECURITY.md §5).
  const ranked = suggestions.map((suggestion) => ({
    id: suggestion.candidate.id,
    callsign: suggestion.candidate.callsign,
    agencyName: suggestion.candidate.agencyName,
    officeName: suggestion.candidate.officeName,
    capable: suggestion.capable,
    distanceKm: suggestion.distanceKm,
  }));

  return jsonResponse({ ok: true, suggestions: ranked }, 200, { ...PRIVATE_CACHE_HEADERS });
}

/** Assignee picker for the routing panel (dispatcher and admin only). */
export async function handleListAssignableResponders(
  request: Request,
  deps: AppDeps,
): Promise<Response> {
  const context = await authenticate(request, deps);
  if (!context.ok) {
    return context.response;
  }

  const forbidden = requirePermission(context.principal, 'responder:read');
  if (forbidden) {
    return forbidden;
  }

  const responders = await deps.authStore.listAssignableResponders(context.principal.officeId);
  return jsonResponse({ ok: true, responders }, 200, { ...PRIVATE_CACHE_HEADERS });
}

/**
 * On-incident, need-to-know medical reveal (SECURITY.md §8.3).
 *
 * Deny by default. A responder sees the reporting citizen's minimised medical snapshot
 * ONLY when ALL hold:
 *   - they are the responder currently assigned to the incident;
 *   - the incident is not RESOLVED (the grant auto-revokes on resolve);
 *   - the incident was submitted by a logged-in citizen (has a reporter link).
 * Every successful reveal writes a MEDICAL_ACCESS audit event (actor + incident id,
 * never the profile body or coordinates).
 */
export async function handleMedicalReveal(
  request: Request,
  deps: AppDeps,
  incidentId: string,
): Promise<Response> {
  const context = await authenticate(request, deps);
  if (!context.ok) {
    return context.response;
  }

  const { principal } = context;
  // Only a field responder acting on their own assignment may reveal. Dispatchers and
  // admins coordinate but do not get citizen health data by default (SECURITY.md §4/§8).
  if (!can(principal.role, 'incident:status:own')) {
    return errorResponse(403, 'forbidden');
  }

  const incident = await deps.incidents.findById(incidentId);
  if (!incident) {
    return errorResponse(404, 'incident_not_found');
  }

  // The grant is the assignment: not the assignee -> indistinguishable from missing.
  if (incident.assignedToId !== principal.responderId) {
    return errorResponse(404, 'incident_not_found');
  }

  // Auto-revoke on resolve: a closed incident no longer grants access.
  if (incident.status === 'RESOLVED') {
    return errorResponse(403, 'grant_expired');
  }

  if (!incident.reporterCitizenId) {
    // Anonymous reporter: there is simply no profile to reveal.
    return jsonResponse({ ok: true, snapshot: null }, 200, { ...NO_STORE_HEADERS });
  }

  const snapshot = await readSnapshotFor(deps.medical, incident.reporterCitizenId);

  // Audit the reveal regardless of whether a profile existed - the responder looked.
  await deps.incidents.recordMedicalAccess({
    incidentId,
    actorId: principal.responderId,
    at: deps.now(),
  });

  return jsonResponse({ ok: true, snapshot }, 200, { ...NO_STORE_HEADERS });
}
