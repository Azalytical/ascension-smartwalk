// Uber H3 cells over the places on the «Рядом» map: how many places our data has in each cell and how complete their data is.
// The cells come precomputed from scripts/h3-cells.mjs (resolution 9 and its resolution 8 parents), so the browser needs no h3-js.
// Resolution 8 is drawn when the map is zoomed out, 9 closer in; with the 3D button on, each cell is a column as tall as its count.
// Only places are put into cells, never the person's own point.
import { setOverlay, removeOverlay, setData, onLayerClick, cssVar, isTilted } from './map.js';

const SPLIT_ZOOM = 13.5;
const empty = { type: 'FeatureCollection', features: [] };
let cellsPromise = null;
let shown = false;
let collection = empty;
let selectedId = '';
let onSelect = null;

export function loadCells() {
  cellsPromise ||= fetch('/data/h3.json').then((response) => {
    if (!response.ok) throw new Error('h3');
    return response.json();
  }).catch((error) => { cellsPromise = null; throw error; });
  return cellsPromise;
}

/** The shown places grouped by their resolution 9 cell and by its resolution 8 parent. */
export function groupPlaces(cells, items) {
  const groups = new Map();
  for (const place of items) {
    const fine = cells.places[place.id];
    if (!fine) continue;
    for (const [id, resolution] of [[fine, cells.resolutions.fine], [cells.cells[fine]?.parent, cells.resolutions.coarse]]) {
      if (!id) continue;
      let group = groups.get(id);
      if (!group) groups.set(id, group = { id, resolution, places: [] });
      group.places.push(place);
    }
  }
  return groups;
}

function featuresFor(cells, groups) {
  return { type: 'FeatureCollection', features: [...groups.values()].map(({ id, resolution, places }) => ({
    type: 'Feature', properties: { id, res: resolution, count: places.length },
    geometry: { type: 'Polygon', coordinates: [resolution === cells.resolutions.fine ? cells.cells[id].outline : cells.parents[id]] },
  })) };
}

function layers() {
  const fine = ['==', ['get', 'res'], 9];
  const coarse = ['==', ['get', 'res'], 8];
  const opacity = ['interpolate', ['linear'], ['get', 'count'], 1, 0.1, 8, 0.28, 30, 0.5];
  const fill = (id, filter, zoom) => ({ id, type: 'fill', source: 'h3', filter, ...zoom, beforeId: 'places-dots', paint: { 'fill-color': () => cssVar('--gold'), 'fill-opacity': opacity } });
  const line = (id, filter, zoom) => ({ id, type: 'line', source: 'h3', filter, ...zoom, beforeId: 'places-dots', paint: { 'line-color': () => cssVar('--gold-strong'), 'line-width': 1, 'line-opacity': 0.7 } });
  // A column's height grows with the square root of the count, so a cell of 95 places does not hide the city behind it.
  const column = (id, filter, zoom, metres) => ({ id, type: 'fill-extrusion', source: 'h3', filter, ...zoom, beforeId: 'places-dots',
    paint: { 'fill-extrusion-color': () => ['interpolate', ['linear'], ['get', 'count'], 1, cssVar('--gold-ink'), 30, cssVar('--gold')],
      'fill-extrusion-height': ['*', ['sqrt', ['get', 'count']], metres], 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.72 } });
  const below = { maxzoom: SPLIT_ZOOM };
  const above = { minzoom: SPLIT_ZOOM };
  const flat = [fill('h3-fill-8', coarse, below), line('h3-line-8', coarse, below), fill('h3-fill-9', fine, above), line('h3-line-9', fine, above)];
  const tall = [column('h3-col-8', coarse, below, 60), column('h3-col-9', fine, above, 40)];
  const selected = { id: 'h3-selected', type: 'line', source: 'h3', filter: ['==', ['get', 'id'], selectedId], beforeId: 'places-dots',
    paint: { 'line-color': () => cssVar('--ink'), 'line-width': 3 } };
  return [...(isTilted() ? tall : flat), selected];
}

function draw() {
  // Flat cells and columns are different layers, so the old set goes before the new one is added.
  removeOverlay('h3');
  setOverlay('h3', { sources: { h3: { type: 'geojson', data: collection } }, layers: layers() });
  for (const id of ['h3-fill-8', 'h3-fill-9', 'h3-col-8', 'h3-col-9']) onLayerClick(id, (feature) => onSelect?.(feature.properties.id));
}

/** Draws the cells of the given places; `select` gets a cell id when one is tapped. */
export function showCells(cells, items, select) {
  onSelect = select;
  collection = featuresFor(cells, groupPlaces(cells, items));
  if (shown) { setData('h3', collection); return; }
  shown = true;
  draw();
}

export function selectCell(id) {
  selectedId = id || '';
  if (shown) draw();
}

export function hideCells() {
  if (!shown) return;
  shown = false;
  selectedId = '';
  onSelect = null;
  removeOverlay('h3');
}

// The 3D button swaps flat cells for columns and back.
document.addEventListener('seruen:tilt', () => { if (shown) draw(); });
