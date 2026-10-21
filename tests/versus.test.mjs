// «Почему это, а не другое» without Gemini: when no card beats all the others, the line names the one it beats
// or the one it is farther than, instead of «похоже на остальные», and says it in Kazakh and English too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { recommend } from '../src/retrieval.mjs';

// The app's dictionaries only: public/js/ui/common.js needs files the build generates.
globalThis.document ??= { documentElement: {}, addEventListener() {} };
const { t, has, setLang } = await import('../public/js/core/i18n.js');

const start = { lat: 51.12, lon: 71.42, minutes: 60, maxWalkMinutes: 20 };
const place = (id, overrides = {}) => ({ id, name: `Место ${id}`, lat: 51.12, lon: 71.42, category: 'park', tags: { leisure: 'park' },
  sourceUrl: `https://www.openstreetmap.org/node/${id.replace(/\D/g, '')}`, retrievedAt: '2026-10-19T12:00:00Z', openingHours: null, ...overrides });
const reasons = card => card.versus.reasons.map(reason => [reason.key, reason.params]);

test('two near squares say which far one they beat, the far one says it is farther, and an open-data mention counts', () => {
  const home = place('osm:node:11', { name: 'Сквер у дома', lat: 51.1209, tags: { leisure: 'park', wikidata: 'Q1' } });
  const across = place('osm:node:12', { name: 'Сквер напротив', lat: 51.1209, lon: 71.4201 });
  const far = place('osm:node:13', { name: 'Дальний сквер', lat: 51.1254 });
  const cards = recommend([home, across, far], { ...start, query: 'парк' }).recommendations;
  const by = id => cards.find(card => card.id === id);
  assert.equal(cards.length, 3);
  assert.equal(by(far.id).walkMinutes - by(home.id).walkMinutes, 10);

  assert.deepEqual(reasons(by(home.id)), [['listed', {}], ['closerThan', { minutes: 10, name: 'Дальний сквер' }]]);
  assert.equal(by(home.id).versus.text, 'Есть в открытых справочниках, в отличие от остальных; на 10 мин пешком ближе, чем «Дальний сквер».');
  assert.deepEqual(reasons(by(across.id)), [['closerThan', { minutes: 10, name: 'Дальний сквер' }]]);
  assert.deepEqual(reasons(by(far.id)), [['farther', { minutes: 10, name: 'Сквер у дома' }]]);
  assert.equal(by(far.id).versus.text, 'На 10 мин дальше, чем «Сквер у дома», но тоже успеваете.');
});

test('a minute closer on foot but clearly nearer in metres says so; unconfirmed hours are said; truly alike cards say they are alike', () => {
  const first = place('osm:node:14', { name: 'Кофейня 1', category: 'cafe', tags: { amenity: 'cafe' }, lat: 51.1215 });
  const second = place('osm:node:15', { name: 'Кофейня 2', category: 'cafe', tags: { amenity: 'cafe' }, lat: 51.1222 });
  const [near, next] = recommend([first, second], { ...start, query: 'кофе' }).recommendations;
  assert.equal(next.walkMinutes - near.walkMinutes, 1);
  assert.deepEqual(reasons(near), [['nearer', { meters: 70 }]]);
  assert.equal(near.versus.text, 'Ближе остальных на 70 м по прямой.');
  assert.deepEqual(reasons(next), [['similar', {}]]);

  // As near as the other, but only the other has hours in the source: the line says that rather than «похоже».
  const open = place('osm:node:16', { name: 'Кофейня с часами', category: 'cafe', tags: { amenity: 'cafe' }, lat: 51.1215, openingHours: '24/7' });
  const unknown = place('osm:node:17', { name: 'Кофейня без часов', category: 'cafe', tags: { amenity: 'cafe' }, lat: 51.1215, lon: 71.4202 });
  const pair = recommend([open, unknown], { ...start, query: 'кофе' }).recommendations;
  assert.deepEqual(reasons(pair.find(card => card.id === open.id)).map(([key]) => key), ['hoursConfirmed']);
  assert.deepEqual(reasons(pair.find(card => card.id === unknown.id)), [['hoursUnconfirmed', {}]]);
  assert.equal(pair.find(card => card.id === unknown.id).versus.text, 'Часы работы не подтверждены, в отличие от остальных.');
});

test('the new lines exist in Kazakh and English, with the place name and the numbers', () => {
  try {
    for (const language of ['kk', 'en']) {
      setLang(language);
      for (const key of ['closerThan', 'farther', 'nearer', 'listed', 'hoursUnconfirmed']) {
        assert.ok(has(`vs.${key}`), `${language} vs.${key}`);
        const text = t(`vs.${key}`, { minutes: 7, meters: 70, name: 'Starbucks' });
        if (key === 'closerThan' || key === 'farther') assert.match(text, /«Starbucks».*7|7.*«Starbucks»/u, `${language} ${key}`);
        if (key === 'nearer') assert.match(text, /70/u);
        assert.doesNotMatch(text, /\{/u, `${language} ${key}`);
        if (language === 'en') assert.doesNotMatch(text, /[а-яё]/iu, key);
      }
    }
  } finally { setLang('ru'); }
});
