// City events from the sxodim.com listing: dates as the site writes them, venues placed only from our own place base.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseWhen, cityEventsFor, upcomingEvents, CITY_EVENTS } from '../src/events.mjs';
import { handleApi } from '../src/api.mjs';
import { runTool } from '../src/tools.mjs';
import { modelView } from '../src/agent.mjs';

const places = JSON.parse(readFileSync(new URL('../data/places.json', import.meta.url), 'utf8'));
const pozitiv = { lat: 51.1640, lon: 71.4300 };
const evening = new Date('2026-10-22T19:30:00+05:00');

test('dates are read the way the listing writes them', () => {
  assert.deepEqual(parseWhen('31 октября в 17:00', 2026), { dates: ['2026-10-31'], time: '17:00' });
  assert.deepEqual(parseWhen('18 октября - 28 ноября', 2026), { from: '2026-10-18', to: '2026-11-28', time: null });
  assert.deepEqual(parseWhen('20 октября и 27 октября', 2026), { dates: ['2026-10-20', '2026-10-27'], time: null });
  assert.deepEqual(parseWhen('6 декабря - 27 января', 2026), { from: '2026-12-06', to: '2027-01-27', time: null }, 'a range across the new year');
  assert.deepEqual(parseWhen('18 - 20 октября в 20:00', 2026), { from: '2026-10-18', to: '2026-10-20', time: '20:00' }, 'days of one month');
  assert.deepEqual(parseWhen('20, 21 и 22 октября', 2026), { dates: ['2026-10-20', '2026-10-21', '2026-10-22'], time: null });
  assert.equal(parseWhen(null, 2026), null);
});

test('every event in the listing has its sxodim.com page, a date and a venue found in the place base', () => {
  assert.ok(CITY_EVENTS.length >= 20);
  const byId = new Map(places.map(place => [place.id, place]));
  for (const event of CITY_EVENTS) {
    assert.match(event.url, /^https:\/\/sxodim\.com\/astana\/event\//);
    assert.ok(event.when, event.title);
    const place = byId.get(event.placeId);
    assert.ok(place, `${event.title} is placed at a known place`);
    assert.equal(event.lat, place.lat); assert.equal(event.lon, place.lon);
  }
});

test('«Сегодня в городе» keeps today\'s events within walking reach, with the listing as source', () => {
  const events = cityEventsFor(CITY_EVENTS, { ...pozitiv, minutes: 120, maxWalkMinutes: 25, now: evening });
  assert.ok(events.length >= 1 && events.length <= 3);
  const timed = events.find(event => event.whenLabel === 'сегодня в 20:00');
  assert.ok(timed, 'the 20:00 stand-up next door');
  assert.equal(timed.startsInMinutes, 30);
  assert.equal(timed.fitsWindow, true);
  assert.ok(events.every(event => event.source === 'sxodim.com' && /уточняйте/.test(event.note) && event.walkMinutes <= 25));
  assert.equal(cityEventsFor(CITY_EVENTS, { ...pozitiv, minutes: 120, maxWalkMinutes: 25, now: new Date('2026-10-22T20:40:00+05:00') })
    .some(event => event.whenLabel === 'сегодня в 20:00'), false, 'an event that started long ago is gone');
  assert.deepEqual(cityEventsFor(CITY_EVENTS, { ...pozitiv, minutes: 120, maxWalkMinutes: 25, withChild: true, now: evening }), [], 'no bar or stand-up with a child');
  assert.deepEqual(cityEventsFor(CITY_EVENTS, { lat: 51.0269, lon: 71.4614, minutes: 120, now: evening }), [], 'nothing near the airport');
});

test('/api/recommend shows the block and tells Gemini the events with their source, without coordinates', async () => {
  const original = globalThis.fetch;
  let sent = null;
  globalThis.fetch = async (url, init) => {
    if (!String(url).includes(':generateContent')) return new Response('{}', { status: 503 });
    sent = JSON.parse(JSON.parse(init.body).contents[0].parts[0].text);
    return new Response('{}', { status: 503 });
  };
  try {
    const request = new Request('https://demo.example/api/recommend', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://demo.example' },
      body: JSON.stringify({ ...pozitiv, minutes: 120, maxWalkMinutes: 25, query: 'куда сходить вечером', visitDate: evening.toISOString() }) });
    const data = await (await handleApi(request, { GEMINI_API_KEY: 'g', LOCAL_DEVELOPMENT: true, RETRY_DELAY_MS: 0 }, places)).json();
    assert.equal(data.cityEvents.label, 'Сегодня в городе');
    assert.equal(data.cityEvents.source.label, 'sxodim.com');
    assert.ok(data.cityEvents.items.length >= 1);
    assert.ok(sent.cityEvents.length >= 1);
    assert.ok(sent.cityEvents.every(event => event.from === 'афиша sxodim.com' && event.lat === undefined && event.url === undefined));
  } finally { globalThis.fetch = original; }
});

test('/api/events lists the next days for the map, and plan_walk passes today\'s events to the agent', async () => {
  const data = await (await handleApi(new Request('https://demo.example/api/events?days=14'), {}, places)).json();
  assert.equal(data.source.label, 'sxodim.com');
  assert.ok(Array.isArray(data.events));
  assert.ok(upcomingEvents(CITY_EVENTS, { now: evening, days: 3 }).every(event => Number.isFinite(event.lat) && event.url));
  const plan = await runTool('plan_walk', { ...pozitiv, minutes: 120, query: 'куда сходить вечером', visit_time: evening.toISOString() }, { dataset: places, now: evening });
  assert.ok(plan.cityEvents?.length >= 1);
  const seen = modelView(plan).cityEvents[0];
  assert.equal(seen.from, 'афиша sxodim.com');
  assert.equal(seen.sourceUrl, undefined, 'Gemini gets no links');
});
