// The watch and Siri with walks «только туда» and of up to four hours: /api/watch/plan takes one=1 and minutes up to 240,
// the spoken answer says «закончите к» without a way back, and the watch page offers the same times as the phone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleApi } from '../src/api.mjs';
import { spokenPlan } from '../src/watch.mjs';

const pois = [
  { id: 'node/1', name: 'Кофейня у Байтерека', lat: 51.1290, lon: 71.4310, category: 'cafe', tags: { amenity: 'cafe' }, sourceUrl: 'https://www.openstreetmap.org/node/1', retrievedAt: '2026-10-19T10:00:00Z', openingHours: null },
  { id: 'node/2', name: 'Сквер', lat: 51.1300, lon: 71.4330, category: 'park', tags: { leisure: 'park' }, sourceUrl: 'https://www.openstreetmap.org/node/2', retrievedAt: '2026-10-19T10:00:00Z', openingHours: null }
];
const plan = (query) => handleApi(new Request(`https://demo.example/api/watch/plan?${query}`), {}, pois);

test('Siri plans up to four hours, and no more', async () => {
  const long = await plan('lat=51.1283&lon=71.4304&minutes=240&mood=coffee');
  assert.equal(long.status, 200);
  const data = await long.json();
  assert.equal(data.minutes, 240);
  assert.ok(data.places.length > 0);
  const tooLong = await plan('lat=51.1283&lon=71.4304&minutes=241&mood=coffee');
  assert.equal(tooLong.status, 400);
  assert.match((await tooLong.json()).error, /от 10 до 240/);
});

test('one=1 plans a walk with no way back, and Siri says «закончите к»', async () => {
  const data = await (await plan('lat=51.1283&lon=71.4304&minutes=180&mood=coffee&one=1')).json();
  assert.equal(data.oneWay, true);
  assert.ok(data.places.every(place => place.returnMinutes === 0));
  const round = await (await plan('lat=51.1283&lon=71.4304&minutes=180&mood=coffee')).json();
  assert.equal(round.oneWay, undefined);
  assert.ok(round.places[0].returnMinutes > 0);
  const text = await (await plan('lat=51.1283&lon=71.4304&minutes=180&mood=coffee&one=1&format=text')).text();
  assert.match(text, /без дороги обратно займёт примерно \d+ минут[уы]?, закончите к \d\d:\d\d\./);
  assert.doesNotMatch(text, /вернётесь/);
});

test('the one-way spoken plan in Kazakh and English', () => {
  const place = { name: 'Degirmen', category: 'cafe', walkMinutes: 6, visitMinutes: 30, returnMinutes: 0, safetyReserveMinutes: 5, totalMinutes: 41 };
  const now = new Date('2026-10-21T10:00:00Z');
  assert.match(spokenPlan({ places: [place] }, now, 'ru'), /займёт примерно 36 минут, закончите к 15:36\./);
  assert.match(spokenPlan({ places: [place] }, now, 'kk'), /қайту жолынсыз .* 15:36 шамасында аяқтайсыз\./);
  assert.match(spokenPlan({ places: [place] }, now, 'en'), /one way, .* done by 15:36\./);
  assert.match(spokenPlan({ places: [{ ...place, returnMinutes: 6, totalMinutes: 47 }] }, now, 'ru'), /вернётесь к 15:42\./);
});

test('the watch page offers the phone’s times and takes «только туда» from the phone', () => {
  const script = readFileSync(new URL('../public/watch.js', import.meta.url), 'utf8');
  const times = JSON.parse(script.match(/const TIMES = (\[[^\]]+\])/)[1]);
  assert.deepEqual(times, [30, 45, 60, 90, 120, 150, 180, 240]);
  // The hand-off link carries one=1 (and back=0) from the phone; either one means no way back on the watch.
  assert.match(script, /hash\.get\('one'\) === '1' \|\| hash\.get\('back'\) === '0' \? 0/);
  const common = readFileSync(new URL('../public/js/ui/common.js', import.meta.url), 'utf8');
  assert.match(common, /if \(oneWay\) params\.set\('one', '1'\)/);
  for (const file of ['place.js', 'live.js']) assert.match(readFileSync(new URL(`../public/js/ui/${file}`, import.meta.url), 'utf8'), /watchButton\(\{[^)]*oneWay/, file);
});
