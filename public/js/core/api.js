// Network calls. The app's own API is same-origin; routing and weather are optional public services.
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
  }).then((data) => ({ ...data, items: data.rows.map(([id, name, category, lat, lon, openingHours, phone, website, wheelchair]) => ({ id, name, category, lat, lon, openingHours, phone, website, wheelchair, sourceUrl: osmUrl(id) })) }))
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

const routeCache = new Map();
/** Real walking route from the FOSSGIS OSRM foot server; null when it is unreachable (the app then draws a straight line). */
export async function walkingRoute(from, to) {
  const key = [from.lon, from.lat, to.lon, to.lat].map((n) => n.toFixed(5)).join(',');
  if (routeCache.has(key)) return routeCache.get(key);
  const url = `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson`;
  const result = await withTimeout(url, {}, 6000).then((r) => (r.ok ? r.json() : null)).then((data) => {
    const route = data?.routes?.[0];
    return route?.geometry?.coordinates?.length ? { coordinates: route.geometry.coordinates, meters: route.distance, seconds: route.duration } : null;
  }).catch(() => null);
  routeCache.set(key, result);
  return result;
}

let weatherPromise = null;
export function weather() {
  weatherPromise ||= withTimeout('https://api.open-meteo.com/v1/forecast?latitude=51.13&longitude=71.43&current=temperature_2m,precipitation,weather_code,wind_speed_10m&wind_speed_unit=ms&timezone=auto', {}, 5000)
    .then((r) => (r.ok ? r.json() : null)).then((data) => data?.current ?? null).catch(() => null);
  return weatherPromise;
}
