// «Город 15 минут» (cells.reach in data/h3-cells.json, made by scripts/h3-cells.mjs): what is not within 15 minutes on foot
// of each H3 cell with places. Checked here without h3-js, from the cell outlines and the same walking model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { preparedPlaces } from '../src/retrieval.mjs';
import { haversine, walkMinutes } from '../public/js/core/geo.js';

globalThis.document ??= { documentElement: {}, addEventListener() {} };
const { gapCounts } = await import('../public/js/ui/gaps.js');
const { t, has, setLang } = await import('../public/js/core/i18n.js');

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const cells = read('../data/h3-cells.json');
const places = preparedPlaces(read('../data/places.json'));
const landUse = read('../data/overture/land_use.json');
const AREAS = { playground: 'playground', park: 'park', village_green: 'park', garden: 'park', recreation_ground: 'park', dog_park: 'park' };
const evidence = [...places.map((place) => ({ ...place, inset: 0 })),
  ...landUse.filter((item) => AREAS[item.class]).map((item) => ({ category: AREAS[item.class], lat: item.lat, lon: item.lon, inset: (item.extentMeters || 0) * 0.3 }))];
const centre = (ring) => ring.slice(0, -1).reduce(([x, y], [lon, lat], _, all) => [x + lon / all.length, y + lat / all.length], [0, 0]);
const nearest = (lat, lon, categories) => Math.min(...evidence.filter((item) => categories.includes(item.category))
  .map((item) => walkMinutes(Math.max(0, haversine(lat, lon, item.lat, item.lon) - item.inset))));

test('every gap is a cell with places, and its nearest one is beyond 15 minutes', () => {
  const { reach } = cells;
  assert.equal(reach.minutes, 15);
  assert.deepEqual(reach.needs, { playground: ['playground'], food: ['cafe', 'restaurant'], park: ['park'] });
  assert.equal(reach.evidence.places, places.length);
  for (const [id, gap] of Object.entries(reach.gaps)) {
    assert.ok(cells.cells[id], id);
    for (const [need, near] of Object.entries(gap)) {
      assert.ok(need in reach.needs, need);
      assert.ok(near === null || near.minutes > reach.minutes, `${id} ${need}`);
    }
  }
});

test('the gaps match the places and areas: recounted from each outline’s centre', () => {
  // The outline's average is within a few metres of the H3 centre, so one minute of slack either way.
  for (const [id, cell] of Object.entries(cells.cells)) {
    const [lon, lat] = centre(cell.outline);
    for (const [need, categories] of Object.entries(cells.reach.needs)) {
      const minutes = nearest(lat, lon, categories);
      if (need in (cells.reach.gaps[id] || {})) assert.ok(minutes >= 15, `${id} ${need} ${minutes}`);
      else assert.ok(minutes <= 16, `${id} ${need} ${minutes}: run node scripts/h3-cells.mjs`);
    }
  }
});

test('the city counts and the words in three languages', () => {
  const counts = gapCounts(cells);
  assert.equal(counts.total, Object.keys(cells.cells).length);
  assert.equal(counts.all + Object.keys(cells.reach.gaps).length, counts.total);
  assert.ok(counts.needs.park > 0 && counts.needs.playground > 0);
  for (const language of ['ru', 'kk', 'en']) {
    setLang(language);
    for (const key of ['gaps.toggle', 'gaps.places', 'gaps.title', 'gaps.count', 'gaps.all', 'gaps.legend', 'gaps.about', 'gaps.cell', 'gaps.cellAll', 'gaps.near', 'gaps.nearNameless',
      ...Object.keys(cells.reach.needs).map((need) => `gaps.no.${need}`)]) assert.ok(has(key), `${language} ${key}`);
    if (language === 'en') assert.doesNotMatch(t('gaps.about', { places: 1, areas: 2 }), /[а-яё]/iu);
  }
  setLang('ru');
  assert.equal(t('gaps.count', { label: t('gaps.no.park'), n: 131, total: 563 }), 'Нет парка или сквера: 131 из 563 сот');
});
