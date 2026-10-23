'use client';

import { useState } from 'react';

import { useLivePosition } from '../hooks/useLivePosition';
import type { GeoPoint } from '../lib/geo';
import { type Incident } from '../lib/incidents';
import type { CategoryFilter } from './Dashboard';
import { LiveMap, type ResponderMarker } from './LiveMap';
import { QueueSidebar } from './QueueSidebar';
import { RoutingPanel } from './RoutingPanel';

export interface IncidentConsoleProps {
  readonly incidents: readonly Incident[];
  readonly origin: GeoPoint;
  /**
   * Oversight mode (admin): queue + map only, NO assign/status controls. When false the
   * console renders the interactive dispatcher surface (routing panel + controls).
   */
  readonly readOnly?: boolean;
  /** Interactive mode only: the caller may assign units (routing is a dispatcher action). */
  readonly canAssign?: boolean;
  /** Interactive mode only: the caller may advance incident status. */
  readonly canUpdateStatus?: boolean;
  /** Interactive mode only: re-read the queue after a mutation so every surface agrees. */
  readonly onChanged?: () => void;
  /** Empty-queue copy for the sidebar (e.g. responder "no assigned incidents"). */
  readonly emptyLabel?: string;
}

/**
 * Shared map + queue surface for the operations picture (R4.4). A single definition
 * mounted by both `/console` (interactive dispatcher surface) and the admin oversight
 * view (read-only). Owns the category filter, the selected incident, and the live
 * responder-position poll for the selected incident.
 *
 * - readOnly=true  -> queue + map only (admin oversight, no controls).
 * - readOnly=false -> queue + map + RoutingPanel (assign/status controls).
 *
 * Capabilities are mirrored by server-side checks; hiding a control is not access
 * control (SECURITY.md §4.1).
 */
export function IncidentConsole({
  incidents,
  origin,
  readOnly = false,
  canAssign = false,
  canUpdateStatus = false,
  onChanged,
  emptyLabel,
}: IncidentConsoleProps) {
  const [filter, setFilter] = useState<CategoryFilter>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const visible: readonly Incident[] =
    filter === 'ALL' ? incidents : incidents.filter((incident) => incident.category === filter);

  const selected: Incident | null =
    incidents.find((incident) => incident.id === selectedId) ?? visible[0] ?? incidents[0] ?? null;

  // Poll the assigned unit's live position for the selected incident, but only while it
  // is assigned and not resolved (a closed incident is not tracked - SECURITY.md §9).
  const trackable =
    selected !== null && selected.assignedToId !== null && selected.status !== 'RESOLVED';
  const tracking = useLivePosition(selected?.id ?? null, { active: trackable });
  const responderMarker: ResponderMarker | null = tracking?.position
    ? {
        lat: tracking.position.lat,
        lon: tracking.position.lon,
        fresh: tracking.position.fresh,
        callsign: tracking.assignedToCallsign,
        lastSeen: new Date(tracking.position.updatedAt).toISOString().slice(11, 16),
      }
    : null;

  if (readOnly) {
    return (
      <div
        className="grid min-h-0 grid-cols-[300px_minmax(0,1fr)] gap-0 border border-line"
        style={{ height: '70vh' }}
      >
        <QueueSidebar
          incidents={incidents}
          filter="ALL"
          onFilterChange={() => undefined}
          selectedId={selected?.id ?? null}
          onSelect={setSelectedId}
          origin={origin}
          className="border-r border-line"
        />
        <div className="min-h-0 min-w-0">
          <LiveMap
            incidents={incidents}
            selected={selected}
            origin={origin}
            responder={responderMarker}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)_360px]">
      <QueueSidebar
        incidents={visible}
        filter={filter}
        onFilterChange={setFilter}
        selectedId={selected?.id ?? null}
        onSelect={setSelectedId}
        origin={origin}
        emptyLabel={emptyLabel}
        className="border-r border-line"
      />

      <div className="min-h-0 min-w-0">
        <LiveMap
          incidents={visible}
          selected={selected}
          origin={origin}
          responder={responderMarker}
        />
      </div>

      <RoutingPanel
        incident={selected}
        canAssign={canAssign}
        canUpdateStatus={canUpdateStatus}
        onChanged={onChanged ?? (() => undefined)}
        className="border-l border-line"
      />
    </div>
  );
}
