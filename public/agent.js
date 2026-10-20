// Aidem agent page: asks /api/agent, then replays the agent's steps and shows the answer with map and calendar links.
// Voice uses the app's engine: tap once, speak, hear the answer, then ask a follow-up without touching the screen.
// The page speaks the app's language (RU, ҚАЗ, EN, shared with the main site); its texts are in agent-i18n.js.
import { converse, understand } from '/js/core/voice.js';
import { speakText, stopSpeaking } from '/js/core/media.js';
import { coarse } from '/js/core/privacy.js';
import { lang, setLang } from '/js/core/i18n.js';
import { on } from '/js/core/store.js';
import { categoryName } from '/js/ui/common.js';
import { whyText } from '/js/ui/server-text.js';
import TEXT from '/agent-i18n.js';

const $ = id => document.getElementById(id);
const state = { lat: 51.1283, lon: 71.4304, minutes: 60, here: false };
// «Моё место» is sent rounded to about 100 m (core/privacy.js); a landmark from the list goes as it is.
const sentPoint = () => (state.here ? { lat: coarse(state.lat), lon: coarse(state.lon) } : { lat: state.lat, lon: state.lon });
const ICON = { get_weather: '☁', plan_walk: '🧭', search_places: '🔎', place_details: '📍', build_route: '🗺', check: '✓', give_answer: '✦' };
// Opening-hours status → colour of the tag.
const TONE = { open: 'open', closed: 'closed', closes_early: 'closed', unknown: 'unknown', no_data: 'unknown', not_checked: 'unknown' };
const inAstana = (lat, lon) => lat >= 51 && lat <= 51.35 && lon >= 71.25 && lon <= 71.65;

const has = key => Object.hasOwn(TEXT[lang()] || {}, key);
/** A text of this page in the current language, Russian when a key has no translation. */
function tr(key, params = {}) {
  const text = TEXT[lang()]?.[key] ?? TEXT.ru[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''));
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) if (child) node.append(child);
  return node;
}

function press(group, button) {
  for (const other of group.querySelectorAll('.chip')) other.setAttribute('aria-pressed', String(other === button));
}

function clockIn(minutes) {
  const date = new Date(Date.now() + minutes * 60000);
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Almaty' });
}

$('starts').addEventListener('click', event => {
  const button = event.target.closest('[data-start]');
  if (!button) return;
  if (button.dataset.start !== 'me') {
    [state.lat, state.lon] = button.dataset.start.split(',').map(Number);
    state.here = false;
    press($('starts'), button);
    return;
  }
  if (!navigator.geolocation) return;
  button.textContent = tr('start.locating');
  navigator.geolocation.getCurrentPosition(position => {
    button.textContent = tr('start.me');
    const { latitude, longitude } = position.coords;
    if (!inAstana(latitude, longitude)) { button.textContent = tr('start.outside'); return; }
    Object.assign(state, { lat: latitude, lon: longitude, here: true });
    press($('starts'), button);
  }, () => { button.textContent = tr('start.denied'); }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
});

$('minutes').addEventListener('click', event => {
  const button = event.target.closest('[data-min]');
  if (!button) return;
  state.minutes = Number(button.dataset.min);
  press($('minutes'), button);
});

$('examples').addEventListener('click', event => {
  const button = event.target.closest('[data-q]');
  if (!button) return;
  $('query').value = button.dataset.q;
  if (button.dataset.min) {
    press($('minutes'), $('minutes').querySelector(`[data-min="${button.dataset.min}"]`));
    state.minutes = Number(button.dataset.min);
  }
  $('child').checked = button.dataset.child === '1';
  $('query').focus();
});

// Weather codes of Open-Meteo (WMO) → the sky word of a step.
function sky(code) {
  if (!Number.isFinite(code)) return null;
  if (code >= 95) return 'storm';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if (code >= 51 && code <= 57) return 'drizzle';
  if (code === 45 || code === 48) return 'fog';
  return { 0: 'clear', 1: 'clear', 2: 'partly', 3: 'overcast' }[code] || null;
}
const hoursWord = status => tr(`h.${TONE[status] ? status : 'no_data'}`);
const quoted = query => (query ? tr('s.query', { query }) : '');

// A step in Kazakh or English, built from the key and params the server sends with its Russian text.
const STEP = {
  weather: p => [tr('s.weather.label'), p.available
    ? tr('s.weather', { ...p, sky: sky(p.code) ? `, ${tr(`s.sky.${sky(p.code)}`)}` : '', advice: tr(p.indoor ? 's.indoor' : 's.outdoor') })
    : tr('s.weather.none')],
  plan: p => [tr('s.plan.label', { minutes: p.minutes, query: quoted(p.query) }),
    p.places?.length ? p.places.map(place => tr('s.plan.item', place)).join('; ') : tr('s.plan.none')],
  search: p => [tr('s.search.label', { query: quoted(p.query), category: p.category ? ` (${categoryName(p.category).toLocaleLowerCase()})` : '' }),
    p.names?.length ? tr('s.search', { total: p.total, names: p.names.join(', ') }) : tr('s.search.none')],
  details: p => [tr('s.details.label', p), tr('s.details', { hours: p.hours || tr('s.details.noHours'), status: hoursWord(p.status) })],
  route: p => [tr('s.route.label'), tr(p.closed?.length ? 's.route.closed' : p.fits ? 's.route' : 's.route.over',
    { ...p, stops: (p.stops || []).join(' → '), closed: (p.closed || []).join(', ') })],
  check: p => [tr('s.check.label'), tr(has(`s.check.${p.reason}`) ? `s.check.${p.reason}` : 's.check.places', p)],
  answer: p => [tr('s.answer.label'), tr('s.answer', { names: (p.names || []).join(', ') })],
  error: () => [tr('s.error.label'), tr('s.error')],
};

/** [label, summary] of a step: the server's Russian, or the keyed version in Kazakh and English. */
function stepText(step) {
  if (lang() !== 'ru' && STEP[step.key] && step.params && typeof step.params === 'object') {
    try { return STEP[step.key](step.params); } catch { /* an older or odd answer: keep the server's text */ }
  }
  return [step.label, step.summary];
}

// Each step reads as the tool's name, what the agent did and what came back; the raw arguments stay in the response only.
function stepNode(step, final = false) {
  const [label, summary] = stepText(step);
  const tool = Object.hasOwn(TEXT.ru, `tool.${step.tool}`) ? tr(`tool.${step.tool}`) : tr('tool.other');
  return el('li', { class: `step${final ? ' final' : ''}` }, el('span', { class: 'icon', 'aria-hidden': 'true', text: ICON[step.tool] || '•' }),
    el('div', {}, el('span', { class: 'tool', text: tool }), el('b', { text: label }), summary ? el('p', { text: summary }) : null));
}

function placeNode(place) {
  const status = place.hours?.status || place.hoursNow?.status || 'no_data';
  const hoursText = status === 'open' && place.hours?.closesAt ? tr('h.openUntil', { time: place.hours.closesAt }) : hoursWord(status);
  const meta = el('div', { class: 'meta' });
  if (Number.isFinite(place.walkMinutes)) meta.append(el('span', { text: tr('walk', { n: place.walkMinutes }) }));
  if (Number.isFinite(place.totalMinutes)) {
    // «Вернётесь к» as in the app: without the reserve, which is spare time on top.
    const reserve = place.safetyReserveMinutes ?? 5;
    meta.append(el('span', { text: tr('total', { total: place.totalMinutes, reserve, time: clockIn(place.totalMinutes - reserve) }) }));
  }
  meta.append(el('span', { class: `tag ${TONE[status] || 'unknown'}`, text: `${hoursText} · ${place.dataSource || 'OSM'}` }));
  // «Почему подходит» is the server's Russian; in Kazakh and English it is built from its keys, or left out when it cannot be.
  const why = whyText(place);
  const links = el('div', { class: 'links' });
  const add = (href, text) => href && links.append(el('a', { href, target: '_blank', rel: 'noopener', text }));
  add(place.links?.googleMapsWalk, 'Google Maps');
  add(place.links?.twoGis, tr('l.2gis'));
  add(place.links?.googleCalendar, tr('l.calendar'));
  if (Number.isFinite(place.walkMinutes)) {
    const hand = new URLSearchParams({ to: `${place.lat},${place.lon}`, name: place.name, cat: place.category, from: `${state.lat},${state.lon}`,
      min: String(state.minutes), walk: String(place.walkMinutes), visit: String(place.visitMinutes || 0), back: String(place.returnMinutes || 0) });
    add(`/watch#${hand}`, tr('l.watch'));
  }
  add(place.sourceUrl, tr('l.source'));
  return el('li', { class: 'place' }, el('h3', { text: place.name }), el('span', { class: 'tag', text: categoryName(place.category) }),
    meta, why && (lang() === 'ru' || why !== place.why) ? el('p', { class: 'why', text: why }) : null, links);
}

function routeNode(route) {
  const node = el('div', { class: 'route' }, el('b', { text: tr('r.title', { stops: route.stops.map(stop => stop.name).join(' → ') }) }),
    el('p', { text: tr('r.text', { total: route.totalMinutes, walk: route.walkMinutes, visit: route.visitMinutes, reserve: route.reserveMinutes ?? 5,
      fit: route.closedOnArrival?.length ? tr('r.closed', { names: route.closedOnArrival.join(', ') }) : tr(route.fits ? 'r.fits' : 'r.over') }) }));
  if (route.googleMapsRoute) node.append(el('div', { class: 'links' }, el('a', { href: routeLink(route.googleMapsRoute), target: '_blank', rel: 'noopener', text: tr('r.link') })));
  return node;
}

// The server knew only the rounded cell, so the way back in the link ends there; on this device it ends where the person really is.
function routeLink(href) {
  if (!state.here) return href;
  const url = new URL(href);
  if (url.searchParams.get('destination') === `${coarse(state.lat)},${coarse(state.lon)}`) url.searchParams.set('destination', `${state.lat},${state.lon}`);
  return url.href;
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let lastSummary = '';
// The last answer, kept to redraw it when the language changes (the summary stays in the language Gemini wrote it in).
let shown = null;

function showAnswer({ data, spoken }) {
  const seconds = Number.isFinite(data.elapsedMs) ? (data.elapsedMs / 1000).toFixed(1) : null;
  $('who').textContent = data.mode === 'agent'
    ? tr('who.agent', { model: data.model, calls: data.modelCalls, tools: data.toolCalls })
      + (seconds ? tr('who.seconds', { s: lang() === 'en' ? seconds : seconds.replace('.', ',') }) : '')
    : tr('who.fallback');
  $('you').textContent = spoken ? tr('you', { text: spoken }) : '';
  $('summary').textContent = data.summary;
  $('route').replaceChildren(...(data.route ? [routeNode(data.route)] : []));
  $('places').replaceChildren(...data.places.map(placeNode));
  // The server words the privacy note in Russian; its meaning is fixed, so the other languages say it themselves.
  $('privacy').textContent = lang() === 'ru' ? data.privacy : tr('privacy');
  $('answer').hidden = false;
}

/** Runs the agent for one question and renders its steps and answer. Returns the response, or null on failure. */
async function ask(query, extra = {}) {
  const go = $('go');
  go.disabled = true; go.textContent = tr('go.busy');
  $('result').hidden = false; $('answer').hidden = true;
  shown = null;
  const steps = $('steps');
  steps.replaceChildren(el('li', { class: 'step pending' }, el('span', { class: 'icon', 'aria-hidden': 'true', text: '✦' }),
    el('div', {}, el('b', { text: tr('pending') }), el('p', { text: tr('pending.text') }))));
  $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  try {
    // A spoken phrase carries its own language; a typed one is judged by its letters, with the page's language where they cannot tell.
    const response = await fetch('/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, ...sentPoint(), minutes: state.minutes, withChild: $('child').checked, uiLang: lang(), ...extra }) });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error || ''), { server: true });
    steps.replaceChildren();
    for (const step of data.steps) { steps.append(stepNode(step, step.tool === 'give_answer')); await wait(extra.lang ? 200 : 380); }
    lastSummary = data.summary;
    shown = { data, spoken: extra.lang ? query : '' };
    showAnswer(shown);
    return data;
  } catch (error) {
    // The server's refusals are worded in Russian; other languages get their own plain line.
    steps.replaceChildren(el('li', { class: 'error', text: error.server && error.message && lang() === 'ru' ? error.message : tr('failed') }));
    return null;
  } finally {
    go.disabled = false; go.textContent = tr('go');
  }
}

$('ask').addEventListener('submit', event => {
  event.preventDefault();
  const query = $('query').value.trim();
  if (query) ask(query);
});

$('speak').addEventListener('click', async () => {
  if (!lastSummary) return;
  const button = $('speak');
  button.disabled = true; button.textContent = tr('speak.busy');
  try { await speakText(lastSummary); } finally { button.disabled = false; button.textContent = tr('speak'); }
});

// ---------- hands-free voice ----------
const VOICE_STATES = ['idle', 'listening', 'followUp', 'thinking', 'speaking', 'failed'];
let conversation = null;
let turns = 0;
let previous = null;
let voiceNow = 'idle';

function showVoice(stateName) {
  voiceNow = stateName;
  const named = stateName === 'listening' && turns > 0 ? 'followUp' : stateName;
  const key = VOICE_STATES.includes(named) ? named : 'idle';
  $('voiceState').textContent = tr(`voice.${key}`);
  $('voiceHint').textContent = tr(`voice.${key}.hint`);
  $('mic').dataset.state = stateName;
  $('mic').setAttribute('aria-pressed', String(stateName !== 'idle' && stateName !== 'failed'));
  $('mic').setAttribute('aria-label', tr(stateName === 'idle' || stateName === 'failed' ? 'mic.talk' : 'mic.stop'));
}

$('mic').addEventListener('click', () => {
  if (conversation) { conversation.stop(); return; }
  turns = 0; previous = null;
  conversation = converse({
    onState: showVoice,
    onText: text => { $('query').value = text; },
    again: () => $('handsfree').checked,
    onPhrase: async (text, lang) => {
      const { minutes } = understand(text);
      if (minutes) {
        state.minutes = minutes;
        const chip = $('minutes').querySelector(`[data-min="${minutes}"]`);
        for (const other of $('minutes').querySelectorAll('.chip')) other.setAttribute('aria-pressed', String(other === chip));
      }
      $('query').value = text;
      const data = await ask(text, { lang, ...(previous ? { previous } : {}) });
      if (!data) return '';
      previous = { query: text.slice(0, 300), summary: data.summary.slice(0, 500) };
      turns++;
      return data.summary;
    },
  });
  conversation.done.catch(() => showVoice('failed')).finally(() => { conversation = null; if ($('mic').dataset.state !== 'failed') showVoice('idle'); });
});

addEventListener('pagehide', () => { conversation?.stop(); stopSpeaking(); });

async function shrink(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 768 / Math.max(bitmap.width, bitmap.height));
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(bitmap.width * scale), height: Math.round(bitmap.height * scale) });
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.8);
}

$('photo').addEventListener('change', async () => {
  const file = $('photo').files?.[0];
  if (!file) return;
  const out = $('vision');
  try {
    const image = await shrink(file);
    out.replaceChildren(el('img', { src: image, alt: tr('v.alt') }), el('p', { text: tr('v.wait') }));
    const response = await fetch('/api/vision', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image, ...sentPoint(), lang: lang() }) });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error || ''), { server: true });
    const parts = [el('img', { src: image, alt: tr('v.alt') })];
    if (data.place) {
      const level = Object.hasOwn(TEXT.ru, `v.${data.confidence}`) ? tr(`v.${data.confidence}`) : data.confidence;
      parts.push(el('h3', { text: data.place.name }), el('span', { class: 'tag', text: tr('v.meta', { source: data.nameSource || tr('v.base'), level }) }));
      if (data.facts.length) parts.push(el('ul', { class: 'facts' }, ...data.facts.map(fact => el('li', {}, el('span', { class: 'tag ai', text: tr('v.ai') }), document.createTextNode(` ${fact}`)))));
      parts.push(el('div', { class: 'links' }, el('a', { href: data.place.links.googleMapsWalk, target: '_blank', rel: 'noopener', text: 'Google Maps' }),
        el('a', { href: data.place.links.twoGis, target: '_blank', rel: 'noopener', text: tr('l.2gis') })));
    } else {
      parts.push(el('p', { text: data.seen ? tr('v.unsure', { seen: data.seen }) : tr('v.none') }));
    }
    if (data.nearby?.length) parts.push(el('p', { class: 'hint', text: tr('v.nearby', { list: data.nearby.map(place => tr('v.dist', { name: place.name, m: place.distanceMeters })).join(', ') }) }));
    parts.push(el('p', { class: 'privacy', text: lang() === 'ru' ? data.privacy : tr('v.privacy') }));
    out.replaceChildren(...parts);
  } catch (error) {
    out.replaceChildren(el('p', { class: 'error', text: error.server && error.message && lang() === 'ru' ? error.message : tr('v.failed') }));
  } finally { $('photo').value = ''; }
});

$('mcp-url').textContent = `${location.origin}/mcp`;
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-copy]');
  if (!button) return;
  try { await navigator.clipboard.writeText($(button.dataset.copy).textContent); button.textContent = tr('c.copied'); }
  catch { button.textContent = tr('c.select'); }
  setTimeout(() => { button.textContent = tr('c.copy'); }, 1600);
});

// ---------- language ----------
/** Puts the page's fixed texts, the voice state and the last answer into the current language. */
function translatePage() {
  document.title = tr('title');
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = tr(node.dataset.i18n);
  for (const node of document.querySelectorAll('[data-i18n-label]')) node.setAttribute('aria-label', tr(node.dataset.i18nLabel));
  for (const node of document.querySelectorAll('[data-i18n-placeholder]')) node.placeholder = tr(node.dataset.i18nPlaceholder);
  for (const node of document.querySelectorAll('[data-i18n-q]')) node.dataset.q = tr(node.dataset.i18nQ);
  for (const button of $('langs').querySelectorAll('[data-lang]')) button.setAttribute('aria-pressed', String(button.dataset.lang === lang()));
  if ($('go').disabled) $('go').textContent = tr('go.busy');
  showVoice(voiceNow);
  if (shown) {
    $('steps').replaceChildren(...shown.data.steps.map(step => stepNode(step, step.tool === 'give_answer')));
    showAnswer(shown);
  }
}

$('langs').addEventListener('click', event => {
  const button = event.target.closest('[data-lang]');
  if (button) setLang(button.dataset.lang);
});
on('lang', translatePage);
translatePage();
