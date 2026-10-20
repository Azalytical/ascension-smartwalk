// The hackathon task's own scenarios (case 1, НИЦ Smart City) on the full place base, plus the intents behind them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recommend, notabilityFor } from '../src/retrieval.mjs';
import { runAgent } from '../src/agent.mjs';
import { limitedJson, answerLanguage, UNSUPPORTED } from '../src/api.mjs';
import { queryIntents, nightReference } from '../src/intent.mjs';
import { weatherCondition, currentWeather, resetWeatherCache } from '../src/weather.mjs';
import { handleApi } from '../src/api.mjs';
import { runTool } from '../src/tools.mjs';

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

test('jury v2: nameless «Фонтан» drops out of the Mega walk, nameless playgrounds carry a nearby name', () => {
  const walk = ask('mega', { minutes: 60, maxWalkMinutes: 20, query: 'Я сейчас возле Mega Silk Way, хочу прогуляться 30–60 минут — что посоветуете?', visitDate: '2026-10-22T18:00:00+05:00' });
  assert.ok(walk.recommendations.every(place => !place.nameIsGenerated));
  const child = ask('baiterek', { minutes: 90, maxWalkMinutes: 15, withChild: true, query: 'Еду с ребёнком — где рядом есть детские площадки или музей с интерактивами?', visitDate: '2026-10-22T12:00:00+05:00' });
  assert.equal(child.recommendations[0].nameIsGenerated, undefined);
  for (const place of child.recommendations.filter(item => item.nameIsGenerated)) {
    assert.match(place.name, /^Детская площадка у «.+»$/);
    assert.ok(place.landmark.distanceMeters <= 250);
    assert.ok(place.warnings.some(warning => warning.includes(`подписали по ближайшему месту «${place.landmark.name}»`)));
  }
  assert.equal(new Set(child.recommendations.map(place => place.name)).size, child.recommendations.length);
});

test('jury v2: a named category that does not fit gets the nearest one and the time it needs', () => {
  const child = ask('baiterek', { minutes: 90, maxWalkMinutes: 15, withChild: true, query: 'Еду с ребёнком — где рядом есть детские площадки или музей с интерактивами?', visitDate: '2026-10-22T12:00:00+05:00' });
  const museum = child.nearestMissing.find(item => item.category === 'museum');
  assert.ok(museum.walkMinutes > 15);
  assert.ok(child.warnings[0].startsWith(`Музей в ваше время не помещается: ближайший вариант «${museum.name}»`));
  const empty = ask('baiterek', { minutes: 120, maxWalkMinutes: 30, query: 'I want to see a museum nearby', visitDate: '2026-10-22T15:00:00+05:00' });
  assert.ok(empty.warnings[0].startsWith('Ближе всего подходит'));
  assert.ok(empty.warnings[0].includes(`Разрешите до ${empty.nearestBeyondLimits.walkMinutes} мин пешком`));
});

test('jury v2: one record mapped twice is shown once, two cafes in one mall both stay', () => {
  const sights = ask('baiterek', { minutes: 120, maxWalkMinutes: 20, query: 'Составь маршрут по достопримечательностям на 2 часа', visitDate: '2026-10-22T14:00:00+05:00' });
  const fountains = sights.recommendations.filter(place => /субұрқақ|фонтан/i.test(place.name));
  assert.ok(fountains.length <= 1);
  const coffee = ask('mega', { minutes: 45, maxWalkMinutes: 15, query: 'Маған жақын жерде кофе ішкім келеді', visitDate: '2026-10-22T15:00:00+05:00' });
  assert.ok(coffee.recommendations.some(place => place.name === 'Starbucks'));
  assert.ok(coffee.recommendations.find(place => place.name === 'Starbucks').why.includes('по данным источника: кофейня'));
});

test('jury v2: a mini-route has at most one place to eat unless food is the request', () => {
  const food = ['cafe', 'restaurant', 'nightlife'];
  for (const [where, query] of [['baiterek', 'Я на коляске, нужно доступное место без ступенек'], ['baiterek', 'Куда сходить на полтора часа?'], ['mega', 'Погулять 90 минут']]) {
    const route = ask(where, { minutes: 90, maxWalkMinutes: 15, query, visitDate: '2026-10-22T15:00:00+05:00' }).route;
    if (route) assert.ok(route.stops.filter(stop => food.includes(stop.category)).length <= 1, query);
  }
});

test('jury v3: a company gets places whose format suits it, and the «why» names that format from the source', () => {
  at.khan = [51.1324, 71.4036];
  const result = ask('khan', { minutes: 90, maxWalkMinutes: 20, query: 'Нас четверо друзей, хотим поужинать', visitDate: '2026-10-22T19:00:00+05:00' });
  const first = result.recommendations[0];
  assert.match(first.why, /для компании из 4 по данным источника: (пицца|гриль|стейки|караоке|фудкорт|тематический ресторан|грузинская кухня|местная кухня|казахская кухня|узбекская кухня)/);
  assert.ok(first.scoreBreakdown.intent >= 13);
  assert.ok(result.recommendations.every(place => !/для компании/.test(place.why) || place.why.split('для компании').length === 2));
});

test('jury v3: «поужинать и погулять» keeps food on the cards and adds a walk to the mini-route', () => {
  const result = ask('khan', { minutes: 90, maxWalkMinutes: 20, query: 'Нас четверо друзей, хотим поужинать и погулять', visitDate: '2026-10-22T19:00:00+05:00' });
  assert.deepEqual(result.retrieval.requestedCategories, ['restaurant', 'park', 'attraction']);
  assert.deepEqual(categories(result), ['restaurant', 'restaurant', 'restaurant']);
  assert.ok(result.route.stops.some(stop => ['park', 'attraction'].includes(stop.category)));
  assert.equal(result.route.stops.filter(stop => stop.category === 'restaurant').length, 1);
});

test('jury v3: a tourist with few sights in walking range is told the nearest one beyond it needs transport', () => {
  at.airport = [51.0269, 71.4614];
  const result = ask('airport', { minutes: 120, maxWalkMinutes: 30, query: 'Я турист, у меня 2 часа перед вылетом: что можно посмотреть поблизости?', visitDate: '2026-10-22T14:00:00+05:00' });
  assert.ok(result.recommendations.length > 0 && result.recommendations.length < 3);
  assert.match(result.warnings[0], /^Пешком отсюда мест для осмотра мало\. Ближайшее за пределами вашего времени: «[^»]+», около [\d,]+ км по прямой, примерно \d+ мин пешком в одну сторону\. Дальше нужен транспорт/);
  const baiterek = ask('baiterek', { minutes: 120, maxWalkMinutes: 30, query: 'Я турист, у меня 2 часа перед вылетом: что можно посмотреть поблизости?', visitDate: '2026-10-22T14:00:00+05:00' });
  assert.ok(!baiterek.warnings.some(warning => warning.startsWith('Пешком отсюда мест для осмотра мало')));
});

test('jury v4: two nameless playgrounds by the same landmark never read as one place listed twice', () => {
  const result = ask('mega', { minutes: 90, maxWalkMinutes: 15, withChild: true, query: 'С ребёнком: площадка или музей с интерактивами' });
  const names = result.recommendations.map(place => place.name);
  assert.equal(new Set(names).size, names.length, names.join(' | '));
});

test('jury v4: wishes no source confirms reach Gemini as «unconfirmed», and hours are cited as the source\'s', async () => {
  const result = ask('baiterek', { minutes: 60, maxWalkMinutes: 15, query: 'Хочу тихое место с кофе и розеткой недалеко от меня.', visitDate: '2026-10-22T15:00:00+05:00' });
  assert.deepEqual(result.unconfirmed, ['розетки', 'тишина']);
  assert.deepEqual(ask('baiterek', { minutes: 60, maxWalkMinutes: 15, query: 'кофе' }).unconfirmed, []);

  const original = globalThis.fetch;
  let sent = null;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes(':generateContent')) sent = JSON.parse(JSON.parse(options.body).contents[0].parts[0].text);
    return new Response('{}', { status: 503 });
  };
  try {
    const request = new Request('https://demo.example/api/recommend', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://demo.example' },
      body: JSON.stringify({ lat: at.baiterek[0], lon: at.baiterek[1], minutes: 60, maxWalkMinutes: 15, query: 'Хочу тихое место с кофе и розеткой', visitDate: '2026-10-22T15:00:00+05:00' }) });
    await handleApi(request, { GEMINI_API_KEY: 'g', LOCAL_DEVELOPMENT: true }, places);
    assert.deepEqual(sent.unconfirmed, ['розетки', 'тишина']);
    assert.ok(sent.alternatives.filter(place => place.hours !== 'режим работы не подтверждён').every(place => place.hours.startsWith('по часам из источника')));
  } finally { globalThis.fetch = original; }
});

test('jury v4: the agent\'s plan_walk passes unconfirmed wishes to Gemini', async () => {
  const plan = await runTool('plan_walk', { minutes: 60, query: 'тихое кафе с розеткой', lat: at.baiterek[0], lon: at.baiterek[1] }, { dataset: places });
  assert.deepEqual(plan.unconfirmed, ['розетки', 'тишина']);
});

test('jury v5: notability from open data is shown as such, never as a rating, and leads a tourist to Бәйтерек', () => {
  const result = ask('baiterek', { minutes: 120, maxWalkMinutes: 30, query: 'Я турист, у меня 2 часа перед вылетом: что можно посмотреть поблизости?', visitDate: '2026-10-22T14:00:00+05:00' });
  const baiterek = result.recommendations[0];
  assert.equal(baiterek.name, 'Бәйтерек');
  assert.equal(baiterek.notability.level, 'high');
  assert.equal(baiterek.notability.isRating, false);
  assert.ok(baiterek.notability.reasons.includes('есть в Wikidata'));
  assert.equal(notabilityFor({ name: 'Детская площадка', nameIsGenerated: true }).level, 'low');
});

test('jury v5: the airport transport hint reaches Gemini as beyondWalk, and the agent without a model answers in the asker\'s language', async () => {
  at.airport = [51.0269, 71.4614];
  const query = 'I am a tourist with 2 hours before my flight, what can I see nearby?';
  const plan = await runTool('plan_walk', { minutes: 120, query, lat: at.airport[0], lon: at.airport[1] }, { dataset: places });
  assert.equal(plan.beyondWalk.needsTransport, true);
  assert.ok(plan.beyondWalk.name && plan.beyondWalk.distanceKm > 1);
  const answer = await runAgent({ query, lat: at.airport[0], lon: at.airport[1], minutes: 120 },
    { env: {}, dataset: places, limitedJson, answerLanguage, unsupported: UNSUPPORTED });
  assert.equal(answer.mode, 'fallback');
  assert.match(answer.summary, /^Below are separate options/);
  assert.match(answer.summary, new RegExp(`the nearest beyond it is «${plan.beyondWalk.name}», about ${plan.beyondWalk.distanceKm} km away, so you would need transport`));
  const kk = await runAgent({ query: 'Маған жақын жерде кофе ішкім келеді', lat: at.mega[0], lon: at.mega[1], minutes: 45 },
    { env: {}, dataset: places, limitedJson, answerLanguage, unsupported: UNSUPPORTED });
  assert.match(kk.summary, /^Төменде бөлек нұсқалар/);
});
