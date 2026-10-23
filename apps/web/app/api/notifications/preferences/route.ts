import {
  handleGetPreferences,
  handleSetPreferences,
} from '../../../../src/lib/api/notifications-handlers';
import { getAppDeps } from '../../../../src/lib/api/deps';
import { errorResponse } from '../../../../src/lib/api/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const deps = getAppDeps();
  if (!deps) {
    return errorResponse(503, 'service_unavailable');
  }
  return handleGetPreferences(request, deps);
}

export async function POST(request: Request): Promise<Response> {
  const deps = getAppDeps();
  if (!deps) {
    return errorResponse(503, 'service_unavailable');
  }
  return handleSetPreferences(request, deps);
}
