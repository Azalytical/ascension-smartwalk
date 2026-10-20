// The shared MapLibre map. Base styles fall back from vector (OpenFreeMap) to raster (CARTO, then OSM),
// and every overlay registered here is re-added after a style switch, so screens never lose their layers.
import { ASTANA } from '../core/geo.js';
import { h } from '../core/dom.js';

let maplibregl = null;
let map = null;
let resolveReady;
export const mapReady = new Promise((resolve) => { resolveReady = resolve; });
export const getMap = () => map;
export const lib = () => maplibregl;

const overlays = new Map();
const clickHandlers = new Map();
let styleIndex = 0;
let dark = false;
let watchdog = null;
let tileSeen = false;
let failed = false;

const OSM_ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
function styleFor(index) {
  if (index === 0) return dark ? 'https://tiles.openfreemap.org/styles/dark' : 'https://tiles.openfreemap.org/styles/positron';
  const carto = index === 1;
  const tiles = carto
    ? ['a', 'b', 'c', 'd'].map((s) => `https://${s}.basemaps.cartocdn.com/${dark ? 'dark_all' : 'rastertiles/voyager'}/{z}/{x}/{y}@2x.png`)
    : ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'];
  return {
    version: 8,
    sources: { base: { type: 'raster', tiles, tileSize: 256, maxzoom: 19, attribution: carto ? `${OSM_ATTRIBUTION} © <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>` : OSM_ATTRIBUTION } },
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': dark ? '#0B0B0D' : '#F1F0EB' } },
      { id: 'base', type: 'raster', source: 'base', paint: dark ? {} : { 'raster-saturation': -0.35, 'raster-contrast': -0.05 } }],
  };
}

function armWatchdog() {
  clearTimeout(watchdog);
  tileSeen = false;
  watchdog = setTimeout(() => { if (!tileSeen) nextStyle(); }, 9000);
}
function nextStyle() {
  if (styleIndex >= 2) { document.dispatchEvent(new CustomEvent('seruen:map-tiles-failed')); return; }
  styleIndex += 1;
  map.setStyle(styleFor(styleIndex), { diff: false });
  armWatchdog();
}

export async function initMap(container, options = {}) {
  dark = Boolean(options.dark);
  try {
    maplibregl = await import('/vendor/maplibre/maplibre-gl.mjs');
    map = new maplibregl.Map({
      container, style: styleFor(styleIndex), center: ASTANA.center, zoom: 12.4, minZoom: 9, maxZoom: 19,
      maxBounds: [[70.8, 50.8], [72.1, 51.5]], attributionControl: { compact: true }, fadeDuration: 120,
      dragRotate: true, touchPitch: true, locale: options.locale,
    });
  } catch (error) {
    failed = true;
    document.dispatchEvent(new CustomEvent('seruen:map-unavailable', { detail: String(error?.message || error) }));
    return null;
  }
  armWatchdog();
  map.on('data', (event) => { if (event.dataType === 'source' && event.tile) { tileSeen = true; clearTimeout(watchdog); } });
  map.on('error', (event) => {
    // A style that cannot be fetched fails before any tile: switch to the next base map straight away.
    if (!tileSeen && !event.tile && !event.sourceId && styleIndex < 2) { clearTimeout(watchdog); nextStyle(); }
  });
  map.on('style.load', () => { for (const id of overlays.keys()) apply(id); });
  for (const type of ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart']) map.on(type, (event) => { if (event.originalEvent) lastFit = null; });
  map.once('load', () => resolveReady(map));
  map.on('click', (event) => {
    const layers = [...clickHandlers.keys()].filter((id) => map.getLayer(id));
    if (!layers.length) return;
    const feature = map.queryRenderedFeatures(event.point, { layers })[0];
    if (feature) clickHandlers.get(feature.layer.id)(feature, event);
  });
  return map;
}

export const mapFailed = () => failed;
export const getMaplibre = () => maplibregl;

export function setDark(next) {
  if (!map || dark === next) { dark = next; return; }
  dark = next;
  map.setStyle(styleFor(styleIndex), { diff: false });
  armWatchdog();
}

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
export { cssVar };

/** Register a set of sources and layers under one id. Layer paint values may be functions, evaluated on (re)apply. */
export function setOverlay(id, spec) {
  overlays.set(id, spec);
  if (map?.isStyleLoaded()) apply(id);
  else map?.once('idle', () => apply(id));
}

function apply(id) {
  const spec = overlays.get(id);
  if (!spec || !map) return;
  try {
    for (const layer of spec.layers || []) if (map.getLayer(layer.id)) map.removeLayer(layer.id);
    for (const [sourceId, source] of Object.entries(spec.sources || {})) {
      if (map.getSource(sourceId)) map.removeSource(sourceId);
      map.addSource(sourceId, source);
    }
    for (const layer of spec.layers || []) {
      if (layer.requiresSource && !map.getSource(layer.requiresSource)) continue;
      const { requiresSource, paint, ...rest } = layer;
      const resolved = Object.fromEntries(Object.entries(paint || {}).map(([key, value]) => [key, typeof value === 'function' ? value() : value]));
      map.addLayer({ ...rest, paint: resolved }, layer.beforeId && map.getLayer(layer.beforeId) ? layer.beforeId : undefined);
    }
  } catch (error) { console.warn('overlay', id, error); }
}

export function refreshOverlays() { for (const id of overlays.keys()) apply(id); }

export function removeOverlay(id) {
  const spec = overlays.get(id);
  overlays.delete(id);
  if (!spec || !map) return;
  for (const layer of spec.layers || []) { if (map.getLayer(layer.id)) map.removeLayer(layer.id); clickHandlers.delete(layer.id); }
  for (const sourceId of Object.keys(spec.sources || {})) if (map.getSource(sourceId)) map.removeSource(sourceId);
}

export function setData(sourceId, data) {
  for (const spec of overlays.values()) if (spec.sources?.[sourceId]) spec.sources[sourceId] = { ...spec.sources[sourceId], data };
  map?.getSource(sourceId)?.setData(data);
}

export function onLayerClick(layerId, handler) { clickHandlers.set(layerId, handler); }

export function marker(element, lngLat, options = {}) {
  if (failed) return null;
  if (!map || !maplibregl) {
    // Asked before the map exists (first paint, deep links): place it once the map is ready.
    let removed = false;
    let real = null;
    mapReady.then(() => { if (!removed) real = marker(element, lngLat, options); });
    return { remove() { removed = true; real?.remove(); }, getElement: () => element };
  }
  return new maplibregl.Marker({ element, anchor: options.anchor || 'center', ...options }).setLngLat(lngLat).addTo(map);
}

let padding = { top: 0, bottom: 0, left: 0, right: 0 };
// The last framed set of points: when the sheet moves, the same points are framed again in the new free area,
// until the user moves the map themselves.
let lastFit = null;

export function setPadding(next, animate = true) {
  padding = { ...padding, ...next };
  if (!map) return;
  if (lastFit) { frame(lastFit, animate ? 320 : 0); return; }
  if (animate) map.easeTo({ padding, duration: 280 });
  else map.setPadding(padding);
}

export function fitPoints(points, options = {}) {
  if (!map || !points.length) return;
  lastFit = { points, margin: options.padding ?? 56, maxZoom: options.maxZoom ?? 15.5 };
  frame(lastFit, options.duration ?? 700);
}

// Frames the points inside the part of the map that the sheet and the top bar leave free.
function frame({ points, margin, maxZoom }, duration) {
  const mercator = points.map((point) => maplibregl.MercatorCoordinate.fromLngLat(point));
  const xs = mercator.map((m) => m.x), ys = mercator.map((m) => m.y);
  const center = new maplibregl.MercatorCoordinate((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2).toLngLat();
  const { clientWidth: width, clientHeight: height } = map.getContainer();
  const freeW = Math.max(40, width - padding.left - padding.right - margin * 2);
  const freeH = Math.max(40, height - padding.top - padding.bottom - margin * 2);
  // World size in pixels is 512 * 2^zoom; the span is a fraction of the world.
  const spanX = (Math.max(...xs) - Math.min(...xs)) * 512, spanY = (Math.max(...ys) - Math.min(...ys)) * 512;
  const fit = Math.min(spanX ? Math.log2(freeW / spanX) : Infinity, spanY ? Math.log2(freeH / spanY) : Infinity);
  const zoom = Math.max(map.getMinZoom(), Math.min(maxZoom, Number.isFinite(fit) ? fit : maxZoom));
  map.easeTo({ center, zoom, padding, duration, essential: false });
}

export function flyTo(lngLat, zoom = 15, duration = 700, { exact = false } = {}) {
  lastFit = null;
  map?.flyTo({ center: lngLat, zoom: exact ? zoom : Math.max(map.getZoom(), zoom), padding, duration, essential: false });
}

let tilted = false;
export function toggleTilt() {
  if (!map) return false;
  tilted = !tilted;
  if (tilted && map.getSource('openmaptiles') && !map.getLayer('seruen-3d')) {
    setOverlay('buildings-3d', { layers: [{ id: 'seruen-3d', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building', minzoom: 13, requiresSource: 'openmaptiles',
      paint: { 'fill-extrusion-color': () => (dark ? '#2A2A2F' : '#E4E2DB'), 'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-opacity': 0.85 } }] });
  }
  map.easeTo({ pitch: tilted ? 58 : 0, bearing: tilted ? -18 : 0, zoom: tilted ? Math.max(map.getZoom(), 15) : map.getZoom(), padding, duration: 900 });
  return tilted;
}

export function userDot() {
  return h('div', { class: 'user-dot', 'aria-hidden': 'true' }, h('span'));
}
