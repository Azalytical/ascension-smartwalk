// The Worker collects the sxodim.com listing itself: the card parser, the collection run in small alarm steps, and the
// fallback to the saved snapshot. The listing page here is a synthetic fixture (see its header), not a copy of the site.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseListing, splitInfo } from '../src/events-sxodim.mjs';
import { placeEvents, venueIndex, venueIndexData } from '../src/events-venues.mjs';
import { localCityEvents, cityEventsState, refreshCityEvents, LISTING_PAGES } from '../src/events-live.mjs';
import { CITY_EVENTS } from '../src/events.mjs';
import { handleApi } from '../src/api.mjs';
import { runTool } from '../src/tools.mjs';

const places = JSON.parse(readFileSync(new URL('../data/places.json', import.meta.url), 'utf8'));
const listing = readFileSync(new URL('./fixtures/sxodim-afisha.html', import.meta.url), 'utf8');
const morning = Date.parse('2026-10-22T05:50:00+05:00');
const evening = new Date('2026-10-22T19:30:00+05:00');
const pozitiv = { lat: 51.1640, lon: 71.4300 };

test('listing cards are read by their links and content, not by class names', () => {
  const rows = parseListing(listing);
  assert.equal(rows.length, 8, 'six cards, the banner and the footer link; nothing from the script');
  assert.ok(!rows.some(row => row.url.endsWith('/not-a-card')));
  assert.deepEqual(rows[1], { title: 'Uly Dala Fest', category: 'Фестивали', dateText: '31 октября в 17:00', price: 'от 10 000 тенге',
    venue: 'Дворец единоборств имени Ж. Ушкемпирова', address: 'пр. Кабанбай батыра, 43', url: 'https://sxodim.com/astana/event/uly-dala-fest' });
  assert.equal(rows[2].title, 'Сборный стендап (Stand Up Bar «Pozitiv»)', 'entities decoded');
  assert.equal(rows[2].category, 'Стендап 18+', 'the age mark stays with the category');
  assert.equal(rows[3].venue, 'Abu Dhabi Plaza, Practic Office', 'a comma inside the venue name');
  assert.equal(rows[3].address, 'ул. Сыганак, 60/4, 26-й этаж');
  assert.deepEqual([rows[4].venue, rows[4].address, rows[4].dateText, rows[4].price], ['Nova', 'улица Достык, 3', '11 декабря в 20:00', 'от 25 000 теңге'],
    'one comma-separated line');
  assert.equal(rows[5].dateText, '18 - 20 октября в 20:00');
  assert.deepEqual([rows[6].price, rows[6].dateText], ['бесплатно', '20, 21 и 22 октября']);
  assert.equal(rows[0].dateText, null, 'the banner has no date');
  assert.deepEqual(parseListing('<html><body>Технические работы</body></html>'), []);
});

test('the text of a card splits into date, price, venue and address', () => {
  assert.deepEqual(splitInfo(['Место сбора: ТРЦ Хан Шатыр, 22 октября в 11:00']),
    { age: null, dateText: '22 октября в 11:00', price: null, venue: null, address: 'Место сбора: ТРЦ Хан Шатыр' });
  assert.deepEqual(splitInfo(['от 3000 до 5000 тенге', '25 октября', 'Astana Opera']),
    { age: null, dateText: '25 октября', price: 'от 3000 до 5000 тенге', venue: 'Astana Opera', address: null });
  assert.equal(splitInfo(['5 000 ₸', '1 ноября в 19:00', 'Bar 1', 'Кабанбай батыра 43']).address, 'Кабанбай батыра 43');
});

test('venues are placed from the place base, the same with the index the Worker bundle carries', () => {
  const rows = parseListing(listing).filter(row => row.dateText);
  const events = placeEvents(rows, places, { collectedAt: '2026-10-22' });
  const at = title => events.find(event => event.title.startsWith(title));
  assert.equal(at('Сборный стендап').located, 'address');
  assert.equal(at('Встреча с Канатом').located, 'name');
  assert.equal(at('Uly Dala').lat, undefined, 'a venue missing from the base stays off the map');
  const copy = structuredClone(places);
  venueIndex(copy, JSON.parse(JSON.stringify(venueIndexData(places))));
  assert.deepEqual(placeEvents(rows, copy, { collectedAt: '2026-10-22' }), events);
});

function sxodim(pages) {
  const asked = [];
  const fetcher = async url => {
    asked.push(String(url));
    const path = String(url).replace('https://sxodim.com/astana/', '');
    return pages[path] ? new Response(pages[path], { headers: { 'Content-Type': 'text/html' } }) : new Response('Not found', { status: 404 });
  };
  return { asked, fetcher };
}
async function collect(store) {
  for (let steps = 0; store.storage.alarmAt !== null; steps++) {
    assert.ok(steps < 60, 'the run ends');
    store.storage.alarmAt = null;
    await store.alarm();
  }
}

test('a collection run reads the listing page by page and the site, walks and the agent use it', async () => {
  // The concerts page lists the same cards under other event pages: six more events.
  const { asked, fetcher } = sxodim({ afisha: listing, 'events/kontserty': listing.replace(/\/astana\/event\/([a-z0-9-]+)/g, '/astana/event/$1-2') });
  const store = localCityEvents({ manual: true, fetcher, places, now: morning });
  const env = { CITY_EVENTS_LOCAL: store };
  assert.deepEqual(await refreshCityEvents(env), { started: true });
  assert.deepEqual(await refreshCityEvents(env), { started: false }, 'one run at a time');
  await collect(store);
  assert.equal(asked.filter(url => url.includes('afisha')).length, 2, 'paging stops at the first page with nothing new');
  assert.equal(asked.length, 2 + LISTING_PAGES.filter(path => !path.startsWith('afisha')).length);
  assert.ok(asked.every(url => url.startsWith('https://sxodim.com/astana/')));

  const data = await (await handleApi(new Request('https://demo.example/api/events?days=14'), env, places)).json();
  assert.equal(data.mode, 'live');
  assert.equal(data.fetchedAt, new Date(morning).toISOString());
  assert.equal(data.collectedAt, '2026-10-22');
  assert.deepEqual(data.collection.lastAttempt.stats, { pages: 8, failedPages: 6, cards: 16, dated: 12, located: 8 });
  assert.ok(data.events.some(event => event.title === 'Квиз, плиз! (новички) #804'));

  const request = new Request('https://demo.example/api/recommend', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://demo.example' },
    body: JSON.stringify({ ...pozitiv, minutes: 120, maxWalkMinutes: 25, query: 'куда сходить вечером', visitDate: evening.toISOString() }) });
  const walk = await (await handleApi(request, { ...env, LOCAL_DEVELOPMENT: true }, places)).json();
  assert.equal(walk.cityEvents.mode, 'live');
  assert.equal(walk.cityEvents.fetchedAt, new Date(morning).toISOString());
  assert.ok(walk.cityEvents.items.some(event => event.title.startsWith('Сборный стендап')));

  const plan = await runTool('plan_walk', { ...pozitiv, minutes: 120, query: 'куда сходить вечером', visit_time: evening.toISOString() }, { env, dataset: places, now: evening });
  assert.ok(plan.cityEvents.some(event => event.title.startsWith('Сборный стендап')));
});

test('when the site refuses, the walk keeps the saved snapshot and the failure is visible', async () => {
  const { asked, fetcher } = sxodim({});
  const refuse = async url => { await fetcher(url); return new Response('Forbidden', { status: 403 }); };
  const store = localCityEvents({ manual: true, fetcher: refuse, places, now: morning });
  const env = { CITY_EVENTS_LOCAL: store };
  const first = await cityEventsState(env);
  assert.equal(first.mode, 'snapshot', 'nothing collected yet');
  assert.notEqual(store.storage.alarmAt, null, 'the first visit starts a collection');
  await collect(store);
  assert.equal(asked.length, 2, 'two refusals end the run');
  const data = await (await handleApi(new Request('https://demo.example/api/events'), { CITY_EVENTS_LOCAL: store }, places)).json();
  assert.equal(data.mode, 'snapshot');
  assert.equal(data.collectedAt, '2026-10-20');
  assert.equal(data.collection.lastAttempt.ok, false);
  assert.equal(data.collection.lastAttempt.problem, 'http_403');
  await cityEventsState({ CITY_EVENTS_LOCAL: store });
  assert.equal(store.storage.alarmAt, null, 'no new run within the hour after a failed one');
});

test('a run that finds too little keeps the last good listing', async () => {
  const pages = { afisha: listing };
  const store = localCityEvents({ manual: true, fetcher: sxodim(pages).fetcher, places, now: morning });
  await refreshCityEvents({ CITY_EVENTS_LOCAL: store });
  await collect(store);
  const good = await store.storage.get('live');
  pages.afisha = '<html><body><a href="/astana/event/odno">Одно событие</a> 22 октября</body></html>';
  store.options.now = morning + 86400000;
  await refreshCityEvents({ CITY_EVENTS_LOCAL: store });
  await collect(store);
  assert.deepEqual(await store.storage.get('live'), good);
  const status = await store.storage.get('status');
  assert.equal(status.ok, false);
  assert.equal(status.problem, 'too_few_events');
});

test('a slow store never holds up a walk: the snapshot is used', async () => {
  const env = { CITY_EVENTS_LOCAL: { fetch: () => new Promise(() => {}) } };
  const state = await cityEventsState(env, { timeoutMs: 20 });
  assert.equal(state.mode, 'snapshot');
  assert.equal(state.events, CITY_EVENTS);
  assert.equal((await cityEventsState({})).mode, 'snapshot', 'no store at all');
});
