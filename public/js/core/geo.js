// Same walking model as the server (src/retrieval.mjs): straight line × 1.35 at 4.2 km/h, 5-minute reserve.
export const DETOUR = 1.35;
export const METERS_PER_MINUTE = 4200 / 60;
export const RESERVE = 5;
export const VISIT = { park: 15, cafe: 20, museum: 35, playground: 20, attraction: 15, restaurant: 45, mall: 40, culture: 60 };
export const ASTANA = { center: [71.4304, 51.1283], bounds: [[71.25, 51.0], [71.65, 51.35]] };

export function inAstana(lat, lon) {
  return lat >= 51.0 && lat <= 51.35 && lon >= 71.25 && lon <= 71.65;
}

export function haversine(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export const walkMinutes = (meters) => Math.ceil(meters * DETOUR / METERS_PER_MINUTE);

/** Client-side estimate for a place picked on the map; recommendations come with the server's own numbers. */
export function estimate(start, place) {
  const distance = haversine(start.lat, start.lon, place.lat, place.lon);
  const walk = walkMinutes(distance);
  const visit = VISIT[place.category] ?? 20;
  return { distanceMeters: Math.ceil(distance), walkMinutes: walk, visitMinutes: visit, returnMinutes: walk, safetyReserveMinutes: RESERVE, totalMinutes: walk * 2 + visit + RESERVE };
}

/** How far one can go and still come back: the radius of the reach ring on the map. */
export function reachMeters(minutes, maxWalk) {
  const oneWay = Math.max(0, Math.min(maxWalk, Math.floor((minutes - RESERVE - 15) / 2)));
  return oneWay * METERS_PER_MINUTE / DETOUR;
}

export function circlePolygon(lon, lat, radiusMeters, steps = 72) {
  const coords = [];
  const dLat = radiusMeters / 111320;
  const dLon = radiusMeters / (111320 * Math.cos(lat * Math.PI / 180));
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    coords.push([lon + dLon * Math.cos(angle), lat + dLat * Math.sin(angle)]);
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: {} };
}

export const PRESETS = [
  { id: 'baiterek', name: { ru: 'Байтерек', kk: 'Бәйтерек', en: 'Baiterek' }, lat: 51.1283, lon: 71.4304 },
  { id: 'khan-shatyr', name: { ru: 'Хан Шатыр', kk: 'Хан Шатыр', en: 'Khan Shatyr' }, lat: 51.13251, lon: 71.40387 },
  { id: 'mega', name: { ru: 'Mega Silk Way', kk: 'Mega Silk Way', en: 'Mega Silk Way' }, lat: 51.0880152, lon: 71.4097489 },
  { id: 'expo', name: { ru: 'EXPO', kk: 'EXPO', en: 'EXPO' }, lat: 51.09279, lon: 71.42148 },
  { id: 'opera', name: { ru: 'Астана Опера', kk: 'Астана Опера', en: 'Astana Opera' }, lat: 51.13545, lon: 71.41075 },
  { id: 'embankment', name: { ru: 'Набережная Есиля', kk: 'Есіл жағалауы', en: 'Yesil embankment' }, lat: 51.161, lon: 71.423 },
];

export function formatDistance(meters, lang = 'ru') {
  const km = { ru: 'км', kk: 'км', en: 'km' }[lang] || 'км';
  const m = { ru: 'м', kk: 'м', en: 'm' }[lang] || 'м';
  return meters >= 1000 ? `${(meters / 1000).toLocaleString(lang === 'en' ? 'en' : 'ru-RU', { maximumFractionDigits: 1 })} ${km}` : `${Math.round(meters / 10) * 10} ${m}`;
}
