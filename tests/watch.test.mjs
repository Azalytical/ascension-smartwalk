import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleApi } from '../src/api.mjs';
import { plural, spokenPlan } from '../src/watch.mjs';

const pois = [
  { id: 'node/1', name: 'Кофейня у Байтерека', lat: 51.1290, lon: 71.4310, category: 'cafe', tags: { amenity: 'cafe' }, sourceUrl: 'https://www.openstreetmap.org/node/1', retrievedAt: '2026-10-19T10:00:00Z', openingHours: null },
  { id: 'node/2', name: 'Сквер', lat: 51.1300, lon: 71.4330, category: 'park', tags: { leisure: 'park' }, sourceUrl: 'https://www.openstreetmap.org/node/2', retrievedAt: '2026-10-19T10:00:00Z', openingHours: null }
];
const plan = (query, init) => handleApi(new Request(`https://demo.example/api/watch/plan?${query}`, init), {}, pois);

test('watch plan is compact and sourced', async () => {
  const response = await plan('lat=51.1283&lon=71.4304&minutes=45&mood=coffee');
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.places[0].name, 'Кофейня у Байтерека');
  assert.equal(data.places[0].sourceUrl, 'https://www.openstreetmap.org/node/1');
  for (const key of ['walkMinutes', 'visitMinutes', 'returnMinutes', 'totalMinutes', 'lat', 'lon']) assert.equal(typeof data.places[0][key], 'number');
  assert.equal(data.places[0].evidence, undefined);
  assert.ok(data.places.length <= 3);
  assert.match(data.query, /кофе/);
});

test('watch plan cites the dataset of each place and its confidence', async () => {
  const overture = { ...pois[0], id: 'overture/1', sourceUrl: 'https://overturemaps.org/', source: { id: 'overture', label: 'Overture Maps · Meta', license: 'CDLA-Permissive-2.0', attribution: 'Overture Maps Foundation' } };
  const response = await handleApi(new Request('https://demo.example/api/watch/plan?lat=51.1283&lon=71.4304&minutes=45&mood=coffee'), {}, [overture, pois[1]]);
  const data = await response.json();
  assert.equal(data.places[0].source.label, 'Overture Maps · Meta');
  assert.equal(data.places[0].source.license, 'CDLA-Permissive-2.0');
  assert.match(data.places[0].confidence.label, /уверенность/);
  assert.ok(['high', 'medium', 'low'].includes(data.places[0].confidence.level));
  assert.equal(data.attribution, '© OpenStreetMap contributors, Overture Maps Foundation');
  assert.equal(data.license, undefined);
  const html = readFileSync(new URL('../public/watch.html', import.meta.url), 'utf8');
  assert.match(html, /© OpenStreetMap contributors, Overture Maps Foundation/);
});

test('voice format answers in plain Russian and accepts comma decimals', async () => {
  const response = await plan('lat=51,1283&lon=71,4304&mood=coffee&format=text');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Type'), /text\/plain/);
  const text = await response.text();
  assert.match(text, /^Кофейня у Байтерека, кафе\. Идти примерно \d+ минут/);
  assert.match(text, /займёт примерно \d+ минут[уы]?, вернётесь к \d\d:\d\d\./);
});

test('outside Astana is explained, readable aloud in voice format', async () => {
  const json = await plan('lat=43.2&lon=76.9&mood=coffee');
  assert.equal(json.status, 400);
  assert.match((await json.json()).error, /только в Астане/);
  const voice = await plan('lat=43.2&lon=76.9&mood=coffee&format=text');
  assert.equal(voice.status, 200);
  assert.match(await voice.text(), /только в Астане/);
});

test('unknown moods, methods and paths are rejected', async () => {
  assert.equal((await plan('lat=51.1283&lon=71.4304&mood=party')).status, 400);
  assert.equal((await plan('lat=51.1283&lon=71.4304', { method: 'POST' })).status, 405);
  assert.equal((await handleApi(new Request('https://demo.example/api/watch/other'), {}, pois)).status, 404);
});

test('nothing in reach is said honestly', () => {
  assert.match(spokenPlan({ places: [] }), /не нашлось/);
});

test('Russian plurals', () => {
  assert.deepEqual([1, 2, 5, 11, 21, 24, 112].map(n => plural(n, 'минуту', 'минуты', 'минут')),
    ['минуту', 'минуты', 'минут', 'минут', 'минуту', 'минуты', 'минут']);
});

test('every element the watch script looks up exists on the page', () => {
  const html = readFileSync(new URL('../public/watch.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../public/watch.js', import.meta.url), 'utf8');
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  const used = new Set([...script.matchAll(/\$\('([^']+)'\)/g)].map(match => match[1]));
  assert.ok(used.size > 40);
  assert.deepEqual([...used].filter(id => !ids.has(id)), []);
  // The pairing keypad: ten digits, erase and back.
  assert.equal([...html.matchAll(/data-key="([^"]+)"/g)].map(match => match[1]).sort().join(','), '0,1,2,3,4,5,6,7,8,9,back,del');
});
