import { handleCitizenAccountDelete } from '../../../../src/lib/api/citizen-handlers';
import { getAppDeps } from '../../../../src/lib/api/deps';
import { errorResponse } from '../../../../src/lib/api/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Hard-delete the authenticated citizen's account (SECURITY.md §7.5, R10). */
export async function DELETE(request: Request): Promise<Response> {
  const deps = getAppDeps();
  if (!deps) {
    return errorResponse(503, 'service_unavailable');
  }
  return handleCitizenAccountDelete(request, deps);
}
