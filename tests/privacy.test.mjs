// Where a person is: the exact point stays on the phone; the server, Gemini and the routing service work from a cell of about 110 × 70 m.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleApi } from '../src/api.mjs';
import { coarse, coarsePoint } from '../src/privacy.mjs';
import { haversineMeters } from '../src/retrieval.mjs';
import * as phone from '../public/js/core/privacy.js';
import { walkingRoute } from '../public/js/core/api.js';

const EXACT = { lat: 51.12834, lon: 71.43041 };
const CELL = { lat: 51.128, lon: 71.43 };
const fromCell = haversineMeters(CELL.lat, CELL.lon, EXACT.lat, EXACT.lon);
// About 47 m, not 0: the place was measured from the cell. Retrieval and the photo search round metres their own way.
const fromTheCell = meters => Math.abs(meters - fromCell) <= 2;
// A café exactly where the person stands: from the exact point it would be 0 m away.
const pois = [{ id: 'node/1', name: 'Кофейня', lat: EXACT.lat, lon: EXACT.lon, category: 'cafe', tags: { amenity: 'cafe' },
  sourceUrl: 'https://www.openstreetmap.org/node/1', retrievedAt: '2026-10-19T10:00:00Z', openingHours: '24/7' }];
const env = { LOCAL_DEVELOPMENT: true };
const post = (path, body) => handleApi(new Request(`https://demo.example${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env, pois);
const get = path => handleApi(new Request(`https://demo.example${path}`), env, pois);

function withFetch(handler, fn) {
  return async () => {
    const original = globalThis.fetch;
    globalThis.fetch = handler;
    try { await fn(); } finally { globalThis.fetch = original; }
  };
}

test('rounding keeps three decimals, matches on the phone and the server, and moves a point by at most ~66 m', () => {
  assert.deepEqual(coarsePoint(EXACT), CELL);
  assert.equal(coarse(coarse(EXACT.lat)), coarse(EXACT.lat));
  assert.ok(Number.isNaN(coarse(undefined)));
  let worst = 0;
  for (let lat = 51.0; lat <= 51.35; lat += 0.00037) {
    for (let lon = 71.25; lon <= 71.65; lon += 0.0071) {
      assert.equal(phone.coarse(lat), coarse(lat));
      worst = Math.max(worst, haversineMeters(lat, lon, coarse(lat), coarse(lon)));
    }
  }
  assert.ok(worst < 66, `worst shift ${worst} m`);
});

test('the person’s own point goes out rounded, a landmark from the list as it is', () => {
  assert.deepEqual(phone.outbound({ kind: 'gps', ...EXACT, accuracy: 8 }), CELL);
  assert.deepEqual(phone.outbound({ kind: 'map', ...EXACT }), CELL);
  assert.deepEqual(phone.outbound({ kind: 'preset', id: 'baiterek', lat: 51.1283, lon: 71.4304 }), { lat: 51.1283, lon: 71.4304 });
  assert.deepEqual(phone.outbound({ id: 'node/1', lat: 51.13251, lon: 71.40387 }), { lat: 51.13251, lon: 71.40387 });
});

test('the routing service gets the rounded point, and the drawn line still starts at the person', withFetch(async url => {
  globalThis.__route = String(url);
  return new Response(JSON.stringify({ routes: [{ distance: 320, duration: 250, geometry: { coordinates: [[71.4301, 51.1281], [71.4321, 51.1301]] } }] }));
}, async () => {
  const route = await walkingRoute({ kind: 'gps', ...EXACT }, { id: 'node/9', lat: 51.1301, lon: 71.4321 });
  assert.match(globalThis.__route, /\/71\.43,51\.128;71\.4321,51\.1301\?/);
  assert.ok(!globalThis.__route.includes('51.12834'));
  assert.deepEqual(route.coordinates, [[EXACT.lon, EXACT.lat], [71.4301, 51.1281], [71.4321, 51.1301]]);
}));

test('the agent and Siri work from the rounded cell even when the exact point arrives', async () => {
  const agent = await (await post('/api/agent', { query: 'кофе', ...EXACT, minutes: 45 })).json();
  assert.equal(agent.places[0].id, 'node/1');
  assert.ok(fromTheCell(agent.places[0].distanceMeters), String(agent.places[0].distanceMeters));
  assert.match(agent.privacy, /округлил точку/);
  const siri = await (await get(`/api/watch/ask?lat=${EXACT.lat}&lon=${EXACT.lon}&q=${encodeURIComponent('кофе')}`)).json();
  assert.ok(fromTheCell(siri.places[0].distanceMeters));
  const spoken = async point => (await get(`/api/watch/plan?format=text&lat=${point.lat}&lon=${point.lon}&mood=coffee`)).text();
  assert.equal(await spoken(EXACT), await spoken(CELL));
});

test('the photo search measures nearby places from the rounded cell', async () => {
  const data = await (await post('/api/vision', { image: 'data:image/jpeg;base64,' + 'A'.repeat(400), ...EXACT })).json();
  assert.equal(data.nearby[0].id, 'node/1');
  assert.ok(fromTheCell(data.nearby[0].distanceMeters));
});

test('Workers Logs never store request URLs, which carry Siri’s point', () => {
  const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, ''));
  assert.equal(config.observability.logs.invocation_logs, false);
});
