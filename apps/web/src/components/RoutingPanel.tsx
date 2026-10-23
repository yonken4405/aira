'use client';

import { buildSosPayload, googleMapsDirectionsUrl, serializeSosPayload, t } from '@aira/ui';
import {
  Button,
  CategoryBadge,
  ConfirmDialog,
  MetricRow,
  Panel,
  Select,
  cn,
  useToast,
} from '@aira/ui/web';
import { Navigation } from 'lucide-react';
import { useEffect, useState } from 'react';

import { estimateEtaMinutes, formatDistance, haversineKm } from '../lib/geo';
import {
  RESPONDER_ORIGIN,
  RESPONDER_UPDATABLE_STATUSES,
  canTransition,
  type Incident,
  type IncidentStatus,
} from '../lib/incidents';
import { statusLabel } from '../lib/labels';
import { loadAssignableResponders, type AssignableResponder } from '../lib/responders-client';
import { loadRoutingSuggestions, type RoutingSuggestionView } from '../lib/routing-client';

export interface RoutingPanelProps {
  readonly incident: Incident | null;
  /** DISPATCHER only: routing is a dispatcher action (SECURITY.md §4). */
  readonly canAssign: boolean;
  /** The caller may move this incident forward (own assignment or dispatch). */
  readonly canUpdateStatus: boolean;
  /** Re-read the queue after a mutation so every surface agrees. */
  readonly onChanged: () => void;
  readonly className?: string;
}

interface PostResult {
  readonly ok: boolean;
  readonly status: number;
}

async function postJson(url: string, body: unknown): Promise<PostResult> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

/**
 * Responder routing panel: decoded mesh payload, distance/ETA, unit assignment and
 * field status reporting.
 *
 * Both mutations are confirmation-gated or single-step and always report through the
 * unified toast surface (DESIGN.md §6). Controls are hidden for roles that lack the
 * permission, but the server enforces the same rule independently.
 */
export function RoutingPanel({
  incident,
  canAssign,
  canUpdateStatus,
  onChanged,
  className,
}: RoutingPanelProps) {
  const [responders, setResponders] = useState<readonly AssignableResponder[]>([]);
  const [suggestions, setSuggestions] = useState<readonly RoutingSuggestionView[]>([]);
  const [responderId, setResponderId] = useState<string>('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Status transitions (including RESOLVED) are confirmation-gated (R18): the
  // POST only fires after the responder confirms; Cancel aborts with no request.
  const [statusConfirm, setStatusConfirm] = useState<IncidentStatus | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (!canAssign) {
      return;
    }

    let cancelled = false;
    loadAssignableResponders()
      .then((rows) => {
        if (!cancelled) {
          setResponders(rows);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResponders([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [canAssign]);

  // Fetch ranked nearest-unit suggestions for the selected incident. Resetting the
  // manual selection lets the top (nearest capable) suggestion drive the default.
  const incidentId = incident?.id ?? null;
  useEffect(() => {
    if (!canAssign || !incidentId) {
      setSuggestions([]);
      return;
    }

    let cancelled = false;
    setResponderId('');
    loadRoutingSuggestions(incidentId)
      .then((rows) => {
        if (!cancelled) {
          setSuggestions(rows);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSuggestions([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [canAssign, incidentId]);

  if (!incident) {
    return (
      <Panel title={t('responderRouting')} className={cn('min-h-0', className)}>
        <p className="p-3 text-xs text-muted">{t('noIncident')}</p>
      </Panel>
    );
  }

  const current = incident;

  const distanceKm = haversineKm(RESPONDER_ORIGIN, current);
  const payload = serializeSosPayload(buildSosPayload(current.category, current.lat, current.lon));

  // Default the assignee to the top suggestion (nearest capable unit) when the
  // dispatcher has not picked one; fall back to the first roster entry.
  const suggestedId = suggestions[0]?.id ?? '';
  const targetId = responderId || suggestedId || responders[0]?.id || '';
  const target = responders.find((row) => row.id === targetId) ?? null;
  const assigned = current.assignedToCallsign;

  const nextStatuses: readonly IncidentStatus[] = RESPONDER_UPDATABLE_STATUSES.filter((status) =>
    canTransition(current.status, status),
  );

  async function assign(): Promise<void> {
    if (!target) {
      return;
    }

    setConfirmOpen(false);
    setPending('assign');

    const result = await postJson(`/api/incidents/${current.id}/assign`, {
      responderId: target.id,
    });

    setPending(null);

    if (result.ok) {
      toast({
        tone: 'success',
        title: t('toastAssignedTitle'),
        description: t('toastAssignedBody', { unit: target.callsign, id: current.id }),
      });
      onChanged();
      return;
    }

    toast({
      tone: 'error',
      title: t('toastAssignErrorTitle'),
      description: t('toastAssignErrorBody', { unit: target.callsign }),
    });
  }

  async function confirmStatus(): Promise<void> {
    const status = statusConfirm;
    setStatusConfirm(null);
    if (status === null) {
      return;
    }
    await advance(status);
  }

  async function advance(status: IncidentStatus): Promise<void> {
    setPending(status);

    const result = await postJson(`/api/incidents/${current.id}/status`, { status });

    setPending(null);

    if (result.ok) {
      toast({
        tone: 'success',
        title: t('toastStatusTitle'),
        description: t('toastStatusBody', {
          id: current.id,
          status: statusLabel(status),
        }),
      });
      onChanged();
      return;
    }

    toast({
      tone: 'error',
      title: t('toastStatusErrorTitle'),
      description: t('toastStatusErrorBody', { id: current.id }),
    });
  }

  return (
    <Panel title={t('responderRouting')} className={cn('min-h-0', className)} bodyClassName="p-3">
      <div className="flex items-center justify-between gap-2">
        <CategoryBadge category={incident.category} />
        <span className="font-mono text-[11px] tabular-nums text-muted">{incident.id}</span>
      </div>

      <p className="mt-2 text-xs text-muted">
        {incident.source === 'mesh' ? t('sourceMesh') : t('sourceManual')} at{' '}
        <span className="font-mono tabular-nums">{incident.reportedAt.slice(11, 16)} UTC</span>
      </p>

      <div className="mt-3 border border-line bg-raised p-2">
        <p className="text-[10px] uppercase tracking-label text-muted">{t('meshPayload')}</p>
        <p className="mt-1 break-all font-mono text-xs text-fg">{payload}</p>
      </div>

      <div className="mt-3">
        <MetricRow label={t('distance')} value={formatDistance(distanceKm)} />
        <MetricRow label={t('eta')} value={`${estimateEtaMinutes(distanceKm)} min`} />
        <MetricRow label={t('coordinates')} value={`${incident.lat}, ${incident.lon}`} />
        <MetricRow label={t('status')} value={statusLabel(incident.status)} />
        <MetricRow label={t('assignedToLabel')} value={assigned ?? t('unassigned')} />
      </div>

      {canAssign && suggestions.length > 0 ? (
        <div className="mt-3 border-t border-line pt-3">
          <p className="text-[10px] font-bold uppercase tracking-label text-muted">
            {t('routingSuggestions')}
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {suggestions.map((suggestion, index) => (
              <li
                key={suggestion.id}
                className={cn(
                  'flex items-center justify-between gap-2 border border-line bg-raised px-2 py-1',
                  suggestion.id === targetId && 'border-status-dispatched',
                )}
                data-testid={`routing-suggestion-${suggestion.id}`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-mono text-xs text-fg">{suggestion.callsign}</span>
                  {index === 0 ? (
                    <span className="shrink-0 text-[9px] font-bold uppercase tracking-label text-status-dispatched">
                      {t('routingNearest')}
                    </span>
                  ) : null}
                  <span
                    className={cn(
                      'shrink-0 text-[9px] font-bold uppercase tracking-label',
                      suggestion.capable ? 'text-status-resolved' : 'text-muted',
                    )}
                  >
                    {suggestion.capable ? t('routingCapable') : t('routingNotCapable')}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">
                  {suggestion.distanceKm === null ? 'n/a' : formatDistance(suggestion.distanceKm)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {canAssign ? (
        <div className="mt-3 border-t border-line pt-3">
          <div className="flex items-end gap-2">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <label
                htmlFor="assign-unit"
                className="text-[10px] font-bold uppercase tracking-label text-muted"
              >
                {t('assignTo')}
              </label>
              <Select
                id="assign-unit"
                value={targetId}
                onChange={(event) => setResponderId(event.target.value)}
                disabled={
                  pending !== null || responders.length === 0 || incident.status === 'RESOLVED'
                }
              >
                {responders.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.callsign}
                    {row.agencyName ? ` - ${row.agencyName}` : ''}
                  </option>
                ))}
              </Select>
            </div>

            <Button
              onClick={() => setConfirmOpen(true)}
              disabled={pending !== null || target === null || incident.status === 'RESOLVED'}
            >
              {assigned ? t('reassignUnit') : t('assignUnit')}
            </Button>
          </div>

          {responders.length === 0 ? (
            <p className="mt-2 text-[11px] leading-relaxed text-muted">{t('noUnits')}</p>
          ) : null}
        </div>
      ) : null}

      {canUpdateStatus ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          {nextStatuses.map((status) => (
            <Button
              key={status}
              variant={status === 'RESOLVED' ? 'secondary' : 'default'}
              size="sm"
              onClick={() =>
                status === 'RESOLVED' ? setStatusConfirm(status) : void advance(status)
              }
              disabled={pending !== null}
            >
              {pending === status ? t('advancingStatus') : statusLabel(status)}
            </Button>
          ))}

          {/* Hand off to Google Maps with ONLY the destination coordinates (no PII,
              SECURITY.md §11). We do not build in-app navigation. */}
          {incident.status !== 'RESOLVED' ? (
            <a
              href={googleMapsDirectionsUrl(incident.lat, incident.lon)}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="navigate-link"
              title={t('navigateHint')}
              className="inline-flex items-center gap-1.5 border border-line bg-raised px-2.5 py-1 text-xs font-bold uppercase tracking-label text-fg transition-colors duration-fast hover:border-muted"
            >
              <Navigation aria-hidden="true" size={12} />
              {t('navigate')}
            </a>
          ) : null}
        </div>
      ) : null}

      <p className="mt-2 text-center text-[10px] leading-relaxed text-muted">{t('dispatchMock')}</p>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('confirmTitle')}
        description={t('confirmBody', {
          unit: target?.callsign ?? '',
          id: incident.id,
        })}
        confirmLabel={t('confirmAction')}
        cancelLabel={t('cancelAction')}
        onConfirm={() => void assign()}
      />

      <ConfirmDialog
        open={statusConfirm !== null}
        onOpenChange={(open) => {
          if (!open) {
            setStatusConfirm(null);
          }
        }}
        title={t('confirmStatusTitle')}
        description={t('confirmStatusBody', {
          id: incident.id,
          status: statusConfirm === null ? '' : statusLabel(statusConfirm),
        })}
        confirmLabel={t('confirmStatusAction')}
        cancelLabel={t('cancelAction')}
        tone={statusConfirm === 'RESOLVED' ? 'destructive' : 'default'}
        onConfirm={() => void confirmStatus()}
      />
    </Panel>
  );
}
