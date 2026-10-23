'use client';

import { useEffect, useRef, useState } from 'react';

import {
  loadIncidentTracking,
  TRACKING_POLL_MS,
  type IncidentTrackingView,
} from '../lib/tracking-client';

/**
 * Polls the tracking endpoint for one incident on a short interval (SECURITY.md §9).
 * Returns the latest tracking view (assigned unit + live position) or null. Stops when
 * the incident is null/resolved so a closed incident is not tracked (grant auto-revoke).
 */
export function useLivePosition(
  incidentId: string | null,
  options: { readonly active?: boolean; readonly pollMs?: number } = {},
): IncidentTrackingView | null {
  const active = options.active ?? true;
  const pollMs = options.pollMs ?? TRACKING_POLL_MS;
  const [tracking, setTracking] = useState<IncidentTrackingView | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;

    if (!incidentId || !active) {
      setTracking(null);
      return () => {
        cancelled.current = true;
      };
    }

    const poll = async (): Promise<void> => {
      try {
        const next = await loadIncidentTracking(incidentId);
        if (!cancelled.current) {
          setTracking(next);
        }
      } catch {
        // A failed poll leaves the last-known value; the next tick retries.
      }
    };

    void poll();
    const timer = setInterval(() => void poll(), pollMs);

    return () => {
      cancelled.current = true;
      clearInterval(timer);
    };
  }, [incidentId, active, pollMs]);

  return tracking;
}
