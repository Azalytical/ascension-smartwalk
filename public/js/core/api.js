// Network calls. The app's own API is same-origin; routing and weather are optional public services.
import { outbound, personal } from './privacy.js';
let statusPromise = null;
let placesPromise = null;

async function withTimeout(url, options = {}, ms = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  options.signal?.addEventListener('abort', () => controller.abort());
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

export function status() {
  statusPromise ||= withTimeout('/api/status', {}, 8000).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return statusPromise;
}

/** Compact list of every place on the map: rows of [id, name, category, lat, lon, hours, phone, website, wheelchair]. */
export function places() {
  placesPromise ||= withTimeout('/data/places.json', {}, 15000).then((r) => {
    if (!r.ok) throw new Error('places');
    return r.json();
  }).then((data) => ({ ...data, items: data.rows.map(([id, name, category, lat, lon, openingHours, phone, website, wheelchair, source, address]) => ({ id, name, category, lat, lon, openingHours, phone, website, wheelchair, address,
    source: source ? { label: source } : null, sourceUrl: id.startsWith('overture:') ? `https://explore.overturemaps.org/#18/${lat}/${lon}` : osmUrl(id) })) }))
    .catch((error) => { placesPromise = null; throw error; });
  return placesPromise;
}

function osmUrl(id) {
  const match = /^osm:(node|way|relation):(\d+)$/.exec(id);
  return match ? `https://www.openstreetmap.org/${match[1]}/${match[2]}` : null;
}

export class ApiError extends Error {
  constructor(kind, message) { super(message || kind); this.kind = kind; }
}

export async function recommend(body, signal) {
  let response;
  try {
    response = await withTimeout('/api/recommend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal }, 60000);
  } catch (error) {
    if (signal?.aborted) throw new ApiError('aborted');
    throw new ApiError(navigator.onLine === false ? 'offline' : error.name === 'AbortError' ? 'timeout' : 'offline');
  }
  let data = null;
  try { data = await response.json(); } catch { /* handled below */ }
  if (!response.ok || !data || !Array.isArray(data.recommendations)) {
    throw new ApiError(response.status === 429 ? 'limit' : 'server', typeof data?.error === 'string' ? data.error : null);
  }
  return data;
}

let demoPromise = null;
/**
 * A saved answer for one of the key scenarios, for when there is no internet. The service worker keeps
 * /data/demo-answers.json (written by scripts/demo-answers.mjs); the screen labels it «Демо-ответ, сохранён …».
 * Picks the scenario by `id`, else the first whose words match the request, else the first one.
 */
export async function demoAnswer({ query = '', id = null } = {}) {
  demoPromise ||= fetch('/data/demo-answers.json').then((r) => { if (!r.ok) throw new Error('demo'); return r.json(); })
    .catch((error) => { demoPromise = null; throw error; });
  const data = await demoPromise;
  const text = String(query || '').toLowerCase();
  const scenario = data.scenarios.find((item) => item.id === id)
    || data.scenarios.find((item) => item.match && new RegExp(item.match, 'i').test(text)) || data.scenarios[0];
  return { ...scenario.result, demo: { id: scenario.id, title: scenario.title, savedAt: data.savedAt, minutes: scenario.minutes, time: scenario.time,
    start: { kind: 'preset', ...scenario.start }, scenarios: data.scenarios.map((item) => ({ id: item.id, title: item.title })) } };
}

const routeCache = new Map();
/**
 * Real walking route from the FOSSGIS OSRM foot server; null when it is unreachable (the app then draws a straight line).
 * The server is a third party, so the person's own point goes rounded, and the drawn line is joined to the exact point here.
 */
export async function walkingRoute(from, to) {
  const a = outbound(from), b = outbound(to);
  const key = [a.lon, a.lat, b.lon, b.lat].map((n) => n.toFixed(5)).join(',');
  if (!routeCache.has(key)) {
    const url = `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${a.lon},${a.lat};${b.lon},${b.lat}?overview=full&geometries=geojson`;
    routeCache.set(key, await withTimeout(url, {}, 6000).then((r) => (r.ok ? r.json() : null)).then((data) => {
      const route = data?.routes?.[0];
      return route?.geometry?.coordinates?.length ? { coordinates: route.geometry.coordinates, meters: route.distance, seconds: route.duration } : null;
    }).catch(() => null));
  }
  const result = routeCache.get(key);
  if (!result) return null;
  const join = (point) => (personal(point) ? [[point.lon, point.lat]] : []);
  return { ...result, coordinates: [...join(from), ...result.coordinates, ...join(to)] };
}

let weatherPromise = null;
export function weather() {
  weatherPromise ||= withTimeout('https://api.open-meteo.com/v1/forecast?latitude=51.13&longitude=71.43&current=temperature_2m,precipitation,weather_code,wind_speed_10m&wind_speed_unit=ms&timezone=auto', {}, 5000)
    .then((r) => (r.ok ? r.json() : null)).then((data) => data?.current ?? null).catch(() => null);
  return weatherPromise;
}
