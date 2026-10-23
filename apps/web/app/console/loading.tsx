import { MapSkeleton, QueueSkeleton, RoutingSkeleton } from '../../src/components/loading';

/** Route-level fallback for the responder console dashboard (R19.1, R19.2). */
export default function ConsoleLoading() {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,22rem)_minmax(0,1fr)_minmax(0,22rem)]">
      <QueueSkeleton />
      <MapSkeleton />
      <RoutingSkeleton />
    </div>
  );
}
