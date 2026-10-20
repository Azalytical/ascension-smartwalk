// The main tab: plan a walk, see the options, open a place, walk with the return countdown.
import { registerTab } from '../shell.js';
import { h, icon, clear, isDesktop, safeUrl } from '../core/dom.js';
import { t, pick, plural, lang, time } from '../core/i18n.js';
import * as store from '../core/store.js';
import { PRESETS, inAstana, reachMeters, estimate } from '../core/geo.js';
import * as api from '../core/api.js';
import { mapReady, getMap, flyTo, fitPoints } from '../map/map.js';
import * as layers from '../map/layers.js';
import { setSnap, ensureAtLeast, getSnap } from '../ui/sheet.js';
import { toast, announce } from '../ui/toast.js';
import { timeRing } from '../ui/ring.js';
import { art, categoryArt, categoryName, hoursStatus, hoursChip, share, backTime, confidenceChip, backButton, listenButton } from '../ui/common.js';
import { placeView } from '../ui/place.js';
import { understand, canListen, startListening } from '../core/voice.js';
import { speakText, stopSpeaking, unlockAudio } from '../core/media.js';
import { locateMe } from '../core/where.js';
import { mountLive, startWalk } from '../ui/live.js';

const MINUTES = [30, 45, 60, 90, 120];
const MAX_WALK = [10, 15, 20, 30];
const MOODS = [
  ['coffee', 'coffee'], ['food', 'food'], ['park', 'park'], ['water', 'waterfront'],
  ['kids', 'family'], ['culture', 'museum'], ['sights', 'landmark'], ['indoor', 'indoor'],
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
// Where the walk starts: a fresh GPS fix by default. A start picked by hand (a place, a map point, a shared link) is kept
// for half an hour. A fix older than FRESH_MS is refreshed before planning, and one older than STALE_MS is never used.
let locating = null;
let locationNote = null;
// Set when «Найти» had no real start: the start screen explains why, and choosing a start runs the search.
let startPrompt = null;
// A search started by voice is answered aloud: the Gemini tip, or a short line when there is none.
let speakNext = false;
// Hands-free: after the spoken answer the mic listens again for a follow-up («второй», «поехали», «а на полчаса?»).
// It ends when nothing is said, on «хватит», after MAX_VOICE_TURNS, or when the person types or stops the voice.
let voiceTurns = 0;
let voice = null;
const MAX_VOICE_TURNS = 5;
const MANUAL_START_MS = 30 * 60000;
const FRESH_MS = 2 * 60000;
const STALE_MS = 15 * 60000;
// iPhone with «Точная геопозиция» off gives a fix within a few kilometres: say so instead of planning from it silently.
const COARSE_M = 300;

function presetStart(id) {
  const preset = PRESETS.find((item) => item.id === id) || PRESETS[0];
  return { kind: 'preset', id: preset.id, name: pick(preset.name), names: preset.name, lat: preset.lat, lon: preset.lon };
}
const startName = () => (start.names ? pick(start.names) : start.kind === 'gps' ? t('start.here') : start.kind === 'map' ? t('start.picked') : start.name);
function savePlan() { store.set('plan', plan); }
function setStart(next, manual = true) { start = next; store.set('start', next); store.set('startManual', manual ? Date.now() : 0); store.rememberStart(next); }

const isManual = () => Date.now() - (store.get('startManual') || 0) < MANUAL_START_MS;
const fixAge = () => (start.kind === 'gps' ? Date.now() - (start.at || 0) : Infinity);
// A start the app fell back to on its own (no fix and nothing picked) is never planned from without asking.
const isFallback = () => start.kind !== 'gps' && !isManual();
const gpsStart = (fix) => ({ kind: 'gps', lat: fix.lat, lon: fix.lon, accuracy: fix.accuracy, at: fix.at });

/** Gets a fresh fix unless the start was picked by hand or the fix is still fresh; force asks again regardless. */
function autoLocate(force = false) {
  if (locating) return locating;
  if (!force && (isManual() || fixAge() < FRESH_MS)) return Promise.resolve();
  locationNote = null;
  locating = locateMe().then((fix) => {
    if (inAstana(fix.lat, fix.lon)) setStart(gpsStart(fix), false);
    else { locationNote = 'outside'; fallBack(); }
  }, (failure) => { locationNote = failure.reason || 'failed'; fallBack(); })
    .finally(() => { locating = null; refreshStart(); });
  refreshStart();
  return locating;
}
// A GPS start too old to trust gives way to the city centre, which the start row and «Найти» then flag.
function fallBack() { if (start.kind === 'gps' && fixAge() > STALE_MS) setStart(presetStart('baiterek'), false); }

// The locate button on the map counts as "start from where I am".
document.addEventListener('seruen:located', ({ detail: fix }) => {
  if (!root || view !== 'plan' || !inAstana(fix.lat, fix.lon) || (start.kind === 'gps' && start.at === fix.at)) return;
  locationNote = null;
  setStart(gpsStart(fix), false);
  refreshStart();
});
// Back from the background (the phone was in a pocket): the fix may be old, so ask again.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && root && view === 'plan') autoLocate(); });

// Only the start row and the map change, so a half-typed request stays as it is.
function refreshStart() {
  if (view !== 'plan' || !root) return;
  root.querySelector('.start-row')?.replaceWith(startRowView());
  if (getMap()) drawPlanMap();
  root.querySelector('.cta')?.dispatchEvent(new CustomEvent('refresh'));
}
function startRowView() {
  const here = start.kind === 'gps';
  const age = fixAge();
  const searching = locating && !(here && age < STALE_MS);
  const detail = locating ? t('start.locating')
    : here ? (age >= FRESH_MS ? t('start.age', { n: Math.max(1, Math.round(age / 60000)) }) : start.accuracy > COARSE_M ? t('start.coarse', { m: start.accuracy }) : start.accuracy ? t('start.accuracy', { m: start.accuracy }) : null)
      : locationNote ? t(`start.note.${locationNote}`) : null;
  const row = h('button', { class: 'row-button', type: 'button', onclick: () => { view = 'start'; render(); } },
    h('span', { class: `row-icon start-icon${here ? ' is-here' : ''}`, 'aria-hidden': 'true' }, icon(here || searching ? 'locate' : 'pin')),
    h('span', { class: 'row-text' }, h('small', { text: t('plan.from') }), h('strong', { text: searching ? t('start.locating') : startName() }),
      detail && !searching ? h('small', { class: `start-note${(!here && locationNote) || (here && start.accuracy > COARSE_M) ? ' is-warn' : ''}`, text: detail }) : null), icon('chevron', 'row-chevron'));
  // Not starting from a fresh fix: one tap brings the real location back.
  const useMine = !locating && (!here || age >= FRESH_MS)
    ? h('button', { class: 'btn btn-quiet btn-sm start-locate', type: 'button', onclick: () => autoLocate(true) }, icon('locate'), t(here ? 'start.refresh' : 'start.useMine'))
    : null;
  return h('div', { class: 'start-row' }, row, useMine);
}

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
  if (voice && voice.view !== view) dropVoice();
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
  query.addEventListener('input', () => { voiceTurns = 0; plan.query = query.value; plan.mood = MOODS.find(([id]) => t(`moodQuery.${id}`) === query.value)?.[0] || null; savePlan(); syncMoods(); });
  query.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); query.blur(); submit(); } });
  const mic = voiceButton();

  const moods = h('div', { class: 'chip-row no-drag', role: 'group', 'aria-label': t('plan.queryLabel') },
    MOODS.map(([id, file]) => h('button', { type: 'button', class: 'chip', dataset: { mood: id }, 'aria-pressed': String(plan.mood === id),
      onclick: () => { const on = plan.mood !== id; plan.mood = on ? id : null; plan.query = on ? t(`moodQuery.${id}`) : ''; query.value = plan.query; savePlan(); syncMoods(); } },
    art(file, 22, 'chip-art'), t(`mood.${id}`))));
  function syncMoods() { moods.querySelectorAll('.chip').forEach((chip) => chip.setAttribute('aria-pressed', String(chip.dataset.mood === plan.mood))); }

  const startRow = startRowView();

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
  cta.addEventListener('refresh', () => updatePlanLive());
  function updatePlanLive() {
    returnLine.textContent = t('plan.returnBy', { time: time(leaveAt() + plan.minutes * 60000) });
    layers.updateReach(start, reachMeters(plan.minutes, plan.maxWalk));
  }

  const weatherHost = h('div');

  clear(root, h('section', { class: 'view plan-view', 'aria-labelledby': 'plan-title' },
    h('div', { class: 'plan-top' }, h('p', { class: 'eyebrowless', text: greeting() }), weatherHost),
    h('h1', { id: 'plan-title', class: 'title-1', text: t('plan.title') }),
    minutesGroup,
    h('div', { class: 'search-field' }, icon('search', 'search-icon'), query, mic),
    moods,
    startRow,
    more,
    cta));
  updatePlanLive();
  renderWeather(weatherHost, () => { plan.mood = 'indoor'; plan.query = t('moodQuery.indoor'); query.value = plan.query; savePlan(); syncMoods(); });
  drawPlanMap();
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

// The mic: say "час, кофе и парк" and the walk is planned right away; the time is taken out of the phrase.
// The plan, the results and the place card each have one; they share one phrase at a time (`voice`).
function voiceButton() {
  const button = h('button', { class: 'icon-btn mic', type: 'button', 'aria-label': t('plan.voice') }, icon('mic'));
  if (!canListen()) { button.hidden = true; return button; }
  button.addEventListener('click', () => listen(false));
  return button;
}

function showVoiceState(state) {
  root?.querySelectorAll('.mic').forEach((button) => {
    button.classList.toggle('is-listening', state === 'listening');
    button.classList.toggle('is-thinking', state === 'thinking');
    button.setAttribute('aria-label', t(state === 'listening' ? 'plan.voiceStop' : 'plan.voice'));
  });
  const input = root?.querySelector('#query');
  if (input) input.placeholder = t(state === 'listening' ? 'plan.voiceListening' : state === 'thinking' ? 'plan.voiceThinking' : 'plan.queryPlaceholder');
}

// Leaving the screen (or the tab) drops the phrase being heard and ends the conversation.
function dropVoice() {
  if (voice) { voice.cancelled = true; voice.session.stop(); voice = null; }
  voiceTurns = 0;
}

async function listen(followUp) {
  // A tap while listening ends the phrase early; a follow-up never interrupts a phrase already being heard.
  if (voice) { if (!followUp) voice.session.stop(); return; }
  voiceTurns = followUp ? voiceTurns + 1 : 1;
  stopSpeaking();
  if (!followUp) unlockAudio();
  const field = () => root?.querySelector('#query');
  if (field()) field().value = '';
  if (followUp) toast(t('voice.followUp'), { iconName: 'mic', duration: 6000 });
  const mine = { view, cancelled: false, session: null };
  voice = mine;
  mine.session = startListening({ onState: (state) => { if (!mine.cancelled) showVoiceState(state); },
    onText: (text) => { if (!mine.cancelled && field()) field().value = text; }, ...(followUp ? { silentStartMs: 7000 } : {}) });
  try {
    const text = (await mine.session.promise).trim();
    if (voice === mine) voice = null;
    if (mine.cancelled) return;
    // Silence after an answer simply ends the conversation; silence after a tap gets a hint.
    if (!text) { voiceTurns = 0; if (!followUp) toast(t('plan.voiceNothing'), { iconName: 'mic' }); return; }
    if (field()) { field().value = text; field().blur(); }
    onPhrase(text);
  } catch (failure) {
    if (mine.cancelled) return;
    voiceTurns = 0;
    toast(failure?.message === 'unsupported' ? t('plan.voiceUnsupported') : failure?.name === 'NotAllowedError' ? t('plan.voiceDenied') : t('plan.voiceFailed'), { iconName: 'warning' });
  } finally { if (voice === mine) voice = null; }
}

// What a spoken phrase asks for: 'stop', 'go', a result number (0-2), or null for a new search.
const STOP_WORDS = /^(?:(?:нет,?\s+)?(?:спасибо|хватит|стоп|всё|все|отмена|пока)|(?:no\s+)?(?:thanks|thank you|stop|cancel|that's all|bye)|рақмет|болды|тоқта|жоқ)$/iu;
const GO_WORDS = /^(?:ну\s+|давай(?:те)?\s+|so\s+|ok\s+)?(?:поехали|пошли|идём|идем|айда|айдём|айдем|начинаем|начать|старт|погнали|go|let'?s go|start|кеттік|жүрдік|бастау|бастаймыз)$/iu;
const ORDINALS = [/(?<!\p{L})(?:перв|first|бірінші|(?:1|один|one|бір)(?![\p{L}\d]))/iu, /(?<!\p{L})(?:втор|second|екінші|(?:2|два|two|екі)(?![\p{L}\d]))/iu, /(?<!\p{L})(?:трет|third|үшінші|(?:3|три|three|үш)(?![\p{L}\d]))/iu];
function voiceCommand(text) {
  const phrase = text.toLowerCase().replace(/[.!?,«»"]/g, ' ').replace(/\s+/g, ' ').trim();
  if (STOP_WORDS.test(phrase)) return 'stop';
  if (GO_WORDS.test(phrase)) return 'go';
  // "второй", "давай первый", "расскажи про третий": short phrases only, so "два часа в парке" stays a search.
  if (phrase.split(' ').length <= 4 && !understand(phrase).minutes) {
    const index = ORDINALS.findIndex((pattern) => pattern.test(phrase));
    if (index >= 0) return index;
  }
  return null;
}

function onPhrase(text) {
  const command = voiceCommand(text);
  const recs = (result?.recommendations || []).slice(0, 3);
  const hasResults = (view === 'results' || view === 'place') && recs.length;
  if (command === 'stop') { voiceTurns = 0; stopSpeaking(); return; }
  if (command === 'go' && hasResults) { voiceTurns = 0; startPlace(recs[selected] || recs[0], true); return; }
  if (typeof command === 'number' && hasResults && recs[command]) { speakNext = true; openResult(command); return; }
  // A follow-up that only changes the time ("а на полчаса?") keeps the previous wishes.
  const said = understand(text);
  if (said.minutes && voiceTurns > 1 && said.query.replace(/[^\p{L}\d]+/gu, '').length < 3) plan.minutes = said.minutes;
  else { plan.query = text; plan.mood = null; root?.querySelectorAll('.chip[data-mood]').forEach((chip) => chip.setAttribute('aria-pressed', 'false')); }
  savePlan();
  submit({ spoken: true });
}

// Reads the answer, then listens for a follow-up if the conversation is still on and the person is still here.
async function answer(text, finished) {
  speakNext = false;
  const at = view;
  const heard = await (finished || speakText(text).then(() => true));
  if (!heard || !voiceTurns || voiceTurns >= MAX_VOICE_TURNS || view !== at || document.visibilityState !== 'visible' || !root?.isConnected) { if (!heard) voiceTurns = 0; return; }
  if (root.querySelector('.mic:not([hidden])')) listen(true);
}

// One return time per option: the server's (it also wrote the «why»), else the same sum counted here.
const backOf = (place) => place.plan?.backAt || backTime(place, leaveAt());

const timingOf = (place) => ({ distanceMeters: place.distanceMeters, walkMinutes: place.walkMinutes, visitMinutes: place.visitMinutes, returnMinutes: place.returnMinutes, safetyReserveMinutes: place.safetyReserveMinutes, totalMinutes: place.totalMinutes });

function startPlace(place, spoken) {
  const timing = timingOf(place);
  startWalk({ place, start, timing, backAt: backOf(place) });
  view = 'live'; render();
  if (spoken) speakText(t('voice.go', { name: place.name, time: backOf(place) }));
}

function drawPlanMap() {
  layers.hidePins(); layers.hideRoutes();
  layers.showStart(start, startName(), { tag: true });
  layers.showReach(start, reachMeters(plan.minutes, plan.maxWalk));
  const radius = reachMeters(plan.minutes, plan.maxWalk);
  const dLat = radius / 111320; const dLon = radius / (111320 * Math.cos(start.lat * Math.PI / 180));
  if (getMap()) fitPoints([[start.lon - dLon, start.lat - dLat], [start.lon + dLon, start.lat + dLat]], { maxZoom: 15, duration: 600 });
}

// ---------- start point ----------
function renderStart() {
  const message = h('p', { class: 'inline-message', role: 'status', hidden: !startPrompt, text: startPrompt ? t(`start.prompt.${startPrompt}`) : '' });
  // After «Найти» without a real start, choosing one runs the search that was asked for.
  const choose = (next, manual = true) => {
    setStart(next, manual);
    if (startPrompt) { startPrompt = null; submit(); return; }
    view = 'plan'; render();
  };
  const gps = h('button', { class: 'list-row', type: 'button', onclick: () => locate(message, choose) },
    h('span', { class: 'row-icon is-sky', 'aria-hidden': 'true' }, icon('locate')), h('span', { class: 'row-text' }, h('strong', { text: t('start.gps') }), h('small', { text: t('start.gpsHint') })));
  const pickRow = h('button', { class: 'list-row', type: 'button', onclick: () => { view = 'pick'; render(); } },
    h('span', { class: 'row-icon', 'aria-hidden': 'true' }, icon('target')), h('span', { class: 'row-text' }, h('strong', { text: t('start.pick') }), h('small', { text: t('start.pickHint') })));
  const recent = (store.get('recentStarts') || []).filter((item) => item.kind === 'map');
  clear(root, h('section', { class: 'view start-view' },
    h('div', { class: 'view-bar' }, backButton(t('common.back'), () => { startPrompt = null; view = 'plan'; render(); })),
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
  show(t('start.locating'));
  locateMe().then((fix) => {
    if (!inAstana(fix.lat, fix.lon)) { show(t('start.outside')); return; }
    locationNote = null;
    toast(t('toast.locationShared'), { iconName: 'locate' });
    choose(gpsStart(fix), false);
  }, (failure) => show(t(failure.reason === 'denied' ? 'start.denied' : 'start.failed')));
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

function askForStart() {
  startPrompt = locationNote || 'failed';
  if (speakNext) speakText(t('start.promptVoice'));
  speakNext = false; voiceTurns = 0;
  view = 'start'; render();
}

async function submit(options) {
  speakNext = options?.spoken === true;
  if (!speakNext) voiceTurns = 0;
  const said = understand(plan.query);
  if (said.minutes) { plan.minutes = said.minutes; plan.query = said.query; plan.mood = null; savePlan(); }
  // Plan only from a real start: a fresh fix, or a point the person chose. Without one, ask on the start screen.
  if (!isManual() && fixAge() >= FRESH_MS) {
    await autoLocate(true);
    if (isFallback()) { askForStart(); return; }
  }
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
  const notes = notesView(recs);
  const tip = llm ? aiCard(generation) : h('div', { class: 'ai-card is-quiet' }, h('p', { class: 'fine', text: t('results.fallback') }));

  const rows = recs.map((place, index) => {
    const status = hoursStatus(place, place.walkMinutes, place.visitMinutes, place.hoursCheck);
    return h('button', { class: `result-row${index === selected ? ' is-selected' : ''}`, type: 'button', dataset: { index }, onclick: () => openResult(index),
      onmouseenter: () => highlight(index), onfocus: () => highlight(index) },
    h('span', { class: 'result-num num', 'aria-hidden': 'true', text: index + 1 }),
    categoryArt(place.category, 44, 'art'),
    h('span', { class: 'result-text' }, h('strong', { class: 'result-name', text: place.name }),
      h('span', { class: 'meta' }, categoryName(place.category), h('span', { class: 'meta-sep', 'aria-hidden': 'true' }), t('explore.walk', { n: place.walkMinutes })),
      h('span', { class: 'result-badges' }, hoursChip(status), confidenceChip(place.confidence))),
    h('span', { class: 'result-time' }, timeRing({ there: place.walkMinutes, visit: place.visitMinutes, back: place.returnMinutes, reserve: place.safetyReserveMinutes, size: 50, stroke: 6 }),
      h('span', { class: 'num result-total', text: t('plan.min', { n: place.totalMinutes }) })));
  });

  clear(root, h('section', { class: 'view results-view', 'aria-labelledby': 'results-title' },
    h('div', { class: 'view-bar' }, back, h('div', { class: 'view-bar-actions' }, voiceButton(),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('place.share'), onclick: () => share({ title: 'Aidem', text: t('results.title', { min: request.minutes }), url: shareLink() }) }, icon('share')))),
    h('h2', { id: 'results-title', class: 'title-1', text: t('results.title', { min: request.minutes }) }),
    h('p', { class: 'meta' }, icon('pin', 'icon-xs'), t('results.start', { name: startName() }), h('span', { class: 'meta-sep', 'aria-hidden': 'true' }), t('plan.returnBy', { time: time(leave + request.minutes * 60000) })),
    tip,
    notes.notices,
    h('div', { class: 'result-list' }, rows),
    understoodRow(result.understood),
    routeCard(result.route),
    eventsCard(result.cityEvents),
    notes.unchecked));
  drawResultsMap(recs);
  if (speakNext) {
    // The Gemini tip is read through its own «Слушать» button, so «Стоп» there also ends the conversation.
    const listen = llm && tip.querySelector('.listen-btn');
    if (listen?.play) answer(null, listen.play());
    else answer(t('voice.answer', { n: recs.length, name: recs[0].name, walk: recs[0].walkMinutes, time: backOf(recs[0]) }));
  }
}

// The server's notes. What it cannot confirm from the request (розетки, тишина…) and the notes about this request
// («музей не помещается», «дальше нужен транспорт», «исключено N мест») show above the list, at most three lines;
// the general caveats and what all three cards share fold into «Что мы не проверяли».
const GENERAL_NOTE = /^(?:Расстояние указано по прямой|Каждая карточка|Актуальное открытие)/;
function notesView(recs, { skip = null } = {}) {
  const all = (Array.isArray(result?.warnings) ? result.warnings : []).filter((note) => !skip?.test(note));
  const specific = all.filter((note) => !GENERAL_NOTE.test(note));
  const unconfirmed = Array.isArray(result?.unconfirmed) && result.unconfirmed.length ? t('results.unconfirmed', { list: result.unconfirmed.join(', ') }) : null;
  const lines = [unconfirmed, ...specific].filter(Boolean);
  const cards = recs.map((place) => (Array.isArray(place.warnings) ? place.warnings : []));
  const shared = cards.length > 1 ? cards[0].filter((note) => cards.every((list) => list.includes(note))) : [];
  const folded = [...new Set([...lines.slice(3), ...all.filter((note) => GENERAL_NOTE.test(note)), ...shared])];
  return {
    notices: lines.length ? h('div', { class: 'notices' }, lines.slice(0, 3).map((text) => h('p', { class: 'notice' }, icon('info', 'icon-xs'), h('span', { text })))) : null,
    unchecked: folded.length ? h('details', { class: 'disclosure unchecked' }, h('summary', {}, icon('info'), t('results.unchecked'), h('span', { class: 'count num', text: folded.length })),
      h('ul', { class: 'bullets fine' }, folded.map((text) => h('li', { text })))) : null,
  };
}

// «Мы учли»: what the server understood from the request (time, categories, child, night, weather, hours).
function understoodRow(items) {
  const shown = (items || []).filter((item) => item.key !== 'location' && item.label);
  if (!shown.length) return null;
  const icons = { time: 'clock', categories: 'filter', child: 'user', night: 'moon', group: 'friends', accessible: 'accessible', weather: 'cloud', hours: 'clock' };
  return h('div', { class: 'understood' }, h('p', { class: 'understood-title', text: t('results.understood') }),
    h('div', { class: 'chip-row no-drag' }, shown.map((item) => h('span', { class: 'chip is-static' }, icon(icons[item.key] || 'check', 'icon-xs'), h('span', { class: 'chip-text', text: item.label })))));
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

// «Сегодня в городе»: today's events from the sxodim.com listing within walking reach; each row opens the event page there.
function eventsCard(events) {
  const items = (events?.items || []).filter((event) => safeUrl(event.url)).slice(0, 3);
  if (!items.length) return null;
  return h('section', { class: 'route-card events-card', 'aria-labelledby': 'events-title' },
    h('div', { class: 'route-head' }, h('span', { class: 'route-icon', 'aria-hidden': 'true' }, icon('calendar')),
      h('div', {}, h('strong', { id: 'events-title', text: t('events.title') }), h('small', { text: t('events.note') }))),
    h('ul', { class: 'event-list' }, items.map((event) => h('li', {},
      h('a', { class: 'event-row', href: safeUrl(event.url), target: '_blank', rel: 'noopener noreferrer', 'aria-label': `${event.title}. ${t('events.open')}` },
        h('span', { class: 'row-text' }, h('strong', { text: event.title }),
          h('small', { text: [eventWhen(event), event.venue, t('explore.walk', { n: event.walkMinutes }), event.price].filter(Boolean).join(' · ') })),
        icon('external', 'icon-xs'))))));
}
function eventWhen(event) {
  if (event.when?.time) return t('events.at', { time: event.when.time });
  if (event.when?.to) return t('events.until', { date: new Date(`${event.when.to}T12:00:00+05:00`).toLocaleDateString(lang() === 'kk' ? 'kk-KZ' : lang() === 'en' ? 'en-GB' : 'ru-RU', { day: 'numeric', month: 'long' }) });
  return t('events.today');
}

// The Gemini tip, three lines at first so the places stay in view; the full text and the note open on tap.
function aiCard(generation) {
  const note = h('p', { class: 'fine', text: t('results.aiNote'), hidden: true });
  const more = h('button', { class: 'ai-more', type: 'button', 'aria-expanded': 'false', text: t('results.aiMore') });
  const card = h('div', { class: 'ai-card' }, h('p', { class: 'ai-label' }, icon('sparkle'), t(generation.provider === 'gemini' ? 'results.aiGemini' : 'results.ai')),
    h('p', { class: 'ai-text', text: generation.summary }), note,
    h('div', { class: 'ai-actions' }, more, listenButton(generation.summary)));
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
  layers.showEvents(result?.cityEvents?.items || []);
}

function renderEmpty(back) {
  // The nearest place and «no options» are already said by the screen itself.
  const notes = notesView([], { skip: /^(?:Ближе всего подходит|В текущем наборе данных нет)/ });
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
  clear(root, h('section', { class: 'view state-view' }, h('div', { class: 'view-bar' }, back, voiceButton()),
    h('div', { class: 'state-icon', 'aria-hidden': 'true' }, icon('compass')),
    h('h2', { class: 'title-2', text: t('results.empty.title') }), h('p', { class: 'lead', text: t('results.empty.text') }),
    nearest ? h('div', { class: 'pairing nearest' }, categoryArt(nearest.category, 36, 'art'), h('span', { class: 'row-text' }, h('small', { text: t('results.nearest') }), h('strong', { text: nearest.name }),
      h('small', { text: t('results.nearestValue', { walk: nearest.walkMinutes, n: nearest.neededMinutes }) }))) : null,
    notes.notices,
    h('div', { class: 'stack' }, actions),
    notes.unchecked));
  layers.hidePins(); layers.hideRoutes(); layers.showReach(start, reachMeters(plan.minutes, plan.maxWalk));
  if (speakNext) answer(`${t('results.empty.title')} ${nearest?.name ? t('voice.nearest', { name: nearest.name, n: nearest.neededMinutes }) : ''}`);
}

function renderError(back) {
  speakNext = false;
  voiceTurns = 0;
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
  const timing = timingOf(place);
  const url = new URL(shareLink());
  clear(root, placeView({ place, timing, start, serverHours: place.hoursCheck, why: place.why, activities: place.activities || [], warnings: place.warnings || [],
    backLabel: t('common.back'), onBack: () => { view = 'results'; render(); },
    onStart: () => { voiceTurns = 0; startPlace(place); }, voice: voiceButton(),
    routeInfo: lastRoute?.id === place.id ? lastRoute.route : null, shareUrl: url.href, backAt: backOf(place) }));
  // Opened by voice («второй»): say why it fits and how long it takes, then wait for «поехали».
  // The server's «why» is written for reading (all the minutes), so only Gemini's idea is said aloud.
  if (speakNext) answer(`${place.name}. ${place.aiWhy || ''} ${t('voice.place', { walk: place.walkMinutes, time: backOf(place) })}`);
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
    autoLocate();
    if (view === 'loading' && !inflight) view = result ? 'results' : 'plan';
    render();
    mapReady.then(() => { if (root === container && root.isConnected) render(); });
  },
  reopen() { if (view !== 'live' && view !== 'loading') { view = 'plan'; render(); autoLocate(); } },
  unmount() {
    dropVoice();
    document.body.classList.remove('is-picking');
    liveCleanup?.(); liveCleanup = null;
    layers.clearWalkLayers(); layers.hideStart();
    root = null;
  },
});
