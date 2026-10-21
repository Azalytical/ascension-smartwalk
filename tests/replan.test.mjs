// «Что-то пошло не так?» on the walk screen (public/js/core/replan.js): a new plan keeps the promised time back,
// and when nothing fits the person is told how late turning back now would make them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { alternatives, switchTo, turnBack, runLate, whereNow, minutesLeft } from '../public/js/core/replan.js';
import { checkVisit } from '../src/hours.mjs';

// 12:00 in Astana (UTC+5) on a Wednesday.
const NOW = Date.parse('2026-10-21T07:00:00Z');
const START = { name: 'Байтерек', lat: 51.1283, lon: 71.4304, kind: 'preset' };
// A café about 600 m east of the start; the walk began 8 minutes ago and is on the way there.
const walk = {
  startedAt: NOW - 8 * 60000, promised: null, phase: 'there', phaseAt: { there: NOW - 8 * 60000 }, alerted: false,
  place: { id: 'osm:node:1', name: 'Закрытая кофейня', category: 'cafe', lat: 51.1283, lon: 71.439 },
  start: START,
  plan: { there: 12, visit: 20, back: 12, reserve: 16, total: 60 },
};
const at = (east, north = 0) => ({ lat: START.lat + north / 111320, lon: START.lon + east / 69900 });
const place = (id, category, metresEast, extra = {}) => ({ id, name: id, category, ...at(metresEast, 120), ...extra });
const hoursAt = (hours, arrival, visit) => checkVisit(hours, arrival, visit);
const here = at(600);

test('a closed café is replaced by a café that fits before the promised time; a 45-minute restaurant does not fit', () => {
  const items = [
    walk.place,
    place('cafe-near', 'cafe', 500),
    place('cafe-shut', 'cafe', 550, { openingHours: 'Mo-Su 18:00-23:00' }),
    place('cafe-far', 'cafe', 2600),
    place('restaurant', 'restaurant', 560, { openingHours: 'Mo-Su 10:00-22:00' }),
    place('park', 'park', 520),
  ];
  const found = alternatives(walk, items, { reason: 'closed', here, now: NOW, hoursAt });
  assert.equal(found.left, 36);
  assert.deepEqual(found.options.map((option) => option.place.id), ['cafe-near']);
  for (const option of found.options) assert.ok(option.there + option.visit + option.back <= found.left);
  // A closed park is replaced by another park first, then by a sight in the open air; not by a playground.
  const park = { ...walk, place: { ...walk.place, category: 'park' } };
  const parks = alternatives(park, [place('sight', 'attraction', 510), place('park-near', 'park', 530), place('playground', 'playground', 505)], { reason: 'closed', here, now: NOW, hoursAt });
  assert.deepEqual(parks.options.map((option) => option.place.id), ['park-near', 'sight']);
});

test('in the rain only places under a roof are offered, open ones first', () => {
  const items = [place('park', 'park', 500), place('mall', 'mall', 700), place('museum', 'museum', 520, { openingHours: 'Mo-Su 10:00-18:00' }),
    place('shut', 'museum', 510, { openingHours: 'Mo-Su 14:00-18:00' })];
  const long = { ...walk, plan: { there: 12, visit: 60, back: 12, reserve: 6, total: 90 } };
  const found = alternatives(long, items, { reason: 'rain', here, now: NOW, hoursAt });
  assert.deepEqual(found.options.map((option) => option.place.id), ['museum', 'mall']);
  assert.equal(found.options[0].open, true);
});

test('switching keeps the promised time and the reserve end, and the leg starts where the person is', () => {
  const promisedBack = walk.startedAt + (12 + 20 + 12) * 60000;
  const [option] = alternatives(walk, [place('cafe-near', 'cafe', 500)], { reason: 'closed', here, now: NOW, hoursAt }).options;
  const next = switchTo(walk, option, { here, now: NOW });
  const back = next.startedAt + (next.plan.there + next.plan.visit + next.plan.back) * 60000;
  assert.ok(back <= promisedBack, 'back no later than promised');
  assert.equal(next.plan.total, 60);
  assert.equal(next.plan.reserve, next.plan.total - next.plan.there - next.plan.visit - next.plan.back);
  assert.equal(next.place.id, 'cafe-near');
  assert.deepEqual(next.from, here);
  assert.deepEqual(next.skipped, ['osm:node:1']);
  // The «there» leg left counts from now: elapsed minutes are already in plan.there.
  assert.equal(next.plan.there - (NOW - next.phaseAt.there) / 60000, option.there);
  // The closed café is not offered again.
  assert.equal(alternatives(next, [walk.place], { reason: 'closed', here, now: NOW, hoursAt }).options.length, 0);
});

test('with nothing that fits, the answer is when turning back now gets the person home', () => {
  const late = { ...walk, startedAt: NOW - 40 * 60000, phaseAt: { there: NOW - 40 * 60000 } };
  const far = at(3000);
  const found = alternatives(late, [place('cafe-near', 'cafe', 500)], { reason: 'closed', here: far, now: NOW, hoursAt });
  assert.equal(found.options.length, 0);
  assert.equal(minutesLeft(late, NOW), 4);
  assert.ok(found.backNow > 4);
  assert.equal(found.lateBy, found.backNow - 4);
  const turned = turnBack(late, { here: far, now: NOW });
  assert.equal(turned.phase, 'back');
  assert.deepEqual(turned.backFrom, far);
  assert.equal(turned.plan.back, found.backNow);
  assert.equal(turned.plan.visit, 0);
});

test('running late on the way takes the minutes from the visit first, so the time back holds', () => {
  const kept = runLate(walk, 15);
  assert.equal(kept.kept, true);
  assert.equal(kept.walk.plan.visit, 5);
  assert.equal(kept.walk.plan.there + kept.walk.plan.visit + kept.walk.plan.back, 44);
  const short = runLate({ ...walk, plan: { ...walk.plan, visit: 10, reserve: 26 } }, 15);
  assert.equal(short.kept, false);
  assert.equal(short.later, 5);
  assert.equal(short.over, 0);
  // On site, more time there moves the return; past the reserve it says by how much.
  const onSite = runLate({ ...walk, phase: 'visit', plan: { ...walk.plan, reserve: 5, total: 49 } }, 15);
  assert.equal(onSite.later, 15);
  assert.equal(onSite.over, 10);
  assert.equal(onSite.walk.alerted, false);
});

test('without a fix the person is placed along the current leg, and at the place once there', () => {
  const half = whereNow({ ...walk, startedAt: NOW - 6 * 60000 }, NOW);
  assert.ok(Math.abs(half.lon - (START.lon + walk.place.lon) / 2) < 1e-6);
  assert.deepEqual(whereNow({ ...walk, phase: 'visit' }, NOW), { lat: walk.place.lat, lon: walk.place.lon });
  assert.deepEqual(whereNow(walk, NOW, { lat: 1, lon: 2, at: NOW - 1000 }), { lat: 1, lon: 2 });
  // A fix older than two minutes is not trusted.
  assert.notDeepEqual(whereNow(walk, NOW, { lat: 1, lon: 2, at: NOW - 300000 }), { lat: 1, lon: 2 });
});
