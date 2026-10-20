// The visitor's walk settings: the reserve (5, 10 or 15 minutes), «Больше не предлагать», «Удиви меня»,
// and the line that says why a card rather than the other ones.
import test from 'node:test';
import assert from 'node:assert/strict';
import { recommend } from '../src/retrieval.mjs';
import { handleApi } from '../src/api.mjs';
import { runTool, ToolError } from '../src/tools.mjs';
import { runAgent } from '../src/agent.mjs';
import { limitedJson, answerLanguage, UNSUPPORTED } from '../src/api.mjs';

const start = { lat: 51.12, lon: 71.42, minutes: 60, maxWalkMinutes: 20 };
// About 111 m per 0.001° of latitude: +0.0009 is a 2-minute walk, +0.0027 six minutes, +0.0054 twelve.
const place = (id, overrides = {}) => ({ id, name: `Место ${id}`, lat: 51.12, lon: 71.42, category: 'park', tags: { leisure: 'park' },
  sourceUrl: `https://www.openstreetmap.org/node/${id.replace(/\D/g, '') || 1}`, retrievedAt: '2026-10-19T12:00:00Z', openingHours: null, ...overrides });
const AT = '2026-10-21T13:00:00+05:00';

test('reserve: 5 minutes by default, 10 or 15 on request, counted in the fit check, the plan, «почему» and «понял»', () => {
  const park = place('osm:node:1', { lat: 51.1209 });
  const fits = recommend([park], { ...start, minutes: 24, visitDate: AT }).recommendations[0];
  assert.equal(fits.walkMinutes, 2);
  assert.equal(fits.safetyReserveMinutes, 5);
  assert.equal(fits.totalMinutes, 24);
  // The same place no longer fits 24 minutes with a 10-minute reserve, and fits 29.
  assert.equal(recommend([park], { ...start, minutes: 24, reserveMinutes: 10 }).recommendations.length, 0);
  const result = recommend([park], { ...start, minutes: 29, reserveMinutes: 10, visitDate: AT });
  const card = result.recommendations[0];
  assert.equal(card.totalMinutes, 29);
  assert.equal(card.safetyReserveMinutes, 10);
  assert.equal(result.constraints.safetyReserveMinutes, 10);
  assert.deepEqual(result.constraints.reserveOptions, [5, 10, 15]);
  // «Вернётесь к» stays the way there, the visit and back; «с запасом до» adds the reserve.
  assert.equal(card.plan.leaveAt, '13:00');
  assert.equal(card.plan.backAt, '13:19');
  assert.equal(card.plan.spareUntil, '13:29');
  assert.equal(card.plan.reserveMinutes, 10);
  assert.match(card.why, /и ещё 10 мин в запасе из ваших 29/);
  assert.match(card.why, /вернётесь примерно к 13:19/);
  assert.ok(result.understood.find(item => item.key === 'time').label.endsWith('запас 10 мин'));
  assert.ok(result.warnings.some(line => line.includes('резерв 10 минут')));
  assert.equal(recommend([park], { ...start, minutes: 60, reserveMinutes: '15' }).recommendations[0].safetyReserveMinutes, 15);
  for (const reserveMinutes of [0, 7, 20, 'ten', true, [10]]) {
    assert.throws(() => recommend([park], { ...start, reserveMinutes }), error => error.code === 'INVALID_INPUT' && error.message === 'Запас времени: 5, 10 или 15 минут.');
  }
});

test('reserve: the micro-route counts the chosen reserve too', () => {
  const pois = ['1', '2', '3', '4'].map((n, index) => place(`osm:node:${n}`, { name: `Сквер ${n}`, lat: 51.12 + 0.0009 * (index + 1), category: index % 2 ? 'attraction' : 'park',
    tags: index % 2 ? { tourism: 'attraction' } : { leisure: 'park' } }));
  const route = recommend(pois, { ...start, minutes: 120, query: 'погулять маршрутом', reserveMinutes: 15 }).route;
  assert.ok(route, 'a route fits two hours');
  assert.equal(route.reserveMinutes, 15);
  assert.equal(route.totalMinutes, route.walkMinutes + route.visitMinutes + 15);
});

test('«Больше не предлагать»: hidden places are dropped before ranking, the visitor still gets three', () => {
  const pois = ['1', '2', '3', '4'].map((n, index) => place(`osm:node:${n}`, { name: `Парк ${n}`, lat: 51.12 + 0.0009 * (index + 1) }));
  const all = recommend(pois, start);
  assert.equal(all.recommendations.length, 3);
  const hidden = all.recommendations[0].id;
  const result = recommend(pois, { ...start, excludeIds: [hidden, 'osm:node:999'] });
  assert.equal(result.recommendations.length, 3);
  assert.ok(!result.recommendations.some(card => card.id === hidden));
  assert.equal(result.retrieval.rejected.excludedByUser, 1, 'an unknown id is not counted');
  assert.deepEqual(result.constraints.excludeIds, [hidden, 'osm:node:999']);
  assert.equal(result.understood.find(item => item.key === 'hidden').label, 'Не предлагаем 1 место, которое вы скрыли');
  const two = recommend(pois, { ...start, excludeIds: ['osm:node:1', 'osm:node:2'] });
  assert.equal(two.understood.find(item => item.key === 'hidden').label, 'Не предлагаем 2 места, которые вы скрыли');
  assert.equal(two.recommendations.length, 2);
  assert.equal(recommend(pois, start).understood.some(item => item.key === 'hidden'), false);
});

test('«Больше не предлагать»: a hidden place is not offered as the nearest beyond the limits or as a second stop', () => {
  const far = place('osm:node:7', { name: 'Дальний музей', category: 'museum', tags: { tourism: 'museum' }, lat: 51.15, openingHours: '24/7' });
  assert.equal(recommend([far], { ...start, query: 'музей' }).nearestBeyondLimits.id, far.id);
  assert.equal(recommend([far], { ...start, query: 'музей', excludeIds: [far.id] }).nearestBeyondLimits, null);
  const park = place('osm:node:1', { name: 'Сквер' });
  const cafe = place('osm:node:2', { name: 'Кофейня рядом', category: 'cafe', tags: { amenity: 'cafe' }, lat: 51.1205, openingHours: '24/7' });
  assert.equal(recommend([park, cafe], { ...start, query: 'парк' }).recommendations[0].pairing?.id, cafe.id);
  assert.equal(recommend([park, cafe], { ...start, query: 'парк', excludeIds: [cafe.id] }).recommendations[0].pairing, null);
});

test('«Больше не предлагать»: the list is checked', () => {
  for (const excludeIds of ['osm:node:1', { id: 1 }, Array(201).fill('a'), ['x'.repeat(121)], [null]]) {
    assert.throws(() => recommend([], { ...start, excludeIds }), error => error.code === 'INVALID_INPUT' && /excludeIds/.test(error.message));
  }
});

test('«Удиви меня»: one place at random, only among those that passed the time, hours and name checks', () => {
  const pois = [
    place('osm:node:1', { name: 'Сквер Желтоксан' }),
    place('osm:node:2', { name: 'Музей у воды', category: 'museum', tags: { tourism: 'museum' }, lat: 51.1227, openingHours: '24/7' }),
    place('osm:node:3', { name: 'Кофейня у дома', category: 'cafe', tags: { amenity: 'cafe' }, lat: 51.1209, openingHours: '24/7' }),
    place('osm:node:4', { name: 'Галерея', category: 'attraction', tags: { tourism: 'gallery' }, lat: 51.1254 }),
    // Closed at 13:00, too far, nameless and a chain: never the surprise while named local places fit.
    place('osm:node:5', { name: 'Вечерний бар', category: 'cafe', tags: { amenity: 'cafe' }, lat: 51.1209, openingHours: 'Mo-Su 18:00-23:00' }),
    place('osm:node:6', { name: 'Дальний парк', lat: 51.16 }),
    place('osm:node:7', { name: 'Детская площадка', category: 'playground', tags: { leisure: 'playground' }, nameIsGenerated: true }),
    place('osm:node:8', { name: 'Сетевой кофе', category: 'cafe', tags: { amenity: 'cafe', brand: 'Сеть' }, lat: 51.1218, openingHours: '24/7' }),
  ];
  const allowed = new Set(['osm:node:1', 'osm:node:2', 'osm:node:3', 'osm:node:4']);
  const picked = new Set();
  for (let seed = 0; seed < 120; seed++) {
    const result = recommend(pois, { ...start, visitDate: AT, surprise: true, surpriseSeed: seed });
    assert.equal(result.recommendations.length, 1);
    assert.ok(allowed.has(result.recommendations[0].id), `seed ${seed} picked ${result.recommendations[0].id}`);
    assert.equal(result.route, null);
    assert.deepEqual(result.surprise, { seed, poolSize: 4 });
    assert.equal(result.recommendations[0].versus.reasons[0].key, 'surprise');
    picked.add(result.recommendations[0].id);
  }
  assert.equal(picked.size, 4, 'every allowed place comes up for some seed');
  // The same seed gives the same place; without one the server picks a seed and returns it.
  const first = recommend(pois, { ...start, visitDate: AT, surprise: true });
  assert.ok(Number.isInteger(first.surprise.seed));
  assert.equal(recommend(pois, { ...start, visitDate: AT, surprise: true, surpriseSeed: first.surprise.seed }).recommendations[0].id, first.recommendations[0].id);
  assert.ok(first.understood.some(item => item.key === 'surprise'));
  // With a child the surprise stays within places for a walk with a child.
  for (let seed = 0; seed < 30; seed++) {
    const child = recommend(pois, { ...start, visitDate: AT, surprise: true, surpriseSeed: seed, withChild: true });
    assert.ok(['park', 'playground', 'family', 'museum'].includes(child.recommendations[0].category));
  }
  assert.throws(() => recommend(pois, { ...start, surprise: 'yes' }), error => error.code === 'INVALID_INPUT');
  assert.throws(() => recommend(pois, { ...start, surprise: true, surpriseSeed: -1 }), error => error.code === 'INVALID_INPUT');
  const none = recommend([pois[5]], { ...start, surprise: true, surpriseSeed: 3 });
  assert.equal(none.recommendations.length, 0);
  assert.deepEqual(none.surprise, { seed: 3, poolSize: 0 });
});

test('alternatives explained: every card says why it rather than the others, from confirmed data only', () => {
  const near = place('osm:node:1', { name: 'Ближний сквер', lat: 51.1209 });
  const farther = place('osm:node:2', { name: 'Дальний сквер', lat: 51.1254 });
  const [first, second] = recommend([near, farther], { ...start, query: 'парк' }).recommendations;
  const closer = first.versus.reasons.find(reason => reason.key === 'closer');
  assert.equal(closer.params.minutes, second.walkMinutes - first.walkMinutes);
  assert.equal(first.versus.text, `Ближе остальных на ${second.walkMinutes - first.walkMinutes} мин пешком.`);
  assert.equal(first.versus.origin, 'computed_from_poi');
  assert.equal(first.provenance.versus.origin, 'computed_from_poi');
  assert.ok(second.versus.reasons.length >= 1);

  // Hours from the source and a Wi-Fi tag that only one of two cafes has.
  const listed = place('osm:node:3', { name: 'Кофейня с часами', category: 'cafe', tags: { amenity: 'cafe', internet_access: 'wlan' }, lat: 51.1209, openingHours: '24/7' });
  const unlisted = place('osm:node:4', { name: 'Кофейня без часов', category: 'cafe', tags: { amenity: 'cafe' }, lat: 51.1209, lon: 71.4203 });
  const cafe = recommend([listed, unlisted], { ...start, query: 'кофе' }).recommendations.find(card => card.id === listed.id);
  const keys = cafe.versus.reasons.map(reason => reason.key);
  assert.ok(keys.includes('hoursConfirmed'));
  assert.ok(cafe.versus.reasons.find(reason => reason.key === 'hoursConfirmed').text.includes('круглосуточно'));
  assert.deepEqual(cafe.versus.reasons.find(reason => reason.key === 'feature').params, { fact: 'есть Wi-Fi' });

  // In the rain a roof is the difference, said with the weather from Open-Meteo.
  const museum = place('osm:node:5', { name: 'Музей', category: 'museum', tags: { tourism: 'museum' }, lat: 51.1209, openingHours: '24/7' });
  const rain = recommend([near, museum], { ...start, minutes: 90, query: 'парк или музей' }, { weather: { temperatureC: 4, precipitationMm: 1.2, code: 61 } });
  const roofed = rain.recommendations.find(card => card.id === museum.id);
  assert.equal(roofed.versus.reasons[0].key, 'roof');
  assert.match(roofed.versus.reasons[0].params.weather, /дождь/);
  assert.ok(!rain.recommendations.find(card => card.id === near.id).versus.reasons.some(reason => ['roof', 'outdoor'].includes(reason.key)), 'no fresh-air plus in the rain');

  // One card: it is the only one that fits.
  assert.equal(recommend([near], start).recommendations[0].versus.reasons[0].key, 'only');
  // Identical cards still get a reason, and the reason says so.
  const twin = place('osm:node:6', { name: 'Другой сквер', lat: 51.1209, lon: 71.4201 });
  for (const card of recommend([near, twin], { ...start, query: 'парк' }).recommendations) {
    assert.ok(card.versus.reasons.length >= 1);
    assert.ok(card.versus.text.endsWith('.'));
  }
});

const api = (path, body, env = {}, pois = [], extra = {}) => handleApi(new Request(`https://demo.example${path}`, { method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'https://demo.example', ...extra }, body: JSON.stringify(body) }), { LOCAL_DEVELOPMENT: true, ...env }, pois);
const geminiReply = payload => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }), { headers: { 'Content-Type': 'application/json' } });
const park = place('node/1', { name: 'Парк', lat: 51.1283, lon: 71.4304 });
const valid = { lat: 51.1283, lon: 71.4304, minutes: 45, maxWalkMinutes: 15, query: 'Прогулка в парке' };

test('/api/recommend: the reserve reaches the card, the calendar link, and a bad value is a 400', async () => {
  const data = await (await api('/api/recommend', { ...valid, reserveMinutes: 15 }, {}, [park])).json();
  const card = data.recommendations[0];
  assert.equal(card.safetyReserveMinutes, 15);
  assert.equal(card.totalMinutes, card.walkMinutes + card.visitMinutes + card.returnMinutes + 15);
  assert.match(new URL(card.links.googleCalendar).searchParams.get('details'), /запас 15 мин/);
  assert.equal(data.surprise, null);
  const bad = await api('/api/recommend', { ...valid, reserveMinutes: 7 }, {}, [park]);
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, 'Запас времени: 5, 10 или 15 минут.');
  // Two hundred hidden ids fit in the request.
  const hidden = Array.from({ length: 200 }, (_, n) => `overture:${String(n).padStart(8, '0')}-0000-0000-0000-000000000000`);
  assert.equal((await api('/api/recommend', { ...valid, excludeIds: hidden }, {}, [park])).status, 200);
});

test('/api/recommend: the model sees the computed differences for its summary; the card keeps the computed line', async () => {
  const original = globalThis.fetch;
  let sent;
  try {
    globalThis.fetch = async (_url, options) => { sent = JSON.parse(options.body); return geminiReply({ summary: 'Можно выбрать Парк: прогулка с возвращением и запасом.', references: [park.id],
      places: [{ id: park.id, why: 'Подходит под прогулку.', todo: 'Пройтись по парку.', versus: 'Других вариантов под ваше время нет.' }] }); };
    const data = await (await api('/api/recommend', valid, { GEMINI_API_KEY: 'g' }, [park])).json();
    const context = JSON.parse(sent.contents[0].parts[0].text);
    assert.deepEqual(context.alternatives[0].versus, ['единственный вариант, который помещается в ваше время и условия']);
    assert.equal(context.alternatives[0].reserveMinutes, 5);
    // The model writes only why and todo: rewording the difference too made the answer about a quarter longer.
    assert.deepEqual(sent.generationConfig.responseSchema.properties.places.items.required, ['id', 'why', 'todo']);
    assert.ok(!sent.systemInstruction.parts[0].text.includes('versus —'));
    assert.equal(data.recommendations[0].aiVersus, undefined, 'a stray versus from a model is not shown');
    assert.equal(data.recommendations[0].aiWhy, 'Подходит под прогулку.');
    assert.equal(data.recommendations[0].versus.reasons[0].key, 'only');
    assert.ok(data.recommendations[0].versus.text);
  } finally { globalThis.fetch = original; }
});

const pois = [
  { id: 'node/1', name: 'Кофейня у Байтерека', lat: 51.1290, lon: 71.4310, category: 'cafe', tags: { amenity: 'cafe' }, sourceUrl: 'https://www.openstreetmap.org/node/1', retrievedAt: '2026-10-19T10:00:00Z', openingHours: '24/7' },
  { id: 'node/2', name: 'Кофейня у парка', lat: 51.1300, lon: 71.4330, category: 'cafe', tags: { amenity: 'cafe' }, sourceUrl: 'https://www.openstreetmap.org/node/2', retrievedAt: '2026-10-19T10:00:00Z', openingHours: '24/7' },
  { id: 'node/3', name: 'Сквер', lat: 51.1300, lon: 71.4300, category: 'park', tags: { leisure: 'park' }, sourceUrl: 'https://www.openstreetmap.org/node/3', retrievedAt: '2026-10-19T10:00:00Z', openingHours: null }
];
const START = { lat: 51.1283, lon: 71.4304 };

test('plan_walk and build_route (MCP and the agent) take the reserve, hidden places and «Удиви меня»', async () => {
  const walk = await runTool('plan_walk', { ...START, minutes: 60, query: 'кофе', reserve_minutes: 10, exclude_ids: ['node/1'] }, { dataset: pois });
  assert.ok(walk.places.length >= 1);
  assert.ok(!walk.places.some(item => item.id === 'node/1'));
  assert.ok(walk.places.every(item => item.safetyReserveMinutes === 10 && typeof item.versus === 'string'));
  assert.equal(walk.reserveMinutes, 10);
  assert.match(walk.method, /резерв 10 минут/);
  const surprise = await runTool('plan_walk', { ...START, minutes: 60, surprise: true, surprise_seed: 7 }, { dataset: pois });
  assert.equal(surprise.places.length, 1);
  assert.equal(surprise.surprise.seed, 7);
  assert.equal(surprise.microRoute, undefined);
  await assert.rejects(runTool('plan_walk', { ...START, reserve_minutes: 7 }, { dataset: pois }), ToolError);
  const route = await runTool('build_route', { ...START, place_ids: ['node/1', 'node/3'], reserve_minutes: 15 }, { dataset: pois });
  assert.equal(route.reserveMinutes, 15);
  assert.equal(route.totalMinutes, route.walkMinutes + route.visitMinutes + 15);
  await assert.rejects(runTool('build_route', { ...START, place_ids: ['node/1', 'node/3'], reserve_minutes: 12 }, { dataset: pois }), ToolError);
});

const weatherBody = { current: { time: '2026-10-20T15:00', temperature_2m: 8, apparent_temperature: 6, wind_speed_10m: 3, wind_gusts_10m: 5, precipitation: 0, weather_code: 1, is_day: 1 },
  daily: { sunrise: ['2026-10-20T07:40'], sunset: ['2026-10-20T17:50'] } };
const agentDeps = env => ({ env, dataset: pois, limitedJson, answerLanguage, unsupported: UNSUPPORTED,
  fetchImpl: async () => new Response(JSON.stringify(weatherBody), { headers: { 'Content-Type': 'application/json' } }) });

test('agent: the server fills in the reserve and the hidden places; Gemini never sees or offers a hidden place', async () => {
  // Without a key the agent answers from the same tools, with the reserve the visitor chose.
  const fallback = await runAgent({ query: 'кофе', ...START, minutes: 60, reserveMinutes: 15, excludeIds: ['node/1'] }, agentDeps({}));
  assert.equal(fallback.mode, 'fallback');
  assert.match(fallback.summary, /запас 15 минут/);
  assert.ok(fallback.places.length >= 1 && !fallback.places.some(item => item.id === 'node/1'));
  assert.ok(fallback.places.every(item => item.safetyReserveMinutes === 15));
  assert.match(new URL(fallback.places[0].links.googleCalendar).searchParams.get('details'), /запас 15 мин/);

  const original = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    const answered = body.contents.some(content => content.role === 'model');
    const parts = answered ? [{ functionCall: { name: 'give_answer', args: { summary: 'Кофейня у Байтерека рядом.', place_ids: ['node/1'] } } }]
      : [{ functionCall: { name: 'plan_walk', args: { query: 'кофе' } } }, { functionCall: { name: 'search_places', args: { query: 'Кофейня' } } }];
    return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts } }] }), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const data = await runAgent({ query: 'кофе', ...START, minutes: 60, reserveMinutes: 10, excludeIds: ['node/1'] }, agentDeps({ GEMINI_API_KEY: 'test' }));
    assert.equal(JSON.parse(bodies[0].contents[0].parts[0].text).reserveMinutes, 10);
    const results = bodies[1].contents.at(-1).parts.map(part => part.functionResponse.response.result);
    assert.ok(results.every(result => !JSON.stringify(result).includes('node/1')), 'the hidden place is not in any tool result');
    // Gemini named the hidden place anyway: the answer is sent back, then the server answers on its own.
    assert.ok(!data.places.some(item => item.id === 'node/1'));
    assert.ok(data.steps.some(step => step.tool === 'check'));
  } finally { globalThis.fetch = original; }

  for (const body of [{ reserveMinutes: 7 }, { excludeIds: 'node/1' }, { excludeIds: [1] }]) {
    const response = await api('/api/agent', { query: 'кофе', ...START, ...body }, {}, pois);
    assert.equal(response.status, 400);
  }
});

test('watch and Siri: reserve=… and exclude=… in the link', async () => {
  const get = path => handleApi(new Request(`https://demo.example${path}`), { LOCAL_DEVELOPMENT: true }, pois);
  const plan = await (await get('/api/watch/plan?lat=51.1283&lon=71.4304&minutes=60&mood=coffee&reserve=15&exclude=node/1')).json();
  assert.ok(plan.places.length >= 1 && !plan.places.some(item => item.id === 'node/1'));
  assert.ok(plan.places.every(item => item.safetyReserveMinutes === 15 && item.totalMinutes === item.walkMinutes + item.visitMinutes + item.returnMinutes + 15));
  assert.ok(plan.places.every(item => typeof item.versus === 'string' && item.versus.length > 3));
  assert.match(plan.estimate, /резервом 15 минут/);
  assert.equal((await get('/api/watch/plan?lat=51.1283&lon=71.4304&reserve=7')).status, 400);
  const asked = await (await get(`/api/watch/ask?lat=51.1283&lon=71.4304&q=${encodeURIComponent('кофе')}&reserve=10&exclude=node/1`)).json();
  assert.ok(asked.places.length >= 1 && !asked.places.some(item => item.id === 'node/1'));
  assert.ok(asked.places.every(item => item.safetyReserveMinutes === 10));
});
