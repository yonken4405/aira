'use client';

import 'maplibre-gl/dist/maplibre-gl.css';

import { getCategory, t } from '@aira/ui';
import { EmergencyIcon, cn } from '@aira/ui/web';
import { Navigation, RadioTower } from 'lucide-react';
import Map, { Layer, Marker, Source } from 'react-map-gl/maplibre';
import type { StyleSpecification } from 'maplibre-gl';

import type { GeoPoint } from '../lib/geo';
import type { Incident } from '../lib/incidents';

/** Assigned-unit live position for the selected incident (SECURITY.md §9). */
export interface ResponderMarker {
  readonly lat: number;
  readonly lon: number;
  /** Within the TTL: a live fix. Stale fixes render muted with a "last seen" hint. */
  readonly fresh: boolean;
  readonly callsign: string | null;
  /** Local HH:MM of the last fix, for the stale "last seen" label. */
  readonly lastSeen: string;
}

export interface LiveMapProps {
  readonly incidents: readonly Incident[];
  readonly selected: Incident | null;
  readonly origin: GeoPoint;
  /** The assigned responder's live position for the selected incident, if any. */
  readonly responder?: ResponderMarker | null;
}

/**
 * MapLibre base map with Lucide category markers and a dashed straight-line route.
 * NOTE (dev): uses public OSM raster tiles with attribution - swap for a self-hosted or
 * contracted tile provider before production (PRODUCT.md §5).
 */
const OSM_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

export function LiveMap({ incidents, selected, origin, responder }: LiveMapProps) {
  const selectedMeta = selected ? getCategory(selected.category) : null;

  const routeData =
    selected && selectedMeta
      ? {
          type: 'Feature' as const,
          geometry: {
            type: 'LineString' as const,
            coordinates: [
              [origin.lon, origin.lat],
              [selected.lon, selected.lat],
            ],
          },
          properties: {},
        }
      : null;

  return (
    <Map
      initialViewState={{ longitude: 123.8854, latitude: 10.3157, zoom: 12 }}
      style={{ width: '100%', height: '100%' }}
      mapStyle={OSM_STYLE}
      reuseMaps
    >
      <Marker longitude={origin.lon} latitude={origin.lat} anchor="center">
        <div
          title={t('responderStation')}
          className="flex h-6 w-6 items-center justify-center border-2 border-fg bg-ink"
        >
          <RadioTower aria-hidden="true" size={13} className="text-fg" />
        </div>
      </Marker>

      {incidents.map((incident) => {
        const meta = getCategory(incident.category);
        const isSelected = incident.id === selected?.id;

        return (
          <Marker
            key={incident.id}
            longitude={incident.lon}
            latitude={incident.lat}
            anchor="center"
          >
            <div
              title={`${meta.label} (${meta.localizedLabel}), ${incident.id}`}
              aria-label={t('incidentMarker', { category: meta.label, id: incident.id })}
              data-testid={`map-marker-${incident.id}`}
              className={cn(
                'flex items-center justify-center border-2 bg-ink transition-colors duration-fast',
                isSelected ? 'h-7 w-7 outline outline-2 outline-offset-1 outline-fg' : 'h-6 w-6',
              )}
              style={{ borderColor: meta.color }}
            >
              <EmergencyIcon category={incident.category} size={isSelected ? 15 : 13} />
            </div>
          </Marker>
        );
      })}

      {responder ? (
        <Marker longitude={responder.lon} latitude={responder.lat} anchor="center">
          <div
            data-testid="responder-marker"
            className="flex flex-col items-center"
            title={
              responder.fresh
                ? (responder.callsign ?? t('responderUnit'))
                : `${responder.callsign ?? t('responderUnit')} - ${t('lastSeen')} ${responder.lastSeen}`
            }
          >
            <div
              className={cn(
                'flex h-6 w-6 items-center justify-center border-2 bg-ink transition-transform duration-fast motion-reduce:transition-none',
                responder.fresh ? 'border-status-dispatched' : 'border-muted opacity-60',
              )}
            >
              <Navigation
                aria-hidden="true"
                size={13}
                className={responder.fresh ? 'text-status-dispatched' : 'text-muted'}
              />
            </div>
            <span className="mt-0.5 whitespace-nowrap bg-ink/80 px-1 font-mono text-[9px] tabular-nums text-fg">
              {responder.callsign ?? t('responderUnit')}
              {responder.fresh ? '' : ` · ${t('lastSeen')} ${responder.lastSeen}`}
            </span>
          </div>
        </Marker>
      ) : null}

      {routeData && selectedMeta ? (
        <Source id="route" type="geojson" data={routeData}>
          <Layer
            id="route-line"
            type="line"
            paint={{
              'line-color': selectedMeta.color,
              'line-width': 3,
              'line-dasharray': [1, 1.5],
            }}
          />
        </Source>
      ) : null}
    </Map>
  );
}
