import { haversineMeters, preparedPlaces } from '../retrieval.mjs';
import { checkVisit } from '../hours.mjs';

// Same walking model as walk recommendations: straight line × detour factor at 4.2 km/h.
const DETOUR = 1.35;
const METERS_PER_MINUTE = 4200 / 60;
const STAY_MINUTES = 60;
const MAX_WALK = 45;
const CULTURE = ['museum', 'gallery', 'theatre', 'cinema', 'arts_centre', 'library', 'concert_hall', 'exhibition_centre'];
export const MEETING_KINDS = {
  any: ['cafe', 'bakery', 'dessert', 'restaurant', 'fast_food', 'park', 'garden', 'plaza', 'fountain', 'mall', 'attraction', 'culture', ...CULTURE],
  coffee: ['cafe', 'bakery', 'dessert'],
  food: ['cafe', 'restaurant', 'fast_food', 'bakery'],
  park: ['park', 'garden', 'plaza', 'beach'],
  indoor: ['mall', 'culture', ...CULTURE, 'cafe', 'bakery', 'dessert', 'restaurant']
};

const minutesFor = meters => Math.max(1, Math.round(meters * DETOUR / METERS_PER_MINUTE));

/**
 * Places that are fair for everyone: the longest walk is as short as possible, then the walks are as even as possible.
 * participants: [{ id, lat, lon }], one or more people (for one, the nearest places). Returns up to three options backed by POI records.
 */
export function fairMeetingPoints(dataset, participants, { kind = 'any', at = new Date(), stayMinutes = STAY_MINUTES } = {}) {
  const categories = new Set(MEETING_KINDS[kind] ?? MEETING_KINDS.any);
  const lat0 = participants.reduce((sum, p) => sum + p.lat, 0) / participants.length;
  const lon0 = participants.reduce((sum, p) => sum + p.lon, 0) / participants.length;
  // Equirectangular distances are accurate to well under 1% across a city and cost a few multiplications.
  const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
  const scored = [];
  for (const poi of preparedPlaces(dataset)) {
    if (!categories.has(poi.category)) continue;
    let max = 0, min = Infinity, sum = 0;
    for (const p of participants) {
      const meters = Math.hypot((poi.lon - p.lon) * kx, (poi.lat - p.lat) * ky);
      if (meters > max) max = meters;
      if (meters < min) min = meters;
      sum += meters;
    }
    if (minutesFor(max) > MAX_WALK) continue;
    scored.push({ poi, max, spread: max - min, sum });
  }
  // Round to whole minutes first so that a 20 m difference does not beat a much more even split.
  scored.sort((a, b) => minutesFor(a.max) - minutesFor(b.max) || a.spread - b.spread || a.sum - b.sum);
  const options = [];
  const arrival = new Date(at.getTime());
  for (const candidate of scored.slice(0, 60)) {
    if (options.length === 3) break;
    // Three cafés in one mall are one option, not three.
    if (options.some(option => haversineMeters(option.place.lat, option.place.lon, candidate.poi.lat, candidate.poi.lon) < 120)) continue;
    const walks = participants.map(p => ({ userId: p.id, minutes: minutesFor(haversineMeters(p.lat, p.lon, candidate.poi.lat, candidate.poi.lon)) }));
    const longest = Math.max(...walks.map(walk => walk.minutes));
    const shortest = Math.min(...walks.map(walk => walk.minutes));
    const hours = checkVisit(candidate.poi.openingHours ?? null, new Date(arrival.getTime() + longest * 60000), stayMinutes);
    if (hours.status === 'closed' || hours.status === 'closes_early') continue;
    options.push({
      place: { id: String(candidate.poi.id), name: candidate.poi.name, category: candidate.poi.category, lat: candidate.poi.lat, lon: candidate.poi.lon,
        sourceUrl: candidate.poi.sourceUrl, source: { label: candidate.poi.source?.label || 'OpenStreetMap' }, openingHours: candidate.poi.openingHours ?? null },
      walks, maxMinutes: longest, spreadMinutes: longest - shortest,
      hours: hours.status === 'open' ? { status: 'open', closesAt: hours.closesAt ?? null } : { status: 'unknown' },
      why: participants.length === 1 ? `Идти примерно ${longest} мин` : shortest === longest ? `Всем идти примерно ${longest} мин` : `Всем идти от ${shortest} до ${longest} мин`
    });
  }
  return {
    midpoint: { lat: lat0, lon: lon0 },
    options,
    method: { detourFactor: DETOUR, walkingSpeedKmh: 4.2, maxWalkMinutes: MAX_WALK, stayMinutes, estimate: true,
      note: 'Время в пути — оценка по прямой с коэффициентом обхода, без пешеходного маршрута.' }
  };
}

export { minutesFor as walkMinutes };
