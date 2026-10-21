// A start named the way people talk in Astana («у меги», «возле шатра», «у шара на ЭКСПО») becomes the walk's start
// (public/js/core/geo.js), and the rest of the request stays the request.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startFrom, PRESETS } from '../public/js/core/geo.js';

test('colloquial Russian, Kazakh and English starts', () => {
  const cases = [
    ['час у меги, кофе', 'mega', 'час, кофе'],
    ['кофе возле шатра', 'khan-shatyr', 'кофе'],
    ['около Хан Шатыра парк', 'khan-shatyr', 'парк'],
    ['У шара на ЭКСПО, на час', 'expo', 'на час'],
    ['от Нур Алема музей', 'expo', 'музей'],
    ['прогулка от Байтерека', 'baiterek', 'прогулка'],
    ['у пирамиды погулять с ребёнком', 'pyramid', 'погулять с ребёнком'],
    ['рядом с Дворцом мира и согласия кафе', 'pyramid', 'кафе'],
    ['кофе у NU', 'nu', 'кофе'],
    ['от Назарбаев Университета пицца', 'nu', 'пицца'],
    ['у оперы ужин', 'opera', 'ужин'],
    ['по набережной от набережной Есиля', 'embankment', 'по набережной'],
    ['Бәйтеректен бастап кофе', 'baiterek', 'кофе'],
    ['Меганың жанында саябақ', 'mega', 'саябақ'],
    ['coffee near Khan Shatyr', 'khan-shatyr', 'coffee'],
    ['a walk from Baiterek', 'baiterek', 'a walk'],
  ];
  for (const [text, id, query] of cases) assert.deepEqual(startFrom(text), { id, query }, text);
});

test('a place to go to, other words and «ну» are not a start', () => {
  for (const text of ['в Мегу за кофе', 'Хан Шатыр', 'ну кофе', 'у меня час', 'кафе у мегаполиса', 'шарики для ребёнка', 'парк и кофе', '']) {
    assert.equal(startFrom(text), null, text);
  }
});

test('every start word leads to a start in the list, with names in three languages', () => {
  for (const preset of PRESETS) {
    for (const language of ['ru', 'kk', 'en']) assert.ok(preset.name[language], `${preset.id} ${language}`);
    assert.ok(preset.lat > 51 && preset.lat < 51.35 && preset.lon > 71.25 && preset.lon < 71.65, preset.id);
  }
  for (const text of ['у меги', 'у шатра', 'у шара', 'от Байтерека', 'у оперы', 'от набережной', 'у пирамиды', 'у NU']) {
    assert.ok(PRESETS.some((preset) => preset.id === startFrom(text)?.id), text);
  }
});
