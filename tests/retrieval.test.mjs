import test from 'node:test';
import assert from 'node:assert/strict';
import { recommend, haversineMeters } from '../src/retrieval.mjs';

const start = { lat: 51.12, lon: 71.42, minutes: 60, maxWalkMinutes: 20 };
const poi = (overrides = {}) => ({ id: 'osm/node/1', name: 'Тестовый парк', lat: 51.12, lon: 71.42,
  category: 'park', description: 'Парк в данных источника', tags: ['park'],
  sourceUrl: 'https://www.openstreetmap.org/node/1', retrievedAt: '2026-10-19T12:00:00Z', openingHours: null, ...overrides });

test('budget includes visit, return, and five-minute reserve at exact boundary', () => {
  const result = recommend([poi()], { ...start, minutes: 20 });
  assert.equal(result.recommendations.length, 1);
  assert.equal(result.recommendations[0].totalMinutes, 20);
  assert.equal(result.recommendations[0].visitMinutes, 15);
  assert.equal(result.recommendations[0].safetyReserveMinutes, 5);
  assert.equal(recommend([poi()], { ...start, minutes: 19 }).recommendations.length, 0);
});

test('return budget and max outbound time are enforced independently', () => {
  const walkingPoi = poi({ lat: 51.124 });
  const candidate = recommend([walkingPoi], start).recommendations[0];
  assert.ok(candidate.walkMinutes > 0);
  assert.equal(candidate.returnMinutes, candidate.walkMinutes);
  assert.equal(candidate.totalMinutes, candidate.walkMinutes * 2 + 20);
  const noReturnBudget = candidate.walkMinutes + 20;
  assert.equal(recommend([walkingPoi], { ...start, minutes: noReturnBudget }).recommendations.length, 0);
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
  const result = recommend({ pois: [poi({ openingHours: null, retrievedAt: undefined })] }, { ...start, query: 'Хочу тихое место с розеткой' });
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
  assert.equal(result.retrieval.rejected.unsupportedCategory, 1);
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
