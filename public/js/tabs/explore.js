// "Nearby": every place in the database on the map and in a list, nearest first, with search and filters.
import { registerTab, openTab } from '../shell.js';
import { h, icon, clear } from '../core/dom.js';
import { t, pick, number } from '../core/i18n.js';
import * as store from '../core/store.js';
import * as api from '../core/api.js';
import { PRESETS, estimate, formatDistance } from '../core/geo.js';
import { lang } from '../core/i18n.js';
import { setOverlay, removeOverlay, setData, onLayerClick, cssVar, fitPoints, flyTo, mapReady } from '../map/map.js';
import * as layers from '../map/layers.js';
import { setSnap } from '../ui/sheet.js';
import { categoryArt, categoryName, hoursStatus, hoursChip, CATEGORY_COLOR, backButton } from '../ui/common.js';
import { placeView } from '../ui/place.js';
import { startWalk } from '../ui/live.js';

const FILTERS = [['all', null], ['cafe', ['cafe']], ['restaurant', ['restaurant']], ['park', ['park', 'playground']], ['culture', ['museum', 'culture']], ['attraction', ['attraction']], ['mall', ['mall']]];
const PAGE = 40;
let root = null;
let data = null;
let filter = 'all';
let openNow = false;
let search = '';
let shown = PAGE;
let current = null;
let listHost = null;
let countHost = null;

const startPoint = () => {
  const saved = store.get('start');
  if (saved) return { ...saved, name: saved.names ? pick(saved.names) : saved.kind === 'gps' ? t('start.gps') : saved.kind === 'map' ? t('start.picked') : saved.name };
  const preset = PRESETS[0];
  return { kind: 'preset', id: preset.id, name: pick(preset.name), lat: preset.lat, lon: preset.lon };
};
const normalize = (text) => String(text || '').toLocaleLowerCase('ru').replace(/ё/g, 'е');

function filtered() {
  const start = startPoint();
  const categories = FILTERS.find(([id]) => id === filter)?.[1];
  const query = normalize(search.trim());
  return data.items
    .filter((place) => !categories || categories.includes(place.category))
    .filter((place) => !query || normalize(place.name).includes(query))
    .map((place) => ({ place, timing: estimate(start, place) }))
    .filter(({ place, timing }) => !openNow || hoursStatus(place, timing.walkMinutes, timing.visitMinutes).status === 'open')
    .sort((a, b) => a.timing.distanceMeters - b.timing.distanceMeters);
}

function geojson(items) {
  return { type: 'FeatureCollection', features: items.map(({ place }) => ({ type: 'Feature', id: undefined, properties: { id: place.id, category: place.category }, geometry: { type: 'Point', coordinates: [place.lon, place.lat] } })) };
}

function drawMap(items) {
  const colors = () => ['match', ['get', 'category'], ...Object.entries(CATEGORY_COLOR).flatMap(([category, variable]) => [category, cssVar(variable)]), cssVar('--ink-3')];
  setOverlay('places', {
    sources: { places: { type: 'geojson', data: geojson(items) } },
    layers: [
      { id: 'places-dots', type: 'circle', source: 'places', paint: { 'circle-color': colors, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 13, 4.5, 16, 8], 'circle-stroke-color': () => cssVar('--surface'), 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 14, 1.5] } },
      { id: 'places-selected', type: 'circle', source: 'places', filter: ['==', ['get', 'id'], current?.place.id || ''], paint: { 'circle-color': () => cssVar('--gold'), 'circle-radius': 11, 'circle-stroke-color': () => cssVar('--ink'), 'circle-stroke-width': 3 } },
    ],
  });
  onLayerClick('places-dots', (feature) => {
    const place = data.items.find((item) => item.id === feature.properties.id);
    if (place) openPlace(place);
  });
}

function renderList() {
  if (!data) return;
  const items = filtered();
  setData('places', geojson(items));
  countHost.textContent = t('explore.count', { n: number(items.length) });
  if (!items.length) { clear(listHost, h('p', { class: 'empty-note', text: t('explore.empty') })); return; }
  clear(listHost, h('div', { class: 'list' }, items.slice(0, shown).map(({ place, timing }) => h('button', { class: 'list-row place-row', type: 'button', onclick: () => openPlace(place) },
    categoryArt(place.category, 36, 'art'),
    h('span', { class: 'row-text' }, h('strong', { text: place.name }),
      h('small', {}, categoryName(place.category), h('span', { class: 'meta-sep', 'aria-hidden': 'true' }), t('explore.walk', { n: timing.walkMinutes })),
      hoursChip(hoursStatus(place, timing.walkMinutes, timing.visitMinutes))), icon('chevron', 'row-chevron')))),
  items.length > shown ? h('button', { class: 'btn btn-quiet btn-block', type: 'button', text: t('explore.more'), onclick: () => { shown += PAGE; renderList(); } }) : null);
}

function renderBrowse() {
  current = null;
  const start = startPoint();
  const input = h('input', { class: 'field-input', type: 'search', enterkeyhint: 'search', autocomplete: 'off', spellcheck: 'false', placeholder: t('explore.search'), 'aria-label': t('explore.search'), value: search });
  let debounce;
  input.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(() => { search = input.value; shown = PAGE; renderList(); }, 120); });
  const chips = h('div', { class: 'chip-row no-drag', role: 'group', 'aria-label': t('tab.explore') },
    FILTERS.map(([id]) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(filter === id), dataset: { filter: id },
      onclick: () => { filter = id; shown = PAGE; chips.querySelectorAll('[data-filter]').forEach((chip) => chip.setAttribute('aria-pressed', String(chip.dataset.filter === id))); renderList(); } },
    id === 'all' ? t('explore.all') : categoryName(id === 'park' ? 'park' : id === 'culture' ? 'culture' : id))),
    h('button', { type: 'button', class: 'chip chip-toggle', 'aria-pressed': String(openNow), onclick: (event) => { openNow = !openNow; event.currentTarget.setAttribute('aria-pressed', String(openNow)); renderList(); } }, h('span', { class: 'status-dot', 'aria-hidden': 'true' }), t('explore.openNow')));
  countHost = h('p', { class: 'meta', role: 'status' });
  listHost = h('div', { class: 'explore-list' }, h('p', { class: 'empty-note', text: t('explore.loading') }));
  clear(root, h('section', { class: 'view explore-view', 'aria-labelledby': 'explore-title' },
    h('h1', { id: 'explore-title', class: 'title-1', text: t('tab.explore') }),
    h('p', { class: 'meta' }, icon('pin', 'icon-xs'), t('explore.near', { name: start.name })),
    h('div', { class: 'search-field' }, icon('search', 'search-icon'), input),
    chips, countHost, listHost));
  layers.showStart(start, start.name);
  if (data) { drawMap(filtered()); renderList(); }
}

function openPlace(place) {
  const start = startPoint();
  const timing = estimate(start, place);
  current = { place, timing };
  const url = new URL(location.origin);
  url.searchParams.set('tab', 'explore');
  url.searchParams.set('place', place.id);
  clear(root, placeView({ place: { ...place, retrievedAt: data?.updatedAt }, timing, start, onBack: () => { renderBrowse(); },
    onStart: () => { startWalk({ place, start, timing }); openTab('walk'); }, shareUrl: url.href }));
  root.scrollTop = 0;
  setSnap('half');
  drawMap(filtered());
  layers.showRoutes([{ coordinates: [[start.lon, start.lat], [place.lon, place.lat]], selected: true }]);
  layers.upgradeRoute(0, start, place);
  fitPoints([[start.lon, start.lat], [place.lon, place.lat]], { maxZoom: 17 });
}

registerTab({
  id: 'explore', order: 20, icon: 'map', title: 'tab.explore',
  mount(container) {
    root = container;
    renderBrowse();
    api.places().then((loaded) => {
      data = loaded;
      if (root !== container) return;
      const wanted = new URLSearchParams(location.search).get('place');
      const place = wanted && data.items.find((item) => item.id === wanted);
      if (place) { history.replaceState(null, '', location.pathname); openPlace(place); return; }
      drawMap(filtered()); renderList();
      mapReady.then(() => { const start = startPoint(); flyTo([start.lon, start.lat], 14.2, 600); });
    }).catch(() => { if (listHost) clear(listHost, h('p', { class: 'empty-note', text: t('explore.failed') })); });
  },
  reopen() { if (root) renderBrowse(); },
  unmount() { removeOverlay('places'); layers.hideRoutes(); layers.hideStart(); root = null; },
});
