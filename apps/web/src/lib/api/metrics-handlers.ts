/**
 * `/api/metrics` handler: read-only oversight metrics (PRODUCT.md §5).
 *
 * Requires `metrics:read` (ADMIN / DISPATCHER). Returns aggregate counts + durations
 * for the caller's office subtree only; never coordinates or citizen links.
 */

import { computeMetrics } from '../metrics';
import type { AppDeps } from './deps';
import { jsonResponse, PRIVATE_CACHE_HEADERS } from './http';
import { authenticate, requirePermission } from './session-guard';

export async function handleGetMetrics(request: Request, deps: AppDeps): Promise<Response> {
  const context = await authenticate(request, deps);
  if (!context.ok) {
    return context.response;
  }

  const forbidden = requirePermission(context.principal, 'metrics:read');
  if (forbidden) {
    return forbidden;
  }

  const incidents = await deps.incidents.listForOffice(context.principal.officeId);
  const metrics = computeMetrics(incidents);

  return jsonResponse({ ok: true, metrics }, 200, { ...PRIVATE_CACHE_HEADERS });
}
