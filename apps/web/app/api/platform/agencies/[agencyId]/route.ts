import { handlePlatformUpdateAgency } from '../../../../../src/lib/api/platform-handlers';
import { getAppDeps } from '../../../../../src/lib/api/deps';
import { errorResponse } from '../../../../../src/lib/api/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ agencyId: string }> },
): Promise<Response> {
  const deps = getAppDeps();
  if (!deps) {
    return errorResponse(503, 'service_unavailable');
  }
  const { agencyId } = await context.params;
  return handlePlatformUpdateAgency(request, deps, agencyId);
}
