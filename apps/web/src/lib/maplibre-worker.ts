/**
 * MapLibre GL v6 worker wiring (dev + prod).
 *
 * MapLibre v6 no longer auto-resolves its Web Worker under Next.js (Turbopack and
 * webpack): the map throws "Worker failed to load. Check that the worker URL is
 * correct" unless the host points it at the bundled worker before the first map
 * mounts. We do that once here, at module load, and both map components import this
 * module for its side effect.
 *
 * `new URL('...', import.meta.url)` makes the bundler emit the worker as a hashed,
 * same-origin asset and hand us its real URL — so the worker stays self-hosted (no CDN,
 * no token), matching AIRA's no-third-party posture (SECURITY.md §6.5). This is NOT an
 * API-key issue; MapLibre + the OSM raster style need no key.
 */

import { setWorkerUrl } from 'maplibre-gl';

// v6 ships the worker as an ESM module (`maplibre-gl-worker.mjs`). `new URL(..., import.meta.url)`
// lets the bundler emit it as a hashed same-origin asset and resolve its URL. Idempotent.
setWorkerUrl(new URL('maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url).toString());
