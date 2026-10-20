/**
 * Puts listing events on the map. A venue gets coordinates only from a place in our base: the same name, the same street
 * and house number, a named alias below, or another event at the same address. Events whose venue is not found stay off
 * the map. Used by scripts/build_events.mjs for the saved snapshot and by the Worker's daily collection (src/events-live.mjs).
 */
import { parseWhen } from './events.mjs';
import { haversineMeters } from './retrieval.mjs';

// Venues whose name in the listing differs from the name in our base: the same building, by name or by the listing's own note.
const ALIASES = [
  [/филармони/i, 'osm:node:4916363251', 'Е. Рахмадиев атындағы Мемлекеттік академиялық филармония'],
  [/дворец мира и согласия/i, 'osm:way:166197368', 'Бейбітшілік және келісім сарайы'],
  [/цкз|qazaqstan/i, 'overture:a4d7605b-b301-4a9c-baec-cc65c1b617ca', 'ЦКЗ Казахстан'],
  [/здание цирка/i, 'osm:node:5126825313', 'the listing says «здание Цирка»'],
  [/жастар/i, 'osm:way:1428964223', 'Жастар сарайы алаңы, the square of the Palace of Youth'],
  [/harat.s (grand alatau|irish pub желтоксан)/i, 'overture:27cbf60e-6385-4518-9dd8-dfbba8905ba4', "Harat's Irish Pub Grand Alatau, ул. Желтоксан, 2Т"],
];

const LATIN = { а: 'a', б: 'b', в: 'v', г: 'g', ғ: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i', к: 'k', қ: 'k', л: 'l', м: 'm', н: 'n',
  ң: 'n', о: 'o', ө: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ұ: 'u', ү: 'u', ф: 'f', х: 'kh', һ: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '',
  ы: 'y', і: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya' };
// A plain loop: the Worker runs this for every place name within its CPU budget.
function latin(value) {
  const text = String(value || '').toLowerCase();
  let out = '';
  for (const letter of text) out += LATIN[letter] ?? (letter === 'q' ? 'k' : letter === '’' || letter === '`' ? "'" : letter);
  return out;
}
const plain = value => latin(value).replace(/[^a-z0-9]+/g, ' ').trim();
const GENERIC = new Set(['ulitsa', 'prospekt', 'koshesi', 'avenue', 'street', 'shosse', 'astana', 'mesto', 'sbora', 'blok']);

function addressKey(address) {
  const value = latin(address).replace(/место сбора:|mesto sbora:/, '');
  const house = value.match(/(?:^|[\s,])(\d+)(?:\s*\/\s*(\d+))?(?:-?([a-z]{1,2}))?(?=$|[\s,.(])/);
  if (!house) return null;
  const words = value.slice(0, house.index).split(/[^a-z]+/).filter(word => word.length >= 5 && !GENERIC.has(word)).map(word => word.slice(0, 6));
  if (!words.length) return null;
  return { words, number: Number(house[1]), house: `${house[1]}${house[2] ? `/${house[2]}` : ''}${house[3] || ''}` };
}
const sameStreet = (a, b) => a.words.some(word => b.words.includes(word));

// Names and addresses of the base, worked out once per dataset. The Worker bundle carries them ready-made
// (venueIndexData at build time), because working them out from 2255 places takes longer than its CPU budget.
const indexes = new WeakMap();
const osmFirst = (a, b) => (a.place.source?.id === 'osm' ? 0 : 1) - (b.place.source?.id === 'osm' ? 0 : 1);
export function venueIndex(places, prebuilt = null) {
  let index = indexes.get(places);
  if (index) return index;
  const byId = new Map(places.map(place => [place.id, place]));
  if (prebuilt) {
    const named = prebuilt.named.map(([name, id]) => ({ place: byId.get(id), name })).filter(item => item.place);
    const keyed = prebuilt.keyed.map(([id, words, number, house, ok]) => ({ place: byId.get(id), key: { words, number, house }, plausible: Boolean(ok) }))
      .filter(item => item.place);
    index = { byId, named, keyed };
  } else {
    const named = places.map(place => ({ place, name: plain(place.name) })).filter(item => item.name.length >= 6).sort(osmFirst);
    const keyed = places.map(place => ({ place, key: place.address ? addressKey(place.address) : null })).filter(item => item.key);
    index = { byId, named, keyed };
  }
  indexes.set(places, index);
  return index;
}

/** The index as plain data for the Worker bundle: names and address keys with their place ids. */
export function venueIndexData(places) {
  const index = venueIndex(places);
  return { named: index.named.map(item => [item.name, item.place.id]),
    keyed: index.keyed.map(item => [item.place.id, item.key.words, item.key.number, item.key.house, plausible(index, item) ? 1 : 0]) };
}

// A house number whose neighbours on the same street are all far away is a data error, not a location.
function plausible(index, candidate) {
  if (candidate.plausible !== undefined) return candidate.plausible;
  const neighbours = index.keyed.filter(item => item.place !== candidate.place && sameStreet(item.key, candidate.key)
    && Math.abs(item.key.number - candidate.key.number) <= 4 && item.key.house !== candidate.key.house);
  candidate.plausible = !neighbours.length || neighbours.some(item => haversineMeters(item.place.lat, item.place.lon, candidate.place.lat, candidate.place.lon) < 900);
  return candidate.plausible;
}

function locate(index, venue, address) {
  const both = `${venue} ${address}`;
  for (const [pattern, id, why] of ALIASES) {
    if (!pattern.test(both)) continue;
    const place = index.byId.get(id);
    if (place) return { place, located: 'alias', why };
  }
  const name = plain(venue);
  if (name.length >= 6) {
    const named = index.named.find(item => item.name === name || (item.name.length >= 8 && name.includes(item.name)));
    if (named) return { place: named.place, located: 'name' };
  }
  const key = addressKey(address);
  if (key) {
    const match = index.keyed.find(item => item.key.house === key.house && sameStreet(item.key, key) && plausible(index, item));
    if (match) return { place: match.place, located: 'address' };
  }
  return null;
}

const DAY = 86400000;
/**
 * When an event runs. The listing gives no year: dates are taken in the collection year, and a date more than two
 * months before the collection day belongs to the next year (a January event listed in December).
 */
function whenFor(dateText, collectedAt) {
  const year = Number(collectedAt.slice(0, 4));
  const when = parseWhen(dateText, year);
  const last = when && (when.to || when.dates.at(-1));
  if (last && Date.parse(`${last}T00:00:00Z`) < Date.parse(`${collectedAt}T00:00:00Z`) - 60 * DAY) return parseWhen(dateText, year + 1);
  return when;
}

/**
 * One event from a listing row { title, category, dateText, venue, address, price, url }, collected on `collectedAt`
 * (YYYY-MM-DD). It has `when` (null without a date) and, when its venue is found, lat, lon and placeId.
 */
export function placeEvent(row, places, { collectedAt, venues = null }) {
  const found = locate(venueIndex(places, venues), row.venue || '', row.address || '');
  return { id: `sxodim:${row.url.split('/').pop()}`, title: row.title, category: row.category ?? null, dateText: row.dateText ?? null,
    when: whenFor(row.dateText || '', collectedAt), venue: row.venue ?? null, address: row.address ?? null, price: row.price ?? null, url: row.url,
    ...(found ? { lat: found.place.lat, lon: found.place.lon, placeId: found.place.id, placeName: found.place.name, located: found.located } : {}) };
}

/** Another event at the same address shares a found location. Changes the events in place. */
export function shareAddresses(events) {
  const keys = new Map(events.filter(event => event.address).map(event => [event, addressKey(event.address)]));
  for (const event of events.filter(item => !Number.isFinite(item.lat) && keys.get(item))) {
    const key = keys.get(event);
    const twin = events.find(other => { const known = Number.isFinite(other.lat) && keys.get(other);
      return known && known.house === key.house && sameStreet(known, key); });
    if (twin) Object.assign(event, { lat: twin.lat, lon: twin.lon, placeId: twin.placeId, placeName: twin.placeName, located: 'same_address' });
  }
  return events;
}

/** Events from listing rows, placed on the map where the venue is found. */
export const placeEvents = (rows, places, options) => shareAddresses(rows.map(row => placeEvent(row, places, options)));
