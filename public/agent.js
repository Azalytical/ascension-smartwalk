// Aidem agent page: asks /api/agent, then replays the agent's steps and shows the answer with map and calendar links.
// Voice uses the app's engine: tap once, speak, hear the answer, then ask a follow-up without touching the screen.
import { converse, understand } from '/js/core/voice.js';
import { speakText, stopSpeaking } from '/js/core/media.js';
import { coarse } from '/js/core/privacy.js';

const $ = id => document.getElementById(id);
const state = { lat: 51.1283, lon: 71.4304, minutes: 60, here: false };
// «Моё место» is sent rounded to about 100 m (core/privacy.js); a landmark from the list goes as it is.
const sentPoint = () => (state.here ? { lat: coarse(state.lat), lon: coarse(state.lon) } : { lat: state.lat, lon: state.lon });
const CATEGORY = { park: 'парк', cafe: 'кафе', museum: 'музей', playground: 'детская площадка', attraction: 'достопримечательность',
  restaurant: 'где поесть', mall: 'торговый центр', culture: 'культура' };
const ICON = { get_weather: '☁', plan_walk: '🧭', search_places: '🔎', place_details: '📍', build_route: '🗺', check: '✓', give_answer: '✦' };
const HOURS = { open: ['open', 'открыто'], closed: ['closed', 'закрыто'], closes_early: ['closed', 'закроется раньше'], unknown: ['unknown', 'часы не разобраны'],
  no_data: ['unknown', 'часы неизвестны'], not_checked: ['unknown', 'часы не проверены'] };
const inAstana = (lat, lon) => lat >= 51 && lat <= 51.35 && lon >= 71.25 && lon <= 71.65;

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
  button.textContent = 'Ищем вас…';
  navigator.geolocation.getCurrentPosition(position => {
    button.textContent = 'Моё место';
    const { latitude, longitude } = position.coords;
    if (!inAstana(latitude, longitude)) { button.textContent = 'Вы не в Астане'; return; }
    Object.assign(state, { lat: latitude, lon: longitude, here: true });
    press($('starts'), button);
  }, () => { button.textContent = 'Нет доступа к месту'; }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
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

function stepNode(step, final = false) {
  const detail = Object.keys(step.args || {}).length ? el('code', { text: JSON.stringify(step.args) }) : null;
  return el('li', { class: `step${final ? ' final' : ''}` }, el('span', { class: 'icon', 'aria-hidden': 'true', text: ICON[step.tool] || '•' }),
    el('div', {}, el('b', { text: step.label }), el('p', { text: step.summary }), detail));
}

function placeNode(place) {
  const hours = HOURS[place.hours?.status || place.hoursNow?.status || 'no_data'] || HOURS.no_data;
  const hoursText = hours[0] === 'open' && place.hours?.closesAt ? `${hours[1]} до ${place.hours.closesAt}` : hours[1];
  const meta = el('div', { class: 'meta' });
  if (Number.isFinite(place.walkMinutes)) meta.append(el('span', { text: `≈${place.walkMinutes} мин пешком` }));
  if (Number.isFinite(place.totalMinutes)) {
    // «Вернётесь к» as in the app: without the reserve, which is spare time on top.
    const reserve = place.safetyReserveMinutes ?? 5;
    meta.append(el('span', { text: `всего ≈${place.totalMinutes} мин с запасом ${reserve} мин, вернётесь к ${clockIn(place.totalMinutes - reserve)}` }));
  }
  meta.append(el('span', { class: `tag ${hours[0]}`, text: `${hoursText} · ${place.dataSource || 'OSM'}` }));
  const links = el('div', { class: 'links' });
  const add = (href, text) => href && links.append(el('a', { href, target: '_blank', rel: 'noopener', text }));
  add(place.links?.googleMapsWalk, 'Google Maps');
  add(place.links?.twoGis, '2ГИС');
  add(place.links?.googleCalendar, 'В Google Календарь');
  if (Number.isFinite(place.walkMinutes)) {
    const hand = new URLSearchParams({ to: `${place.lat},${place.lon}`, name: place.name, cat: place.category, from: `${state.lat},${state.lon}`,
      min: String(state.minutes), walk: String(place.walkMinutes), visit: String(place.visitMinutes || 0), back: String(place.returnMinutes || 0) });
    add(`/watch#${hand}`, 'На часы');
  }
  add(place.sourceUrl, 'Источник');
  return el('li', { class: 'place' }, el('h3', { text: place.name }), el('span', { class: 'tag', text: CATEGORY[place.category] || place.category }),
    meta, place.why ? el('p', { class: 'why', text: place.why }) : null, links);
}

function routeNode(route) {
  const node = el('div', { class: 'route' }, el('b', { text: `Мини-маршрут: ${route.stops.map(stop => stop.name).join(' → ')}` }),
    el('p', { text: `Всего ≈${route.totalMinutes} мин (ходьба ${route.walkMinutes}, на местах ${route.visitMinutes}, запас 5) — ${route.fits ? 'помещается в ваше время' : 'не помещается, сократите маршрут'}.` }));
  if (route.googleMapsRoute) node.append(el('div', { class: 'links' }, el('a', { href: routeLink(route.googleMapsRoute), target: '_blank', rel: 'noopener', text: 'Весь маршрут в Google Maps' })));
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

/** Runs the agent for one question and renders its steps and answer. Returns the response, or null on failure. */
async function ask(query, extra = {}) {
  const go = $('go');
  go.disabled = true; go.textContent = 'Gemini думает…';
  $('result').hidden = false; $('answer').hidden = true;
  const steps = $('steps');
  steps.replaceChildren(el('li', { class: 'step pending' }, el('span', { class: 'icon', 'aria-hidden': 'true', text: '✦' }),
    el('div', {}, el('b', { text: 'Gemini выбирает инструменты' }), el('p', { text: 'Погода, места рядом, часы работы, маршрут — что нужно для вашего запроса.' }))));
  $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  try {
    const response = await fetch('/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, ...sentPoint(), minutes: state.minutes, withChild: $('child').checked, ...extra }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Не получилось');
    steps.replaceChildren();
    for (const step of data.steps) { steps.append(stepNode(step, step.tool === 'give_answer')); await wait(extra.lang ? 200 : 380); }
    $('who').textContent = data.mode === 'agent'
      ? `Gemini · ${data.model} · ${data.modelCalls} обращ. к модели, ${data.toolCalls} инструм.${Number.isFinite(data.elapsedMs) ? ` · ${(data.elapsedMs / 1000).toFixed(1).replace('.', ',')} с` : ''}`
      : 'Подбор по данным без ИИ: Gemini сейчас недоступен';
    lastSummary = data.summary;
    $('you').textContent = extra.lang ? `Вы сказали: «${query}»` : '';
    $('summary').textContent = data.summary;
    $('route').replaceChildren(...(data.route ? [routeNode(data.route)] : []));
    $('places').replaceChildren(...data.places.map(placeNode));
    $('privacy').textContent = data.privacy;
    $('answer').hidden = false;
    return data;
  } catch (error) {
    steps.replaceChildren(el('li', { class: 'error', text: error.message || 'Не получилось. Попробуйте ещё раз.' }));
    return null;
  } finally {
    go.disabled = false; go.textContent = 'Спросить Gemini';
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
  button.disabled = true; button.textContent = 'Говорит Gemini…';
  try { await speakText(lastSummary); } finally { button.disabled = false; button.textContent = 'Озвучить'; }
});

// ---------- hands-free voice ----------
const VOICE = {
  idle: ['Нажмите и говорите', 'Gemini ответит голосом, потом можно спросить ещё, не касаясь экрана. Русский, қазақша, English.'],
  listening: ['Слушаю…', 'Скажите, сколько у вас времени и чего хочется. Пауза — конец фразы.'],
  followUp: ['Слушаю продолжение…', 'Например: «а поближе?», «а с кофе?» Или молчите, и разговор закончится.'],
  thinking: ['Gemini думает…', 'Распознаю фразу и проверяю погоду, места и часы работы.'],
  speaking: ['Gemini отвечает', 'Нажмите на кнопку, чтобы остановить.'],
  failed: ['Не получилось', 'Нет доступа к микрофону или речь не распознана. Разрешите микрофон или напишите словами.'],
};
let conversation = null;
let turns = 0;
let previous = null;

function showVoice(stateName) {
  const key = stateName === 'listening' && turns > 0 ? 'followUp' : stateName;
  const [title, hint] = VOICE[key] || VOICE.idle;
  $('voiceState').textContent = title;
  $('voiceHint').textContent = hint;
  $('mic').dataset.state = stateName;
  $('mic').setAttribute('aria-pressed', String(stateName !== 'idle' && stateName !== 'failed'));
  $('mic').setAttribute('aria-label', stateName === 'idle' || stateName === 'failed' ? 'Говорить с Gemini' : 'Остановить разговор');
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
    out.replaceChildren(el('img', { src: image, alt: 'Ваше фото' }), el('p', { text: 'Gemini сравнивает фото с местами рядом…' }));
    const response = await fetch('/api/vision', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image, ...sentPoint() }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    const parts = [el('img', { src: image, alt: 'Ваше фото' })];
    if (data.place) {
      parts.push(el('h3', { text: data.place.name }), el('span', { class: 'tag', text: `название: ${data.nameSource || 'база Aidem'} · уверенность: ${{ high: 'высокая', medium: 'средняя', low: 'низкая' }[data.confidence] || data.confidence}` }));
      if (data.facts.length) parts.push(el('ul', { class: 'facts' }, ...data.facts.map(fact => el('li', {}, el('span', { class: 'tag ai', text: 'идея ИИ' }), document.createTextNode(` ${fact}`)))));
      parts.push(el('div', { class: 'links' }, el('a', { href: data.place.links.googleMapsWalk, target: '_blank', rel: 'noopener', text: 'Google Maps' }),
        el('a', { href: data.place.links.twoGis, target: '_blank', rel: 'noopener', text: '2ГИС' })));
    } else {
      parts.push(el('p', { text: data.seen ? `Не узнали уверенно. На фото: ${data.seen}` : 'Не узнали место на фото. Вот что есть рядом:' }));
    }
    if (data.nearby?.length) parts.push(el('p', { class: 'hint', text: `Рядом: ${data.nearby.map(place => `${place.name} (${place.distanceMeters} м)`).join(', ')}` }));
    parts.push(el('p', { class: 'privacy', text: data.privacy }));
    out.replaceChildren(...parts);
  } catch (error) {
    out.replaceChildren(el('p', { class: 'error', text: error.message || 'Не получилось распознать фото.' }));
  } finally { $('photo').value = ''; }
});

$('mcp-url').textContent = `${location.origin}/mcp`;
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-copy]');
  if (!button) return;
  try { await navigator.clipboard.writeText($(button.dataset.copy).textContent); button.textContent = 'Скопировано'; }
  catch { button.textContent = 'Выделите и скопируйте'; }
  setTimeout(() => { button.textContent = 'Копировать'; }, 1600);
});
