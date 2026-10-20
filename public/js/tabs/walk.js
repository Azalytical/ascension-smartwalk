// The main tab: plan a walk, see the options, open a place, walk with the return countdown.
import { registerTab } from '../shell.js';
import { h, icon, clear, isDesktop } from '../core/dom.js';
import { t, pick, plural, lang, time, date as formatDate, number } from '../core/i18n.js';
import * as store from '../core/store.js';
import { PRESETS, inAstana, reachMeters, estimate } from '../core/geo.js';
import * as api from '../core/api.js';
import { mapReady, getMap, flyTo, fitPoints } from '../map/map.js';
import * as layers from '../map/layers.js';
import { setSnap, ensureAtLeast, getSnap } from '../ui/sheet.js';
import { toast, announce } from '../ui/toast.js';
import { timeRing } from '../ui/ring.js';
import { art, categoryArt, categoryName, hoursStatus, hoursChip, share, returnBy, backButton } from '../ui/common.js';
import { placeView } from '../ui/place.js';
import { mountLive, startWalk } from '../ui/live.js';

const MINUTES = [30, 45, 60, 90, 120];
const MAX_WALK = [10, 15, 20, 30];
const MOODS = [
  ['coffee', 'coffee'], ['food', 'food'], ['park', 'park'], ['water', 'waterfront'],
  ['kids', 'family'], ['culture', 'museum'], ['sights', 'landmark'], ['indoor', 'indoor'],
];
const IDEAS = [
  { id: 'coffee', art: 'coffee', start: 'mega', minutes: 45, maxWalk: 15, mood: 'coffee' },
  { id: 'kids', art: 'family', start: 'baiterek', minutes: 60, maxWalk: 10, mood: 'kids' },
  { id: 'water', art: 'waterfront', start: 'embankment', minutes: 45, maxWalk: 15, mood: 'water' },
];

const defaults = { minutes: 45, maxWalk: 15, query: '', mood: null, when: 'now' };
let plan = { ...defaults, ...(store.get('plan') || {}) };
let start = store.get('start') || presetStart('baiterek');
let view = store.get('walk') ? 'live' : 'plan';
let result = null;
let request = null;
let selected = 0;
let error = null;
let inflight = null;
let root = null;
let liveCleanup = null;
let lastRoute = null;

function presetStart(id) {
  const preset = PRESETS.find((item) => item.id === id) || PRESETS[0];
  return { kind: 'preset', id: preset.id, name: pick(preset.name), names: preset.name, lat: preset.lat, lon: preset.lon };
}
const startName = () => (start.names ? pick(start.names) : start.kind === 'gps' ? t('start.gps') : start.kind === 'map' ? t('start.picked') : start.name);
function savePlan() { store.set('plan', plan); }
function setStart(next) { start = next; store.set('start', next); store.rememberStart(next); }

function leaveAt() {
  if (plan.when === 'in1h') return Date.now() + 3600000;
  if (plan.when === 'evening') {
    const now = new Date();
    const astanaNow = new Date(now.getTime() + 5 * 3600000);
    const target = Date.UTC(astanaNow.getUTCFullYear(), astanaNow.getUTCMonth(), astanaNow.getUTCDate(), 19, 0) - 5 * 3600000;
    return target > now.getTime() ? target : Date.now();
  }
  return Date.now();
}
function isoWithOffset(ms) {
  const shifted = new Date(ms + 5 * 3600000).toISOString().slice(0, 16);
  return `${shifted}:00+05:00`;
}

function greeting() {
  const hour = new Date(Date.now() + 5 * 3600000).getUTCHours();
  return t(hour < 5 ? 'greet.night' : hour < 12 ? 'greet.morning' : hour < 18 ? 'greet.day' : hour < 23 ? 'greet.evening' : 'greet.night');
}

// ---------- rendering ----------
function render() {
  if (!root) return;
  if (view !== 'live' && liveCleanup) { liveCleanup(); liveCleanup = null; }
  const renderers = { plan: renderPlan, start: renderStart, pick: renderPick, loading: renderLoading, results: renderResults, place: renderPlace, live: renderLive };
  (renderers[view] || renderPlan)();
  root.scrollTop = 0;
}

function renderPlan() {
  const minutesGroup = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': t('plan.title') },
    MINUTES.map((value) => h('button', { type: 'button', role: 'radio', class: 'seg', 'aria-checked': String(plan.minutes === value),
      onclick: () => { plan.minutes = value; savePlan(); updatePlanLive(); minutesGroup.querySelectorAll('.seg').forEach((b, i) => b.setAttribute('aria-checked', String(MINUTES[i] === value))); } },
    h('span', { class: 'num', text: value === 120 ? t('plan.2h') : value }), value === 120 ? null : h('small', { text: t('plan.min', { n: '' }).trim() }))));

  const query = h('input', { id: 'query', class: 'field-input', type: 'search', enterkeyhint: 'search', autocomplete: 'off', spellcheck: 'false', maxlength: 400,
    placeholder: t('plan.queryPlaceholder'), value: plan.query, 'aria-label': t('plan.queryLabel') });
  query.addEventListener('input', () => { plan.query = query.value; plan.mood = MOODS.find(([id]) => t(`moodQuery.${id}`) === query.value)?.[0] || null; savePlan(); syncMoods(); });
  query.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); query.blur(); submit(); } });
  const mic = voiceButton(query);

  const moods = h('div', { class: 'chip-row no-drag', role: 'group', 'aria-label': t('plan.queryLabel') },
    MOODS.map(([id, file]) => h('button', { type: 'button', class: 'chip', dataset: { mood: id }, 'aria-pressed': String(plan.mood === id),
      onclick: () => { const on = plan.mood !== id; plan.mood = on ? id : null; plan.query = on ? t(`moodQuery.${id}`) : ''; query.value = plan.query; savePlan(); syncMoods(); } },
    art(file, 22, 'chip-art'), t(`mood.${id}`))));
  function syncMoods() { moods.querySelectorAll('.chip').forEach((chip) => chip.setAttribute('aria-pressed', String(chip.dataset.mood === plan.mood))); }

  const startRow = h('button', { class: 'row-button', type: 'button', onclick: () => { view = 'start'; render(); } },
    h('span', { class: 'row-icon start-icon', 'aria-hidden': 'true' }, icon(start.kind === 'gps' ? 'locate' : 'pin')),
    h('span', { class: 'row-text' }, h('small', { text: t('plan.from') }), h('strong', { text: startName() })), icon('chevron', 'row-chevron'));

  const walkGroup = h('div', { class: 'segmented segmented-sm', role: 'radiogroup', 'aria-label': t('plan.maxWalk') },
    MAX_WALK.map((value) => h('button', { type: 'button', role: 'radio', class: 'seg', 'aria-checked': String(plan.maxWalk === value),
      onclick: () => { plan.maxWalk = value; savePlan(); updatePlanLive(); walkGroup.querySelectorAll('.seg').forEach((b, i) => b.setAttribute('aria-checked', String(MAX_WALK[i] === value))); } }, h('span', { class: 'num', text: t('plan.min', { n: value }) }))));
  const whenGroup = h('div', { class: 'segmented segmented-sm', role: 'radiogroup', 'aria-label': t('plan.when') },
    ['now', 'in1h', 'evening'].map((value) => h('button', { type: 'button', role: 'radio', class: 'seg', 'aria-checked': String(plan.when === value),
      onclick: () => { plan.when = value; savePlan(); updatePlanLive(); whenGroup.querySelectorAll('.seg').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.when === value))); }, dataset: { when: value } }, t(`plan.${value}`))));

  const more = h('details', { class: 'disclosure plan-more', open: plan.maxWalk !== defaults.maxWalk || plan.when !== 'now' },
    h('summary', {}, icon('filter'), t('plan.more')),
    h('div', { class: 'field' }, h('span', { class: 'field-label', text: t('plan.maxWalk') }), walkGroup),
    h('div', { class: 'field' }, h('span', { class: 'field-label', text: t('plan.when') }), whenGroup));

  const returnLine = h('span', { class: 'cta-sub num' });
  const cta = h('button', { class: 'btn btn-gold btn-xl cta', type: 'button', onclick: submit }, h('span', { class: 'cta-main' }, icon('sparkle'), t('plan.submit')), returnLine);
  function updatePlanLive() {
    returnLine.textContent = t('plan.returnBy', { time: time(leaveAt() + plan.minutes * 60000) });
    layers.updateReach(start, reachMeters(plan.minutes, plan.maxWalk));
  }

  const weatherHost = h('div');
  const ideas = h('div', { class: 'ideas no-drag' }, IDEAS.map((idea) => h('button', { class: 'idea', type: 'button', onclick: () => runIdea(idea) },
    art(idea.art, 44, 'idea-art'), h('span', { class: 'idea-text' }, h('strong', { text: t(`idea.${idea.id}.title`) }), h('small', { text: t(`idea.${idea.id}.sub`) })))));

  clear(root, h('section', { class: 'view plan-view', 'aria-labelledby': 'plan-title' },
    h('div', { class: 'plan-top' }, h('p', { class: 'eyebrowless', text: greeting() }), weatherHost),
    h('h1', { id: 'plan-title', class: 'title-1', text: t('plan.title') }),
    minutesGroup,
    h('div', { class: 'search-field' }, icon('search', 'search-icon'), query, mic),
    moods,
    startRow,
    more,
    cta,
    h('h2', { class: 'block-title', text: t('plan.ideas') }),
    ideas,
    dataFooter()));
  updatePlanLive();
  renderWeather(weatherHost, () => { plan.mood = 'indoor'; plan.query = t('moodQuery.indoor'); query.value = plan.query; savePlan(); syncMoods(); });
  drawPlanMap();
}

function dataFooter() {
  const line = h('p', { class: 'fine data-line' });
  api.status().then((status) => {
    if (!status) return;
    const day = formatDate(status.updatedAt);
    line.replaceChildren(icon('map'), t('results.source', { count: number(status.poiCount), date: day || '—' }));
  });
  return line;
}

async function renderWeather(host, onIndoor) {
  const current = await api.weather();
  if (!current || !host.isConnected) return;
  const temp = Math.round(current.temperature_2m);
  const wet = current.precipitation > 0 || [51, 53, 55, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99].includes(current.weather_code);
  const snowy = [71, 73, 75, 77, 85, 86].includes(current.weather_code);
  host.replaceChildren(h('span', { class: 'weather-pill num' }, icon(snowy ? 'snow' : wet ? 'rain' : current.weather_code <= 1 ? 'sun' : 'cloud'), `${temp > 0 ? '+' : ''}${temp}°`));
  const reason = wet ? t('weather.rain') : temp <= -10 ? t('weather.cold', { t: temp }) : current.wind_speed_10m >= 12 ? t('weather.wind') : null;
  if (reason && plan.mood !== 'indoor') {
    const banner = h('div', { class: 'banner' }, icon(wet ? 'rain' : 'cloud'), h('span', { text: reason }),
      h('button', { class: 'btn btn-sm btn-primary', type: 'button', text: t('weather.yes'), onclick: () => { onIndoor(); banner.remove(); } }));
    root.querySelector('.plan-view h1')?.after(banner);
  }
}

function voiceButton(input) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const button = h('button', { class: 'icon-btn mic', type: 'button', 'aria-label': t('plan.voice') }, icon('mic'));
  if (!Recognition) { button.hidden = true; return button; }
  let active = null;
  button.addEventListener('click', () => {
    if (active) { active.stop(); return; }
    const recognition = new Recognition();
    recognition.lang = { ru: 'ru-RU', kk: 'kk-KZ', en: 'en-US' }[lang()];
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    active = recognition;
    button.classList.add('is-listening');
    input.placeholder = t('plan.voiceListening');
    recognition.onresult = (event) => {
      input.value = [...event.results].map((item) => item[0].transcript).join(' ');
      plan.query = input.value; plan.mood = null; savePlan();
      root?.querySelectorAll('.chip[data-mood]').forEach((chip) => chip.setAttribute('aria-pressed', 'false'));
    };
    recognition.onend = () => { active = null; button.classList.remove('is-listening'); input.placeholder = t('plan.queryPlaceholder'); };
    recognition.onerror = () => recognition.onend();
    try { recognition.start(); } catch { recognition.onend(); }
  });
  return button;
}

function drawPlanMap() {
  layers.hidePins(); layers.hideRoutes();
  layers.showStart(start, startName());
  layers.showReach(start, reachMeters(plan.minutes, plan.maxWalk));
  const radius = reachMeters(plan.minutes, plan.maxWalk);
  const dLat = radius / 111320; const dLon = radius / (111320 * Math.cos(start.lat * Math.PI / 180));
  if (getMap()) fitPoints([[start.lon - dLon, start.lat - dLat], [start.lon + dLon, start.lat + dLat]], { maxZoom: 15, duration: 600 });
}

// ---------- start point ----------
function renderStart() {
  const message = h('p', { class: 'inline-message', role: 'status', hidden: true });
  const choose = (next) => { setStart(next); view = 'plan'; render(); };
  const gps = h('button', { class: 'list-row', type: 'button', onclick: () => locate(message, choose) },
    h('span', { class: 'row-icon is-sky', 'aria-hidden': 'true' }, icon('locate')), h('span', { class: 'row-text' }, h('strong', { text: t('start.gps') }), h('small', { text: t('start.gpsHint') })));
  const pickRow = h('button', { class: 'list-row', type: 'button', onclick: () => { view = 'pick'; render(); } },
    h('span', { class: 'row-icon', 'aria-hidden': 'true' }, icon('target')), h('span', { class: 'row-text' }, h('strong', { text: t('start.pick') }), h('small', { text: t('start.pickHint') })));
  const recent = (store.get('recentStarts') || []).filter((item) => item.kind === 'map');
  clear(root, h('section', { class: 'view start-view' },
    h('div', { class: 'view-bar' }, backButton(t('common.back'), () => { view = 'plan'; render(); })),
    h('h2', { class: 'title-2', text: t('start.title') }),
    h('div', { class: 'list' }, gps, pickRow), message,
    recent.length ? h('h3', { class: 'block-title', text: t('start.recent') }) : null,
    recent.length ? h('div', { class: 'list' }, recent.map((item) => h('button', { class: 'list-row', type: 'button', onclick: () => choose(item) },
      h('span', { class: 'row-icon', 'aria-hidden': 'true' }, icon('history')), h('span', { class: 'row-text' }, h('strong', { text: t('start.picked') }), h('small', { class: 'num', text: `${item.lat.toFixed(4)}, ${item.lon.toFixed(4)}` }))))) : null,
    h('h3', { class: 'block-title', text: t('start.presets') }),
    h('div', { class: 'list' }, PRESETS.map((preset) => h('button', { class: `list-row${start.id === preset.id ? ' is-current' : ''}`, type: 'button', onclick: () => choose(presetStart(preset.id)) },
      h('span', { class: 'row-icon', 'aria-hidden': 'true' }, icon('pin')), h('span', { class: 'row-text' }, h('strong', { text: pick(preset.name) })), start.id === preset.id ? icon('check', 'row-check') : null)))));
}

function locate(message, choose) {
  const show = (text) => { message.textContent = text; message.hidden = false; };
  if (!navigator.geolocation) { show(t('start.failed')); return; }
  show(t('start.locating'));
  navigator.geolocation.getCurrentPosition((position) => {
    const { latitude: lat, longitude: lon } = position.coords;
    if (!inAstana(lat, lon)) { show(t('start.outside')); return; }
    choose({ kind: 'gps', name: t('start.gps'), lat, lon });
    toast(t('toast.locationShared'), { iconName: 'locate' });
  }, (failure) => show(failure.code === 1 ? t('start.denied') : t('start.failed')), { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
}

function renderPick() {
  const map = getMap();
  if (!map) { view = 'start'; render(); return; }
  layers.hideReach();
  layers.hideStart();
  setSnap('peek');
  document.body.classList.add('is-picking');
  const message = h('p', { class: 'inline-message', role: 'status', hidden: true });
  const done = () => {
    const center = map.getCenter();
    if (!inAstana(center.lat, center.lng)) { message.textContent = t('start.outsidePick'); message.hidden = false; return; }
    document.body.classList.remove('is-picking');
    setStart({ kind: 'map', name: t('start.picked'), lat: +center.lat.toFixed(6), lon: +center.lng.toFixed(6) });
    view = 'plan'; setSnap('half'); render();
  };
  clear(root, h('section', { class: 'view pick-view' },
    h('p', { class: 'lead', text: t('start.pickHint') }), message,
    h('div', { class: 'pick-actions' },
      h('button', { class: 'btn btn-quiet', type: 'button', text: t('start.pickCancel'), onclick: () => { document.body.classList.remove('is-picking'); view = 'start'; setSnap('half'); render(); } }),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: done }, icon('check'), t('start.pickDone')))));
  flyTo([start.lon, start.lat], 15, 500);
}

// ---------- request ----------
function buildRequest() {
  const body = { lat: start.lat, lon: start.lon, minutes: plan.minutes, maxWalkMinutes: plan.maxWalk, query: plan.query.trim(), withChild: plan.mood === 'kids', category: 'any', returnToStart: true };
  if (plan.when !== 'now') body.visitDate = isoWithOffset(leaveAt());
  return body;
}

async function submit() {
  inflight?.abort();
  const controller = new AbortController();
  inflight = controller;
  request = buildRequest();
  result = null; error = null; selected = 0;
  view = 'loading'; render();
  try {
    const data = await api.recommend(request, controller.signal);
    if (controller.signal.aborted) return;
    result = data;
    view = 'results';
    store.addHistory({ key: JSON.stringify([request.lat.toFixed(3), request.lon.toFixed(3), request.minutes, request.query]), kind: 'plan', plan: { ...plan }, start, count: data.recommendations.length });
    announce(`${t('results.title', { min: request.minutes })}: ${data.recommendations.length}`);
  } catch (failure) {
    if (failure.kind === 'aborted' || controller.signal.aborted) return;
    error = failure;
    view = 'results';
  } finally { if (inflight === controller) inflight = null; }
  render();
}

function runIdea(idea) {
  setStart(presetStart(idea.start));
  plan = { ...plan, minutes: idea.minutes, maxWalk: idea.maxWalk, mood: idea.mood, query: t(`moodQuery.${idea.mood}`), when: 'now' };
  savePlan();
  submit();
}

function renderLoading() {
  const steps = ['loading.s1', 'loading.s2', 'loading.s3', 'loading.s4'];
  const list = h('ol', { class: 'progress-steps' }, steps.map((key) => h('li', {}, h('span', { class: 'step-dot', 'aria-hidden': 'true' }), t(key))));
  clear(root, h('section', { class: 'view loading-view', 'aria-busy': 'true' },
    h('div', { class: 'view-bar' }, backButton(t('common.cancel'), () => { inflight?.abort(); view = 'plan'; render(); })),
    h('h2', { class: 'title-2', text: t('loading.title') }),
    list,
    h('div', { class: 'skeletons', 'aria-hidden': 'true' }, [0, 1, 2].map(() => h('div', { class: 'skeleton-row' }, h('span', { class: 'sk sk-art' }), h('span', { class: 'sk-lines' }, h('span', { class: 'sk sk-line' }), h('span', { class: 'sk sk-line short' })))))));
  const items = [...list.children];
  items.forEach((item, index) => setTimeout(() => {
    if (!item.isConnected) return;
    items.forEach((other, j) => { other.classList.toggle('is-done', j < index); other.classList.toggle('is-current', j === index); });
  }, [0, 450, 1000, 1600][index]));
  layers.hideReach();
}

// ---------- results ----------
function shareLink() {
  const url = new URL(location.origin);
  url.searchParams.set('t', String(plan.minutes));
  if (plan.maxWalk !== defaults.maxWalk) url.searchParams.set('w', String(plan.maxWalk));
  if (plan.query) url.searchParams.set('q', plan.query);
  if (start.kind === 'preset') url.searchParams.set('from', start.id);
  else { url.searchParams.set('lat', start.lat.toFixed(5)); url.searchParams.set('lon', start.lon.toFixed(5)); }
  url.searchParams.set('go', '1');
  return url.href;
}

function renderResults() {
  const back = backButton(t('results.back'), () => { view = 'plan'; render(); });
  if (error) { renderError(back); return; }
  const recs = (result?.recommendations || []).slice(0, 3);
  if (!recs.length) { renderEmpty(back); return; }
  const generation = result.generation || {};
  const llm = generation.mode === 'llm' && generation.summary;
  const leave = leaveAt();
  const cardWarnings = recs.map((place) => (Array.isArray(place.warnings) ? place.warnings : []));
  const shared = recs.length > 1 ? cardWarnings[0].filter((w) => cardWarnings.every((list) => list.includes(w))) : [];
  const unchecked = [...new Set([...(result.warnings || []), ...shared])];

  const rows = recs.map((place, index) => {
    const status = hoursStatus(place, place.walkMinutes, place.visitMinutes, place.hoursCheck);
    return h('button', { class: `result-row${index === selected ? ' is-selected' : ''}`, type: 'button', dataset: { index }, onclick: () => openResult(index),
      onmouseenter: () => highlight(index), onfocus: () => highlight(index) },
    h('span', { class: 'result-num num', 'aria-hidden': 'true', text: index + 1 }),
    categoryArt(place.category, 44, 'art'),
    h('span', { class: 'result-text' }, h('strong', { class: 'result-name', text: place.name }),
      h('span', { class: 'meta' }, categoryName(place.category), h('span', { class: 'meta-sep', 'aria-hidden': 'true' }), t('explore.walk', { n: place.walkMinutes })),
      hoursChip(status)),
    h('span', { class: 'result-time' }, timeRing({ there: place.walkMinutes, visit: place.visitMinutes, back: place.returnMinutes, reserve: place.safetyReserveMinutes, size: 50, stroke: 6 }),
      h('span', { class: 'num result-total', text: t('plan.min', { n: place.totalMinutes }) })));
  });

  clear(root, h('section', { class: 'view results-view', 'aria-labelledby': 'results-title' },
    h('div', { class: 'view-bar' }, back, h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('place.share'), onclick: () => share({ title: 'Seruen', text: t('results.title', { min: request.minutes }), url: shareLink() }) }, icon('share'))),
    h('h2', { id: 'results-title', class: 'title-1', text: t('results.title', { min: request.minutes }) }),
    h('p', { class: 'meta' }, icon('pin', 'icon-xs'), t('results.start', { name: startName() }), h('span', { class: 'meta-sep', 'aria-hidden': 'true' }), t('plan.returnBy', { time: time(leave + request.minutes * 60000) })),
    llm ? aiCard(generation) : h('div', { class: 'ai-card is-quiet' }, h('p', { class: 'fine', text: t('results.fallback') })),
    h('div', { class: 'result-list' }, rows),
    understoodRow(result.understood),
    routeCard(result.route),
    unchecked.length ? h('details', { class: 'disclosure' }, h('summary', {}, icon('info'), t('results.unchecked'), h('span', { class: 'count num', text: unchecked.length })), h('ul', { class: 'bullets fine' }, unchecked.map((w) => h('li', { text: w })))) : null,
    h('p', { class: 'fine data-line' }, icon('map'), t('results.source', { count: number(result.dataset?.poiCount || 0), date: formatDate(result.dataset?.updatedAt) || '—' }))));
  drawResultsMap(recs);
}

// «Мы учли»: what the server understood from the request (time, categories, child, night, weather, hours).
function understoodRow(items) {
  const shown = (items || []).filter((item) => item.key !== 'location' && item.label);
  if (!shown.length) return null;
  const icons = { time: 'clock', categories: 'filter', child: 'user', night: 'moon', group: 'friends', accessible: 'accessible', weather: 'cloud', hours: 'clock' };
  return h('div', { class: 'understood' }, h('p', { class: 'understood-title', text: t('results.understood') }),
    h('div', { class: 'chip-row no-drag' }, shown.map((item) => h('span', { class: 'chip is-static' }, icon(icons[item.key] || 'check', 'icon-xs'), item.label))));
}

// A three-stop micro-route from the server: stops with clock times, shown on the map on tap.
function routeCard(route) {
  const stops = (route?.stops || []).filter((stop) => Number.isFinite(stop.lat) && Number.isFinite(stop.lon));
  if (stops.length < 2) return null;
  const show = () => {
    const chain = [[start.lon, start.lat], ...stops.map((stop) => [stop.lon, stop.lat]), ...(route.returnToStart ? [[start.lon, start.lat]] : [])];
    layers.showPins(stops, () => {});
    layers.showRoutes([{ coordinates: chain, selected: true }]);
    fitPoints(chain, { maxZoom: 17 });
    ensureAtLeastHalf();
    toast(t('results.routeShown'), { iconName: 'route' });
  };
  return h('section', { class: 'route-card' },
    h('div', { class: 'route-head' }, h('span', { class: 'route-icon', 'aria-hidden': 'true' }, icon('route')),
      h('div', {}, h('strong', { text: t('results.route', { n: stops.length }) }),
        h('small', { class: 'num', text: t('results.routeMeta', { n: route.totalMinutes, time: route.backBy || '' }) }))),
    h('ol', { class: 'route-stops' }, stops.map((stop) => h('li', {},
      h('span', { class: 'route-time num', text: stop.arriveAt || '' }),
      h('span', { class: 'row-text' }, h('strong', { text: stop.name }), h('small', { text: t('results.routeStop', { walk: stop.walkFromPreviousMinutes, visit: stop.visitMinutes }) }))))),
    h('button', { class: 'btn btn-quiet btn-sm', type: 'button', onclick: show }, icon('map'), t('results.routeShow')));
}
const ensureAtLeastHalf = () => { if (getSnap() === 'full') setSnap('half'); };

// The Gemini tip, three lines at first so the places stay in view; the full text and the note open on tap.
function aiCard(generation) {
  const note = h('p', { class: 'fine', text: t('results.aiNote'), hidden: true });
  const more = h('button', { class: 'ai-more', type: 'button', 'aria-expanded': 'false', text: t('results.aiMore') });
  const card = h('div', { class: 'ai-card' }, h('p', { class: 'ai-label' }, icon('sparkle'), t(generation.provider === 'gemini' ? 'results.aiGemini' : 'results.ai')),
    h('p', { class: 'ai-text', text: generation.summary }), generation.label ? h('p', { class: 'origin', text: generation.label }) : null, note, more);
  more.addEventListener('click', () => {
    const open = !card.classList.contains('is-open');
    card.classList.toggle('is-open', open);
    note.hidden = !open;
    more.setAttribute('aria-expanded', String(open));
    more.textContent = t(open ? 'results.aiLess' : 'results.aiMore');
  });
  return card;
}

function highlight(index) {
  selected = index;
  layers.selectPin(index);
  layers.selectRoute(index);
  root.querySelectorAll('.result-row').forEach((row, i) => row.classList.toggle('is-selected', i === index));
}

function drawResultsMap(recs) {
  layers.hideReach();
  layers.showStart(start, startName());
  layers.showPins(recs, (index) => { if (view === 'results') { highlight(index); root.querySelector(`.result-row[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } else openResult(index); });
  layers.showRoutes(recs.map((place, index) => ({ coordinates: [[start.lon, start.lat], [place.lon, place.lat]], selected: index === selected })));
  layers.selectPin(selected);
  layers.frame(start, recs);
  recs.forEach((place, index) => layers.upgradeRoute(index, start, place));
}

function renderEmpty(back) {
  const actions = [];
  if (plan.minutes < 180) actions.push(h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { plan.minutes = Math.min(180, plan.minutes + 15); savePlan(); submit(); } }, icon('plus'), t('results.empty.add')));
  if (plan.maxWalk < 30) actions.push(h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => { plan.maxWalk = 30; savePlan(); submit(); } }, icon('walk'), t('results.empty.walk')));
  if (plan.query) actions.push(h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => { plan.query = ''; plan.mood = null; savePlan(); submit(); } }, icon('close'), t('results.empty.clear')));
  const nearest = result?.nearestBeyondLimits;
  if (nearest?.neededMinutes && nearest.neededMinutes <= 180) {
    const minutes = Math.min(180, Math.ceil(nearest.neededMinutes / 15) * 15);
    actions.unshift(h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { plan.minutes = minutes; plan.maxWalk = Math.max(plan.maxWalk, Math.min(60, nearest.walkMinutes)); savePlan(); submit(); } },
      icon('plus'), t('results.empty.take', { n: minutes })));
  }
  clear(root, h('section', { class: 'view state-view' }, h('div', { class: 'view-bar' }, back),
    h('div', { class: 'state-icon', 'aria-hidden': 'true' }, icon('compass')),
    h('h2', { class: 'title-2', text: t('results.empty.title') }), h('p', { class: 'lead', text: t('results.empty.text') }),
    nearest ? h('div', { class: 'pairing nearest' }, categoryArt(nearest.category, 36, 'art'), h('span', { class: 'row-text' }, h('small', { text: t('results.nearest') }), h('strong', { text: nearest.name }),
      h('small', { text: t('results.nearestValue', { walk: nearest.walkMinutes, n: nearest.neededMinutes }) }))) : null,
    h('div', { class: 'stack' }, actions)));
  layers.hidePins(); layers.hideRoutes(); layers.showReach(start, reachMeters(plan.minutes, plan.maxWalk));
}

function renderError(back) {
  const kind = error?.kind;
  const text = kind === 'offline' ? t('error.offline') : kind === 'timeout' ? t('error.timeout') : error?.message && kind !== 'server' ? error.message : (error?.message || t('error.server'));
  clear(root, h('section', { class: 'view state-view' }, h('div', { class: 'view-bar' }, back),
    h('div', { class: 'state-icon is-bad', 'aria-hidden': 'true' }, icon('warning')),
    h('h2', { class: 'title-2', text: t('error.title') }), h('p', { class: 'lead', text }),
    h('button', { class: 'btn btn-primary btn-xl', type: 'button', onclick: submit }, icon('return'), t('error.retry'))));
}

// ---------- place ----------
function openResult(index) {
  selected = index;
  view = 'place';
  render();
}

function renderPlace() {
  const place = result?.recommendations?.[selected];
  if (!place) { view = 'results'; render(); return; }
  const timing = { distanceMeters: place.distanceMeters, walkMinutes: place.walkMinutes, visitMinutes: place.visitMinutes, returnMinutes: place.returnMinutes, safetyReserveMinutes: place.safetyReserveMinutes, totalMinutes: place.totalMinutes };
  const url = new URL(shareLink());
  clear(root, placeView({ place, timing, start, serverHours: place.hoursCheck, why: place.why, activities: place.activities || [], warnings: place.warnings || [],
    backLabel: t('common.back'), onBack: () => { view = 'results'; render(); },
    onStart: () => { startWalk({ place, start, timing }); view = 'live'; render(); },
    routeInfo: lastRoute?.id === place.id ? lastRoute.route : null, shareUrl: url.href }));
  layers.selectPin(selected);
  layers.selectRoute(selected);
  fitPoints([[start.lon, start.lat], [place.lon, place.lat]], { maxZoom: 17 });
  layers.upgradeRoute(selected, start, place).then((route) => {
    if (route && view === 'place' && result?.recommendations?.[selected]?.id === place.id && lastRoute?.id !== place.id) { lastRoute = { id: place.id, route }; render(); }
  });
}

// ---------- live ----------
function renderLive() {
  layers.clearWalkLayers();
  if (!store.get('walk')) { view = 'plan'; render(); return; }
  liveCleanup?.();
  setSnap('half');
  liveCleanup = mountLive(root, { onFinished: (reason) => {
    liveCleanup?.(); liveCleanup = null;
    view = reason === 'resume' ? 'live' : result ? 'results' : 'plan';
    render();
  } });
}

// ---------- deep links ----------
function applyUrl() {
  const params = new URLSearchParams(location.search);
  if (!params.has('t') && !params.has('q') && !params.has('from') && !params.has('lat')) return false;
  const minutes = Number(params.get('t'));
  if (minutes >= 10 && minutes <= 180) plan.minutes = minutes;
  const maxWalk = Number(params.get('w'));
  if (maxWalk >= 1 && maxWalk <= 60) plan.maxWalk = maxWalk;
  if (params.has('q')) { plan.query = params.get('q').slice(0, 400); plan.mood = null; }
  if (params.get('from') && PRESETS.some((item) => item.id === params.get('from'))) setStart(presetStart(params.get('from')));
  const lat = Number(params.get('lat')); const lon = Number(params.get('lon'));
  if (params.has('lat') && inAstana(lat, lon)) setStart({ kind: 'map', name: t('start.picked'), lat, lon });
  savePlan();
  history.replaceState(null, '', location.pathname);
  return params.get('go') === '1';
}

registerTab({
  id: 'walk', ownMap: true, order: 10, icon: 'loop', title: 'tab.walk',
  mount(container) {
    root = container;
    if (store.get('walk')) view = 'live';
    if (view === 'pick') view = 'start';
    if (applyUrl() && view !== 'live') { submit(); return; }
    if (view === 'loading' && !inflight) view = result ? 'results' : 'plan';
    render();
    mapReady.then(() => { if (root === container && root.isConnected) render(); });
  },
  reopen() { if (view !== 'live' && view !== 'loading') { view = 'plan'; render(); } },
  unmount() {
    document.body.classList.remove('is-picking');
    liveCleanup?.(); liveCleanup = null;
    layers.clearWalkLayers(); layers.hideStart();
    root = null;
  },
});
