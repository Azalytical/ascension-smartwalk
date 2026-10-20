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
import { categoryArt, categoryName, hoursStatus, hoursChip, CATEGORY_COLOR, backButton, listenButton } from '../ui/common.js';
import { placeView } from '../ui/place.js';
import { startWalk } from '../ui/live.js';
import { askPhoto } from '../ui/vision.js';
import { identify } from '../core/media.js';

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

// ---------- «Что это за здание?» ----------
function startVision(image) {
  const start = startPoint();
  vision = { image, status: 'loading' };
  renderVision();
  identify({ image, lat: start.lat, lon: start.lon })
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
    body.push(h('p', { class: 'banner is-bad' }, icon('warning'), vision.error || t('vision.fail')), again);
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
      categoryArt(item.category, 32, 'art'), h('span', { class: 'row-text' }, h('strong', { text: item.name }), h('small', { text: formatDistance(item.distanceMeters, lang()) })), icon('chevron', 'row-chevron')))));
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
  unmount() { removeOverlay('places'); layers.hideRoutes(); layers.hideStart(); root = null; vision = null; },
});
