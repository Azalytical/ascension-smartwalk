// The hackathon task's own scenarios (case 1, НИЦ Smart City) on the full place base, plus the intents behind them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recommend } from '../src/retrieval.mjs';
import { queryIntents, nightReference } from '../src/intent.mjs';
import { weatherCondition, currentWeather, resetWeatherCache } from '../src/weather.mjs';
import { handleApi } from '../src/api.mjs';

const places = JSON.parse(readFileSync(new URL('../data/places.json', import.meta.url), 'utf8'));
const at = { mega: [51.0880152, 71.4097489], baiterek: [51.1283, 71.4304], embankment: [51.161, 71.423], expo: [51.0896, 71.416] };
const ask = (where, body, context) => recommend(places, { lat: at[where][0], lon: at[where][1], ...body }, context);
const categories = result => result.recommendations.map(place => place.category);

test('PDF: «возле Mega Silk Way, прогуляться 30–60 минут» gives walks that fit the hour', () => {
  const result = ask('mega', { minutes: 60, maxWalkMinutes: 20, query: 'Я сейчас возле Mega Silk Way, хочу прогуляться 30–60 минут — что посоветуете?', visitDate: '2026-10-22T18:00:00+05:00' });
  assert.equal(result.recommendations.length, 3);
  assert.ok(categories(result).every(category => ['park', 'attraction'].includes(category)));
  assert.ok(result.recommendations.every(place => place.totalMinutes <= 60 && place.why.includes('из ваших 60')));
});

test('PDF: «тихое место с кофе и розеткой недалеко» stays with cafes and never claims sockets', () => {
  const result = ask('baiterek', { minutes: 60, maxWalkMinutes: 15, query: 'Хочу тихое место с кофе и розеткой недалеко от меня.', visitDate: '2026-10-22T15:00:00+05:00' });
  // «недалеко» contains «еда» and once pulled in restaurants.
  assert.deepEqual([...new Set(categories(result))], ['cafe']);
  assert.ok(result.recommendations.every(place => place.warnings.some(warning => warning.includes('розеток не подтверждено'))));
  assert.ok(result.understood.some(item => item.key === 'quiet'));
});

test('PDF: «с ребёнком — площадки или музей» keeps museums allowed and reads the child from the words alone', () => {
  const body = { minutes: 90, maxWalkMinutes: 15, query: 'Еду с ребёнком — где рядом есть детские площадки или музей с интерактивами?', visitDate: '2026-10-22T12:00:00+05:00' };
  const result = ask('baiterek', body);
  assert.ok(result.recommendations.length >= 2);
  assert.ok(result.retrieval.requestedCategories.includes('museum'));
  assert.ok(categories(result).every(category => ['playground', 'museum', 'park', 'family'].includes(category)));
  assert.equal(result.constraints.withChild, true);
  assert.equal(result.constraints.withChildFromQuery, true);
  const museum = recommend([{ id: 'osm:node:9', name: 'Музей', category: 'museum', lat: 51.1285, lon: 71.4306, sourceUrl: 'https://www.openstreetmap.org/node/9' }],
    { lat: 51.1283, lon: 71.4304, ...body, withChild: true });
  assert.equal(museum.recommendations[0]?.category, 'museum');
});

test('PDF: «турист, 2 часа перед вылетом» puts sights first, Байтерек at Байтерек', () => {
  const result = ask('baiterek', { minutes: 120, maxWalkMinutes: 30, query: 'Я турист, у меня 2 часа перед вылетом: что можно посмотреть поблизости?', visitDate: '2026-10-22T14:00:00+05:00' });
  assert.equal(result.recommendations[0].name, 'Бәйтерек');
  assert.ok(categories(result).every(category => ['attraction', 'museum', 'park'].includes(category)));
  assert.ok(result.route, 'two hours fit a three-stop micro-route');
});

test('PDF: «необычная ночная активность» at 23:30 suggests no playground and nothing indoors without hours', () => {
  const result = ask('embankment', { minutes: 120, maxWalkMinutes: 20, query: 'Ищу необычную ночную активность (последние пару часов).', visitDate: '2026-10-22T23:30:00+05:00' });
  assert.ok(result.recommendations.length >= 2);
  for (const place of result.recommendations) {
    assert.ok(!['playground', 'family'].includes(place.category), place.name);
    if (!['park', 'attraction'].includes(place.category)) assert.equal(place.hoursCheck.status, 'open', place.name);
    assert.ok(!/(^|[^\p{L}])БК(?=[^\p{L}]|$)|FairPlay/u.test(place.name), `betting shop suggested: ${place.name}`);
  }
  assert.ok(categories(result).includes('nightlife') || categories(result).includes('culture'));
  assert.ok(result.retrieval.rejected.unknownHoursAtNight > 0);
});

test('PDF example: «у Экспо, необычное на 1–2 часа» starts with the museum next door', () => {
  const result = ask('expo', { minutes: 120, maxWalkMinutes: 30, query: 'Я у здании Экспо 2017, хочу что-то необычное на 1–2 часа, пешком.', visitDate: '2026-10-22T17:00:00+05:00' });
  assert.match(result.recommendations[0].name, /Nur Alem/);
  assert.ok(!result.recommendations.some(place => place.category === 'restaurant'));
});

test('every card carries a confidence level, a plan, and labels that tell data from ideas', () => {
  const result = ask('mega', { minutes: 90, maxWalkMinutes: 15, query: 'кофе', visitDate: '2026-10-22T15:00:00+05:00' });
  for (const place of result.recommendations) {
    assert.ok(['high', 'medium', 'low'].includes(place.confidence.level));
    assert.equal(place.confidence.basis, 'data_completeness');
    assert.equal(place.provenance.facts.origin, 'poi_data');
    assert.equal(place.provenance.activities.origin, 'generated_idea');
    assert.match(place.plan.text, /^План: \d+ мин пешком до «/);
    assert.ok(place.plan.backAt);
  }
  // Hours that cover the whole visit raise the level; a nameless place without hours lowers it.
  assert.equal(result.recommendations.find(place => place.hoursCheck.status === 'open')?.confidence.level, 'high');
  const nameless = recommend([{ id: 'x', name: 'Кафе', nameIsGenerated: true, category: 'cafe', lat: 51.12, lon: 71.42, sourceUrl: 'https://www.openstreetmap.org/node/7' }],
    { lat: 51.12, lon: 71.42, minutes: 60 });
  assert.equal(nameless.recommendations[0].confidence.level, 'low');
});

test('the answer states what it used: start, time, categories, child, hours', () => {
  const result = ask('baiterek', { minutes: 60, maxWalkMinutes: 15, query: 'с ребёнком в парк', visitDate: '2026-10-22T12:00:00+05:00' });
  const keys = result.understood.map(item => item.key);
  for (const key of ['location', 'time', 'categories', 'child', 'hours']) assert.ok(keys.includes(key), key);
  assert.ok(result.understood.find(item => item.key === 'location').label.includes('не сохраняется'));
});

test('micro-route: three named places in order, inside the budget, with clock times', () => {
  const result = ask('baiterek', { minutes: 120, maxWalkMinutes: 20, query: 'маршрут по достопримечательностям', visitDate: '2026-10-22T14:00:00+05:00' });
  const { route } = result;
  assert.equal(route.stops.length, 3);
  assert.equal(new Set(route.stops.map(stop => stop.id)).size, 3);
  assert.ok(route.totalMinutes <= 120);
  assert.equal(route.totalMinutes, route.walkMinutes + route.visitMinutes + route.reserveMinutes);
  assert.equal(route.walkMinutes, route.stops.reduce((sum, stop) => sum + stop.walkFromPreviousMinutes, 0) + route.returnMinutes);
  assert.ok(route.stops.every(stop => /^\d\d:\d\d$/.test(stop.arriveAt)));
  assert.equal(recommend(places, { lat: 51.1283, lon: 71.4304, minutes: 30, maxWalkMinutes: 10 }).route, null);
});

test('wheelchair: places tagged wheelchair=no are dropped, wheelchair=yes go first', () => {
  const base = { category: 'cafe', lat: 51.12, lon: 71.42, sourceUrl: 'https://www.openstreetmap.org/node/' };
  const pois = [{ ...base, id: 'a', name: 'А', tags: { amenity: 'cafe', wheelchair: 'no' }, sourceUrl: base.sourceUrl + 1 },
    { ...base, id: 'b', name: 'Б', lat: 51.1201, tags: { amenity: 'cafe' }, sourceUrl: base.sourceUrl + 2 },
    { ...base, id: 'c', name: 'В', lat: 51.123, tags: { amenity: 'cafe', wheelchair: 'yes' }, sourceUrl: base.sourceUrl + 3 }];
  const result = recommend(pois, { lat: 51.12, lon: 71.42, minutes: 60, query: 'кофе, я на коляске' });
  assert.deepEqual(result.recommendations.map(place => place.id), ['c', 'b']);
  assert.equal(result.retrieval.rejected.notAccessible, 1);
  assert.ok(result.recommendations[0].warnings.some(warning => warning.includes('wheelchair=yes')));
});

test('a group of four is warned about seats and steered away from fast food', () => {
  const result = ask('baiterek', { minutes: 90, maxWalkMinutes: 20, query: 'Нас четверо друзей, хотим поужинать', visitDate: '2026-10-22T19:00:00+05:00' });
  assert.equal(result.constraints.groupSize, 4);
  assert.ok(result.recommendations.every(place => place.warnings.some(warning => warning.includes('для 4 человек'))));
  assert.ok(!result.recommendations.some(place => /KFC|Hardee|Burger King/.test(place.name)));
});

test('nothing in range: the nearest matching place and the time it needs are offered', () => {
  const result = ask('baiterek', { minutes: 120, maxWalkMinutes: 30, query: 'I want to see a museum nearby', visitDate: '2026-10-22T15:00:00+05:00' });
  if (result.recommendations.length) return;
  assert.ok(result.nearestBeyondLimits?.name);
  assert.ok(result.nearestBeyondLimits.walkMinutes > 30);
  assert.ok(result.warnings.some(warning => warning.startsWith('Ближе всего подходит')));
});

test('intents read ru, kk and en and ignore negations', () => {
  assert.equal(queryIntents('мы с ребёнком').child, true);
  assert.equal(queryIntents('баламен серуендеу').child, true);
  assert.equal(queryIntents('баланс карты').child, false);
  assert.equal(queryIntents('late night bar').bar, true);
  assert.equal(queryIntents('без баров').bar, false);
  assert.equal(queryIntents('нас пятеро').groupSize, 5);
  assert.equal(queryIntents('на 6 человек, с друзьями').groupSize, 6);
  assert.equal(queryIntents('Я на коляске').accessible, true);
  assert.equal(queryIntents('Сделай маршрут из трёх мест').route, true);
  // A night request at 15:00 local time is checked against 22:00 tonight.
  assert.equal(nightReference(new Date('2026-10-22T10:00:00Z')).toISOString(), '2026-10-22T17:00:00.000Z');
  assert.equal(nightReference(new Date('2026-10-22T18:30:00Z')), null);
});

test('weather: rain or hard frost now sends a plain request under a roof, and says so', () => {
  assert.equal(weatherCondition({ temperatureC: 4, precipitationMm: 1.2, code: 61 }).label, 'дождь');
  assert.equal(weatherCondition({ temperatureC: -18, precipitationMm: 0, code: 0 }).label, 'сильный мороз');
  assert.equal(weatherCondition({ temperatureC: 12, precipitationMm: 0, code: 1 }).bad, false);
  const rain = { temperatureC: 3, precipitationMm: 2, snowfallCm: 0, windKmh: 10, code: 63, source: 'Open-Meteo' };
  const result = recommend(places, { lat: at.mega[0], lon: at.mega[1], minutes: 60, maxWalkMinutes: 15, query: 'куда сходить?' }, { weather: rain });
  assert.ok(result.recommendations.length);
  assert.ok(result.recommendations.every(place => ['mall', 'museum', 'cafe', 'restaurant', 'culture'].includes(place.category)));
  assert.ok(result.understood.some(item => item.key === 'weather' && item.label.includes('дождь')));
  assert.equal(result.weather.roofOnly, true);
  // An explicit wish for a park is kept, with a weather note instead.
  const park = recommend(places, { lat: at.mega[0], lon: at.mega[1], minutes: 60, maxWalkMinutes: 20, query: 'парк' }, { weather: rain });
  assert.ok(park.recommendations.every(place => place.category === 'park'));
  assert.ok(park.warnings.some(warning => warning.includes('Open-Meteo')));
});

test('weather lookup is opt-in, cached, and a failure means unknown', async () => {
  resetWeatherCache();
  let calls = 0;
  const ok = async () => { calls++; return new Response(JSON.stringify({ current: { time: '2026-10-20T10:00', temperature_2m: -3.4, precipitation: 0, snowfall: 0.4, weather_code: 73, wind_speed_10m: 12 } })); };
  assert.equal(await currentWeather({}, ok), null);
  const weather = await currentWeather({ WEATHER: '1' }, ok, 1000);
  assert.equal(weather.temperatureC, -3.4);
  assert.equal(weatherCondition(weather).text, '−3 °C, снег');
  await currentWeather({ WEATHER: '1' }, ok, 2000);
  assert.equal(calls, 1);
  resetWeatherCache();
  assert.equal(await currentWeather({ WEATHER: '1' }, async () => { throw new Error('offline'); }, 3000), null);
  resetWeatherCache();
});

test('API never takes weather from the request body', async () => {
  const poi = { id: 'node/1', name: 'Парк', lat: 51.1283, lon: 71.4304, category: 'park', tags: { leisure: 'park' }, sourceUrl: 'https://www.openstreetmap.org/node/1' };
  const response = await handleApi(new Request('https://demo.example/api/recommend', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://demo.example' },
    body: JSON.stringify({ lat: 51.1283, lon: 71.4304, minutes: 45, query: 'куда сходить', weather: { temperatureC: -30 } }) }), {}, [poi]);
  const data = await response.json();
  assert.equal(data.weather, null);
  assert.equal(data.recommendations[0].category, 'park');
});
