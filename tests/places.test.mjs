import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recommend, prepareDataset, placeCategory, preparedPlaces } from '../src/retrieval.mjs';
import { handleApi } from '../src/api.mjs';

const places = JSON.parse(readFileSync(new URL('../data/places.json', import.meta.url), 'utf8'));
const start = { lat: 51.1283, lon: 71.4304, minutes: 60, maxWalkMinutes: 20 };
const record = (overrides = {}) => ({ id: 'osm:node:1', name: 'Тестовое место', lat: 51.12, lon: 71.42, category: 'monument',
  sourceUrl: 'https://www.openstreetmap.org/node/1', retrievedAt: '2026-10-19T12:00:00Z',
  source: { id: 'osm', label: 'OpenStreetMap', license: 'ODbL-1.0' }, ...overrides });

test('merged dataset: unique ids, every record valid, sourced and licensed', () => {
  assert.ok(places.length >= 2000, `expected at least 2000 places, got ${places.length}`);
  assert.equal(new Set(places.map(place => place.id)).size, places.length);
  const result = recommend(places, start);
  assert.equal(result.retrieval.rejected.invalidRecords, 0);
  for (const place of places) {
    assert.ok(place.source?.label && place.source?.license, place.id);
    assert.ok(/^https:\/\//.test(place.sourceUrl), place.id);
    if (place.source.id === 'overture') {
      assert.ok(place.source.confidence >= 0.5 && place.source.gersId, place.id);
      assert.ok(!place.openingHours, 'Overture has no opening hours: ' + place.id);
    }
  }
  const sources = new Set(places.map(place => place.source.id));
  assert.deepEqual([...sources].sort(), ['osm', 'overture']);
});

test('merged dataset holds no betting shops or pet shops posing as bars and zoos', () => {
  const junk = places.filter(place => /fair\s*play|букмекер|(^|[\s,])бк\s|казино|casino|зоомагазин|zoo\.kz/i.test(place.name));
  assert.deepEqual(junk.map(place => place.name), []);
});

test('every place has a short Russian description built from its tags', () => {
  const bad = places.filter(place => !/^[А-ЯЁ][а-яё ,-]*[а-яё]$/u.test(place.description.replace('Wi‑Fi', 'вайфай'))
    || place.description.length > 120);
  assert.deepEqual(bad.slice(0, 5).map(place => place.description), []);
  const byId = id => places.find(place => place.id === id).description;
  assert.equal(byId('osm:node:4931059138'), 'Фастфуд с бургерами, есть Wi‑Fi, можно взять с собой');
  assert.equal(byId('osm:node:4874140222'), 'Ресторан грузинской кухни');
});

test('recommendations over the full dataset stay far below the Workers CPU limit', () => {
  prepareDataset(places);
  const queries = ['', 'кофе', 'погулять', 'с ребёнком', 'дождь', 'поесть', 'мечеть', 'фонтан', 'кино'];
  // A Worker isolate serves many requests, so measure warm code. Wall-clock per call also counted time the test
  // machine spent on other processes (median 5–8 ms under load, ~1 ms idle); process CPU time over a batch does not.
  // Windows accounts CPU in ~15 ms ticks, so the batch is large and the assertion is on its mean.
  for (let round = 0; round < 20; round++) for (const query of queries) recommend(places, { ...start, query });
  const starts = [[51.1283, 71.4304], [51.1605, 71.4704], [51.0906, 71.418], [51.1694, 71.4491]];
  const rounds = 10;
  const before = process.cpuUsage();
  for (let round = 0; round < rounds; round++) {
    for (const [lat, lon] of starts) {
      for (const query of queries) recommend(places, { lat, lon, minutes: 180, maxWalkMinutes: 60, query, withChild: query === 'с ребёнком' });
    }
  }
  const used = process.cpuUsage(before);
  const meanMs = (used.user + used.system) / 1000 / (rounds * starts.length * queries.length);
  // ~1.5 ms alone; up to ~5 ms while the other test files run in parallel. The guard is the 10 ms Workers limit.
  assert.ok(meanMs < 8, `mean CPU ${meanMs.toFixed(2)} ms per request`);
});

test('a specific kind in the query wins over a nearer place of the same category', () => {
  const near = record({ id: 'osm:node:2', name: 'Монумент', sourceUrl: 'https://www.openstreetmap.org/node/2' });
  const mosque = record({ id: 'osm:way:3', name: 'Мешіт', category: 'place_of_worship', lat: 51.126,
    sourceUrl: 'https://www.openstreetmap.org/way/3' });
  const result = recommend([near, mosque], { lat: 51.12, lon: 71.42, minutes: 90, maxWalkMinutes: 20, query: 'хочу посмотреть мечеть' });
  assert.deepEqual(result.recommendations.map(place => place.id), ['osm:way:3']);
  assert.deepEqual(result.retrieval.requestedKinds, ['place_of_worship']);
  const none = recommend([near], { lat: 51.12, lon: 71.42, minutes: 90, maxWalkMinutes: 20, query: 'мечеть' });
  assert.equal(none.recommendations[0].id, 'osm:node:2');
  assert.ok(none.warnings.some(warning => warning.includes('именно этого вида')));
});

test('new kinds map to app categories; family places count as child-friendly', () => {
  assert.equal(placeCategory(record({ category: 'fountain' })), 'attraction');
  assert.equal(placeCategory(record({ category: 'bakery' })), 'cafe');
  assert.equal(placeCategory(record({ category: 'amusement_park' })), 'family');
  assert.equal(placeCategory(record({ category: 'toilets' })), 'service');
  assert.equal(placeCategory(record({ category: 'bar' })), 'nightlife');
  assert.equal(placeCategory(record({ category: 'bench' })), 'other');
  const zoo = record({ category: 'zoo', name: 'Зоопарк' });
  const child = recommend([zoo], { lat: 51.12, lon: 71.42, minutes: 120, maxWalkMinutes: 20, withChild: true });
  assert.equal(child.recommendations[0].category, 'family');
  assert.ok(child.recommendations[0].activities[0].includes('возрастные ограничения'));
});

test('other-language names and kind keywords are searchable', () => {
  const cafe = record({ id: 'overture:abc', category: 'cafe', name: 'Кофейня', nameEn: 'Sunrise Coffee', keywords: 'wifi вайфай интернет',
    sourceUrl: 'https://explore.overturemaps.org/#18/51.12/71.42',
    source: { id: 'overture', label: 'Overture Maps · Meta', dataset: 'Meta', license: 'CDLA-Permissive-2.0', confidence: 0.8 } });
  const result = recommend([cafe], { lat: 51.12, lon: 71.42, minutes: 60, maxWalkMinutes: 20, query: 'sunrise с wifi' });
  assert.deepEqual(result.recommendations[0].matchedTerms, ['sunrise', 'wifi']);
  assert.ok(result.recommendations[0].warnings.some(warning => warning.includes('Overture Maps · Meta') && warning.includes('режим работы неизвестен')));
});

test('a generated name is disclosed, and a filled address cites the source it came from', () => {
  const playground = record({ category: 'playground', name: 'Детская площадка', nameIsGenerated: true, address: 'Кенесары, 1',
    fieldSources: { address: 'overture:x' }, alsoIn: [{ id: 'overture:x', sourceUrl: 'https://explore.overturemaps.org/#18/51.12/71.42' }] });
  const place = recommend([playground], { lat: 51.12, lon: 71.42, minutes: 60, maxWalkMinutes: 20 }).recommendations[0];
  assert.ok(place.warnings.some(warning => warning.includes('Название в источнике не указано')));
  const address = place.evidence.find(item => item.field === 'address');
  assert.equal(address.sourceUrl, 'https://explore.overturemaps.org/#18/51.12/71.42');
});

test('/api/places serves the map layer, filters, and details', async () => {
  const get = path => handleApi(new Request(`https://smartwalk.test${path}`), {}, places);
  const all = await (await get('/api/places')).json();
  assert.equal(all.count, places.length);
  assert.equal(all.places.length, places.length);
  assert.ok(all.bySource.OpenStreetMap > 0 && Object.keys(all.bySource).some(label => label.startsWith('Overture')));
  assert.deepEqual(Object.keys(all.places[0]).sort(), [...all.fields].sort());
  const parks = await (await get('/api/places?category=park,service&bbox=51.1,71.4,51.2,71.5')).json();
  assert.ok(parks.count > 0 && parks.count < all.count);
  assert.ok(parks.places.every(place => ['park', 'service'].includes(place.category) && place.lat >= 51.1 && place.lon <= 71.5));
  const id = all.places.find(place => place.source === 'overture').id;
  const detail = await get(`/api/places/${encodeURIComponent(id)}`);
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).id, id);
  assert.equal((await get('/api/places/osm:node:0')).status, 404);
  assert.equal((await get('/api/places?bbox=1,2,3')).status, 400);
  assert.equal((await handleApi(new Request('https://smartwalk.test/api/places', { method: 'POST' }), {}, places)).status, 405);
  const status = await (await get('/api/status')).json();
  // Places after merging duplicates, the number the search, the map and «Моё» show; the raw records are reported apart.
  assert.equal(status.poiCount, preparedPlaces(places).length);
  assert.equal(status.sourceRecords, places.length);
  assert.ok(status.poiCount < status.sourceRecords);
  assert.equal(status.source, 'OpenStreetMap, Overture Maps');
});

test('a place asked for by name is found in either script, and one left out is named above the list', () => {
  const aitu = { lat: 51.0906, lon: 71.418, minutes: 120, maxWalkMinutes: 15, returnToStart: true };
  for (const query of ['Мега', 'Mega', 'в Мегу', 'Mega Silk Way']) {
    const result = recommend(places, { ...aitu, query, visitDate: '2026-10-21T15:00:00+05:00' });
    assert.equal(result.recommendations[0].name, 'Mega Silk Way', query);
  }
  // At 22:30 the mall is closed by its hours: the answer says so instead of silently showing other places.
  const late = recommend(places, { ...aitu, query: 'Мега', visitDate: '2026-10-21T22:30:00+05:00' });
  assert.ok(!late.recommendations.some(place => place.name === 'Mega Silk Way'));
  assert.ok(late.warnings.some(note => note.startsWith('«Mega Silk Way» по режиму работы из источника закрыто')));
  // Shortly before closing it is open on arrival, and the note says when it closes.
  const closing = recommend(places, { ...aitu, query: 'Мега', visitDate: '2026-10-21T21:30:00+05:00' });
  assert.ok(!closing.recommendations.some(place => place.name === 'Mega Silk Way'));
  assert.ok(closing.warnings.some(note => /^«Mega Silk Way» по режиму работы из источника работает до \d\d:\d\d и закроется раньше/.test(note)), closing.warnings.join('\n'));
  // Kazakh letters and a Latin spelling match the Russian one.
  const baiterek = { lat: 51.1283, lon: 71.4304, minutes: 60, maxWalkMinutes: 15, returnToStart: true, visitDate: '2026-10-21T15:00:00+05:00' };
  for (const query of ['Байтерек', 'Baiterek']) assert.equal(recommend(places, { ...baiterek, query }).recommendations[0].name, 'Бәйтерек', query);
  // Category words stay categories: «кафе» does not prefer places that merely have «Кафе» in the name.
  assert.equal(recommend(places, { ...aitu, query: 'кафе' }).retrieval.nameMatches, 0);
});
