/**
 * `/api/citizen/medical` handlers (SECURITY.md §8).
 *
 * Owner-only: a request must carry a valid CITIZEN session, and it can only ever read
 * or write that citizen's own profile. There is no cross-citizen access path here; the
 * responder reveal is a separate, grant-gated route (Task 8).
 */

import { deleteOwnProfile, readOwnProfile, saveOwnProfile } from '../medical/service';
import type { AppDeps } from './deps';
import { authenticateCitizen } from './citizen-handlers';
import {
  errorResponse,
  isSameOrigin,
  jsonResponse,
  NO_STORE_HEADERS,
  readJsonObject,
} from './http';

export async function handleGetMedicalProfile(request: Request, deps: AppDeps): Promise<Response> {
  const principal = await authenticateCitizen(request, deps);
  if (!principal) {
    return errorResponse(401, 'unauthenticated');
  }

  const profile = await readOwnProfile(deps.medical, principal.citizenId);
  // Private, never shared-cached: it is health PII (SECURITY.md §8.2/§5.6).
  return jsonResponse({ ok: true, profile }, 200, { ...NO_STORE_HEADERS });
}

export async function handlePutMedicalProfile(request: Request, deps: AppDeps): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse(403, 'forbidden_origin');
  }

  const principal = await authenticateCitizen(request, deps);
  if (!principal) {
    return errorResponse(401, 'unauthenticated');
  }

  const body = await readJsonObject(request);
  if (!body) {
    return errorResponse(400, 'invalid_json');
  }

  // The service sanitises + encrypts; we echo back the canonical stored shape so the
  // client reflects exactly what was persisted.
  const profile = await saveOwnProfile(deps.medical, principal.citizenId, body);
  return jsonResponse({ ok: true, profile }, 200, { ...NO_STORE_HEADERS });
}

export async function handleDeleteMedicalProfile(
  request: Request,
  deps: AppDeps,
): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse(403, 'forbidden_origin');
  }

  const principal = await authenticateCitizen(request, deps);
  if (!principal) {
    return errorResponse(401, 'unauthenticated');
  }

  await deleteOwnProfile(deps.medical, principal.citizenId);
  return new Response(null, { status: 204, headers: { ...NO_STORE_HEADERS } });
}
