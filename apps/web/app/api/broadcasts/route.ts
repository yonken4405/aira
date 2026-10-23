import { getAppDeps } from '../../../src/lib/api/deps';
import { errorResponse } from '../../../src/lib/api/http';
import { handleCreateBroadcast } from '../../../src/lib/api/broadcast-handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Send a tenant-scoped civilian broadcast (DISPATCHER/ADMIN; R13.1). */
export async function POST(request: Request): Promise<Response> {
  const deps = getAppDeps();
  if (!deps) {
    return errorResponse(503, 'service_unavailable');
  }
  return handleCreateBroadcast(request, deps);
}
