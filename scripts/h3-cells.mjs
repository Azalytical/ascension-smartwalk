// Uber H3 cells for the «Рядом» map: every place gets its resolution 9 cell (about 0.1 km², 174 m edge) and that cell's
// resolution 8 parent (about 0.7 km²). Only cells with places are written, with their outlines, to data/h3-cells.json;
// the build copies the file next to the app, so neither the build nor the Worker needs h3-js.
// «Город 15 минут» (`reach`): for each of those cells, what is not within 15 minutes on foot of its centre.
// Run after data/places.json or data/overture/land_use.json changes: node scripts/h3-cells.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { latLngToCell, cellToParent, cellToBoundary, cellToLatLng, getResolution } from 'h3-js';
import { preparedPlaces } from '../src/retrieval.mjs';
import { haversine, walkMinutes } from '../public/js/core/geo.js';

export const FINE = 9;
export const COARSE = 8;
const root = resolve(import.meta.dirname, '..');
const round = value => Math.round(value * 1e5) / 1e5;
const outline = cell => cellToBoundary(cell, true).map(([lon, lat]) => [round(lon), round(lat)]);

// What a home needs within a short walk, by the categories our data has: a playground, somewhere to eat, a park or square.
export const REACH_MINUTES = 15;
export const NEEDS = { playground: ['playground'], food: ['cafe', 'restaurant'], park: ['park'] };
// Overture's land use layer (OSM) adds the parks, squares and playgrounds that are areas rather than places in our base.
const LAND_USE = { playground: 'playground', park: 'park', village_green: 'park', garden: 'park', recreation_ground: 'park', dog_park: 'park' };

/**
 * For each cell, the needs with nothing within REACH_MINUTES of its centre, by the app's walking model, and the nearest
 * one beyond (minutes and name, when the source has one). An area counts from its edge: the extent is the longer side
 * of its box in degrees × 111 km, which in Astana overstates east–west sides about 1.6 times, so 0.3 of it stays inside.
 */
export function reach(cells, places, landUse = []) {
  const areas = landUse.filter(item => LAND_USE[item.class] && Number.isFinite(item.lat) && Number.isFinite(item.lon));
  const evidence = [
    ...places.map(place => ({ name: place.name, category: place.category, lat: place.lat, lon: place.lon, inset: 0 })),
    ...areas.map(item => ({ name: item.names?.primary || null, category: LAND_USE[item.class], lat: item.lat, lon: item.lon, inset: (item.extentMeters || 0) * 0.3 })),
  ];
  const gaps = {};
  for (const cell of Object.keys(cells)) {
    const [lat, lon] = cellToLatLng(cell);
    for (const [need, categories] of Object.entries(NEEDS)) {
      let nearest = null;
      for (const item of evidence) {
        if (!categories.includes(item.category)) continue;
        const minutes = walkMinutes(Math.max(0, haversine(lat, lon, item.lat, item.lon) - item.inset));
        if (!nearest || minutes < nearest.minutes) nearest = { minutes, name: item.name };
      }
      if (!nearest || nearest.minutes > REACH_MINUTES) (gaps[cell] ??= {})[need] = nearest;
    }
  }
  return { minutes: REACH_MINUTES, needs: NEEDS, evidence: { places: places.length, areas: areas.length }, gaps };
}

export function h3Cells(dataset, landUse = []) {
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
  return { library: 'h3-js', resolutions: { fine: FINE, coarse: COARSE }, placeCount: Object.keys(places).length, places, cells: fine, parents: coarse,
    reach: reach(fine, preparedPlaces(dataset), landUse) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dataset = JSON.parse(await readFile(resolve(root, 'data/places.json'), 'utf8'));
  const landUse = JSON.parse(await readFile(resolve(root, 'data/overture/land_use.json'), 'utf8'));
  const result = h3Cells(dataset, landUse);
  if (Object.values(result.places).some(cell => getResolution(cell) !== FINE)) throw new Error('unexpected H3 resolution');
  await writeFile(resolve(root, 'data/h3-cells.json'), JSON.stringify(result) + '\n');
  console.log(JSON.stringify({ places: result.placeCount, fineCells: Object.keys(result.cells).length, coarseCells: Object.keys(result.parents).length,
    gaps: Object.fromEntries(Object.keys(NEEDS).map(need => [need, Object.values(result.reach.gaps).filter(gap => need in gap).length])) }));
}
