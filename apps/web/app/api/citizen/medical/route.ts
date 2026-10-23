import {
  handleDeleteMedicalProfile,
  handleGetMedicalProfile,
  handlePutMedicalProfile,
} from '../../../../src/lib/api/medical-handlers';
import { getAppDeps } from '../../../../src/lib/api/deps';
import { errorResponse } from '../../../../src/lib/api/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const deps = getAppDeps();
  if (!deps) {
    return errorResponse(503, 'service_unavailable');
  }
  return handleGetMedicalProfile(request, deps);
}

export async function PUT(request: Request): Promise<Response> {
  const deps = getAppDeps();
  if (!deps) {
    return errorResponse(503, 'service_unavailable');
  }
  return handlePutMedicalProfile(request, deps);
}

export async function DELETE(request: Request): Promise<Response> {
  const deps = getAppDeps();
  if (!deps) {
    return errorResponse(503, 'service_unavailable');
  }
  return handleDeleteMedicalProfile(request, deps);
}
