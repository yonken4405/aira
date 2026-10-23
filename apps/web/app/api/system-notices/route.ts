import { getAppDeps } from '../../../src/lib/api/deps';
import { errorResponse } from '../../../src/lib/api/http';
import { handleCreateSystemNotice } from '../../../src/lib/api/system-notice-handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Platform-tier system notice: fan out to every principal across all three tiers. */
export async function POST(request: Request): Promise<Response> {
  const deps = getAppDeps();
  if (!deps) {
    return errorResponse(503, 'service_unavailable');
  }
  return handleCreateSystemNotice(request, deps);
}
