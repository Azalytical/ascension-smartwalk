import test from 'node:test';
import assert from 'node:assert/strict';
import { recommend, haversineMeters, searchLocations } from '../src/retrieval.mjs';

const start = { lat: 51.12, lon: 71.42, minutes: 60, maxWalkMinutes: 20 };
const poi = (overrides = {}) => ({ id: 'osm/node/1', name: 'Тестовый парк', lat: 51.12, lon: 71.42,
  category: 'park', description: 'Парк в данных источника', tags: ['park'],
  sourceUrl: 'https://www.openstreetmap.org/node/1', retrievedAt: '2026-10-19T12:00:00Z', openingHours: null, ...overrides });

test('time includes visit, return and reserve, with an explicitly shortened visit at 10 minutes', () => {
  const result = recommend([poi()], { ...start, minutes: 20 });
  assert.equal(result.recommendations.length, 1);
  assert.equal(result.recommendations[0].totalMinutes, 20);
  assert.equal(result.recommendations[0].visitMinutes, 15);
  assert.equal(result.recommendations[0].safetyReserveMinutes, 5);
  const short = recommend([poi()], { ...start, minutes: 10 }).recommendations[0];
  assert.equal(short.visitMinutes, 5);
  assert.equal(short.totalMinutes, 10);
  assert.equal(short.visitIsShortened, true);
  assert.ok(short.activities[0].includes('Короткий визит'));
  assert.ok(short.warnings.some(warning => warning.includes('сокращённый визит')));
  assert.equal(recommend([poi({ category: 'museum' })], { ...start, minutes: 10 }).recommendations.length, 0);
});

test('return budget and max outbound time are enforced independently', () => {
  const walkingPoi = poi({ lat: 51.124 });
  const candidate = recommend([walkingPoi], start).recommendations[0];
  assert.ok(candidate.walkMinutes > 0);
  assert.equal(candidate.returnMinutes, candidate.walkMinutes);
  assert.equal(candidate.totalMinutes, candidate.walkMinutes * 2 + 20);
  const noReturnBudget = candidate.walkMinutes + 20;
  const shortenedReturn = recommend([walkingPoi], { ...start, minutes: noReturnBudget }).recommendations[0];
  assert.equal(shortenedReturn.totalMinutes, noReturnBudget);
  assert.ok(shortenedReturn.visitMinutes < 15);
  assert.equal(recommend([walkingPoi], { ...start, minutes: candidate.walkMinutes * 2 + 9 }).recommendations.length, 0);
  const noReturn = recommend([walkingPoi], { ...start, minutes: noReturnBudget, returnToStart: false }).recommendations[0];
  assert.equal(noReturn.returnMinutes, 0);
  assert.equal(noReturn.totalMinutes, noReturnBudget);
  assert.equal(recommend([walkingPoi], { ...start, maxWalkMinutes: candidate.walkMinutes - 1 }).recommendations.length, 0);
  assert.equal(recommend([walkingPoi], { ...start, maxWalkMinutes: candidate.walkMinutes }).recommendations.length, 1);
});

test('finite coordinates, Astana bounds, time, and boolean inputs are validated', () => {
  for (const invalid of [null, {}, { ...start, lat: NaN }, { ...start, lon: Infinity }, { ...start, lat: 50.99 },
    { ...start, lat: 51.351 }, { ...start, lon: 71.7 }, { ...start, minutes: 9 }, { ...start, minutes: 181 },
    { ...start, minutes: null }, { ...start, lat: '' }, { ...start, maxWalkMinutes: 0 },
    { ...start, withChild: 'true' }, { ...start, returnToStart: 'false' }, { ...start, query: [] },
    { ...start, category: 'casino' }, { ...start, visitDate: 'yesterday' }]) {
    assert.throws(() => recommend([], invalid), error => error.code === 'INVALID_INPUT' && error.status === 400);
  }
  assert.doesNotThrow(() => recommend([], { lat: '51.0', lon: '71.25', minutes: 10 }));
  assert.doesNotThrow(() => recommend([], { lat: 51.35, lon: 71.65, minutes: 180 }));
});

test('dataset wrapper accepted and unknown fields stay unknown', () => {
  const result = recommend({ pois: [poi({ openingHours: null, retrievedAt: undefined })] }, { ...start, query: 'Желательно тихое место с розеткой' });
  const rec = result.recommendations[0];
  assert.equal(rec.openingHours, null);
  assert.ok(rec.warnings.some(warning => warning.includes('Режим работы неизвестен')));
  assert.ok(rec.warnings.some(warning => warning.includes('розеток не подтверждено')));
  assert.ok(rec.warnings.some(warning => warning.includes('уровень шума не подтверждены')));
  assert.ok(!rec.evidence.some(evidence => evidence.field === 'openingHours'));
  assert.ok(rec.evidence.every(evidence => evidence.sourceUrl === poi().sourceUrl));
  assert.equal(result.retrieval.usesLanguageModel, false);
  assert.equal(result.retrieval.usesEmbeddings, false);
});

test('recorded hours never claim actual opening', () => {
  const rec = recommend([poi({ openingHours: '24/7' })], { ...start, visitDate: '2026-10-19T23:00:00+05:00' }).recommendations[0];
  assert.ok(rec.warnings.some(warning => warning.includes('открытие в момент визита') && warning.includes('не проверены')));
  assert.equal(rec.evidence.find(evidence => evidence.field === 'openingHours').value, '24/7');
  assert.ok(!Object.hasOwn(rec, 'isOpen'));
});

test('withChild restricts to park and playground without asserting safety', () => {
  const records = [poi(), poi({ id: '2', name: 'Кафе', category: 'cafe', sourceUrl: 'https://www.openstreetmap.org/node/2' }),
    poi({ id: '3', name: 'Площадка', category: 'playground', sourceUrl: 'https://www.openstreetmap.org/node/3' })];
  const result = recommend(records, { ...start, withChild: true });
  assert.deepEqual(new Set(result.recommendations.map(rec => rec.category)), new Set(['park', 'playground']));
  assert.ok(result.recommendations.every(rec => rec.warnings.some(w => w.includes('безопасность') && w.includes('не проверены'))));
  assert.equal(recommend(records, { ...start, category: 'cafe', withChild: true }).recommendations.length, 0);
});

test('category intent uses ru/kk/en synonyms and tags, no unrelated filler', () => {
  const cafe = poi({ id: '2', name: 'Екінші орын', category: 'unknown', tags: { amenity: 'cafe' }, sourceUrl: 'https://www.openstreetmap.org/node/2' });
  for (const query of ['Хочу кофе', 'coffee nearby', 'кофехана']) {
    const result = recommend([poi(), cafe], { ...start, query });
    assert.equal(result.recommendations.length, 1);
    assert.equal(result.recommendations[0].id, '2');
    assert.equal(result.recommendations[0].category, 'cafe');
  }
  assert.equal(recommend([poi(), cafe], { ...start, query: 'без кафе, хочу парк' }).recommendations[0].category, 'park');
  assert.equal(recommend([poi(), cafe], { ...start, query: 'Мне парк' }).recommendations[0].category, 'park');
});

test('deduplicates id, same source, and colocated same-name OSM representations', () => {
  const result = recommend([poi(), poi(), poi({ id: 'other', sourceUrl: 'https://www.openstreetmap.org/way/5', lat: 51.12001 }),
    poi({ id: 'sourceDuplicate', name: 'Other name' })], start);
  assert.equal(result.recommendations.length, 1);
  assert.equal(result.retrieval.rejected.duplicates, 3);
});

test('no invented records and source-less, out-of-area, invalid rows rejected', () => {
  const result = recommend([null, poi({ sourceUrl: 'javascript:alert(1)' }), poi({ sourceUrl: undefined }),
    poi({ lat: 48 }), poi({ lat: '51.12' }), poi({ id: null }), poi({ category: 'unknown', tags: [] })], start);
  assert.deepEqual(result.recommendations, []);
  assert.ok(result.warnings[0].includes('нет подтверждённых вариантов'));
  assert.equal(result.retrieval.rejected.invalidRecords, 6);
  assert.equal(result.retrieval.rejected.unsupportedCategory, 1);
  assert.deepEqual(recommend(null, start).recommendations, []);
});

test('a cinema named Кинопарк is never inferred to be a park from name tags', () => {
  const cinema = poi({ id: 'cinema', name: 'IMAX Кинопарк7', category: 'cinema',
    tags: { amenity: 'cinema', name: 'IMAX Кинопарк7', operator: 'Coffee park' } });
  const result = recommend([cinema], { ...start, withChild: true });
  assert.equal(result.recommendations.length, 0);
  assert.equal(result.retrieval.rejected.category, 1);
  assert.equal(recommend([cinema], { ...start, minutes: 90 }).recommendations[0].category, 'culture');
  assert.equal(recommend([poi({ category: 'unknown', tags: { leisure: 'park' } })], start).recommendations[0].category, 'park');
});

test('explicit private or forbidden access excluded, unknown access clearly disclosed', () => {
  for (const restricted of [poi({ access: 'private' }), poi({ tags: { leisure: 'park', access: 'no' } })]) {
    const result = recommend([restricted], start);
    assert.equal(result.recommendations.length, 0);
    assert.equal(result.retrieval.rejected.restrictedAccess, 1);
  }
  assert.ok(recommend([poi()], start).recommendations[0].warnings.some(w => w.includes('доступ на территорию неизвестны')));
});

test('returns at most three alternatives, deterministic and without mutation', () => {
  const records = Array.from({ length: 8 }, (_, index) => poi({ id: String(index), name: `Место ${index}`, sourceUrl: `https://www.openstreetmap.org/node/${index}`,
    category: index % 2 ? 'cafe' : 'park', lat: 51.12 + index * 0.0002 }));
  const original = structuredClone(records);
  const input = { ...start };
  const first = recommend(records, input);
  assert.equal(first.recommendations.length, 3);
  assert.deepEqual(first, recommend(records, input));
  assert.deepEqual(records, original);
  assert.deepEqual(input, start);
  assert.ok(first.recommendations.every(rec => records.some(source => source.id === rec.id)));
  assert.ok(first.recommendations.every(rec => rec.totalMinutes <= first.constraints.minutes && rec.walkMinutes <= first.constraints.maxWalkMinutes));
  assert.equal(first.constraints.alternativesAreSeparate, true);
  assert.equal(first.retrieval.scoreIsConfidence, false);
});

test('distance is haversine and walking estimate follows documented factors', () => {
  assert.equal(haversineMeters(51.12, 71.42, 51.12, 71.42), 0);
  assert.ok(Math.abs(haversineMeters(51.12, 71.42, 51.13, 71.42) - 1111.95) < 1);
  const rec = recommend([poi({ lat: 51.124 })], start).recommendations[0];
  assert.equal(rec.walkMinutes, Math.ceil(haversineMeters(start.lat, start.lon, 51.124, start.lon) * 1.35 / 70));
  assert.ok(rec.estimatedWalkDistanceMeters >= rec.distanceMeters);
  assert.equal(recommend([], start).constraints.walkTimeIsEstimate, true);
});

test('recorded hours exclude places closed or closing during the visit', () => {
  const at = time => ({ ...start, minutes: 90, visitDate: `2026-10-19T${time}:00+05:00` });
  const cafe = hours => poi({ id: hours, category: 'cafe', openingHours: hours, sourceUrl: `https://www.openstreetmap.org/node/${hours.length}` });
  const closed = recommend([cafe('Mo-Su 10:00-22:00')], at('02:30'));
  assert.equal(closed.recommendations.length, 0);
  assert.equal(closed.retrieval.rejected.closedByHours, 1);
  assert.ok(closed.warnings.some(w => w.includes('закрытых к моменту визита')));
  assert.equal(recommend([cafe('Mo-Su 10:00-22:00')], at('21:50')).recommendations.length, 0);
  const open = recommend([cafe('Mo-Su 10:00-22:00')], at('12:00')).recommendations[0];
  assert.equal(open.hoursCheck.status, 'open');
  assert.equal(open.hoursCheck.closesAt, '22:00');
  assert.ok(open.why.includes('открыто до 22:00'));
  assert.ok(open.warnings.some(w => w.includes('праздники и исключения не проверены')));
  const odd = recommend([cafe('Mo-Su,PH 08:00+')], at('12:00')).recommendations[0];
  assert.equal(odd.hoursCheck.status, 'unknown');
  assert.equal(recommend([poi()], at('02:30')).recommendations[0].hoursCheck.status, 'no_data');
  const dateOnly = recommend([cafe('Mo-Su 10:00-22:00')], { ...start, minutes: 90, visitDate: '2026-10-19' });
  assert.equal(dateOnly.recommendations[0].hoursCheck.status, 'not_checked');
  assert.equal(dateOnly.retrieval.hoursReferenceTime, null);
});

test('food, indoor and culture requests use the wider category set', () => {
  const records = [poi(), poi({ id: 'r', name: 'Ресторан', category: 'restaurant', sourceUrl: 'https://www.openstreetmap.org/node/r' }),
    poi({ id: 'm', name: 'ТРЦ', category: 'mall', sourceUrl: 'https://www.openstreetmap.org/node/m' }),
    poi({ id: 'f', name: 'Бургерная', category: 'unknown', tags: { amenity: 'fast_food' }, sourceUrl: 'https://www.openstreetmap.org/node/f' })];
  const food = recommend(records, { ...start, minutes: 120, query: 'Хочу поесть' });
  assert.deepEqual(new Set(food.recommendations.map(r => r.category)), new Set(['restaurant']));
  const rain = recommend(records, { ...start, minutes: 120, query: 'идёт дождь, хочу погулять' });
  assert.ok(rain.recommendations.length > 0);
  assert.ok(rain.recommendations.every(r => r.category !== 'park'));
  assert.deepEqual(recommend(records, { ...start, minutes: 120, query: 'rain, any museum?' }).retrieval.requestedCategories, ['museum']);
});

test('general food includes cafes and unusual includes sourced culture and attractions', () => {
  const records = ['cafe', 'restaurant', 'museum', 'culture', 'attraction', 'park'].map((category, index) => poi({
    id: category, name: category, category, sourceUrl: `https://www.openstreetmap.org/node/${index}` }));
  assert.deepEqual(new Set(recommend(records, { ...start, minutes: 120, query: 'Хочу поесть' }).recommendations.map(row => row.category)), new Set(['cafe', 'restaurant']));
  assert.deepEqual(new Set(recommend(records, { ...start, minutes: 120, query: 'Хочу что-то необычное' }).recommendations.map(row => row.category)), new Set(['museum', 'culture', 'attraction']));
});

test('longer total time derives a walking limit without a hidden twenty-minute cap', () => {
  const far = poi({ lat: 51.14 });
  const result = recommend([far], { lat: start.lat, lon: start.lon, minutes: 180 });
  assert.equal(result.recommendations.length, 1);
  assert.ok(result.recommendations[0].walkMinutes > 20);
  assert.equal(result.constraints.maxWalkMinutes, 87);
  assert.equal(recommend([far], { lat: start.lat, lon: start.lon, minutes: 180, preferences: 'Не больше 10 минут пешком' }).recommendations.length, 0);
  assert.equal(recommend([far], { ...start, minutes: 180, maxWalkMinutes: 10 }).recommendations.length, 0);
});

test('KZT budget excludes known over-budget places and makes unknown prices explicit', () => {
  const records = [2000, 4000, null].map((amount, index) => poi({ id: String(index), name: `Кафе ${index}`, category: 'cafe',
    sourceUrl: `https://www.openstreetmap.org/node/${index}`, averageCheck: amount === null ? null : { amount, currency: 'KZT' } }));
  const result = recommend(records, { ...start, budget: 3000 });
  assert.equal(result.retrieval.rejected.budget, 1);
  const confirmed = result.recommendations.find(row => row.id === '0');
  assert.deepEqual(confirmed.averageCheck, { amount: 2000, currency: 'KZT' });
  assert.equal(confirmed.budgetStatus, 'confirmed');
  const unknown = result.recommendations.find(row => row.id === '2');
  assert.equal(unknown.averageCheck, null);
  assert.equal(unknown.budgetStatus, 'unknown');
  assert.ok(unknown.warnings.some(warning => warning.includes('Соответствие бюджету не подтверждено')));
  assert.equal(recommend([poi({ category: 'cafe', averageCheck: { amount: 10, currency: 'USD' } })], { ...start, budget: 3000 }).recommendations[0].budgetStatus, 'unknown');
  for (const budget of [-1, 1000001, NaN, Infinity, true, []]) assert.throws(() => recommend([], { ...start, budget }), { code: 'INVALID_INPUT' });
  for (const budget of [0, 1000000, null]) assert.doesNotThrow(() => recommend([], { ...start, budget }));
});

test('free requests require positive fee evidence and cafe entry does not imply a free meal', () => {
  const records = [poi(), poi({ id: 'free', name: 'Бесплатный парк', fee: 'no', sourceUrl: 'https://www.openstreetmap.org/node/2' }),
    poi({ id: 'cafe', name: 'Кафе', category: 'cafe', fee: 'no', sourceUrl: 'https://www.openstreetmap.org/node/3' })];
  for (const input of [{ ...start, budget: 0 }, { ...start, preferences: 'Бесплатно' }]) {
    const result = recommend(records, input);
    assert.deepEqual(result.recommendations.map(row => row.id), ['free']);
    assert.equal(result.recommendations[0].budgetStatus, 'free');
  }
});

test('mandatory special conditions reject unknown evidence; optional desires retain a caveat', () => {
  const unknown = poi({ category: 'cafe' });
  const confirmed = poi({ id: 'confirmed', name: 'Подтверждённое кафе', category: 'cafe', sourceUrl: 'https://www.openstreetmap.org/node/2',
    tags: { wheelchair: 'yes', 'socket:usb': '2', quietness: 'quiet' } });
  for (const preferences of ['Обязательно с розеткой', 'Нужен безбарьерный вход для коляски', 'Только тихое место']) {
    const result = recommend([unknown, confirmed], { ...start, preferences });
    assert.deepEqual(result.recommendations.map(row => row.id), ['confirmed']);
    assert.equal(result.retrieval.rejected.specialConditions, 1);
    const empty = recommend([unknown], { ...start, preferences });
    assert.equal(empty.recommendations.length, 0);
    assert.ok(empty.warnings.some(warning => warning.includes('Нужны данные')));
  }
  const optional = recommend([unknown], { ...start, preferences: 'По возможности тихо и с розеткой' });
  assert.equal(optional.recommendations.length, 1);
  assert.ok(optional.recommendations[0].warnings.some(warning => warning.includes('розеток не подтверждено')));
  assert.equal(recommend([poi({ wheelchair: 'limited' })], { ...start, preferences: 'Нужен вход для коляски' }).recommendations.length, 0);
  for (const preferences of [true, [], 'a'.repeat(501)]) assert.throws(() => recommend([], { ...start, preferences }), { code: 'INVALID_INPUT' });
  assert.throws(() => recommend([], { ...start, indoor: 'true' }), { code: 'INVALID_INPUT' });
});

test('indoor field applies independently of the request category', () => {
  const cafe = poi({ id: 'cafe', name: 'Кафе', category: 'cafe', sourceUrl: 'https://www.openstreetmap.org/node/2' });
  assert.deepEqual(recommend([poi(), cafe], { ...start, indoor: true }).recommendations.map(row => row.id), ['cafe']);
  assert.equal(recommend([poi()], { ...start, indoor: true }).recommendations.length, 0);
});

test('contact, check and rating fields are source-only, with safe Instagram links', () => {
  const record = poi({ category: 'cafe', tags: { 'contact:instagram': '@kafe_test', 'contact:phone': '+7 777 123 45 67',
    'contact:website': 'javascript:alert(1)', average_check: '2 500 KZT' }, rating: 4.4, popularity: 123 });
  const result = recommend([record], start).recommendations[0];
  assert.equal(result.contacts.instagram, 'https://www.instagram.com/kafe_test/');
  assert.equal(result.contacts.website, null);
  assert.equal(result.contacts.phone, '+7 777 123 45 67');
  assert.deepEqual(result.averageCheck, { amount: 2500, currency: 'KZT' });
  assert.equal(result.rating, 4.4);
  assert.equal(result.popularity, 123);
  assert.equal(recommend([poi()], start).recommendations[0].contacts.instagram, null);
  assert.equal(recommend([poi({ averageCheck: 2000 })], start).recommendations[0].averageCheck, null);
  assert.equal(recommend([poi({ tags: { instagram: 'https://malicious.example/instagram.com' } })], start).recommendations[0].contacts.instagram, null);
});

test('location search uses validated aliases, hides restrictions and enforces result limits', () => {
  const records = [poi({ aliases: ['Expo 2017', 'Экспо 2017'], address: 'проспект, 1' }),
    poi({ id: 'private', name: 'Экспо private', access: 'private', sourceUrl: 'https://www.openstreetmap.org/node/2' }),
    poi({ id: 'invalid', name: 'Экспо invalid', lat: 0, sourceUrl: 'https://www.openstreetmap.org/node/3' })];
  const result = searchLocations(records, { q: 'expo 2017', limit: 1 });
  assert.equal(result.total, 1);
  assert.equal(result.returned, 1);
  assert.equal(result.locations[0].id, poi().id);
  assert.equal(result.locations[0].address, 'проспект, 1');
  assert.equal(result.locations[0].sourceRecords, undefined);
  assert.equal(searchLocations(records, { q: 'несуществующее' }).total, 0);
  for (const limit of [0, 51, 2.5, 'abc']) assert.throws(() => searchLocations(records, { limit }), { code: 'INVALID_INPUT' });
  assert.throws(() => searchLocations(records, { q: 'a'.repeat(101) }), { code: 'INVALID_INPUT' });
});

test('vegan, vegetarian, dogs and toilets require actual source evidence', () => {
  const known = poi({ id: 'known', name: 'Кафе с данными', category: 'cafe', sourceUrl: 'https://www.openstreetmap.org/node/2',
    tags: { 'diet:vegan': 'yes', 'diet:vegetarian': 'yes', dog: 'leashed', toilets: 'yes' } });
  const unknown = poi({ category: 'cafe' });
  for (const preferences of ['Обязательно веганское меню', 'Только вегетарианские блюда', 'С собакой', 'Нужен туалет']) {
    const result = recommend([unknown, known], { ...start, preferences });
    assert.deepEqual(result.recommendations.map(place => place.id), ['known']);
    assert.equal(result.retrieval.rejected.specialConditions, 1);
    assert.ok(result.recommendations[0].specialConditions.every(condition => condition.evidenced));
    assert.equal(recommend([unknown], { ...start, preferences }).recommendations.length, 0);
  }
  assert.equal(recommend([poi({ tags: { toilets: 'yes', 'toilets:access': 'private' } })], { ...start, preferences: 'Нужен туалет' }).recommendations.length, 0);
});

test('unrecognized mandatory conditions cannot silently pass, and optional wishes have a caveat', () => {
  const record = poi({ tags: { quietness: 'quiet' } });
  for (const preferences of ['Обязательно халяль', 'Только с видом на реку', 'Обязательно тихо и халяль']) {
    const result = recommend([record], { ...start, preferences });
    assert.equal(result.recommendations.length, 0);
    assert.ok(result.constraints.specialConditions.some(condition => condition.required && condition.key.startsWith('unsupported_')));
    assert.ok(result.warnings.some(warning => warning.includes('Нужны данные')));
  }
  const optional = recommend([record], { ...start, preferences: 'Желательно с видом на реку' });
  assert.equal(optional.recommendations.length, 1);
  assert.ok(optional.recommendations[0].warnings.some(warning => warning.includes('не проверено по данным мест')));
  for (const preferences of ['Что-то необычное', 'Не больше 10 минут пешком']) {
    const result = recommend([record], { ...start, preferences });
    assert.equal(result.recommendations.length, 1);
    assert.ok(!result.constraints.specialConditions.some(condition => condition.key.startsWith('unsupported_')));
  }
  assert.equal(recommend([poi()], { ...start, preferences: 'Розетка не обязательна' }).recommendations.length, 1);
});

test('enriched fields link to their own provenance instead of attributing ratings to OSM', () => {
  const source = { source: 'Eventura', sourceUrl: 'https://venue.example/123', retrievedAt: '2026-09-01T10:00:00Z' };
  const record = poi({ rating: 4.8, reviewCount: 187, contacts: { phone: '+7 700 000 00 00' },
    fieldSources: { rating: source, reviewCount: source, contacts: source }, additionalSources: [source] });
  const place = recommend([record], start).recommendations[0];
  for (const field of ['rating', 'reviewCount', 'contacts']) {
    const evidence = place.evidence.find(item => item.field === field);
    assert.equal(evidence.sourceUrl, source.sourceUrl);
    assert.equal(evidence.retrievedAt, source.retrievedAt);
    assert.equal(evidence.source, 'Eventura');
  }
  assert.equal(place.reviewCount, 187);
  assert.equal(place.evidence.find(item => item.field === 'coordinates').sourceUrl, record.sourceUrl);
});
