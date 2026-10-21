// «Соты H3» on the «Рядом» map: data/h3-cells.json (made by scripts/h3-cells.mjs with h3-js) puts every place into the
// Uber H3 cell it lies in. Checked here without h3-js: each place is inside its cell's outline, and each cell inside its parent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { preparedPlaces } from '../src/retrieval.mjs';

globalThis.document ??= { documentElement: {}, addEventListener() {} };
const { groupPlaces } = await import('../public/js/map/h3.js');
const { t, setLang } = await import('../public/js/core/i18n.js');

const cells = JSON.parse(readFileSync(new URL('../data/h3-cells.json', import.meta.url), 'utf8'));
const dataset = JSON.parse(readFileSync(new URL('../data/places.json', import.meta.url), 'utf8'));
const places = preparedPlaces(dataset);

// Ray casting on lon/lat: fine at the scale of one cell.
function inside([lon, lat], ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
const centre = ring => ring.slice(0, -1).reduce(([x, y], [lon, lat], _, all) => [x + lon / all.length, y + lat / all.length], [0, 0]);

test('every place has the resolution 9 cell it lies in, and every cell lies in its resolution 8 parent', () => {
  assert.deepEqual(cells.resolutions, { fine: 9, coarse: 8 });
  const mapped = places.filter(place => cells.places[String(place.id)]);
  // A new place without a cell is only left off the honeycomb; run node scripts/h3-cells.mjs after changing data/places.json.
  assert.ok(mapped.length >= places.length * 0.99, `${places.length - mapped.length} places have no H3 cell: run node scripts/h3-cells.mjs`);
  for (const place of mapped) {
    const cell = cells.cells[cells.places[String(place.id)]];
    assert.ok(cell, place.id);
    // A hexagon (or one of H3's twelve pentagons) as a closed GeoJSON ring.
    assert.ok([6, 7].includes(cell.outline.length), place.id);
    assert.deepEqual(cell.outline[0], cell.outline.at(-1));
    // Outlines are rounded to five decimals (about a metre), so a place on an edge may fall just outside.
    const nudged = cell.outline.some(([lon, lat]) => Math.abs(lon - place.lon) < 2e-5 && Math.abs(lat - place.lat) < 2e-5);
    assert.ok(inside([place.lon, place.lat], cell.outline) || nudged, `${place.id} is outside its cell`);
  }
  for (const [id, cell] of Object.entries(cells.cells)) assert.ok(inside(centre(cell.outline), cells.parents[cell.parent]), `${id} is outside its parent`);
});

test('the map groups the shown places by cell at both resolutions', () => {
  const sample = places.slice(0, 300).map(place => ({ ...place, id: String(place.id) }));
  const groups = groupPlaces(cells, sample);
  const fine = [...groups.values()].filter(group => group.resolution === 9);
  const coarse = [...groups.values()].filter(group => group.resolution === 8);
  const counted = sample.filter(place => cells.places[place.id]).length;
  assert.equal(fine.reduce((sum, group) => sum + group.places.length, 0), counted);
  assert.equal(coarse.reduce((sum, group) => sum + group.places.length, 0), counted);
  for (const group of fine) assert.ok(group.places.every(place => cells.places[place.id] === group.id));
  // A place unknown to the file (added after the cells were made) is left out, not an error.
  assert.equal(groupPlaces(cells, [{ id: 'osm:node:0' }]).size, 0);
});

test('the H3 strings exist in Russian, Kazakh and English', () => {
  const keys = ['h3.toggle', 'h3.title', 'h3.res9', 'h3.res8', 'h3.hours', 'h3.wheelchair', 'h3.clear', 'h3.hint', 'h3.about', 'h3.failed'];
  for (const language of ['ru', 'kk', 'en']) {
    setLang(language);
    for (const key of keys) assert.notEqual(t(key, { n: 1, total: 2 }), key, `${language} ${key}`);
  }
  setLang('ru');
  assert.equal(t('h3.title', { n: 8 }), 'Сота H3 · мест: 8');
});
