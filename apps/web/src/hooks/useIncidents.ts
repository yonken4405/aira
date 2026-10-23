'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { Incident } from '../lib/incidents';
import { IncidentsRequestError, loadIncidents } from '../lib/incidents-client';

export type IncidentsStatus = 'loading' | 'ready' | 'error';

export interface UseIncidentsResult {
  readonly incidents: readonly Incident[];
  readonly status: IncidentsStatus;
  /** True when the latest successful load was served from the TTL cache. */
  readonly fromCache: boolean;
  readonly refreshing: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
}

interface IncidentsState {
  readonly incidents: readonly Incident[];
  readonly status: IncidentsStatus;
  readonly fromCache: boolean;
  readonly refreshing: boolean;
  readonly error: string | null;
}

const INITIAL_STATE: IncidentsState = {
  incidents: [],
  status: 'loading',
  fromCache: false,
  refreshing: false,
  error: null,
};

/**
 * Loads the queue once, then serves cached data on remounts while a manual refresh
 * always revalidates. Keeps the last good data when a refresh fails.
 */
export function useIncidents(): UseIncidentsResult {
  const [state, setState] = useState<IncidentsState>(INITIAL_STATE);
  const requestId = useRef(0);

  const load = useCallback(async (force: boolean) => {
    requestId.current += 1;
    const currentRequest = requestId.current;

    setState((current) => ({ ...current, refreshing: force, error: null }));

    try {
      const result = await loadIncidents({ force });
      if (requestId.current !== currentRequest) {
        return;
      }

      setState({
        incidents: result.incidents,
        status: 'ready',
        fromCache: result.source === 'cache',
        refreshing: false,
        error: null,
      });
    } catch (error) {
      if (requestId.current !== currentRequest) {
        return;
      }

      const unauthorized = error instanceof IncidentsRequestError && error.status === 401;

      setState((current) => ({
        ...current,
        status: current.incidents.length > 0 ? 'ready' : 'error',
        refreshing: false,
        error: unauthorized ? 'unauthorized' : 'incidents_load_failed',
      }));
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const refresh = useCallback(() => {
    void load(true);
  }, [load]);

  return {
    incidents: state.incidents,
    status: state.status,
    fromCache: state.fromCache,
    refreshing: state.refreshing,
    error: state.error,
    refresh,
  };
}
