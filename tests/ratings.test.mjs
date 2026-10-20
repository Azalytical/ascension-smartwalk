import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../src/api.mjs';
import { localSocialHub } from '../src/social/local.mjs';
import { recommend, notabilityFor } from '../src/retrieval.mjs';
import { ratingSummary, ratingBonus, RATINGS } from '../src/ratings.mjs';

const ORIGIN = 'https://aidem.example';
const cafe = (id, name, lat, lon, extra = {}) => ({ id, name, lat, lon, category: 'cafe', description: name, tags: { amenity: 'cafe' },
  sourceUrl: `https://www.openstreetmap.org/node/${id}`, retrievedAt: '2026-10-19T10:00:00Z', openingHours: '24/7', ...extra });
// Two cafés the same distance east and west of the start: without ratings the tie goes to the lower id.
const START = { lat: 51.1283, lon: 71.4304 };
const dataset = [cafe('osm:node:1', 'Кофейня Восток', 51.1283, 71.4334), cafe('osm:node:2', 'Кофейня Запад', 51.1283, 71.4274)];
const walk = { ...START, minutes: 60, maxWalkMinutes: 20, query: 'кофе' };
const device = n => `device-key-${String(n).padStart(8, '0')}-abcdef`;

function setup() {
  const hub = localSocialHub(':memory:');
  const env = { SOCIAL_LOCAL: hub, LOCAL_DEVELOPMENT: true };
  const api = async (path, { body, method = body === undefined ? 'GET' : 'POST', origin = ORIGIN, ip = '203.0.113.7' } = {}) => {
    const headers = { 'CF-Connecting-IP': ip, ...(origin ? { Origin: origin } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) };
    const response = await handleApi(new Request(`${ORIGIN}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }), env, dataset);
    return { status: response.status, data: await response.json() };
  };
  const rate = (placeId, stars, n = 1, ip) => api('/api/ratings', { body: { placeId, stars, device: device(n) }, ip });
  return { hub, env, api, rate };
}

test('the average is shown only from three ratings; fewer say «мало оценок» without a number', () => {
  assert.deepEqual(ratingSummary(0, 0), { count: 0, average: null, state: 'none', influencesRanking: false, source: 'aidem_users', isOpenData: false });
  assert.equal(ratingSummary(2, 10).average, null);
  assert.equal(ratingSummary(2, 10).state, 'few');
  assert.equal(ratingSummary(3, 13).average, 4.3);
  assert.equal(ratingSummary(3, 13).state, 'enough');
  assert.equal(ratingSummary(4, 20).influencesRanking, false);
  assert.equal(ratingSummary(5, 20).influencesRanking, true);
});

test('ratings nudge ranking only from five, through a smoothed average, and never by more than the cap', () => {
  assert.equal(ratingBonus({ count: 4, sum: 20 }), 0);
  assert.equal(ratingBonus({ count: 5, sum: 25 }), 3);
  assert.equal(ratingBonus({ count: 5, sum: 5 }), -5);
  assert.equal(ratingBonus({ count: 500, sum: 2500 }), RATINGS.maxBonus);
  assert.equal(ratingBonus({ count: 500, sum: 500 }), -RATINGS.maxBonus);
  assert.equal(ratingBonus({ count: 40, sum: 140 }), 0);
  assert.ok(RATINGS.maxBonus < 25 && RATINGS.maxBonus < 35, 'weaker than proximity and category');
});

test('a device rates a place once and can change or remove its rating', async () => {
  const { api, rate, hub } = setup();
  let reply = await rate('osm:node:1', 4);
  assert.equal(reply.status, 200, JSON.stringify(reply.data));
  assert.equal(reply.data.mine, 4);
  assert.deepEqual(reply.data.rating, ratingSummary(1, 4));
  assert.equal(reply.data.rating.average, null, 'one rating shows no average');
  reply = await rate('osm:node:1', 5);
  assert.equal(reply.data.rating.count, 1, 'the same device does not add a second rating');
  assert.equal(reply.data.mine, 5);
  await rate('osm:node:1', 3, 2);
  reply = await rate('osm:node:1', 4, 3);
  assert.equal(reply.data.rating.count, 3);
  assert.equal(reply.data.rating.average, 4);
  assert.equal(reply.data.rating.state, 'enough');
  reply = await rate('osm:node:1', null, 3);
  assert.equal(reply.data.mine, null);
  assert.equal(reply.data.rating.count, 2);
  assert.equal(reply.data.rating.average, null);
  // Only a hash of the device key is stored, with no name, address or time zone.
  const rows = hub.ratings.db.all('SELECT * FROM place_ratings');
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.match(row.rater, /^[0-9a-f]{64}$/);
    assert.ok(!JSON.stringify(row).includes('device-key'));
    assert.deepEqual(Object.keys(row).sort(), ['created_at', 'place_id', 'rater', 'stars', 'updated_at']);
  }
  const read = await api('/api/ratings?ids=osm:node:1,osm:node:2,osm:node:404');
  assert.equal(read.status, 200);
  assert.deepEqual(Object.keys(read.data.ratings), ['osm:node:1', 'osm:node:2'], 'unknown ids are skipped');
  assert.equal(read.data.ratings['osm:node:1'].count, 2);
  assert.equal(read.data.ratings['osm:node:1'].average, null);
  assert.equal(read.data.ratings['osm:node:2'].state, 'none');
  assert.equal(read.data.about.isOpenData, false);
  assert.equal(read.data.about.seeded, false);
  assert.ok(!JSON.stringify(read.data).includes('"sum"'), 'the sum would reveal an average of one or two ratings');
});

test('bad ratings, unknown places, bad device keys and other sites are refused', async () => {
  const { api, rate } = setup();
  for (const stars of [0, 6, 2.5, '5', true, undefined]) assert.equal((await rate('osm:node:1', stars)).status, 400, String(stars));
  assert.equal((await rate('osm:node:999', 5)).status, 404);
  assert.equal((await api('/api/ratings', { body: { placeId: 'osm:node:1', stars: 5, device: 'short' } })).status, 400);
  assert.equal((await api('/api/ratings', { body: { placeId: 'osm:node:1', stars: 5, device: 'x'.repeat(30) + '<script>' } })).status, 400);
  assert.equal((await api('/api/ratings', { body: { placeId: 'osm:node:1', stars: 5, device: device(1) }, origin: 'https://evil.example' })).status, 403);
  assert.equal((await api('/api/ratings', { method: 'DELETE' })).status, 405);
  const disabled = await handleApi(new Request(`${ORIGIN}/api/ratings?ids=osm:node:1`), {}, dataset);
  assert.equal(disabled.status, 503);
});

test('one address cannot stuff a place with new raters, but people elsewhere still can rate it', async () => {
  const { rate } = setup();
  for (let n = 1; n <= 10; n++) assert.equal((await rate('osm:node:2', 5, n)).status, 200);
  const stuffed = await rate('osm:node:2', 5, 11);
  assert.equal(stuffed.status, 429);
  // Changing an existing rating from the same address is still allowed.
  assert.equal((await rate('osm:node:2', 4, 1)).status, 200);
  assert.equal((await rate('osm:node:2', 5, 12, '198.51.100.9')).status, 200);
});

test('without ratings the order is unchanged and cards carry no user rating', () => {
  const plain = recommend(dataset, walk);
  assert.equal(plain.recommendations[0].id, 'osm:node:1');
  assert.equal(plain.recommendations[0].userRating, undefined);
  assert.equal(plain.recommendations[0].scoreBreakdown.userRatings, 0);
  assert.equal(plain.retrieval.scoring.userRatings.used, false);
});

test('from five ratings a well-rated place moves up a little; four ratings show but do not move it', () => {
  const four = recommend(dataset, walk, { ratings: new Map([['osm:node:2', { count: 4, sum: 20 }]]) });
  assert.equal(four.recommendations[0].id, 'osm:node:1');
  const second = four.recommendations.find(place => place.id === 'osm:node:2');
  assert.equal(second.userRating.average, 5);
  assert.equal(second.userRating.influencesRanking, false);
  assert.equal(four.recommendations[0].userRating.state, 'none');

  const ten = recommend(dataset, walk, { ratings: new Map([['osm:node:2', { count: 10, sum: 50 }]]) });
  assert.equal(ten.recommendations[0].id, 'osm:node:2');
  assert.ok(ten.recommendations[0].scoreBreakdown.userRatings > 0);
  const low = recommend(dataset, walk, { ratings: new Map([['osm:node:1', { count: 10, sum: 10 }]]) });
  assert.equal(low.recommendations[0].id, 'osm:node:2');
  assert.ok(low.recommendations[1].scoreBreakdown.userRatings < 0);
});

test('user ratings stay apart from the open-data notability mark, which is still not a rating', () => {
  const result = recommend(dataset, walk, { ratings: new Map([['osm:node:1', { count: 3, sum: 12 }]]) });
  const card = result.recommendations.find(place => place.id === 'osm:node:1');
  assert.equal(card.notability.isRating, false);
  assert.equal(card.notability.basis, 'open_data_mentions');
  assert.equal(card.userRating.source, 'aidem_users');
  assert.equal(card.userRating.isOpenData, false);
  assert.deepEqual(notabilityFor(dataset[0]), card.notability);
});

test('the site and the watch see users\' ratings next to each place', async () => {
  const { api, rate } = setup();
  for (let n = 1; n <= 5; n++) await rate('osm:node:2', 5, n);
  const response = await api('/api/recommend', { body: walk });
  assert.equal(response.status, 200);
  const card = response.data.recommendations.find(place => place.id === 'osm:node:2');
  assert.equal(card.userRating.average, 5);
  assert.equal(card.userRating.count, 5);
  assert.equal(response.data.recommendations[0].id, 'osm:node:2', 'five fives move it ahead of an equal café');
  const watch = await api(`/api/watch/plan?lat=${START.lat}&lon=${START.lon}&minutes=60&mood=coffee`);
  assert.equal(watch.status, 200);
  const wrist = watch.data.places.find(place => place.id === 'osm:node:2');
  assert.deepEqual(wrist.userRating, { count: 5, average: 5, state: 'enough' });
  const status = await api('/api/status');
  assert.equal(status.data.ratings, '/api/ratings');
});
