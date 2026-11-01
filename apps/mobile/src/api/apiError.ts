/** Bridge a client transport failure to the shared `errorToCopyKey` input shape. */

import type { ApiError } from '@aira/ui';

import type { ApiFailure } from './citizenClient';

export function failureToApiError(failure: ApiFailure): ApiError {
  if (failure.kind === 'http') {
    return { kind: 'http', status: failure.status, code: failure.code };
  }
  return { kind: failure.kind };
}
