(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const STARTS = [
    { key: 'here', label: 'моего места' },
    { key: 'baiterek', label: 'Байтерека', name: 'Байтерек', lat: 51.1283, lon: 71.4304 },
    { key: 'mega', label: 'Mega Silk Way', name: 'Mega Silk Way', lat: 51.0880152, lon: 71.4097489 },
    { key: 'embankment', label: 'набережной', name: 'Набережная Есиля', lat: 51.161, lon: 71.423 }
  ];
  const TIMES = [30, 45, 60, 90, 120];
  const CATEGORIES = { cafe: ['coffee', 'Кафе'], restaurant: ['food', 'Поесть'], park: ['park', 'Парк'], playground: ['family', 'Площадка'],
    museum: ['museum', 'Музей'], attraction: ['landmark', 'Интересное'], mall: ['indoor', 'Под крышей'], culture: ['museum', 'Культура'],
    family: ['family', 'Для семьи'] };
  // Same estimate as the server: straight line × 1.35 at 4.2 km/h, plus a 5-minute reserve.
  const METERS_PER_MINUTE = 4200 / 60 / 1.35;
  const RESERVE_MINUTES = 5;
  // «Обратно к» as on the phone: the way there, the visit and the way back; the reserve is spare time on top.
  const backIn = (place) => place.walkMinutes + place.visitMinutes + place.returnMinutes;
  const ASTANA = { minLat: 51, maxLat: 51.35, minLon: 71.25, maxLon: 71.65 };
  // Watch screens in CSS pixels: a 44 mm round Wear OS watch and a 45 mm Apple Watch.
  const SHAPES = { round: { w: 230, h: 230 }, square: { w: 198, h: 242 } };

  const params = new URLSearchParams(location.search);
  const saved = (() => { try { return JSON.parse(localStorage.getItem('seruen-watch') || '{}'); } catch { return {}; } })();
  const state = {
    framed: false, shape: 'round', minutes: TIMES.includes(saved.minutes) ? saved.minutes : 45,
    startIndex: Number.isInteger(saved.startIndex) && STARTS[saved.startIndex] ? saved.startIndex : 0,
    demo: params.get('demo') === '1', mood: null, plan: null, walk: null, heading: null, rotation: 0
  };

  function save() {
    try { localStorage.setItem('seruen-watch', JSON.stringify({ minutes: state.minutes, startIndex: state.startIndex, shape: state.shape })); } catch { /* private mode */ }
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  const time = (ms) => new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const distanceText = (meters) => meters < 950 ? `${Math.max(10, Math.round(meters / 10) * 10)} м` : `${(meters / 1000).toFixed(1).replace('.', ',')} км`;

  function haversine(a, b) {
    const rad = Math.PI / 180;
    const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lon - a.lon) * rad / 2) ** 2;
    return 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
  }

  function bearing(a, b) {
    const rad = Math.PI / 180;
    const y = Math.sin((b.lon - a.lon) * rad) * Math.cos(b.lat * rad);
    const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lon - a.lon) * rad);
    return (Math.atan2(y, x) / rad + 360) % 360;
  }

  // Layout: a real watch gets the whole viewport; anything larger shows the same screen inside a watch frame.
  function layout() {
    const forced = params.get('frame');
    state.framed = forced === '1' || (forced !== '0' && Math.min(innerWidth, innerHeight) >= 330);
    document.documentElement.classList.toggle('framed', state.framed);
    const ratio = innerWidth / innerHeight;
    const requested = params.get('shape');
    state.shape = SHAPES[requested] ? requested
      : state.framed ? (SHAPES[saved.shape] ? saved.shape : 'round') : (ratio > 0.94 && ratio < 1.06 ? 'round' : 'square');
    applyShape();
  }

  function applyShape() {
    const device = $('device');
    const screen = $('screen');
    device.classList.toggle('round', state.shape === 'round');
    device.classList.toggle('square', state.shape === 'square');
    document.querySelectorAll('[data-shape]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.shape === state.shape)));
    let width = innerWidth, height = innerHeight;
    if (state.framed) {
      ({ w: width, h: height } = SHAPES[state.shape]);
      screen.style.setProperty('--frame-w', `${width}px`);
      screen.style.setProperty('--frame-h', `${height}px`);
      device.style.zoom = String(Math.max(1, Math.min(2.1, (Math.min(innerHeight, 900) - 120) / height, (innerWidth - 48) / (width + 40))));
    } else device.style.zoom = '';
    screen.style.setProperty('--k', `${width / 100}px`);
    screen.style.setProperty('--h', `${height}px`);
  }

  function show(name) {
    for (const view of document.querySelectorAll('.view')) view.hidden = view.id !== `view-${name}`;
    $('screen').classList.toggle('scroll-snap', name === 'results' || name === 'meet');
    $('screen').scrollTop = 0;
    window.scrollTo(0, 0);
  }

  function renderHome() {
    $('time-value').textContent = state.minutes;
    $('start-value').textContent = STARTS[state.startIndex].label;
    $('clock').textContent = time(Date.now());
    refreshMeetCount();
  }

  function inAstana(point) {
    return point.lat >= ASTANA.minLat && point.lat <= ASTANA.maxLat && point.lon >= ASTANA.minLon && point.lon <= ASTANA.maxLon;
  }

  // The person's own point leaves the watch rounded to three decimals, a cell of about 110 × 70 m (as on the phone, js/core/privacy.js);
  // the exact one stays here for the walk on the watch. A fixed start from the list is a public place and goes as it is.
  const coarse = (value) => Math.round(value * 1000) / 1000;
  const sent = (start) => (start.here ? { lat: coarse(start.lat), lon: coarse(start.lon) } : { lat: start.lat, lon: start.lon });

  function currentPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) { reject(new Error('unsupported')); return; }
      navigator.geolocation.getCurrentPosition((position) => resolve({ lat: position.coords.latitude, lon: position.coords.longitude, accuracy: position.coords.accuracy }),
        reject, { enableHighAccuracy: true, timeout: 9000, maximumAge: 60000 });
    });
  }

  const ago = (ms) => { const minutes = Math.round((Date.now() - ms) / 60000); return minutes < 1 ? 'только что' : `${minutes} мин назад`; };

  // The paired phone's own point, when Friends → «показывать, где я» is on there and the point is fresh.
  async function phonePosition() {
    if (!socialToken()) return null;
    try {
      const share = (await loadSocial()).share;
      if (!share?.hasPoint || Date.now() - share.updatedAt > 15 * 60000) return null;
      const point = { lat: share.lat, lon: share.lon, accuracy: share.accuracy, updatedAt: share.updatedAt };
      return inAstana(point) ? point : null;
    } catch { return null; }
  }

  // Where the walk starts: the watch's own GPS, else the paired phone's point, else a fixed start. Every card says which,
  // so a fixed point is never passed off as the real location.
  async function resolveStart(fallback) {
    const option = STARTS[state.startIndex];
    if (!fallback && option.key !== 'here') return { lat: option.lat, lon: option.lon, name: option.name, here: false };
    const base = fallback || { lat: STARTS[1].lat, lon: STARTS[1].lon, name: STARTS[1].name, label: STARTS[1].label };
    const from = base.label || base.name;
    if (state.demo) return { ...base, here: false, note: `Демо: старт от ${from}` };
    let outside = false;
    try {
      const point = await currentPosition();
      if (inAstana(point)) return { ...point, name: 'Старт', here: true, source: 'watch', note: '📍 По геопозиции часов' };
      outside = true;
    } catch { /* no GPS in this browser, denied or timed out */ }
    const phone = await phonePosition();
    if (phone) return { ...phone, name: 'Старт', here: true, source: 'phone', note: `📍 Место с телефона, ${ago(phone.updatedAt)}` };
    return { ...base, here: false, warn: true,
      note: outside ? `Вы не в Астане: считаю от ${from}` : `⚠ Часы не дали геопозицию: считаю от ${from}` };
  }

  async function findPlaces(mood) {
    state.mood = mood;
    show('loading');
    $('loading-text').textContent = STARTS[state.startIndex].key === 'here' && !state.demo ? 'Где вы?…' : 'Ищем рядом…';
    const start = await resolveStart();
    $('loading-text').textContent = 'Ищем рядом…';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const point = sent(start);
      const query = new URLSearchParams({ lat: String(point.lat), lon: String(point.lon), minutes: String(state.minutes), mood });
      const response = await fetch(`/api/watch/plan?${query}`, { signal: controller.signal });
      let data;
      try { data = await response.json(); } catch { throw new Error('Aidem ответил неожиданно. Попробуйте ещё раз.'); }
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Не получилось подобрать места.');
      state.plan = { places: data.places, query: data.query, start, minutes: state.minutes, at: Date.now() };
      renderResults();
      show('results');
    } catch (error) {
      showError(error.name === 'AbortError' ? 'Сеть отвечает слишком долго. Попробуйте ещё раз.'
        : error instanceof TypeError ? 'Нет связи с Aidem. Проверьте интернет на часах или телефоне.' : error.message);
    } finally { clearTimeout(timer); }
  }

  // Search by name: "Мега", "Хан Шатыр", "кофе". Dictation gives Cyrillic, many places are named in Latin letters,
  // so a Cyrillic query is also searched transliterated.
  const LATIN = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n',
    о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e',
    ю: 'yu', я: 'ya', ә: 'a', ғ: 'g', қ: 'k', ң: 'n', ө: 'o', ұ: 'u', ү: 'u', һ: 'h', і: 'i' };
  const latin = (text) => [...text].map((letter) => LATIN[letter] ?? letter).join('');

  // «Мега» is a name to find; «где выпить кофе рядом?» is a question for the assistant.
  const QUESTION = /\?|^(где|куда|что|чем|как|какой|какая|какое|какие|когда|сколько|можно|посоветуй|подскажи|хочу|хотим|найди|покажи|отведи|давай|пойд|пошли|идём|айда|мне|нам|а )/i;
  const isQuestion = (text) => QUESTION.test(text.trim()) || text.trim().split(/\s+/).length >= 4;

  async function searchPlaces(raw) {
    if (isQuestion(raw)) { askAssistant(raw); return; }
    const query = raw.trim().replace(/[.!?…]+$/, '').toLowerCase().slice(0, 60);
    // Dictation can end with both a change and a submit.
    if (query.length < 2 || (state.lastSearch?.query === query && Date.now() - state.lastSearch.at < 1500)) return;
    state.lastSearch = { query, at: Date.now() };
    state.mood = null;
    show('loading');
    $('loading-text').textContent = `Ищем «${query}»…`;
    const start = await resolveStart();
    const point = sent(start);
    const near = `&lat=${point.lat}&lon=${point.lon}`;
    const variants = [...new Set([query, latin(query)])];
    try {
      const answers = await Promise.all(variants.map((variant) => fetch(`/api/social/places?q=${encodeURIComponent(variant)}${near}`)
        .then((response) => (response.ok ? response.json() : { places: [] }))));
      const seen = new Set();
      // Names that start with the query first ("Mega Silk Way" before "Taksim Fastfood Mega Silkway"), then the nearest.
      const found = answers.flatMap((answer) => answer.places || []).filter((place) => inAstana(place) && !seen.has(place.id) && seen.add(place.id))
        .map((place) => ({ place, starts: variants.some((variant) => place.name.toLowerCase().replace(/ё/g, 'е').startsWith(variant)) }))
        .sort((a, b) => b.starts - a.starts || a.place.distanceMeters - b.place.distanceMeters).slice(0, 5)
        .map(({ place }) => {
          const walkMinutes = Math.max(1, Math.ceil(place.distanceMeters / METERS_PER_MINUTE));
          const visitMinutes = Math.max(10, state.minutes - 2 * walkMinutes - RESERVE_MINUTES);
          return { ...place, walkMinutes, visitMinutes, returnMinutes: walkMinutes, totalMinutes: 2 * walkMinutes + visitMinutes + RESERVE_MINUTES, hours: { status: 'no_data' } };
        });
      if (!found.length && query.includes(' ')) { state.lastSearch = null; askAssistant(raw); return; }
      state.plan = { places: found, query: '', start, minutes: state.minutes, at: Date.now(), search: query };
      renderResults();
      $('ask-gemini').hidden = true;
      show('results');
    } catch {
      showError('Нет связи с Aidem. Проверьте интернет на часах или телефоне.', () => searchPlaces(query));
    }
  }

  // Voice: the browser's speech recognition, or a recording written down by /api/listen. Without either (Apple Watch)
  // the mic stays a plain label for the field, and watchOS opens its own dictation.
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const canRecord = Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);

  // Each field has its own mic: the home search and the question to the assistant.
  const MICS = { voice: { input: 'search-input', placeholder: 'Найти место', send: (text) => searchPlaces(text) },
    'ask-voice': { input: 'ask-input', placeholder: 'Ваш вопрос', send: (text) => askAssistant(text) } };

  function setListening(on) {
    const mic = state.mic || MICS.voice;
    $(mic === MICS.voice ? 'voice' : 'ask-voice').classList.toggle('rec', on);
    $(mic.input).placeholder = on ? 'Говорите…' : mic.placeholder;
    buzz(on ? 30 : 15);
  }

  function heard(text) {
    const mic = state.mic || MICS.voice;
    $(mic.input).value = text;
    mic.send(text);
  }

  function voice(event) {
    if (!Recognition && !canRecord) return;
    event.preventDefault();
    unlockVoice();
    if (!state.recording) state.mic = MICS[event.currentTarget.id] || MICS.voice;
    if (state.recording) { state.recording.stop(); return; }
    if (Recognition) recognize(); else record();
  }

  function recognize() {
    const recognition = new Recognition();
    recognition.lang = 'ru-RU';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    let result = '';
    recognition.onresult = (event) => { result = event.results[0]?.[0]?.transcript || ''; };
    recognition.onerror = (event) => { if (event.error === 'network' || event.error === 'service-not-allowed') result = null; };
    recognition.onend = () => {
      state.recording = null;
      setListening(false);
      if (result) heard(result);
      else if (result === null && canRecord) record();
    };
    state.recording = recognition;
    setListening(true);
    recognition.start();
  }

  async function record() {
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { $('search-input').focus(); return; }
    const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'].find((item) => MediaRecorder.isTypeSupported?.(item)) || '';
    const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks = [];
    let limit;
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = async () => {
      clearTimeout(limit);
      stream.getTracks().forEach((track) => track.stop());
      state.recording = null;
      setListening(false);
      const blob = new Blob(chunks, { type: (recorder.mimeType || type || 'audio/webm').split(';')[0] });
      if (blob.size < 800) return;
      show('loading');
      $('loading-text').textContent = 'Распознаём…';
      try {
        const recording = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
        const response = await fetch('/api/listen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audio: recording, mimeType: blob.type, lang: 'ru' }) });
        const data = await response.json();
        if (!response.ok || !data.text) throw new Error(typeof data.error === 'string' ? data.error : 'Не расслышали. Попробуйте ещё раз.');
        heard(data.text);
      } catch (error) {
        showError(error instanceof TypeError ? 'Нет связи с Aidem. Проверьте интернет на часах или телефоне.' : error.message, () => { renderHome(); show('home'); });
      }
    };
    state.recording = recorder;
    recorder.start();
    setListening(true);
    // Up to 5 seconds, or until the second tap.
    limit = setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 5000);
  }

  function startNote(start) {
    return element('p', `start-note${start.warn ? ' warn' : ''}${start.source ? ` from-${start.source}` : ''}`, start.note);
  }

  function renderResults() {
    const list = $('results');
    list.replaceChildren();
    $('gemini-tip').hidden = true;
    $('ask-gemini').hidden = false;
    $('ask-gemini').disabled = false;
    const { places, start, answer } = state.plan;
    $('ask-more').hidden = !answer;
    if (answer) {
      $('ask-gemini').hidden = true;
      list.append(answerCard(answer));
      if (!places.length) return;
    }
    if (!places.length && state.plan.search) {
      const card = element('article', 'card');
      card.append(element('p', 'card-name', `Не нашли «${state.plan.search}»`), element('p', 'card-hours', 'Попробуйте сказать название иначе или выберите настроение.'));
      list.append(card);
      $('ask-gemini').hidden = true;
      return;
    }
    if (!places.length) {
      const card = element('article', 'card');
      card.append(element('p', 'card-name', 'Рядом ничего не успеть'), element('p', 'card-hours', `За ${state.plan.minutes} мин с дорогой обратно подходящих мест нет.`));
      const more = element('button', 'action', '+30 минут');
      more.type = 'button';
      more.addEventListener('click', () => { state.minutes = TIMES.find((value) => value >= state.plan.minutes + 30) || 120; save(); findPlaces(state.mood); });
      card.append(more);
      list.append(card);
      $('ask-gemini').hidden = true;
      return;
    }
    places.forEach((place, index) => {
      const [iconName, label] = CATEGORIES[place.category] || ['landmark', 'Место'];
      const card = element('article', 'card');
      card.setAttribute('aria-label', `${index + 1} из ${places.length}: ${place.name}`);
      const top = element('p', 'card-top');
      const image = element('img');
      image.src = `/assets/icons/categories/${iconName}-64.webp`;
      image.alt = '';
      top.append(image, element('span', '', `${index + 1}/${places.length} · ${label}`));
      const walk = element('p', 'card-walk');
      const caption = element('span');
      caption.append('мин', document.createElement('br'), 'пешком');
      walk.append(element('b', '', String(place.walkMinutes)), caption);
      const back = element('p', 'card-back', 'обратно к ');
      back.append(element('b', '', time(Date.now() + backIn(place) * 60000)));
      const facts = [distanceText(place.distanceMeters)];
      facts.push(place.hours?.status === 'open' && place.hours.closesAt ? `открыто до ${place.hours.closesAt}` : 'часы неизвестны');
      const go = element('button', 'action', 'Идём');
      go.type = 'button';
      go.addEventListener('click', () => startWalk(place));
      card.dataset.place = place.id;
      card.append(top, element('p', 'card-name', place.name), walk, back, element('p', 'card-hours', facts.join(' · ')), trust(place), go);
      const rated = ratingLine(place.userRating);
      if (rated) go.before(rated);
      if (index === 0 && start.note) card.prepend(startNote(start));
      list.append(card);
    });
    fillRatings(places.filter((place) => !place.userRating), list);
  }

  // Aidem users' ratings, read-only on the wrist: «★ 4,6 · 12 оценок» from three ratings, «мало оценок» below, nothing with none.
  // They are people's stars, not open data; they are given on the phone.
  function ratingLine(rating) {
    if (!rating?.count) return null;
    const many = rating.count % 10 === 1 && rating.count % 100 !== 11 ? 'оценка' : [2, 3, 4].includes(rating.count % 10) && ![12, 13, 14].includes(rating.count % 100) ? 'оценки' : 'оценок';
    const enough = rating.state === 'enough' && Number.isFinite(rating.average);
    const text = enough ? `${rating.average.toFixed(1).replace('.', ',')} · ${rating.count} ${many}` : `мало оценок (${rating.count})`;
    const line = element('p', 'card-rating');
    if (enough) line.append(element('span', 'card-star', '★'), ' ');
    line.append(text);
    line.setAttribute('aria-label', `Оценки пользователей Aidem: ${text}`);
    return line;
  }

  // Places found by name or by the assistant come without ratings; one request fetches them for all cards.
  async function fillRatings(places, list) {
    const ids = places.map((place) => place.id).filter(Boolean);
    if (!ids.length) return;
    try {
      const response = await fetch(`/api/ratings?ids=${ids.slice(0, 30).map(encodeURIComponent).join(',')}`);
      if (!response.ok) return;
      const { ratings = {} } = await response.json();
      for (const card of list.querySelectorAll('.card[data-place]')) {
        const line = !card.querySelector('.card-rating') && ratingLine(ratings[card.dataset.place]);
        if (line) card.querySelector('.action')?.before(line);
      }
    } catch { /* ratings are optional on the watch */ }
  }

  // How complete the data is and where it came from, as on the place card in the main app.
  function trust(place) {
    const line = element('p', 'card-trust');
    const level = place.confidence?.level;
    if (level) {
      // Round screens drop the second word to keep «Идём» on screen: «● Высокая · OpenStreetMap».
      const [word, ...rest] = (place.confidence.label || 'Уверенность').split(' ');
      const badge = element('span', `conf conf-${level}`, word);
      if (rest.length) badge.append(element('span', 'conf-word', ` ${rest.join(' ')}`));
      line.append(badge, ' · ');
    }
    line.append(place.source?.label || 'OpenStreetMap');
    return line;
  }

  // The assistant: a question by voice or text goes to the same Gemini agent as /agent on the phone (/api/agent),
  // with the real start point; the answer comes back as text, read aloud where the watch can play sound, and as cards with «Идём».
  const EXAMPLES = ['Кофе рядом на полчаса', 'Куда с ребёнком на час?', 'Что посмотреть до заката?'];
  const FOLLOW_UPS = ['А поближе?', 'А под крышей?', 'А на полчаса?'];
  const CONFIDENCE = { high: 'Высокая уверенность', medium: 'Средняя уверенность', low: 'Низкая уверенность' };

  function openAsk() {
    const chat = state.chat;
    $('ask-context').hidden = !chat;
    if (chat) $('ask-context').textContent = `Продолжаем: «${chat.question}»`;
    $('ask-reset').hidden = !chat;
    $('ask-input').value = '';
    $('ask-examples').replaceChildren(...(chat ? FOLLOW_UPS : EXAMPLES).map((text) => {
      const button = element('button', 'example', text);
      button.type = 'button';
      button.addEventListener('click', () => askAssistant(text));
      return button;
    }));
    show('ask');
  }

  // Times from the agent were counted from the start sent with the question; a place found only by name gets them here.
  function fitPlace(place, start) {
    const timed = Number.isFinite(place.totalMinutes);
    const walkMinutes = timed ? place.walkMinutes : Math.max(1, Math.ceil(haversine(start, place) / METERS_PER_MINUTE));
    const visitMinutes = timed ? place.visitMinutes : Math.max(10, state.minutes - 2 * walkMinutes - RESERVE_MINUTES);
    const level = place.confidence?.level;
    return { id: place.id, name: place.name, category: place.category, lat: place.lat, lon: place.lon,
      distanceMeters: Number.isFinite(place.distanceMeters) ? place.distanceMeters : Math.round(haversine(start, place)),
      walkMinutes, visitMinutes, returnMinutes: timed ? place.returnMinutes : walkMinutes,
      totalMinutes: timed ? place.totalMinutes : 2 * walkMinutes + visitMinutes + RESERVE_MINUTES,
      hours: place.hours || { status: 'no_data' }, source: { label: place.dataSource || 'OpenStreetMap' },
      confidence: CONFIDENCE[level] ? { level, label: CONFIDENCE[level] } : null };
  }

  async function askAssistant(raw) {
    const question = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    // Dictation can end with both a change and a submit.
    if (question.length < 2 || (state.lastAsk?.question === question && Date.now() - state.lastAsk.at < 1500)) return;
    state.lastAsk = { question, at: Date.now() };
    unlockVoice();
    stopVoice();
    state.mood = null;
    show('loading');
    $('loading-text').textContent = '✦ Aidem думает…';
    const start = await resolveStart();
    const previous = state.chat ? { query: state.chat.question, summary: state.chat.summary } : undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch('/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ query: question, ...sent(start), minutes: state.minutes, lang: 'ru', ...(previous ? { previous } : {}) }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Помощник сейчас недоступен. Попробуйте ещё раз.');
      const places = (data.places || []).filter((place) => inAstana(place)).slice(0, 3).map((place) => fitPlace(place, start));
      // Without Gemini the agent's summary is a generic line; the watch says what it found instead, and says Gemini was not there.
      const first = places[0];
      const summary = data.mode === 'agent' ? String(data.summary || '').trim()
        : first ? `Gemini сейчас не ответил. Ближе всего «${first.name}»: ${first.walkMinutes} мин пешком, обратно к ${time(Date.now() + backIn(first) * 60000)}.`
          : 'Gemini сейчас не ответил, а рядом под ваш вопрос ничего не нашлось. Попробуйте спросить иначе.';
      state.chat = { question, summary };
      state.plan = { places, query: '', start, minutes: state.minutes, at: Date.now(),
        answer: { question, summary, ai: data.mode === 'agent', steps: (data.steps || []).map((step) => step.label).filter(Boolean).slice(0, 4) } };
      renderResults();
      show('results');
      buzz([20, 60, 20]);
      speak(summary);
    } catch (error) {
      const message = error?.name === 'AbortError' ? 'Помощник отвечает слишком долго. Попробуйте ещё раз.'
        : error instanceof TypeError ? 'Нет связи с Aidem. Проверьте интернет на часах или телефоне.' : error.message;
      showError(message, () => { state.lastAsk = null; askAssistant(question); });
    } finally { clearTimeout(timer); }
  }

  function answerCard(answer) {
    const card = element('article', 'card answer-card');
    card.setAttribute('aria-label', 'Ответ Aidem');
    card.append(element('p', 'answer-head', answer.ai ? '✦ Aidem · Gemini' : '✦ Aidem · без модели'),
      element('p', 'answer-q', `«${answer.question}»`), element('p', 'answer-text', answer.summary));
    if (canSpeak && answer.summary) {
      const play = element('button', 'action ghost answer-play', '🔊 Прослушать');
      play.type = 'button';
      play.addEventListener('click', () => { unlockVoice(); speak(answer.summary); });
      card.append(play);
    }
    if (answer.steps.length) card.append(element('p', 'answer-steps', answer.steps.join(' → ')));
    if (state.plan.places.length) card.append(element('p', 'answer-more', 'Ниже места ↓'));
    return card;
  }

  // The answer read aloud: Gemini's voice through /api/speak, else the browser's own voice.
  // Apple Watch pages have neither, so there the answer stays text on the screen.
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const canSpeak = Boolean(AudioContextClass || 'speechSynthesis' in window);
  let audio = null, speech = 0, playing = null;

  /** Inside a tap: wakes the audio context so the answer can play when it arrives (iOS and Safari need this). */
  function unlockVoice() {
    if (AudioContextClass) {
      try {
        if (!audio || audio.state === 'closed') audio = new AudioContextClass();
        audio.resume?.().catch(() => {});
        const source = audio.createBufferSource();
        source.buffer = audio.createBuffer(1, 1, 22050);
        source.connect(audio.destination);
        source.start();
      } catch { /* no sound on this device */ }
    }
    if ('speechSynthesis' in window && !unlockVoice.done) { unlockVoice.done = true; speechSynthesis.speak(new SpeechSynthesisUtterance('')); }
  }

  function stopVoice() {
    speech++;
    playing?.stop();
    playing = null;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }

  async function speak(text) {
    if (!canSpeak || !text) return;
    stopVoice();
    const id = speech;
    // /api/speak takes up to 400 characters: whole sentences that fit.
    const clean = text.length <= 400 ? text : (text.slice(0, 400).match(/^.*[.!?…](?=\s|$)/s)?.[0] || text.slice(0, 400));
    try {
      if (!audio) throw new Error('no audio');
      const response = await fetch('/api/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: clean, lang: 'ru' }) });
      const data = await response.json();
      if (!response.ok || !data.data || id !== speech) throw new Error('no voice');
      const bytes = Uint8Array.from(atob(data.data), (char) => char.charCodeAt(0));
      // A WAV answer starts with a RIFF header; the samples after it are the same 16-bit PCM.
      const offset = bytes.length > 44 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' ? 44 : 0;
      const samples = new Int16Array(bytes.buffer, offset, Math.floor((bytes.length - offset) / 2));
      const buffer = audio.createBuffer(1, samples.length, data.sampleRate || 24000);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 32768;
      await audio.resume?.();
      if (audio.state !== 'running') throw new Error('audio locked');
      if (id !== speech) return;
      const source = audio.createBufferSource();
      source.buffer = buffer;
      source.connect(audio.destination);
      source.start();
      playing = { stop: () => { try { source.stop(); } catch { /* already stopped */ } } };
    } catch {
      if (id !== speech || !('speechSynthesis' in window)) return;
      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.lang = 'ru-RU';
      speechSynthesis.speak(utterance);
    }
  }

  async function askGemini() {
    const button = $('ask-gemini');
    const tip = $('gemini-tip');
    button.disabled = true;
    tip.hidden = false;
    tip.textContent = 'Gemini думает…';
    const { start, minutes } = state.plan;
    try {
      const response = await fetch('/api/recommend', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...sent(start), minutes, maxWalkMinutes: Math.min(30, Math.max(5, Math.round(minutes / 3))),
          query: state.plan.query || '', withChild: state.mood === 'child', category: 'any', returnToStart: true }) });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Gemini сейчас недоступен.');
      tip.replaceChildren(data.generation?.mode === 'llm' ? data.generation.summary : 'Gemini сейчас не ответил. Варианты подобраны по данным OpenStreetMap и Overture Maps.',
        element('small', '', data.generation?.mode === 'llm' ? 'Gemini · факты из OpenStreetMap и Overture Maps' : 'Подбор без модели'));
      button.hidden = true;
    } catch (error) {
      tip.textContent = error instanceof TypeError ? 'Нет связи. Попробуйте ещё раз.' : error.message;
      button.disabled = false;
    }
  }

  function showError(message, retry = () => (state.mood ? findPlaces(state.mood) : show('home'))) {
    state.retry = retry;
    $('error-text').textContent = message;
    show('error');
  }

  // Walking. In demo mode time runs 30 times faster (120 while staying) and the position moves on its own.
  function clock() {
    return state.walk?.demo ? state.walk.simNow : Date.now();
  }

  function buzz(pattern) {
    try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
  }

  async function keepAwake() {
    try { state.wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* unsupported or denied */ }
  }

  function onOrientation(event) {
    let heading = null;
    if (typeof event.webkitCompassHeading === 'number') heading = event.webkitCompassHeading;
    else if (event.absolute && typeof event.alpha === 'number') heading = 360 - event.alpha;
    if (heading === null || Number.isNaN(heading)) return;
    state.heading = (heading + (screen.orientation?.angle || 0) + 360) % 360;
  }

  function listenCompass() {
    const DOE = window.DeviceOrientationEvent;
    if (!DOE) return;
    const attach = () => {
      window.addEventListener('deviceorientationabsolute', onOrientation);
      window.addEventListener('deviceorientation', onOrientation);
    };
    // iOS asks for permission, and only from a tap.
    if (typeof DOE.requestPermission === 'function') DOE.requestPermission().then((answer) => { if (answer === 'granted') attach(); }).catch(() => {});
    else attach();
  }

  // Ring segments in pathLength units (0–100). Round caps reach ~0.7 units past each end, hence the gap.
  const RING_GAP = 2.4;
  function ringCircle(segment) {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    for (const [name, value] of Object.entries({ cx: 50, cy: 50, r: 46, pathLength: 100, class: `seg-${segment.kind}` })) circle.setAttribute(name, String(value));
    circle.style.strokeDasharray = `${Math.max(0.01, segment.length - RING_GAP).toFixed(2)} 100`;
    circle.style.strokeDashoffset = String(-(segment.start + RING_GAP / 2));
    return circle;
  }

  function setupRing(walk, parts) {
    walk.ringMinutes = parts.reduce((sum, [, minutes]) => sum + minutes, 0);
    let start = 0;
    walk.segments = parts.map(([kind, minutes]) => {
      const segment = { kind, start, length: minutes / walk.ringMinutes * 100 };
      start += segment.length;
      return segment;
    });
    $('ring-plan').replaceChildren(...walk.segments.map(ringCircle));
    $('ring-done').replaceChildren(...walk.segments.map(ringCircle));
  }

  function updateRing(walk, fraction) {
    const done = $('ring-done').children;
    walk.segments.forEach((segment, index) => {
      const visible = Math.min(segment.length - RING_GAP, fraction * 100 - segment.start - RING_GAP / 2);
      done[index].style.opacity = visible > 0 ? '1' : '0';
      done[index].style.strokeDasharray = `${Math.max(0.01, visible).toFixed(2)} 100`;
    });
    const angle = fraction * 2 * Math.PI;
    $('ring-dot').setAttribute('cx', (50 + 46 * Math.sin(angle)).toFixed(2));
    $('ring-dot').setAttribute('cy', (50 - 46 * Math.cos(angle)).toFixed(2));
  }

  function newWalk(fields) {
    const now = Date.now();
    return { phase: 'to', demo: state.demo, t0: now, simNow: now, lastReal: performance.now(), realStart: performance.now(),
      pos: { lat: fields.start.lat, lon: fields.start.lon }, accuracy: null, alerted: false, arrivedAt: null, ...fields };
  }

  function startWalk(place) {
    stopVoice();
    // The walk keeps the card's plan, so «обратно к» on the wrist is the time the card showed.
    const there = place.walkMinutes, stay = Math.max(1, place.visitMinutes), back = place.returnMinutes;
    const reserve = Math.max(0, place.totalMinutes - there - stay - back);
    const walk = newWalk({ kind: 'place', place, start: state.plan.start, minutes: there + stay + back + reserve, reserve });
    walk.deadline = walk.t0 + walk.minutes * 60000;
    walk.backAt = walk.deadline - reserve * 60000;
    beginWalk(walk, [['there', there], ['stay', stay], ['back', back], ['reserve', reserve]]);
    if (window.SeruenRemind?.supported()) remindOnWrist(walk);
  }

  function beginWalk(walk, parts) {
    state.heading = null;
    state.walk = walk;
    setupRing(walk, parts);
    setNote(walk.demo ? 'ДЕМО ×30' : '');
    $('view-go').classList.remove('late', 'over', 'stay', 'alert');
    if (!walk.demo) {
      listenCompass();
      if (navigator.geolocation) {
        state.watchId = navigator.geolocation.watchPosition((position) => {
          if (state.walk !== walk) return;
          walk.pos = { lat: position.coords.latitude, lon: position.coords.longitude };
          walk.accuracy = position.coords.accuracy;
          walk.fix = 'watch';
          walk.fixAt = Date.now();
        }, () => {}, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
      }
      if (walk.start.source === 'phone') { walk.fix = 'phone'; walk.fixAt = walk.start.updatedAt; }
      if (socialToken()) {
        state.phoneTimer = setInterval(async () => {
          if (state.walk !== walk || (walk.fix === 'watch' && Date.now() - walk.fixAt < 30000)) return;
          const phone = await phonePosition();
          if (!phone || state.walk !== walk || phone.updatedAt === walk.fixAt) return;
          walk.pos = { lat: phone.lat, lon: phone.lon };
          walk.accuracy = phone.accuracy;
          walk.fix = 'phone';
          walk.fixAt = phone.updatedAt;
        }, 15000);
      }
    }
    keepAwake();
    show('go');
    buzz(40);
    tick();
    state.timer = setInterval(tick, walk.demo ? 200 : 1000);
  }

  function setNote(text) {
    if (state.walk) state.walk.note = text;
    renderNote(state.walk, text);
  }

  // Without a live position the arrow is drawn from the start, and the badge says so.
  function renderNote(walk, text = walk?.note || '') {
    let shown = text;
    if (walk && !walk.demo) {
      const live = walk.fix === 'watch' && Date.now() - walk.fixAt < 60000;
      // The first fix can take a few seconds.
      if (!live && (walk.fix || Date.now() - walk.t0 > 8000)) shown = walk.fix === 'phone' ? `📍 с телефона, ${ago(walk.fixAt)}` : '⚠ нет GPS на часах';
    }
    $('demo-badge').textContent = shown;
    $('demo-badge').hidden = !shown;
    $('demo-badge').classList.toggle('gps-off', Boolean(walk && !walk.demo && shown !== text));
  }

  // Reminders through the phone's notifications reach any paired watch or band, even with this page closed.
  function remindOnWrist(walk) {
    walk.leaveAt = walk.t0 + (walk.minutes - walk.place.returnMinutes - walk.reserve) * 60000;
    if (walk.demo) {
      // Demo time is accelerated, so only ask for permission now; the notification goes out when the demo says "time to go back".
      window.SeruenRemind.permission().catch(() => {});
      return;
    }
    const name = walk.place.name.slice(0, 60);
    const reminders = [];
    if (walk.leaveAt - 5 * 60000 > Date.now() + 60000) {
      reminders.push({ at: walk.leaveAt - 5 * 60000, tag: 'seruen-soon', title: 'Через 5 минут обратно',
        body: `Выйдите из «${name}» в ${time(walk.leaveAt)}, чтобы вернуться к ${time(walk.backAt)}.` });
    }
    reminders.push({ at: Math.max(Date.now(), walk.leaveAt), tag: 'seruen-back', title: 'Пора обратно',
      body: `До старта примерно ${walk.place.returnMinutes} мин пешком. Успеете к ${time(walk.backAt)}.` });
    window.SeruenRemind.schedule(reminders).then((result) => {
      if (!result.ok) return;
      if (state.walk !== walk) { window.SeruenRemind.cancel(result.id); return; }
      walk.reminderId = result.id;
      setNote(`🔔 напомню в ${time(walk.leaveAt)}`);
    });
  }

  function cancelReminders(walk) {
    if (walk?.reminderId) window.SeruenRemind?.cancel(walk.reminderId);
    if (walk) walk.reminderId = null;
  }

  function stopWalk() {
    cancelReminders(state.walk);
    clearInterval(state.timer);
    clearInterval(state.poll);
    clearInterval(state.phoneTimer);
    state.poll = null;
    state.phoneTimer = null;
    if (state.watchId !== undefined && state.watchId !== null) navigator.geolocation?.clearWatch(state.watchId);
    state.watchId = null;
    window.removeEventListener('deviceorientationabsolute', onOrientation);
    window.removeEventListener('deviceorientation', onOrientation);
    state.wakeLock?.release?.().catch(() => {});
    state.wakeLock = null;
  }

  function simulate(walk, target) {
    const real = performance.now();
    const elapsed = real - walk.lastReal;
    walk.lastReal = real;
    walk.simNow += elapsed * (walk.phase === 'stay' ? 120 : 30);
    if (walk.phase === 'stay') return;
    const remaining = haversine(walk.pos, target);
    const step = Math.min(remaining, METERS_PER_MINUTE * elapsed * 30 / 60000);
    if (remaining > 0) {
      const fraction = step / remaining;
      walk.pos = { lat: walk.pos.lat + (target.lat - walk.pos.lat) * fraction, lon: walk.pos.lon + (target.lon - walk.pos.lon) * fraction };
    }
    // A person turning towards the arrow, then walking with a slight sway.
    const seconds = (real - walk.realStart) / 1000;
    state.heading = (bearing(walk.pos, target) + 100 * Math.exp(-seconds / 1.6) + 9 * Math.sin(seconds * 2.1) + 360) % 360;
  }

  function setPhase(phase) {
    const walk = state.walk;
    walk.phase = phase;
    const view = $('view-go');
    view.classList.toggle('stay', phase === 'stay');
    walk.realStart = performance.now();
    // Leaving early: the scheduled "time to go back" is no longer needed.
    if (phase === 'back' && !walk.alerted) cancelReminders(walk);
    if (phase === 'stay') { walk.arrivedAt = clock(); walk.stayAt = { ...walk.pos }; buzz([70, 70, 70]); }
  }

  function timeToReturn() {
    const walk = state.walk;
    if (walk.alerted) return;
    walk.alerted = true;
    const view = $('view-go');
    view.classList.remove('alert');
    void view.offsetWidth;
    view.classList.add('alert');
    buzz([400, 150, 400, 150, 400]);
    if (walk.demo && window.SeruenRemind?.supported() && Notification.permission === 'granted') {
      window.SeruenRemind.schedule([{ at: Date.now(), tag: 'seruen-back', title: 'Пора обратно',
        body: `До старта примерно ${walk.place.returnMinutes} мин пешком. Успеете к ${time(walk.backAt)}.` }]);
    }
    setPhase('back');
  }

  function finish() {
    const walk = state.walk;
    stopWalk();
    const spent = Math.max(1, Math.round((clock() - walk.t0) / 60000));
    const late = Math.round((clock() - walk.deadline) / 60000);
    $('done-title').textContent = late > 0 ? 'Почти вовремя' : 'Вы вернулись';
    $('done-text').textContent = late > 0 ? `${spent} мин, на ${late} мин позже плана.` : `${spent} мин из ${walk.minutes}. Вовремя.`;
    $('done-home').textContent = 'Ещё прогулка';
    state.doneTo = 'home';
    buzz([70, 70, 70]);
    state.walk = null;
    show('done');
  }

  function tick() {
    const walk = state.walk;
    if (!walk) return;
    if (!walk.demo) renderNote(walk);
    if (walk.kind !== 'place') { tickTarget(walk); return; }
    const target = walk.phase === 'back' ? walk.start : walk.place;
    if (walk.demo) simulate(walk, target);
    const now = clock();
    const distance = haversine(walk.pos, target);
    const toTarget = bearing(walk.pos, target);
    const backMinutes = Math.ceil(haversine(walk.pos, walk.start) / METERS_PER_MINUTE);
    const leaveBy = walk.deadline - (backMinutes + walk.reserve) * 60000;
    const arrivalRadius = walk.demo ? 12 : Math.max(25, Math.min(walk.accuracy || 25, 60));

    const away = Math.max(90, arrivalRadius * 2);
    // The walk ends itself only after the walker has really left the start, so trying it at a desk does not finish it.
    if (haversine(walk.pos, walk.start) > away) walk.leftStart = true;
    if (walk.phase === 'to' && distance <= arrivalRadius) setPhase('stay');
    // Walking away from where the visit began means it is over.
    else if (walk.phase === 'stay' && !walk.demo && haversine(walk.pos, walk.stayAt || walk.place) > away) setPhase('back');
    else if (walk.phase === 'back' && distance <= arrivalRadius && (walk.demo || walk.leftStart)) { finish(); return; }
    if (walk.phase !== 'back' && now >= leaveBy) { timeToReturn(); return tick(); }

    const view = $('view-go');
    updateRing(walk, Math.min(1, Math.max(0, (now - walk.t0) / (walk.ringMinutes * 60000))));
    const walkMinutes = Math.ceil(distance / METERS_PER_MINUTE);
    view.classList.toggle('over', now > walk.deadline);
    view.classList.toggle('late', now <= walk.deadline && (walk.phase === 'back' ? now + walkMinutes * 60000 > walk.deadline : now >= leaveBy - 3 * 60000));

    pointArrow(toTarget);
    if (walk.demo) $('demo-badge').textContent = `ДЕМО ×${walk.phase === 'stay' ? 120 : 30}`;

    $('go-name').textContent = walk.phase === 'back' ? walk.start.name : walk.place.name;
    if (walk.phase === 'stay') {
      $('go-phase').textContent = 'На месте';
      $('go-minutes').textContent = String(Math.max(0, Math.floor((leaveBy - now) / 60000)));
      $('go-unit').textContent = 'мин ещё';
      $('go-back').replaceChildren('выйти до ', element('b', '', time(leaveBy)));
    } else {
      $('go-phase').textContent = `${walk.phase === 'back' ? (walk.alerted ? 'Пора обратно' : 'Обратно') : 'Туда'} · ${distanceText(distance)}`;
      $('go-minutes').textContent = String(walkMinutes);
      $('go-unit').textContent = 'мин';
      $('go-back').replaceChildren(walk.phase === 'back' ? 'успеть к ' : 'обратно к ', element('b', '', time(walk.backAt)));
    }
    $('go-next').textContent = { to: 'Я на месте', stay: 'Обратно', back: 'Я вернулся' }[walk.phase];
  }

  function pointArrow(toTarget) {
    const heading = state.heading;
    let rotation = heading === null ? toTarget : toTarget - heading;
    // Turn the shortest way instead of spinning through 360°.
    rotation = state.rotation + ((((rotation - state.rotation) % 360) + 540) % 360 - 180);
    state.rotation = rotation;
    $('arrow').style.transform = `rotate(${rotation}deg)`;
    $('north').style.transform = `translateY(-50%) rotate(${heading === null ? 0 : -heading}deg)`;
  }

  function next() {
    const walk = state.walk;
    if (!walk) return;
    if (walk.kind !== 'place') { arriveAtTarget(); return; }
    if (walk.phase === 'to') setPhase('stay');
    else if (walk.phase === 'stay') setPhase('back');
    else { finish(); return; }
    tick();
  }

  // Meetups and friends come from the Aidem account on the phone. The watch is linked once with a 6-digit code
  // (phone: Профиль → Связать часы) and then keeps its own token.
  const SOCIAL_KEY = 'seruen-watch-social';
  const MEMBER_STATUS = { arrived: 'на месте', on_way: 'в пути', going: 'придёт', maybe: 'может быть', invited: 'приглашён', declined: 'не придёт' };

  function socialToken() {
    try { return localStorage.getItem(SOCIAL_KEY) || state.socialToken; } catch { return state.socialToken; }
  }

  function rememberToken(token) {
    state.socialToken = token;
    try { if (token) localStorage.setItem(SOCIAL_KEY, token); else localStorage.removeItem(SOCIAL_KEY); } catch { /* private mode */ }
    if (!token) { state.social = null; state.socialAt = 0; }
  }

  async function social(op, body) {
    const token = socialToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`/api/social/${op}`, body === undefined ? { headers, signal: controller.signal }
        : { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      let data = {};
      try { data = await response.json(); } catch { /* not JSON */ }
      if (response.status === 401 && token) rememberToken(null);
      if (!response.ok) throw Object.assign(new Error(typeof data.error === 'string' ? data.error : 'Не получилось. Попробуйте ещё раз.'), { status: response.status });
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('Сеть отвечает слишком долго. Попробуйте ещё раз.');
      if (error instanceof TypeError) throw new Error('Нет связи с Aidem. Проверьте интернет на часах или телефоне.');
      throw error;
    } finally { clearTimeout(timer); }
  }

  function upcomingMeetups() {
    const now = Date.now();
    return (state.social?.meetups || []).filter((meetup) => meetup.status !== 'cancelled' && meetup.myStatus !== 'declined' && meetup.startsAt > now - 2 * 3600000);
  }

  async function loadSocial() {
    state.social = await social('state');
    state.me = state.social.me;
    state.socialAt = Date.now();
    return state.social;
  }

  async function refreshMeetCount() {
    if (socialToken() && Date.now() - (state.socialAt || 0) > 60000) {
      state.socialAt = Date.now();
      try { await loadSocial(); } catch { /* the chip still opens the list */ }
    }
    const count = socialToken() ? upcomingMeetups().length : 0;
    $('meet-count').textContent = String(count);
    $('meet-count').hidden = !count;
  }

  function showLink(message) {
    $('link-text').textContent = message || 'На телефоне: Aidem → Профиль → ⌚ Связать часы';
    $('link-text').classList.toggle('error', Boolean(message));
    show('link');
  }

  function showPad() {
    state.code = '';
    renderCode();
    show('pair');
  }

  function renderCode() {
    [...$('pair-code').children].forEach((slot, index) => {
      slot.textContent = state.code[index] || '';
      slot.classList.toggle('filled', index < state.code.length);
    });
    $('pair-code').setAttribute('aria-label', `Код с телефона: ${state.code.length} из 6 цифр`);
  }

  function press(key) {
    if (state.claiming) return;
    if (key === 'back') { showLink(); return; }
    if (key === 'del') state.code = state.code.slice(0, -1);
    else if (/^\d$/.test(key) && state.code.length < 6) state.code += key;
    renderCode();
    buzz(8);
    if (state.code.length === 6) claim();
  }

  async function claim() {
    state.claiming = true;
    $('pair-code').classList.add('busy');
    try {
      const data = await social('claimDevice', { code: state.code });
      rememberToken(data.token);
      state.me = data.me;
      buzz([60, 60, 60]);
      openMeet();
    } catch (error) {
      buzz(250);
      showLink(error.message);
    } finally {
      state.claiming = false;
      $('pair-code').classList.remove('busy');
    }
  }

  async function openMeet() {
    if (!socialToken()) { showLink(); return; }
    show('loading');
    $('loading-text').textContent = 'Загружаем встречи…';
    try {
      [, state.meetStart] = await Promise.all([loadSocial(), resolveStart()]);
      renderMeet();
      show('meet');
    } catch (error) {
      if (error.status === 401) showLink('Часы отвязаны. Получите новый код на телефоне.');
      else showError(error.message, openMeet);
    }
  }

  function button(className, text, onClick) {
    const node = element('button', className, text);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  }

  function day(ms) {
    const date = new Date(ms);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (date.toDateString() === new Date().toDateString()) return 'Сегодня';
    if (date.toDateString() === tomorrow.toDateString()) return 'Завтра';
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '');
  }

  function peopleSummary(members) {
    const others = members.filter((member) => member.id !== state.me?.id);
    const arrived = others.filter((member) => member.status === 'arrived').length;
    const onWay = others.filter((member) => member.status === 'on_way').length;
    return [arrived && `${arrived} на месте`, onWay && `${onWay} в пути`].filter(Boolean).join(' · ');
  }

  function renderMeet() {
    const list = $('meetups');
    list.replaceChildren();
    const start = state.meetStart;
    const meetups = upcomingMeetups().slice(0, 5);
    meetups.forEach((meetup) => list.append(meetupCard(meetup, start)));
    const located = (state.social.friends || []).filter((friend) => Number.isFinite(friend.location?.lat) && Number.isFinite(friend.location?.lon))
      .map((friend) => ({ friend, meters: haversine(start, friend.location) })).sort((a, b) => a.meters - b.meters).slice(0, 4);
    if (located.length) list.append(friendsCard(located));
    if (!meetups.length && !located.length) {
      const card = element('article', 'card');
      card.append(element('p', 'card-top', state.me ? `${state.me.emoji} ${state.me.name}` : 'Aidem'), element('p', 'card-name', 'Пока нет встреч'),
        element('p', 'card-hours', 'Позовите друзей на встречу в Aidem на телефоне, и она появится здесь.'));
      list.append(card);
    }
    if (start.note) list.firstChild.prepend(startNote(start));
    refreshMeetCount();
  }

  function meetupCard(meetup, start) {
    const now = Date.now();
    const meters = haversine(start, meetup.place);
    const walkMinutes = Math.max(1, Math.ceil(meters / METERS_PER_MINUTE));
    const leaveAt = meetup.startsAt - walkMinutes * 60000;
    const card = element('article', 'card meet-card');
    card.setAttribute('aria-label', `Встреча ${meetup.title}, ${day(meetup.startsAt).toLowerCase()} в ${time(meetup.startsAt)}`);
    const top = element('p', 'card-top', `${meetup.changed ? 'Изменена' : day(meetup.startsAt)} · ${time(meetup.startsAt)}`);
    const people = element('p', 'people');
    const members = meetup.members.filter((member) => member.status !== 'declined');
    for (const member of members.slice(0, 5)) {
      const chip = element('span', `person is-${member.status}`, member.emoji);
      chip.title = `${member.name}: ${MEMBER_STATUS[member.status] || member.status}`;
      people.append(chip);
    }
    if (members.length > 5) people.append(element('span', 'person more', `+${members.length - 5}`));
    const summary = peopleSummary(meetup.members);
    if (summary) people.append(element('span', 'people-note', summary));
    // The hero is when to leave; the walk itself goes into the place line.
    const timing = element('p', 'card-walk meet-when');
    const caption = element('span');
    const [first, second, at] = now < leaveAt ? ['выйти', 'до', leaveAt] : now < meetup.startsAt ? ['пора', 'выходить', null] : ['началась', 'в', meetup.startsAt];
    caption.append(first, document.createElement('br'), second);
    timing.append(caption);
    if (at) timing.append(element('b', '', time(at)));
    else timing.classList.add('now');
    const where = element('p', 'card-hours card-place');
    where.append(element('span', 'place-name', meetup.place.name), element('span', '', ` · ${walkMinutes} мин`));
    card.append(top, element('p', 'card-name', meetup.title), where, people, timing);
    if (meetup.myStatus === 'arrived') { card.append(element('p', 'card-here', 'Вы на месте')); return card; }
    card.append(button('action', 'Идём', () => startTargetWalk('meet', meetup)));
    if (!['going', 'on_way'].includes(meetup.myStatus)) {
      const answer = button('action ghost', 'Приду', () => promise(meetup, answer, leaveAt, walkMinutes));
      card.append(answer);
    }
    return card;
  }

  function friendsCard(located) {
    const card = element('article', 'card friends-card');
    card.append(element('p', 'card-top', 'Друзья рядом'));
    for (const { friend, meters } of located) {
      const row = button('friend', undefined, () => startTargetWalk('friend', friend));
      row.setAttribute('aria-label', `Идти к ${friend.name}, ${distanceText(meters)}`);
      row.append(element('span', 'person', friend.emoji), element('span', 'friend-name', friend.name), element('span', 'friend-far', distanceText(meters)));
      card.append(row);
    }
    card.append(element('p', 'card-hours', 'Нажмите, чтобы пойти к другу'));
    return card;
  }

  function rsvp(id, status) {
    return social('rsvpMeetup', { id, status }).catch(() => null);
  }

  // "I'll come": answers the invite and, if the meetup is soon enough, reminds on the wrist 5 minutes before it is time to leave.
  async function promise(meetup, answer, leaveAt, walkMinutes) {
    answer.disabled = true;
    const remindAt = leaveAt - 5 * 60000;
    if (window.SeruenRemind?.supported() && remindAt > Date.now() + 60000 && remindAt < Date.now() + 6 * 3600000) {
      // Started inside the tap, so the browser may show its permission prompt.
      window.SeruenRemind.schedule([{ at: remindAt, tag: 'seruen-meet', title: `Через 5 минут выходить: ${meetup.title}`.slice(0, 80),
        body: `${meetup.place.name} в ${time(meetup.startsAt)}, идти ${walkMinutes} мин.`.slice(0, 240) }]);
    }
    if (await rsvp(meetup.id, 'going')) {
      answer.textContent = '✓ Вы придёте';
      buzz(40);
    } else {
      answer.disabled = false;
      answer.textContent = 'Приду · ещё раз';
    }
  }

  // Walking to a meetup or a friend. The ring is the time until the meetup starts; the target follows updates every 15 s.
  function startTargetWalk(kind, item) {
    const start = state.meetStart;
    const target = kind === 'meet' ? { name: item.place.name, lat: item.place.lat, lon: item.place.lon }
      : { name: `${item.emoji} ${item.name}`, lat: item.location.lat, lon: item.location.lon };
    const walk = newWalk({ kind, id: item.id, place: target, start, title: item.title, startsAt: kind === 'meet' ? item.startsAt : null,
      members: item.members || [], seen: item.location?.updatedAt, approximate: item.location?.mode === 'approximate', lost: false });
    const there = Math.max(1, Math.ceil(haversine(start, target) / METERS_PER_MINUTE));
    const wait = walk.startsAt ? Math.round((walk.startsAt - walk.t0) / 60000) - there : 0;
    beginWalk(walk, wait >= 1 ? [['there', there], ['stay', wait]] : [['there', there]]);
    if (kind === 'meet' && !walk.demo) rsvp(item.id, 'on_way');
    if (!walk.demo) setNote(targetNote(walk));
    state.poll = setInterval(() => refreshTarget(walk), 15000);
  }

  function targetNote(walk) {
    return walk.kind === 'meet' ? peopleSummary(walk.members) : '';
  }

  async function refreshTarget(walk) {
    let data;
    try { data = await loadSocial(); } catch { return; }
    if (state.walk !== walk) return;
    if (walk.kind === 'meet') {
      const meetup = data.meetups.find((item) => item.id === walk.id);
      if (!meetup || meetup.status === 'cancelled') {
        stopWalk();
        state.walk = null;
        buzz([250, 100, 250]);
        showError(`Встречу «${walk.title}» отменили.`, openMeet);
        return;
      }
      Object.assign(walk.place, { name: meetup.place.name, lat: meetup.place.lat, lon: meetup.place.lon });
      walk.members = meetup.members;
      walk.startsAt = meetup.startsAt;
    } else {
      const location = data.friends.find((friend) => friend.id === walk.id)?.location;
      walk.lost = !(Number.isFinite(location?.lat) && Number.isFinite(location?.lon));
      if (!walk.lost) {
        Object.assign(walk.place, { lat: location.lat, lon: location.lon });
        walk.seen = location.updatedAt;
        walk.approximate = location.mode === 'approximate';
      }
    }
    if (!walk.demo) setNote(targetNote(walk));
  }

  function tickTarget(walk) {
    if (walk.demo) simulate(walk, walk.place);
    const now = clock();
    const distance = haversine(walk.pos, walk.place);
    const arrivalRadius = walk.demo ? 12 : Math.max(walk.approximate ? 150 : 25, Math.min(walk.accuracy || 25, 60));
    if (distance <= arrivalRadius) { arriveAtTarget(); return; }
    const minutes = Math.ceil(distance / METERS_PER_MINUTE);
    const view = $('view-go');
    updateRing(walk, Math.min(1, Math.max(0, (now - walk.t0) / (walk.ringMinutes * 60000))));
    view.classList.toggle('over', Boolean(walk.startsAt) && now > walk.startsAt);
    view.classList.toggle('late', Boolean(walk.startsAt) && now <= walk.startsAt && now + minutes * 60000 > walk.startsAt);
    pointArrow(bearing(walk.pos, walk.place));
    $('go-phase').textContent = `${walk.kind === 'meet' ? 'К встрече' : 'К другу'} · ${distanceText(distance)}`;
    $('go-name').textContent = walk.place.name;
    $('go-minutes').textContent = String(minutes);
    $('go-unit').textContent = 'мин';
    if (walk.kind === 'meet') {
      const late = Math.ceil((now + minutes * 60000 - walk.startsAt) / 60000);
      if (now > walk.startsAt) $('go-back').replaceChildren('началась в ', element('b', '', time(walk.startsAt)));
      else if (late > 0) $('go-back').replaceChildren('опоздание ~', element('b', '', `${late} мин`));
      else $('go-back').replaceChildren('начало в ', element('b', '', time(walk.startsAt)));
    } else if (walk.lost) $('go-back').replaceChildren('друг скрыл место');
    else $('go-back').replaceChildren(walk.approximate ? 'примерно · ' : 'место от ', element('b', '', time(walk.seen)));
    $('go-next').textContent = 'Я на месте';
  }

  function arriveAtTarget() {
    const walk = state.walk;
    const now = clock();
    stopWalk();
    state.walk = null;
    if (walk.kind === 'meet') {
      if (!walk.demo) rsvp(walk.id, 'arrived');
      const early = Math.round((walk.startsAt - now) / 60000);
      $('done-title').textContent = 'На месте';
      $('done-text').textContent = `${early > 0 ? `За ${early} мин до начала.` : early < 0 ? `Опоздание ${-early} мин.` : 'Ровно к началу.'}${walk.demo ? '' : ' Друзья это видят.'}`;
    } else {
      $('done-title').textContent = 'Вы рядом';
      $('done-text').textContent = `${walk.place.name} где-то здесь.`;
    }
    $('done-home').textContent = 'К встречам';
    state.doneTo = 'meet';
    buzz([70, 70, 70]);
    show('done');
  }

  // Phone hand-off: /watch#to=51.1,71.4&name=…&cat=cafe&from=51.12,71.43&fromName=…&min=45&walk=4&visit=20&back=4
  async function handoff() {
    const hash = new URLSearchParams(location.hash.slice(1));
    if (!hash.has('to')) return false;
    const pair = (value) => { const [lat, lon] = String(value || '').split(',').map(Number); return inAstana({ lat, lon }) ? { lat, lon } : null; };
    const to = pair(hash.get('to'));
    if (!to) return false;
    const given = pair(hash.get('from'));
    const fromName = (hash.get('fromName') || '').slice(0, 60);
    show('loading');
    $('loading-text').textContent = 'Где вы?…';
    const start = await resolveStart(given ? { ...given, name: fromName || 'Старт', label: fromName || 'точки с телефона' } : undefined);
    const whole = (name, fallback) => {
      const value = hash.has(name) ? Math.round(Number(hash.get(name))) : NaN;
      return Number.isFinite(value) && value >= 0 && value <= 240 ? value : fallback;
    };
    const meters = haversine(start, to);
    // Times in the link were counted from the phone's start; from a real position they are counted again.
    const walkMinutes = start.here ? Math.max(1, Math.ceil(meters / METERS_PER_MINUTE)) : whole('walk', Math.max(1, Math.ceil(meters / METERS_PER_MINUTE)));
    const visitMinutes = whole('visit', 20);
    const returnMinutes = start.here ? walkMinutes : whole('back', walkMinutes);
    const total = walkMinutes + visitMinutes + returnMinutes + RESERVE_MINUTES;
    const minutes = Math.max(whole('min', total), total);
    state.mood = 'any';
    state.plan = { minutes, at: Date.now(), start,
      places: [{ id: 'handoff', name: (hash.get('name') || 'Место').slice(0, 80), category: hash.get('cat') || 'attraction', ...to,
        distanceMeters: Math.round(meters), walkMinutes, visitMinutes, returnMinutes, totalMinutes: total, hours: { status: 'no_data' } }] };
    renderResults();
    $('ask-gemini').hidden = true;
    show('results');
    return true;
  }

  function bind() {
    document.querySelectorAll('[data-mood]').forEach((button) => button.addEventListener('click', () => findPlaces(button.dataset.mood)));
    $('time-chip').addEventListener('click', () => { state.minutes = TIMES[(TIMES.indexOf(state.minutes) + 1) % TIMES.length]; save(); renderHome(); });
    $('start-chip').addEventListener('click', () => {
      state.startIndex = (state.startIndex + 1) % STARTS.length;
      save(); renderHome();
    });
    $('ask-gemini').addEventListener('click', askGemini);
    $('ai-chip').addEventListener('click', () => { unlockVoice(); openAsk(); });
    $('ask-more').addEventListener('click', () => { stopVoice(); openAsk(); });
    $('ask-form').addEventListener('submit', (event) => { event.preventDefault(); $('ask-input').blur(); askAssistant($('ask-input').value); });
    $('ask-voice').addEventListener('click', voice);
    $('ask-voice').addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('ask-voice').click(); } });
    $('ask-input').addEventListener('change', () => { if ($('view-ask').hidden === false) askAssistant($('ask-input').value); });
    // Home starts a new conversation; «Спросить ещё» continues the current one.
    $('ask-home').addEventListener('click', () => { state.chat = null; renderHome(); show('home'); });
    $('ask-reset').addEventListener('click', () => { state.chat = null; openAsk(); });
    $('search-form').addEventListener('submit', (event) => { event.preventDefault(); $('search-input').blur(); searchPlaces($('search-input').value); });
    $('voice').addEventListener('click', voice);
    $('voice').addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('voice').click(); } });
    // Apple Watch returns dictation as a change, without a submit.
    $('search-input').addEventListener('change', () => { if ($('view-home').hidden === false) searchPlaces($('search-input').value); });
    $('back-home').addEventListener('click', () => { stopVoice(); state.chat = null; history.replaceState(null, '', location.pathname + location.search); renderHome(); show('home'); });
    $('go-next').addEventListener('click', next);
    $('go-stop').addEventListener('click', () => {
      const walk = state.walk;
      stopWalk();
      state.walk = null;
      if (walk?.kind === 'place') { show('results'); return; }
      if (walk?.kind === 'meet' && !walk.demo) rsvp(walk.id, 'going');
      openMeet();
    });
    $('done-home').addEventListener('click', () => { if (state.doneTo === 'meet') openMeet(); else { renderHome(); show('home'); } });
    $('error-retry').addEventListener('click', () => state.retry());
    $('meet-chip').addEventListener('click', openMeet);
    $('link-enter').addEventListener('click', showPad);
    $('link-home').addEventListener('click', () => { renderHome(); show('home'); });
    document.querySelectorAll('[data-key]').forEach((key) => key.addEventListener('click', () => press(key.dataset.key)));
    document.addEventListener('keydown', (event) => {
      if ($('view-pair').hidden || event.metaKey || event.ctrlKey || event.altKey) return;
      const key = /^\d$/.test(event.key) ? event.key : { Backspace: 'del', Escape: 'back' }[event.key];
      if (key) { event.preventDefault(); press(key); }
    });
    $('meet-refresh').addEventListener('click', openMeet);
    $('meet-home').addEventListener('click', () => { renderHome(); show('home'); });
    $('meet-unlink').addEventListener('click', () => {
      social('logout', {}).catch(() => {});
      rememberToken(null);
      renderHome();
      show('home');
    });
    $('error-home').addEventListener('click', () => { renderHome(); show('home'); });
    document.querySelectorAll('[data-shape]').forEach((button) => button.addEventListener('click', () => { state.shape = button.dataset.shape; save(); applyShape(); }));
    $('demo-toggle').addEventListener('change', (event) => { state.demo = event.target.checked; });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state.walk && !state.wakeLock) keepAwake(); });
    addEventListener('resize', layout);
    setInterval(() => { if (!$('view-home').hidden) $('clock').textContent = time(Date.now()); }, 15000);
  }

  layout();
  // On a laptop nobody walks, so the frame starts with the demo walk from Baiterek.
  if (state.framed && params.get('demo') === null && matchMedia('(pointer: fine)').matches) {
    state.demo = true;
    if (saved.startIndex === undefined) state.startIndex = 1;
  }
  $('demo-toggle').checked = state.demo;
  $('watch-url').textContent = `${location.host}/watch`;
  bind();
  renderHome();
  handoff().then((handled) => { if (!handled) show('home'); });
})();
