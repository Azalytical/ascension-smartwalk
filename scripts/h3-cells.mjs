// Uber H3 cells for the «Рядом» map: every place gets its resolution 9 cell (about 0.1 km², 174 m edge) and that cell's
// resolution 8 parent (about 0.7 km²). Only cells with places are written, with their outlines, to data/h3-cells.json;
// the build copies the file next to the app, so neither the build nor the Worker needs h3-js.
// Run after data/places.json changes: node scripts/h3-cells.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { latLngToCell, cellToParent, cellToBoundary, getResolution } from 'h3-js';
import { preparedPlaces } from '../src/retrieval.mjs';

export const FINE = 9;
export const COARSE = 8;
const root = resolve(import.meta.dirname, '..');
const round = value => Math.round(value * 1e5) / 1e5;
const outline = cell => cellToBoundary(cell, true).map(([lon, lat]) => [round(lon), round(lat)]);

export function h3Cells(dataset) {
  const places = {};
  const fine = {};
  const coarse = {};
  for (const place of preparedPlaces(dataset)) {
    const cell = latLngToCell(place.lat, place.lon, FINE);
    const parent = cellToParent(cell, COARSE);
    places[String(place.id)] = cell;
    fine[cell] ??= { parent, outline: outline(cell) };
    coarse[parent] ??= outline(parent);
  }
  return { library: 'h3-js', resolutions: { fine: FINE, coarse: COARSE }, placeCount: Object.keys(places).length, places, cells: fine, parents: coarse };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dataset = JSON.parse(await readFile(resolve(root, 'data/places.json'), 'utf8'));
  const result = h3Cells(dataset);
  if (Object.values(result.places).some(cell => getResolution(cell) !== FINE)) throw new Error('unexpected H3 resolution');
  await writeFile(resolve(root, 'data/h3-cells.json'), JSON.stringify(result) + '\n');
  console.log(JSON.stringify({ places: result.placeCount, fineCells: Object.keys(result.cells).length, coarseCells: Object.keys(result.parents).length }));
}
