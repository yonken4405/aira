import { getAppDeps } from '../../../src/lib/api/deps';
import { errorResponse } from '../../../src/lib/api/http';
import { handleIntake, handleListIncidents } from '../../../src/lib/api/incidents-handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Responder queue. Scoped by role in SQL, never by the client. */
export async function GET(request: Request): Promise<Response> {
  const deps = getAppDeps();
  if (!deps) {
    return errorResponse(503, 'service_unavailable');
  }
  return handleListIncidents(request, deps);
}

/** Citizen intake. Public, closed-enum payload, no PII (PRODUCT.md §4). */
export async function POST(request: Request): Promise<Response> {
  const deps = getAppDeps();
  if (!deps) {
    return errorResponse(503, 'service_unavailable');
  }
  return handleIntake(request, deps);
}
