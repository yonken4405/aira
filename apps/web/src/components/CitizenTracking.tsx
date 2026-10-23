'use client';

import { t } from '@aira/ui';
import { CheckCircle2, Circle, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import {
  loadIncidentTracking,
  TRACKING_POLL_MS,
  type IncidentTrackingView,
} from '../lib/tracking-client';
import { CitizenTrackingSkeleton, LoadError } from './loading';

/** Forward-only lifecycle shown to the citizen (mirrors INCIDENT_STATUSES order). */
const TIMELINE: readonly { readonly status: string; readonly labelKey: Parameters<typeof t>[0] }[] =
  [
    { status: 'QUEUED', labelKey: 'timelineQueued' },
    { status: 'DISPATCHED', labelKey: 'timelineDispatched' },
    { status: 'EN_ROUTE', labelKey: 'timelineEnRoute' },
    { status: 'ON_SCENE', labelKey: 'timelineOnScene' },
    { status: 'RESOLVED', labelKey: 'timelineResolved' },
  ];

export interface CitizenTrackingProps {
  readonly incidentId: string;
  /** Opaque token for an anonymous reporter; omitted for a logged-in citizen session. */
  readonly token?: string | null;
}

type Phase = 'loading' | 'ok' | 'expired' | 'unavailable';

/**
 * Civilian tracking view (DESIGN.md §5a): a status timeline plus the assigned unit's
 * live position, polled on a short interval. Shows no coordinates or PII beyond the
 * reporter's own incident. A 401 means the token expired; a network error is transient.
 */
export function CitizenTracking({ incidentId, token }: CitizenTrackingProps) {
  const [tracking, setTracking] = useState<IncidentTrackingView | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [reloadKey, setReloadKey] = useState(0);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;

    const poll = async (): Promise<void> => {
      try {
        const next = await loadIncidentTracking(incidentId, { token });
        if (cancelled.current) {
          return;
        }
        setTracking(next);
        setPhase('ok');
      } catch (error) {
        if (cancelled.current) {
          return;
        }
        // A 401 means the link/token is no longer valid; anything else is transient.
        const status = /_(\d{3})$/.exec((error as Error).message)?.[1];
        setPhase(status === '401' ? 'expired' : tracking ? 'ok' : 'unavailable');
      }
    };

    void poll();
    const timer = setInterval(() => void poll(), TRACKING_POLL_MS);
    return () => {
      cancelled.current = true;
      clearInterval(timer);
    };
    // tracking is intentionally excluded: it is read inside the catch only as a hint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentId, token, reloadKey]);

  const retry = () => {
    setPhase('loading');
    setReloadKey((key) => key + 1);
  };

  if (phase === 'expired') {
    return (
      <Centered>
        <TriangleAlert aria-hidden="true" size={20} className="text-status-error" />
        <h1 className="mt-3 text-base font-bold text-fg">{t('trackExpiredTitle')}</h1>
        <p className="mt-1 text-sm text-muted">{t('trackExpiredBody')}</p>
      </Centered>
    );
  }

  if (phase === 'loading') {
    return <CitizenTrackingSkeleton />;
  }

  if (phase === 'unavailable' && !tracking) {
    return (
      <Centered>
        <p className="text-sm text-muted" data-testid="track-status">
          {t('trackUnavailableBody')}
        </p>
        <div className="mt-4">
          <LoadError onRetry={retry} />
        </div>
      </Centered>
    );
  }

  const currentStatus = tracking?.status ?? 'QUEUED';
  const currentIndex = TIMELINE.findIndex((step) => step.status === currentStatus);
  const resolved = currentStatus === 'RESOLVED';

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-5 bg-ink px-5 py-8 text-fg">
      <header>
        <h1 className="text-lg font-extrabold">{t('trackTitle')}</h1>
        <p className="mt-1 text-sm text-muted">{t('trackSubtitle')}</p>
      </header>

      <section className="border border-line bg-surface p-4" data-testid="track-timeline">
        <ol className="flex flex-col gap-3">
          {TIMELINE.map((step, index) => {
            const done = index <= currentIndex;
            const isCurrent = index === currentIndex;
            return (
              <li key={step.status} className="flex items-center gap-3">
                {done ? (
                  <CheckCircle2
                    aria-hidden="true"
                    size={16}
                    className={
                      resolved && isCurrent ? 'text-status-resolved' : 'text-status-dispatched'
                    }
                  />
                ) : (
                  <Circle aria-hidden="true" size={16} className="text-line" />
                )}
                <span
                  className={
                    isCurrent
                      ? 'text-sm font-bold text-fg'
                      : done
                        ? 'text-sm text-muted'
                        : 'text-sm text-line'
                  }
                  aria-current={isCurrent ? 'step' : undefined}
                >
                  {t(step.labelKey)}
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="border border-line bg-surface p-4">
        <p className="text-[10px] font-bold uppercase tracking-label text-muted">
          {t('trackUnitLabel')}
        </p>
        <p className="mt-1 text-sm text-fg" data-testid="track-unit">
          {tracking?.assignedToCallsign
            ? `${tracking.assignedToCallsign} - ${t('trackUnitEnRoute')}`
            : t('trackNoUnitYet')}
        </p>
        {tracking?.position ? (
          <p
            className="mt-2 font-mono text-[11px] tabular-nums text-muted"
            data-testid="track-position"
          >
            {tracking.position.lat}, {tracking.position.lon}
            {tracking.position.fresh ? '' : ` (${t('lastSeen')})`}
          </p>
        ) : null}
      </section>

      {resolved ? (
        <p
          className="text-center text-sm font-bold text-status-resolved"
          data-testid="track-resolved"
        >
          {t('trackResolvedTitle')}
        </p>
      ) : null}
    </main>
  );
}

function Centered({ children }: { readonly children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-ink px-6 text-center text-fg">
      {children}
    </main>
  );
}
