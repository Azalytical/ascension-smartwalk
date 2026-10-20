// Builds data/events.json from the sxodim.com rows in data/events-sxodim.txt.
// A venue gets coordinates only from a place in data/places.json: the same name, the same street and house number,
// a named alias below, or another event at the same address. Events whose venue is not found stay off the map.
// Usage: node scripts/build_events.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { parseWhen, EVENT_SOURCE } from '../src/events.mjs';
import { haversineMeters } from '../src/retrieval.mjs';

const root = new URL('..', import.meta.url);
const places = JSON.parse(readFileSync(new URL('data/places.json', root), 'utf8'));
const text = readFileSync(new URL('data/events-sxodim.txt', root), 'utf8');
const collectedAt = text.match(/^# collected: (\d{4}-\d{2}-\d{2})/m)?.[1];
if (!collectedAt) throw new Error('data/events-sxodim.txt needs a "# collected: YYYY-MM-DD" line');
const year = Number(collectedAt.slice(0, 4));

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
const latin = value => String(value || '').toLowerCase().replace(/[а-яёғқңөұүһі]/g, letter => LATIN[letter] ?? letter).replace(/q/g, 'k').replace(/[’`]/g, "'");
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

const keyed = places.map(place => ({ place, key: place.address ? addressKey(place.address) : null })).filter(item => item.key);
const sameStreet = (a, b) => a.words.some(word => b.words.includes(word));

// A house number whose neighbours on the same street are all far away is a data error, not a location.
function plausible(candidate) {
  const neighbours = keyed.filter(item => item.place !== candidate.place && sameStreet(item.key, candidate.key)
    && Math.abs(item.key.number - candidate.key.number) <= 4 && item.key.house !== candidate.key.house);
  return !neighbours.length || neighbours.some(item => haversineMeters(item.place.lat, item.place.lon, candidate.place.lat, candidate.place.lon) < 900);
}

function locate(venue, address) {
  const both = `${venue} ${address}`;
  for (const [pattern, id, why] of ALIASES) {
    if (!pattern.test(both)) continue;
    const place = places.find(item => item.id === id);
    if (place) return { place, located: 'alias', why };
  }
  const name = plain(venue);
  if (name.length >= 6) {
    const named = places.filter(place => { const other = plain(place.name); return other.length >= 6 && (other === name || (other.length >= 8 && name.includes(other))); })
      .sort((a, b) => (a.source?.id === 'osm' ? 0 : 1) - (b.source?.id === 'osm' ? 0 : 1));
    if (named.length) return { place: named[0], located: 'name' };
  }
  const key = addressKey(address);
  if (key) {
    const match = keyed.find(item => item.key.house === key.house && sameStreet(item.key, key) && plausible(item));
    if (match) return { place: match.place, located: 'address' };
  }
  return null;
}

const rows = text.split('\n').filter(line => line.trim() && !line.startsWith('#'));
const events = rows.map(line => {
  const [title, category, dateText, venue, address, price, url] = line.split(' | ').map(value => value.trim()).map(value => (value === '-' ? null : value));
  if (!title || !url?.startsWith('https://sxodim.com/')) throw new Error(`bad row: ${line}`);
  const found = locate(venue || '', address || '');
  return { id: `sxodim:${url.split('/').pop()}`, title, category, dateText, when: parseWhen(dateText, year), venue, address, price, url,
    ...(found ? { lat: found.place.lat, lon: found.place.lon, placeId: found.place.id, placeName: found.place.name, located: found.located } : {}) };
});
// Another event at the same address shares a found location.
for (const event of events.filter(item => !Number.isFinite(item.lat) && item.address)) {
  const key = addressKey(event.address);
  const twin = key && events.find(other => { const known = Number.isFinite(other.lat) && other.address && addressKey(other.address);
    return known && known.house === key.house && sameStreet(known, key); });
  if (twin) Object.assign(event, { lat: twin.lat, lon: twin.lon, placeId: twin.placeId, placeName: twin.placeName, located: 'same_address' });
}

const located = events.filter(event => Number.isFinite(event.lat));
writeFileSync(new URL('data/events.json', root), `${JSON.stringify({ source: { ...EVENT_SOURCE, collectedAt,
  note: 'Название, дата, площадка, адрес и цена как в афише sxodim.com; координаты только у площадок, найденных в базе мест.' },
  events: located, unlocated: events.filter(event => !Number.isFinite(event.lat)).map(event => ({ title: event.title, venue: event.venue, address: event.address })) }, null, 1)}\n`);
console.log(JSON.stringify({ rows: events.length, located: located.length, by: located.reduce((all, event) => ({ ...all, [event.located]: (all[event.located] || 0) + 1 }), {}),
  undated: events.filter(event => !event.when).length }));
