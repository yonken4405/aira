'use client';

import 'maplibre-gl/dist/maplibre-gl.css';

import { t } from '@aira/ui';
import { Field, Input, Select, cn } from '@aira/ui/web';
import { Building2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import Map, { Marker } from 'react-map-gl/maplibre';
import type { StyleSpecification } from 'maplibre-gl';

import { filterPins, loadOfficePins, regionsOf, type OfficePinView } from '../lib/platform-client';
import { LoadError, PlatformMapSkeleton } from './loading';

// Dev-only public OSM raster tiles (swap before production); centred on the Philippines.
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

/**
 * Nationwide partner-office map for platform operators. Plots one pin per office across
 * the Philippines; filterable by region and searchable by office/tenant name. Shows
 * ONLY office locations and tenant status - never citizen or incident data.
 */
export function PlatformMap() {
  const [pins, setPins] = useState<readonly OfficePinView[]>([]);
  const [region, setRegion] = useState<string>('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<OfficePinView | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ok' | 'failed'>('loading');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setPhase('loading');
    loadOfficePins()
      .then((rows) => {
        if (!cancelled) {
          setPins(rows);
          setPhase('ok');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPins([]);
          setPhase('failed');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const regions = useMemo(() => regionsOf(pins), [pins]);
  const visible = useMemo(
    () => filterPins(pins, { region: region === '' ? null : region, search }),
    [pins, region, search],
  );
  const plottable = visible.filter((pin) => pin.lat !== null && pin.lon !== null);

  if (phase === 'loading') {
    return <PlatformMapSkeleton />;
  }

  if (phase === 'failed') {
    return <LoadError onRetry={() => setReloadKey((key) => key + 1)} />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-48">
          <Field id="pin-region" label={t('pinFilterRegion')}>
            <Select id="pin-region" value={region} onChange={(e) => setRegion(e.target.value)}>
              <option value="">{t('pinFilterAll')}</option>
              {regions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="min-w-[220px] flex-1">
          <Field id="pin-search" label={t('pinSearch')}>
            <Input
              id="pin-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('pinSearch')}
            />
          </Field>
        </div>

        <span
          className="pb-2 text-[11px] uppercase tracking-label text-muted"
          data-testid="pin-count"
        >
          {t('mapOfficeCount', { count: visible.length })}
        </span>
      </div>

      <div className="border border-line" style={{ height: '70vh' }}>
        <Map
          initialViewState={{ longitude: 122.5, latitude: 12.8, zoom: 5 }}
          style={{ width: '100%', height: '100%' }}
          mapStyle={OSM_STYLE}
          reuseMaps
        >
          {plottable.map((pin) => (
            <Marker
              key={pin.id}
              longitude={pin.lon as number}
              latitude={pin.lat as number}
              anchor="center"
            >
              <button
                type="button"
                data-testid={`office-pin-${pin.id}`}
                title={`${pin.name} - ${pin.tenantName}`}
                onClick={() => setSelected(pin)}
                className={cn(
                  'flex h-6 w-6 items-center justify-center border-2 bg-ink',
                  pin.status === 'active' ? 'border-status-resolved' : 'border-status-error',
                )}
              >
                <Building2
                  aria-hidden="true"
                  size={13}
                  className={pin.status === 'active' ? 'text-status-resolved' : 'text-status-error'}
                />
              </button>
            </Marker>
          ))}
        </Map>
      </div>

      {selected ? (
        <div className="border border-line bg-surface p-3" data-testid="pin-detail">
          <p className="text-sm font-bold text-fg">{selected.name}</p>
          <p className="mt-1 text-xs text-muted">
            {selected.tenantName} · {selected.region ?? ''} {selected.province ?? ''}
          </p>
          <p className="mt-1 text-[10px] font-bold uppercase tracking-label text-muted">
            {selected.kind} ·{' '}
            <span
              className={
                selected.status === 'active' ? 'text-status-resolved' : 'text-status-error'
              }
            >
              {selected.status === 'active' ? t('tenantActive') : t('tenantSuspended')}
            </span>
          </p>
        </div>
      ) : null}
    </div>
  );
}
