import { handleGetTracking } from '../../../../../src/lib/api/tracking-handlers';
import { getAppDeps } from '../../../../../src/lib/api/deps';
import { errorResponse } from '../../../../../src/lib/api/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const deps = getAppDeps();
  if (!deps) {
    return errorResponse(503, 'service_unavailable');
  }

  const { id } = await context.params;
  return handleGetTracking(request, deps, id);
}
