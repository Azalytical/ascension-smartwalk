// "Nearby": every place in the database on the map and in a list, nearest first, with search and filters.
import { registerTab, openTab } from '../shell.js';
import { h, icon, clear } from '../core/dom.js';
import { t, pick, number, placeName } from '../core/i18n.js';
import * as store from '../core/store.js';
import * as api from '../core/api.js';
import { PRESETS, estimate, formatDistance } from '../core/geo.js';
import { lang } from '../core/i18n.js';
import { setOverlay, removeOverlay, setData, onLayerClick, cssVar, fitPoints, flyTo, mapReady, getMap, isTilted } from '../map/map.js';
import * as layers from '../map/layers.js';
import { loadCells, showCells, showGaps, selectCell, hideCells, groupPlaces } from '../map/h3.js';
import { gapsSummary, gapCell } from '../ui/gaps.js';
import { setSnap } from '../ui/sheet.js';
import { categoryArt, categoryName, hoursStatus, hoursChip, CATEGORY_COLOR, backButton, listenButton, backTime } from '../ui/common.js';
import { placeView } from '../ui/place.js';
import { startWalk } from '../ui/live.js';
import { readyView } from '../ui/ready.js';
import { askPhoto } from '../ui/vision.js';
import { identify } from '../core/media.js';
import { outbound } from '../core/privacy.js';
import { pickPlace } from '../core/picked.js';

const FILTERS = [['all', null], ['cafe', ['cafe']], ['restaurant', ['restaurant']], ['park', ['park', 'playground']], ['family', ['family', 'playground']], ['culture', ['museum', 'culture']], ['attraction', ['attraction']], ['nightlife', ['nightlife']], ['mall', ['mall']]];
const PAGE = 40;
let root = null;
let data = null;
let filter = 'all';
let openNow = false;
let search = '';
let shown = PAGE;
let current = null;
let vision = null;
let listHost = null;
let countHost = null;
// «Соты H3»: the places' Uber H3 cells on the map (map/h3.js); a tapped cell narrows the list to its places.
let hexes = false;
let cells = null;
let cell = null;
// What the cells show: 'count' (places in each cell) or 'gaps' («Город 15 минут»: what is not within 15 minutes on foot).
let lens = 'count';

const startPoint = () => {
  const saved = store.get('start');
  if (saved) return { ...saved, name: saved.names ? pick(saved.names) : saved.kind === 'gps' ? t('start.gps') : saved.kind === 'map' ? t('start.picked') : saved.name };
  const preset = PRESETS[0];
  return { kind: 'preset', id: preset.id, name: pick(preset.name), lat: preset.lat, lon: preset.lon };
};
const normalize = (text) => String(text || '').toLocaleLowerCase('ru').replace(/ё/g, 'е');

const inCell = (place) => cells.places[place.id] === cell || cells.cells[cells.places[place.id]]?.parent === cell;

function filtered({ inSelectedCell = true } = {}) {
  const start = startPoint();
  const categories = FILTERS.find(([id]) => id === filter)?.[1];
  const query = normalize(search.trim());
  return data.items
    .filter((place) => !categories || categories.includes(place.category))
    .filter((place) => !query || normalize(place.name).includes(query))
    .filter((place) => !inSelectedCell || !hexes || !cell || !cells || inCell(place))
    .map((place) => ({ place, timing: estimate(start, place) }))
    .filter(({ place, timing }) => !openNow || hoursStatus(place, timing.walkMinutes, timing.visitMinutes).status === 'open')
    .sort((a, b) => a.timing.distanceMeters - b.timing.distanceMeters);
}

function pickCell(id) {
  cell = id;
  selectCell(id);
  shown = PAGE;
  renderList();
  setSnap('half');
  if (id) root?.querySelector('.h3-cell')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/** What a tapped cell holds: places by category and how many of them have hours and wheelchair data. */
function cellSummary(group) {
  const total = group.places.length;
  const byCategory = new Map();
  for (const place of group.places) byCategory.set(place.category, (byCategory.get(place.category) || 0) + 1);
  const categories = [...byCategory].sort((a, b) => b[1] - a[1]).map(([category, n]) => `${categoryName(category)}: ${number(n)}`).join(' · ');
  const withHours = group.places.filter((place) => place.openingHours).length;
  const withWheelchair = group.places.filter((place) => place.wheelchair).length;
  return h('section', { class: 'block h3-cell', 'aria-live': 'polite' },
    h('div', { class: 'h3-cell-head' }, h('strong', { text: t('h3.title', { n: number(total) }) }),
      h('button', { class: 'btn btn-quiet btn-small', type: 'button', text: t('h3.clear'), onclick: () => pickCell(null) })),
    h('p', { class: 'meta', text: t(group.resolution === cells.resolutions.fine ? 'h3.res9' : 'h3.res8') }),
    h('p', { text: categories }),
    h('p', { class: 'meta', text: `${t('h3.hours', { n: number(withHours), total: number(total) })} · ${t('h3.wheelchair', { n: number(withWheelchair), total: number(total) })}` }));
}

function setLens(next) {
  lens = next;
  cell = null;
  selectCell(null);
  shown = PAGE;
  if (data) drawMap(filtered());
  renderList();
  // The gaps lie mostly at the edges of the built-up city, so the lens opens on the city: the middle 90% of the cells,
  // leaving out the few far ones (the airport, the outskirts) that would shrink every cell to a dot.
  if (lens === 'gaps') {
    const corners = Object.values(cells.cells).map((item) => item.outline[0]);
    const share = (values, q) => values.sort((a, b) => a - b)[Math.floor((values.length - 1) * q)];
    const lons = corners.map(([lon]) => lon), lats = corners.map(([, lat]) => lat);
    // About 12 km across: zoom 10.6 fits it in the strip of map the half-open sheet leaves on a phone.
    getMap()?.easeTo({ center: [(share(lons, 0.05) + share(lons, 0.95)) / 2, (share(lats, 0.05) + share(lats, 0.95)) / 2], zoom: 10.6, duration: 700 });
  }
}

const lensSwitch = () => h('div', { class: 'chip-row no-drag h3-lens', role: 'group', 'aria-label': t('h3.toggle') },
  [['count', t('gaps.places')], ['gaps', t('gaps.toggle')]].map(([id, label]) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(lens === id), onclick: () => setLens(id) }, label)));

function toggleHexes(button) {
  hexes = !hexes;
  button.setAttribute('aria-pressed', String(hexes));
  if (!hexes) { cell = null; lens = 'count'; hideCells(); renderList(); if (data) drawMap(filtered()); return; }
  loadCells().then((loaded) => {
    cells = loaded;
    if (!hexes || !root) return;
    if (data) drawMap(filtered());
    renderList();
    // The honeycomb reads best over the whole city.
    const map = getMap();
    if (map && map.getZoom() > 12.6) map.easeTo({ zoom: 12.4, duration: 700 });
  }).catch(() => { hexes = false; button.setAttribute('aria-pressed', 'false'); if (countHost) countHost.textContent = t('h3.failed'); });
}

function geojson(items) {
  return { type: 'FeatureCollection', features: items.map(({ place }) => ({ type: 'Feature', id: undefined, properties: { id: place.id, category: place.category }, geometry: { type: 'Point', coordinates: [place.lon, place.lat] } })) };
}

function drawMap(items) {
  const colors = () => ['match', ['get', 'category'], ...Object.entries(CATEGORY_COLOR).flatMap(([category, variable]) => [category, cssVar(variable)]), cssVar('--ink-3')];
  setOverlay('places', {
    sources: { places: { type: 'geojson', data: geojson(items) } },
    layers: [
      // With «Соты H3» on, the dots shrink so the cells read and can be tapped between them.
      // In 3D the cells stand as columns and the dots would float over them, so the dots step aside;
      // «Город 15 минут» is about the city rather than single places, so its colours stay clear of dots.
      { id: 'places-dots', type: 'circle', source: 'places', layout: { visibility: hexes && (isTilted() || lens === 'gaps') ? 'none' : 'visible' }, paint: { 'circle-color': colors,
        'circle-radius': () => ['interpolate', ['linear'], ['zoom'], 10, hexes ? 1.5 : 2.5, 13, hexes ? 2.5 : 4.5, 16, hexes ? 5 : 8],
        'circle-stroke-color': () => cssVar('--surface'), 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 14, hexes ? 1 : 1.5] } },
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
  const everywhere = hexes && cells ? filtered({ inSelectedCell: false }) : items;
  setData('places', geojson(everywhere));
  countHost.textContent = t('explore.count', { n: number(items.length) });
  let summary = null;
  if (hexes && cells && lens === 'gaps') {
    // The gaps are the city's, so they stay the same whatever the filters; a tapped cell still narrows the list.
    showGaps(cells, pickCell);
    const clearButton = h('button', { class: 'btn btn-quiet btn-small', type: 'button', text: t('h3.clear'), onclick: () => pickCell(null) });
    summary = h('div', {}, lensSwitch(), cell ? gapCell(cells, cell, clearButton) : gapsSummary(cells));
  } else if (hexes && cells) {
    const groups = groupPlaces(cells, everywhere.map(({ place }) => place));
    showCells(cells, everywhere.map(({ place }) => place), pickCell);
    if (cell && !groups.has(cell)) { cell = null; selectCell(null); return renderList(); }
    summary = h('div', {}, lensSwitch(), cell ? cellSummary(groups.get(cell)) : h('p', { class: 'fine h3-hint', text: `${t('h3.hint')} ${t('h3.about')}` }));
  }
  if (!items.length) { clear(listHost, summary, h('p', { class: 'empty-note', text: t('explore.empty') })); return; }
  clear(listHost, summary, h('div', { class: 'list' }, items.slice(0, shown).map(({ place, timing }) => h('button', { class: 'list-row place-row', type: 'button', onclick: () => openPlace(place) },
    categoryArt(place.category, 36, 'art'),
    h('span', { class: 'row-text' }, h('strong', { text: placeName(place.name) }),
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
    h('button', { type: 'button', class: 'chip chip-toggle', 'aria-pressed': String(openNow), onclick: (event) => { openNow = !openNow; event.currentTarget.setAttribute('aria-pressed', String(openNow)); renderList(); } }, h('span', { class: 'status-dot', 'aria-hidden': 'true' }), t('explore.openNow')),
    h('button', { type: 'button', class: 'chip chip-h3', 'aria-pressed': String(hexes), onclick: (event) => toggleHexes(event.currentTarget) }, h('span', { class: 'hex-mark', 'aria-hidden': 'true' }), t('h3.toggle')));
  countHost = h('p', { class: 'meta', role: 'status' });
  listHost = h('div', { class: 'explore-list' }, h('p', { class: 'empty-note', text: t('explore.loading') }));
  clear(root, h('section', { class: 'view explore-view', 'aria-labelledby': 'explore-title' },
    h('h1', { id: 'explore-title', class: 'title-1', text: t('tab.explore') }),
    h('p', { class: 'meta' }, icon('pin', 'icon-xs'), t('explore.near', { name: start.name })),
    h('div', { class: 'search-field' }, icon('search', 'search-icon'), input),
    h('button', { class: 'vision-cta', type: 'button', onclick: askPhoto }, h('span', { class: 'vision-cta-icon', 'aria-hidden': 'true' }, icon('camera')),
      h('span', { class: 'row-text' }, h('strong', { text: t('vision.title') }), h('small', { text: t('vision.cta') })), h('span', { class: 'ai-chip' }, icon('sparkle', 'icon-xs'), 'Gemini')),
    chips, countHost, listHost));
  layers.showStart(start, start.name);
  if (data) { drawMap(filtered()); renderList(); }
}

function openPlace(place) {
  const start = startPoint();
  const timing = estimate(start, place);
  current = { place, timing };
  // «Позвать в место» on the «Друзья» tab starts from the place opened here.
  pickPlace(place);
  const url = new URL(location.origin);
  url.searchParams.set('tab', 'explore');
  url.searchParams.set('place', place.id);
  clear(root, placeView({ place: { ...place, retrievedAt: data?.updatedAt }, timing, start, onBack: () => { renderBrowse(); },
    onStart: () => { clear(root, readyView({ place, timing, backAt: backTime(timing), onGo: () => { startWalk({ place, start, timing }); openTab('walk'); }, onBack: () => openPlace(place) })); root.scrollTop = 0; },
    shareUrl: url.href }));
  root.scrollTop = 0;
  setSnap('half');
  drawMap(filtered());
  layers.showRoutes([{ coordinates: [[start.lon, start.lat], [place.lon, place.lat]], selected: true }]);
  layers.upgradeRoute(0, start, place);
  fitPoints([[start.lon, start.lat], [place.lon, place.lat]], { maxZoom: 17 });
}

// ---------- «Что это за здание?» ----------
function startVision(image) {
  const start = startPoint();
  vision = { image, status: 'loading' };
  renderVision();
  identify({ image, ...outbound(start) })
    .then((data) => { if (vision?.image === image) { vision = { image, status: 'done', data }; renderVision(); } })
    .catch((error) => { if (vision?.image === image) { vision = { image, status: 'error', error: error.message }; renderVision(); } });
}

function renderVision() {
  if (!root || !vision) return;
  setSnap('half');
  const { image, status, data } = vision;
  const back = backButton(t('common.back'), () => { vision = null; renderBrowse(); });
  const photo = h('img', { class: 'vision-photo', src: image, alt: t('vision.photo') });
  const again = h('button', { class: 'btn btn-quiet', type: 'button', onclick: askPhoto }, icon('camera'), t('vision.again'));
  const body = [];
  if (status === 'loading') {
    body.push(h('p', { class: 'lead vision-wait' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), t('vision.loading')));
  } else if (status === 'error') {
    body.push(h('p', { class: 'banner is-bad' }, icon('warning'), (lang() === 'ru' && vision.error) || t('vision.fail')), again);
  } else {
    const found = data.place;
    if (found) {
      const known = (data?.items || []).find((item) => item.id === found.id);
      const place = known || { ...found, sourceUrl: found.sourceUrl };
      const facts = Array.isArray(data.facts) ? data.facts : [];
      body.push(h('div', { class: 'vision-found' }, categoryArt(found.category, 48, 'art art-lg'),
        h('div', {}, h('h3', { class: 'title-2', text: found.name }),
          h('p', { class: 'meta' }, categoryName(found.category), found.distanceMeters ? h('span', { class: 'meta-sep', 'aria-hidden': 'true' }) : null,
            found.distanceMeters ? t('vision.away', { d: formatDistance(found.distanceMeters, lang()) }) : null),
          h('div', { class: 'place-badges' }, CONF[data.confidence] ? h('span', { class: `confidence confidence-${data.confidence}` }, t(CONF[data.confidence])) : null))));
      if (facts.length) body.push(h('ul', { class: 'vision-facts' }, facts.map((fact) => h('li', {}, h('span', { class: 'ai-chip' }, icon('sparkle', 'icon-xs'), t('vision.idea')), h('span', { text: fact })))));
      body.push(h('div', { class: 'place-actions' },
        h('button', { class: 'btn btn-gold', type: 'button', onclick: () => { vision = null; openPlace(place); } }, icon('walk'), t('vision.open')),
        listenButton(() => [found.name, ...facts].join('. '))));
      mapReady.then(() => { const start = startPoint(); layers.showStart(start, start.name); fitPoints([[start.lon, start.lat], [found.lon, found.lat]], { maxZoom: 17 }); });
    } else {
      body.push(h('p', { class: 'lead', text: data.seen ? `${t('vision.unknown')} ${t('vision.seen', { seen: data.seen })}` : t('vision.unknown') }));
    }
    if (data.nearby?.length) {
      body.push(h('h3', { class: 'block-title', text: t('vision.nearby') }), h('div', { class: 'list' }, data.nearby.map((item) => h('button', { class: 'list-row', type: 'button',
        onclick: () => { const known = (data?.items || []).find((p) => p.id === item.id); if (known) { vision = null; openPlace(known); } } },
      categoryArt(item.category, 32, 'art'), h('span', { class: 'row-text' }, h('strong', { text: placeName(item.name) }), h('small', { text: formatDistance(item.distanceMeters, lang()) })), icon('chevron', 'row-chevron')))));
    }
    body.push(again);
    body.push(h('p', { class: 'fine', text: t('vision.private') }));
  }
  clear(root, h('section', { class: 'view vision-view', 'aria-labelledby': 'vision-title', 'aria-busy': String(status === 'loading') },
    h('div', { class: 'view-bar' }, back),
    h('h2', { id: 'vision-title', class: 'title-1', text: t('vision.title') }),
    photo, ...body));
}
const CONF = { high: 'conf.high', medium: 'conf.medium', low: 'conf.low' };

document.addEventListener('seruen:tilt', () => { if (hexes && data && root && !current && !vision) drawMap(filtered({ inSelectedCell: false })); });

registerTab({
  id: 'explore', ownMap: true, order: 20, icon: 'map', title: 'tab.explore',
  mount(container) {
    root = container;
    renderBrowse();
    api.places().then((loaded) => {
      data = loaded;
      if (root !== container) return;
      if (vision) { drawMap(filtered()); return; }
      const wanted = new URLSearchParams(location.search).get('place');
      const place = wanted && data.items.find((item) => item.id === wanted);
      if (place) { history.replaceState(null, '', location.pathname); openPlace(place); return; }
      drawMap(filtered()); renderList();
      mapReady.then(() => { const start = startPoint(); flyTo([start.lon, start.lat], 14.6, 600, { exact: true }); });
    }).catch(() => { if (listHost) clear(listHost, h('p', { class: 'empty-note', text: t('explore.failed') })); });
  },
  reopen(params) { if (!root) return; if (params?.vision) startVision(params.vision); else { vision = null; renderBrowse(); } },
  unmount() { removeOverlay('places'); hideCells(); hexes = false; cell = null; lens = 'count'; layers.hideRoutes(); layers.hideStart(); root = null; vision = null; },
});
