// «Что сделать на месте» by the source's own kind of place: a fountain, a mosque or a cinema gets its own idea,
// in the card, in the visit step of the plan and, through a key, in Kazakh and English.
import test from 'node:test';
import assert from 'node:assert/strict';
import { recommend, KIND_ACTIVITIES } from '../src/retrieval.mjs';

// The app's dictionaries only: public/js/ui/server-text.js needs files the build generates.
globalThis.document ??= { documentElement: {}, addEventListener() {} };
const { t, has, setLang } = await import('../public/js/core/i18n.js');

const record = (overrides = {}) => ({ id: 'osm:node:1', name: 'Поющие фонтаны', lat: 51.12, lon: 71.42, category: 'fountain',
  sourceUrl: 'https://www.openstreetmap.org/node/1', retrievedAt: '2026-10-19T12:00:00Z', source: { id: 'osm', label: 'OpenStreetMap', license: 'ODbL-1.0' }, ...overrides });
const near = { lat: 51.121, lon: 71.421, minutes: 60, maxWalkMinutes: 20 };

test('a fountain gets its own idea in the card and in the visit step', () => {
  const [card] = recommend([record()], near).recommendations;
  assert.equal(card.category, 'attraction');
  assert.match(card.activities[0], /^Посидеть у фонтана и сделать фото; работает ли фонтан сегодня, источник не сообщает/);
  assert.equal(card.provenance.activities.origin, 'generated_idea');
  assert.match(card.plan.steps[1], /мин на месте: посидеть у фонтана и сделать фото$/);
  assert.deepEqual(card.plan.stepKeys[1], { key: 'visit', params: { minutes: card.visitMinutes, category: 'attraction', kind: 'fountain' } });
});

test('a kind without its own idea keeps the category one', () => {
  const [card] = recommend([record({ category: 'cafe', name: 'Кофейня' })], near).recommendations;
  assert.match(card.activities[0], /^Сделать перерыв на кофе/);
  const [mosque] = recommend([record({ category: 'place_of_worship', name: 'Мечеть' })], near).recommendations;
  assert.match(mosque.activities[0], /в закрытой одежде и не во время службы/);
});

test('every kind idea says what the source does not confirm, and has a Kazakh and English step', () => {
  for (const [kind, text] of Object.entries(KIND_ACTIVITIES)) {
    assert.match(text, /^[А-Я][^;]+; .+\.$/u, kind);
    for (const language of ['kk', 'en']) {
      setLang(language);
      // server-text.js renders the visit step with actk.<kind> and falls back to act.<category> when a kind has none.
      assert.ok(has(`actk.${kind}`), `${language} ${kind}`);
      assert.notEqual(t(`actk.${kind}`), t('act.attraction'), `${language} ${kind}`);
      if (language === 'en') assert.doesNotMatch(t(`actk.${kind}`), /[а-яё]/u, kind);
    }
  }
  setLang('en');
  assert.equal(t('step.visit', { minutes: 15, activity: t('actk.fountain') }), '15 min on site: sit by the fountain and take photos');
  setLang('kk');
  assert.equal(t('step.visit', { minutes: 15, activity: t('actk.fountain') }), 'орнында 15 мин: субұрқақ жанында отырып, суретке түсу');
  setLang('ru');
  // In Russian the server's own text stays, so there is no Russian template to drift from it.
  assert.equal(has('actk.fountain'), false);
});
