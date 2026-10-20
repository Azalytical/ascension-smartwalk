// Ulger agent page: asks /api/agent, then replays the agent's steps and shows the answer with map and calendar links.
const $ = id => document.getElementById(id);
const state = { lat: 51.1283, lon: 71.4304, minutes: 60 };
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
    press($('starts'), button);
    return;
  }
  if (!navigator.geolocation) return;
  button.textContent = 'Ищем вас…';
  navigator.geolocation.getCurrentPosition(position => {
    button.textContent = 'Моё место';
    const { latitude, longitude } = position.coords;
    if (!inAstana(latitude, longitude)) { button.textContent = 'Вы не в Астане'; return; }
    Object.assign(state, { lat: latitude, lon: longitude });
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
  if (Number.isFinite(place.totalMinutes)) meta.append(el('span', { text: `всего ≈${place.totalMinutes} мин, обратно к ${clockIn(place.totalMinutes)}` }));
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
  if (route.googleMapsRoute) node.append(el('div', { class: 'links' }, el('a', { href: route.googleMapsRoute, target: '_blank', rel: 'noopener', text: 'Весь маршрут в Google Maps' })));
  return node;
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let lastSummary = '';

$('ask').addEventListener('submit', async event => {
  event.preventDefault();
  const query = $('query').value.trim();
  if (!query) return;
  const go = $('go');
  go.disabled = true; go.textContent = 'Gemini думает…';
  $('result').hidden = false; $('answer').hidden = true;
  const steps = $('steps');
  steps.replaceChildren(el('li', { class: 'step pending' }, el('span', { class: 'icon', 'aria-hidden': 'true', text: '✦' }),
    el('div', {}, el('b', { text: 'Gemini выбирает инструменты' }), el('p', { text: 'Погода, места рядом, часы работы, маршрут — что нужно для вашего запроса.' }))));
  $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  try {
    const response = await fetch('/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, lat: state.lat, lon: state.lon, minutes: state.minutes, withChild: $('child').checked }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Не получилось');
    steps.replaceChildren();
    for (const step of data.steps) { steps.append(stepNode(step, step.tool === 'give_answer')); await wait(380); }
    $('who').textContent = data.mode === 'agent'
      ? `Gemini · ${data.model} · ${data.modelCalls} обращ. к модели, ${data.toolCalls} инструм.`
      : 'Подбор по данным без ИИ: Gemini сейчас недоступен';
    lastSummary = data.summary;
    $('summary').textContent = data.summary;
    $('route').replaceChildren(...(data.route ? [routeNode(data.route)] : []));
    $('places').replaceChildren(...data.places.map(placeNode));
    $('privacy').textContent = data.privacy;
    $('answer').hidden = false;
  } catch (error) {
    steps.replaceChildren(el('li', { class: 'error', text: error.message || 'Не получилось. Попробуйте ещё раз.' }));
  } finally {
    go.disabled = false; go.textContent = 'Спросить Gemini';
  }
});

// The audio context is created inside the tap: iOS keeps a context made after an await silent.
async function playPcm(context, base64, sampleRate) {
  const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
  // A WAV answer starts with a RIFF header; the samples after it are the same 16-bit PCM.
  const offset = bytes.length > 44 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' ? 44 : 0;
  const samples = new Int16Array(bytes.buffer, offset, Math.floor((bytes.length - offset) / 2));
  const buffer = context.createBuffer(1, samples.length, sampleRate || 24000);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 32768;
  const source = context.createBufferSource();
  source.buffer = buffer; source.connect(context.destination);
  await context.resume?.();
  source.start();
  return new Promise(resolve => { source.onended = resolve; });
}

const KAZAKH = /[әғқңөұүһі]/i;
$('speak').addEventListener('click', async () => {
  if (!lastSummary) return;
  const button = $('speak');
  button.disabled = true; button.textContent = 'Готовим голос…';
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  const context = AudioContext ? new AudioContext() : null;
  try {
    if (!context) throw new Error('no audio');
    const response = await fetch('/api/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: lastSummary.slice(0, 400) }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    button.textContent = 'Говорит Gemini…';
    await playPcm(context, data.data, data.sampleRate);
  } catch {
    // The browser voice is the fallback; it may lack Kazakh.
    if ('speechSynthesis' in window) speechSynthesis.speak(Object.assign(new SpeechSynthesisUtterance(lastSummary), { lang: KAZAKH.test(lastSummary) ? 'kk-KZ' : /[а-яё]/i.test(lastSummary) ? 'ru-RU' : 'en-US' }));
  } finally { context?.close?.().catch(() => {}); button.disabled = false; button.textContent = 'Озвучить'; }
});

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
    const response = await fetch('/api/vision', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image, lat: state.lat, lon: state.lon }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    const parts = [el('img', { src: image, alt: 'Ваше фото' })];
    if (data.place) {
      parts.push(el('h3', { text: data.place.name }), el('span', { class: 'tag', text: `название: ${data.nameSource || 'база Ulger'} · уверенность: ${{ high: 'высокая', medium: 'средняя', low: 'низкая' }[data.confidence] || data.confidence}` }));
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
