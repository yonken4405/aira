import { getAppDeps } from '../../../../src/lib/api/deps';
import { errorResponse } from '../../../../src/lib/api/http';
import {
  handleRegisterPushSubscription,
  handleUnregisterPushSubscription,
} from '../../../../src/lib/api/push-subscription-handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Register (or replace) the signed-in principal's Web_Push subscription. */
export async function POST(request: Request): Promise<Response> {
  const deps = getAppDeps();
  if (!deps) {
    return errorResponse(503, 'service_unavailable');
  }
  return handleRegisterPushSubscription(request, deps);
}

/** Unsubscribe the signed-in principal's Web_Push subscription by endpoint. */
export async function DELETE(request: Request): Promise<Response> {
  const deps = getAppDeps();
  if (!deps) {
    return errorResponse(503, 'service_unavailable');
  }
  return handleUnregisterPushSubscription(request, deps);
}
