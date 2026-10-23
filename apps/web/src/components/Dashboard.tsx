'use client';

import { t, type EmergencyCategoryId } from '@aira/ui';
import { Button, useToast } from '@aira/ui/web';
import { Database, Inbox, RadioTower, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useIncidents } from '../hooks/useIncidents';
import { can } from '../lib/auth/rbac';
import type { Viewer } from '../lib/auth/types';
import { RESPONDER_ORIGIN } from '../lib/incidents';
import { IncidentConsole } from './IncidentConsole';
import { LoadError, MapSkeleton, QueueSkeleton, RoutingSkeleton } from './loading';
import { useSession } from './SessionProvider';

export type CategoryFilter = EmergencyCategoryId | 'ALL';

export interface DashboardProps {
  /** Overrides the session context in tests/storybook; the app reads the context. */
  readonly viewer?: Viewer;
}

/**
 * Responder console body: the shared [queue | live map | routing panel] surface
 * (DESIGN.md §5) plus the live-status toolbar that belongs to the dispatch flow.
 *
 * Identity, sign-out, and primary navigation now live in the shared App_Shell
 * header owned by the console layout (R3.1, R3.2); the Dashboard only owns the
 * in-content live-status toolbar (queued count, mesh state, cache indicator,
 * refresh), the loading/error chrome, and the `IncidentConsole` body.
 *
 * Capabilities come from the session role, but every control here is mirrored by a
 * server-side check - hiding a button is not access control (SECURITY.md §4.1).
 */
export function Dashboard({ viewer: viewerProp }: DashboardProps) {
  const session = useSession();
  const viewer = viewerProp ?? session;

  const { incidents, status, fromCache, refreshing, error, refresh } = useIncidents();
  const { toast } = useToast();
  const router = useRouter();

  useEffect(() => {
    if (!error) {
      return;
    }

    if (error === 'unauthorized') {
      toast({
        tone: 'error',
        title: t('sessionExpiredTitle'),
        description: t('sessionExpiredBody'),
      });
      router.replace('/login?next=/console');
      return;
    }

    toast({
      tone: 'error',
      title: t('toastLoadErrorTitle'),
      description: t('loadFailed'),
    });
  }, [error, toast, router]);

  const queuedCount = incidents.filter((incident) => incident.status === 'QUEUED').length;

  const canAssign = viewer ? can(viewer.role, 'incident:assign') : false;
  const canAdvanceStatus = viewer
    ? can(viewer.role, 'incident:status:any') || can(viewer.role, 'incident:status:own')
    : false;

  // Live-status toolbar: the dispatch flow's own queue/mesh/cache/refresh controls.
  // Deliberately a plain div (not a banner element) and carries no identity or
  // sign-out - those moved to the shared App_Shell header (R3.2).
  const toolbar = (
    <div className="flex shrink-0 items-center justify-end gap-4 border-b border-line bg-surface px-4 py-2.5">
      <span className="flex items-center gap-1.5 font-mono text-[11px] tabular-nums text-status-queued">
        <Inbox aria-hidden="true" size={12} />
        {t('queued')} {queuedCount}
      </span>

      <span className="hidden items-center gap-1.5 text-[11px] uppercase tracking-label text-muted sm:flex">
        <RadioTower aria-hidden="true" size={12} />
        {t('meshStandby')}
      </span>

      {fromCache ? (
        <span
          data-testid="cache-indicator"
          className="flex items-center gap-1.5 text-[11px] uppercase tracking-label text-status-info"
        >
          <Database aria-hidden="true" size={12} />
          {t('refreshCached')}
        </span>
      ) : null}

      <Button
        variant="secondary"
        size="sm"
        onClick={refresh}
        disabled={refreshing}
        aria-label={t('refresh')}
      >
        <RefreshCw
          aria-hidden="true"
          size={12}
          className={refreshing ? 'animate-spin motion-reduce:animate-none' : undefined}
        />
        {t('refresh')}
      </Button>
    </div>
  );

  if (status === 'loading') {
    return (
      <div className="flex h-dvh flex-col bg-ink text-fg">
        {toolbar}
        <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)_360px]">
          <QueueSkeleton />
          <MapSkeleton />
          <RoutingSkeleton />
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex h-dvh flex-col bg-ink text-fg">
        {toolbar}
        <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)_360px]">
          <LoadError onRetry={refresh} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-ink text-fg">
      {toolbar}

      <IncidentConsole
        incidents={incidents}
        origin={RESPONDER_ORIGIN}
        canAssign={canAssign}
        canUpdateStatus={canAdvanceStatus}
        onChanged={refresh}
        emptyLabel={viewer?.role === 'RESPONDER' ? t('noAssigned') : undefined}
      />
    </div>
  );
}
