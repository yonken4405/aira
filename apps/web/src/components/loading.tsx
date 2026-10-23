import { t } from '@aira/ui';
import { Button, Skeleton } from '@aira/ui/web';
import { MapPinned, RefreshCw, TriangleAlert } from 'lucide-react';

/**
 * Loading states (DESIGN.md §6). Every async surface renders a skeleton of its real
 * layout - no spinners-only blank screens, no layout shift when data lands.
 */

const SKELETON_ROWS = [0, 1, 2, 3] as const;
const SKELETON_CHIPS = [0, 1, 2, 3, 4] as const;
// The citizen timeline shows five lifecycle steps (QUEUED → RESOLVED).
const TIMELINE_ROWS = [0, 1, 2, 3, 4] as const;

export function QueueSkeleton() {
  return (
    <aside
      aria-busy="true"
      aria-label={t('incomingQueue')}
      data-testid="queue-skeleton"
      className="flex min-h-0 flex-col border-r border-line bg-surface"
    >
      <div className="shrink-0 border-b border-line px-3 pb-2 pt-2.5">
        <Skeleton className="h-3 w-28" />
        <div className="mt-3 flex gap-1.5">
          {SKELETON_CHIPS.map((chip) => (
            <Skeleton key={chip} className="h-6 w-12" />
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {SKELETON_ROWS.map((row) => (
          <div key={row} className="border-b border-line px-3 py-3">
            <div className="flex items-center justify-between gap-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-10" />
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-14" />
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

export function MapSkeleton() {
  return (
    <div
      aria-busy="true"
      data-testid="map-skeleton"
      className="relative flex min-h-0 min-w-0 items-center justify-center overflow-hidden bg-surface"
    >
      <div className="absolute inset-0 p-6">
        <Skeleton className="h-full w-full" />
      </div>

      <div className="relative flex flex-col items-center gap-2 border border-line bg-ink/90 px-4 py-3">
        <MapPinned
          aria-hidden="true"
          size={18}
          className="animate-pulse text-muted motion-reduce:animate-none"
        />
        <p className="text-[11px] uppercase tracking-label text-muted">{t('loadingIncidents')}</p>
      </div>
    </div>
  );
}

export function RoutingSkeleton() {
  return (
    <aside
      aria-busy="true"
      data-testid="routing-skeleton"
      className="flex min-h-0 flex-col border-l border-line bg-surface"
    >
      <div className="shrink-0 border-b border-line px-3 py-2.5">
        <Skeleton className="h-3 w-32" />
      </div>

      <div className="min-h-0 flex-1 space-y-3 p-3">
        <Skeleton className="h-5 w-24" />

        <div className="space-y-2 border border-line p-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-4 w-full" />
        </div>

        {[0, 1, 2].map((row) => (
          <div key={row} className="flex items-center justify-between gap-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}

        <Skeleton className="h-9 w-full" />
      </div>
    </aside>
  );
}

/**
 * Nationwide partner-office map (PlatformMap). Shapes the filter bar + the tall map
 * frame so the real map drops in without layout shift (R19.3, R19.5).
 */
export function PlatformMapSkeleton() {
  return (
    <div aria-busy="true" data-testid="platform-map-skeleton" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-9 min-w-[220px] flex-1" />
        <Skeleton className="h-4 w-24" />
      </div>

      <div
        className="relative flex items-center justify-center overflow-hidden border border-line bg-surface"
        style={{ height: '70vh' }}
      >
        <div className="absolute inset-0 p-6">
          <Skeleton className="h-full w-full" />
        </div>
        <div className="relative flex flex-col items-center gap-2 border border-line bg-ink/90 px-4 py-3">
          <MapPinned
            aria-hidden="true"
            size={18}
            className="animate-pulse text-muted motion-reduce:animate-none"
          />
          <p className="text-[11px] uppercase tracking-label text-muted">{t('loadingIncidents')}</p>
        </div>
      </div>
    </div>
  );
}

/**
 * Civilian incident tracking (CitizenTracking). Shapes the header, status timeline and
 * assigned-unit card so the live view lands without a jump (R19.3, R19.5).
 */
export function CitizenTrackingSkeleton() {
  return (
    <main
      aria-busy="true"
      data-testid="tracking-skeleton"
      className="mx-auto flex min-h-dvh max-w-md flex-col gap-5 bg-ink px-5 py-8 text-fg"
    >
      <header className="space-y-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-56" />
      </header>

      <section className="border border-line bg-surface p-4">
        <div className="flex flex-col gap-3">
          {TIMELINE_ROWS.map((row) => (
            <div key={row} className="flex items-center gap-3">
              <Skeleton className="h-4 w-4 rounded-full" />
              <Skeleton className="h-3 w-32" />
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-2 border border-line bg-surface p-4">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-4 w-40" />
      </section>
    </main>
  );
}

/**
 * Generic content skeleton for form/table-style App-Router segments (profile, settings,
 * audit, dashboards, account). Shapes a page title plus a stack of card-like rows so
 * the real content lands without a jump (R19.1, R19.2, R19.5).
 */
export function PageSkeleton() {
  return (
    <div aria-busy="true" data-testid="page-skeleton" className="flex flex-col gap-5 p-4">
      <div className="space-y-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>

      <div className="space-y-3">
        {SKELETON_ROWS.map((row) => (
          <div key={row} className="space-y-2 border border-line bg-surface p-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Blocking failure with no data to show - the one place a retry button lives. */
export function LoadError({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <div
      data-testid="load-error"
      role="alert"
      className="col-span-3 flex flex-col items-center justify-center gap-3 bg-ink p-8"
    >
      <TriangleAlert aria-hidden="true" size={24} className="text-emergency-krimen" />
      <p className="max-w-sm text-center text-xs leading-relaxed text-muted">{t('loadFailed')}</p>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        <RefreshCw aria-hidden="true" size={12} />
        {t('retry')}
      </Button>
    </div>
  );
}
