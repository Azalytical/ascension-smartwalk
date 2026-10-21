// «Только туда» and walks of two hours and more: the engine counts no way back, the texts say «закончите к»,
// the walk can be planned up to four hours, a phrase sets both («3 часа, только туда»), and «Что-то пошло не так?»
// keeps the end time of a one-way walk.
import test from 'node:test';
import assert from 'node:assert/strict';
import { recommend, MAX_MINUTES } from '../src/retrieval.mjs';
import { handleApi } from '../src/api.mjs';
import { runTool } from '../src/tools.mjs';
import { understand } from '../public/js/core/time-words.js';
import { reachMeters } from '../public/js/core/geo.js';
import { alternatives, switchTo, runLate, minutesLeft } from '../public/js/core/replan.js';
import { checkVisit } from '../src/hours.mjs';

const start = { lat: 51.12, lon: 71.42, minutes: 60, maxWalkMinutes: 20 };
// About 111 m per 0.001° of latitude: +0.0054 is a twelve-minute walk.
const place = (id, overrides = {}) => ({ id, name: `Место ${id}`, lat: 51.12, lon: 71.42, category: 'park', tags: { leisure: 'park' },
  sourceUrl: `https://www.openstreetmap.org/node/${id.replace(/\D/g, '') || 1}`, retrievedAt: '2026-10-19T12:00:00Z', openingHours: null, ...overrides });
const AT = '2026-10-21T13:00:00+05:00';

test('one way: no way back in the time, the plan ends on site, and every text says «закончите»', () => {
  const park = place('osm:node:1', { lat: 51.1254 });
  const round = recommend([park], { ...start, minutes: 45, visitDate: AT });
  assert.equal(round.recommendations[0].walkMinutes, 12);
  assert.equal(round.recommendations[0].totalMinutes, 12 + 15 + 12 + 5);
  // 35 minutes: too short to come back, enough to get there, stay and keep the reserve.
  assert.equal(recommend([park], { ...start, minutes: 35 }).recommendations.length, 0);
  const result = recommend([park], { ...start, minutes: 35, returnToStart: false, visitDate: AT });
  const card = result.recommendations[0];
  assert.equal(card.returnMinutes, 0);
  assert.equal(card.totalMinutes, 12 + 15 + 5);
  assert.equal(card.plan.backAt, '13:27');
  assert.equal(card.plan.spareUntil, '13:32');
  assert.ok(!card.plan.stepKeys.some(step => step.key === 'back'));
  assert.match(card.plan.text, /Закончите примерно к 13:27/);
  assert.doesNotMatch(card.plan.text, /обратно|Вернётесь/);
  assert.match(card.why, /туда и на месте/);
  assert.match(card.why, /закончите примерно к 13:27/);
  const time = result.understood.find(item => item.key === 'time');
  assert.match(time.label, /только туда/);
  assert.equal(time.params.returnToStart, false);
});

test('one way: the micro-route has no leg back and ends with «закончите»', () => {
  const pois = ['1', '2', '3', '4'].map((n, index) => place(`osm:node:${n}`, { name: `Сквер ${n}`, lat: 51.12 + 0.0009 * (index + 1), category: index % 2 ? 'attraction' : 'park',
    tags: index % 2 ? { tourism: 'attraction' } : { leisure: 'park' } }));
  const route = recommend(pois, { ...start, minutes: 120, query: 'погулять маршрутом', returnToStart: false, visitDate: AT }).route;
  assert.ok(route, 'a route fits two hours');
  assert.equal(route.returnMinutes, 0);
  assert.equal(route.returnToStart, false);
  assert.match(route.summary, /закончите примерно к/);
  assert.doesNotMatch(route.summary, /обратно|вернётесь/);
});

test('up to four hours: 240 minutes are planned, 241 are not, in the engine, the tools and the agent API', async () => {
  assert.equal(MAX_MINUTES, 240);
  const park = place('osm:node:1', { lat: 51.1254 });
  assert.equal(recommend([park], { ...start, minutes: 240 }).constraints.minutes, 240);
  assert.throws(() => recommend([park], { ...start, minutes: 241 }), error => error.code === 'INVALID_INPUT' && /от 10 до 240/.test(error.message));
  const planned = await runTool('plan_walk', { lat: start.lat, lon: start.lon, minutes: 240, return_to_start: false }, { dataset: [park], now: new Date(AT) });
  assert.equal(planned.minutes, 240);
  assert.equal(planned.places[0].returnMinutes, 0);
  const agent = await handleApi(new Request('https://demo.example/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://demo.example' },
    body: JSON.stringify({ lat: start.lat, lon: start.lon, minutes: 241, query: 'парк' }) }), { LOCAL_DEVELOPMENT: true }, [park]);
  assert.equal(agent.status, 400);
  assert.equal((await agent.json()).error, 'Время прогулки: от 10 до 240 минут.');
});

test('one way through /api/recommend: the text without a model does not promise a way back', async () => {
  const park = place('osm:node:1', { lat: 51.1254 });
  const ask = returnToStart => handleApi(new Request('https://demo.example/api/recommend', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://demo.example' },
    body: JSON.stringify({ lat: start.lat, lon: start.lon, minutes: 60, maxWalkMinutes: 20, query: 'парк', returnToStart }) }), { LOCAL_DEVELOPMENT: true }, [park]).then(response => response.json());
  const one = await ask(false);
  assert.equal(one.recommendations[0].returnMinutes, 0);
  assert.match(one.generation.summary, /без обратной дороги/);
  assert.match((await ask(true)).generation.summary, /возвращение/);
});

test('phrases: «3 часа», «два с половиной часа», «2,5 ч», «4 часа» and «только туда» in three languages', () => {
  const cases = [
    ['3 часа, парк', 180, null, 'парк'], ['два с половиной часа кофе', 150, null, 'кофе'], ['2,5 часа у меги, только туда', 150, true, 'у меги'],
    ['2 часа 30 минут музей', 150, null, 'музей'], ['4 часа', 240, null, ''], ['у меня четыре часа', 240, null, ''],
    ['3 часа без возвращения', 180, true, ''], ['час у меги туда и обратно', 60, false, 'у меги'], ['на час, кофе и парк', 60, null, 'кофе и парк'],
    ['полтора часа', 90, null, ''], ['2.5 hours one way', 150, true, ''], ['four hours, round trip', 240, false, ''], ['two and a half hours coffee', 150, null, 'coffee'],
    ['екі жарым сағат саябақ', 150, null, 'саябақ'], ['төрт сағат', 240, null, ''], ['тек бару, 3 сағат', 180, true, ''],
  ];
  for (const [phrase, minutes, oneWay, query] of cases) assert.deepEqual(understand(phrase), { minutes, oneWay, query }, phrase);
  // Beyond four hours, or a number of hours inside a bigger number, is not a time budget.
  assert.equal(understand('5 часов').minutes, null);
  assert.equal(understand('12 часов').minutes, null);
  // «15 минут в одну сторону» is about the way there, not about coming back.
  assert.equal(understand('15 минут в одну сторону').oneWay, null);
  // Short follow-ups stay commands, not time budgets.
  assert.equal(understand('второй').minutes, null);
});

test('the reach ring is wider one way: the whole time minus a visit goes to the way there', () => {
  assert.ok(reachMeters(60, 60, 5, true) > reachMeters(60, 60, 5, false));
  assert.equal(reachMeters(60, 60, 5, true), reachMeters(100, 60, 5, false));
  // The walking limit still caps both.
  assert.equal(reachMeters(240, 15, 5, true), reachMeters(240, 15, 5, false));
});

// 12:00 in Astana; a one-way walk to a café 600 m east, eight minutes in, still on the way there, with half an hour planned on site.
const NOW = Date.parse('2026-10-21T07:00:00Z');
const START = { name: 'Байтерек', lat: 51.1283, lon: 71.4304, kind: 'preset' };
const oneWayWalk = {
  startedAt: NOW - 8 * 60000, promised: null, phase: 'there', phaseAt: { there: NOW - 8 * 60000 }, alerted: false, oneWay: true,
  place: { id: 'osm:node:1', name: 'Закрытая кофейня', category: 'cafe', lat: 51.1283, lon: 71.439 },
  start: START,
  plan: { there: 12, visit: 30, back: 0, reserve: 8, total: 50 },
};
const at = (east, north = 0) => ({ lat: START.lat + north / 111320, lon: START.lon + east / 69900 });
const hoursAt = (hours, arrival, visit) => checkVisit(hours, arrival, visit);

test('«Что-то пошло не так?» one way: a new place fits the way there and the visit before the same end time', () => {
  const here = at(600);
  // A café 1.1 km east of the start: no time to come back from it, but a one-way walk does not come back.
  const far = { id: 'cafe-far', name: 'cafe-far', category: 'cafe', ...at(1100, 120) };
  assert.equal(minutesLeft(oneWayWalk, NOW), 34);
  const found = alternatives(oneWayWalk, [oneWayWalk.place, far], { reason: 'closed', here, now: NOW, hoursAt });
  assert.deepEqual(found.options.map(option => option.place.id), ['cafe-far']);
  assert.equal(found.options[0].back, 0);
  const round = alternatives({ ...oneWayWalk, oneWay: false, plan: { ...oneWayWalk.plan, back: 12, total: 62 } }, [oneWayWalk.place, far], { reason: 'closed', here, now: NOW, hoursAt });
  assert.equal(round.options.length, 0);
  const next = switchTo(oneWayWalk, found.options[0], { here, now: NOW });
  assert.equal(next.oneWay, true);
  assert.equal(next.plan.back, 0);
  assert.equal(next.plan.there + next.plan.visit + next.plan.reserve, next.plan.total);
  // Running late on the way there: the visit gives the minutes back, the end time holds.
  const late = runLate(oneWayWalk, 15);
  assert.equal(late.kept, true);
  assert.equal(late.walk.plan.back, 0);
  assert.equal(late.walk.plan.there + late.walk.plan.visit, oneWayWalk.plan.there + oneWayWalk.plan.visit);
});
