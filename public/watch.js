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
    museum: ['museum', 'Музей'], attraction: ['landmark', 'Интересное'], mall: ['indoor', 'Под крышей'], culture: ['museum', 'Культура'] };
  // Same estimate as the server: straight line × 1.35 at 4.2 km/h, plus a 5-minute reserve.
  const METERS_PER_MINUTE = 4200 / 60 / 1.35;
  const RESERVE_MINUTES = 5;
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
    $('screen').classList.toggle('scroll-snap', name === 'results');
    $('screen').scrollTop = 0;
    window.scrollTo(0, 0);
  }

  function renderHome() {
    $('time-value').textContent = state.minutes;
    $('start-value').textContent = STARTS[state.startIndex].label;
    $('clock').textContent = time(Date.now());
  }

  function inAstana(point) {
    return point.lat >= ASTANA.minLat && point.lat <= ASTANA.maxLat && point.lon >= ASTANA.minLon && point.lon <= ASTANA.maxLon;
  }

  function currentPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) { reject(new Error('unsupported')); return; }
      navigator.geolocation.getCurrentPosition((position) => resolve({ lat: position.coords.latitude, lon: position.coords.longitude, accuracy: position.coords.accuracy }),
        reject, { enableHighAccuracy: true, timeout: 9000, maximumAge: 60000 });
    });
  }

  async function resolveStart() {
    const option = STARTS[state.startIndex];
    if (option.key !== 'here') return { lat: option.lat, lon: option.lon, name: option.name, here: false };
    const fallback = { ...STARTS[1], here: false };
    if (state.demo) return { ...fallback, note: 'Демо: старт от Байтерека' };
    try {
      const point = await currentPosition();
      if (inAstana(point)) return { ...point, name: 'Старт', here: true };
      return { ...fallback, note: 'Вы не в Астане: старт от Байтерека' };
    } catch {
      return { ...fallback, note: 'Без геолокации: старт от Байтерека' };
    }
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
      const query = new URLSearchParams({ lat: start.lat.toFixed(6), lon: start.lon.toFixed(6), minutes: String(state.minutes), mood });
      const response = await fetch(`/api/watch/plan?${query}`, { signal: controller.signal });
      let data;
      try { data = await response.json(); } catch { throw new Error('Seruen ответил неожиданно. Попробуйте ещё раз.'); }
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Не получилось подобрать места.');
      state.plan = { places: data.places, query: data.query, start, minutes: state.minutes, at: Date.now() };
      renderResults();
      show('results');
    } catch (error) {
      showError(error.name === 'AbortError' ? 'Сеть отвечает слишком долго. Попробуйте ещё раз.'
        : error instanceof TypeError ? 'Нет связи с Seruen. Проверьте интернет на часах или телефоне.' : error.message);
    } finally { clearTimeout(timer); }
  }

  function renderResults() {
    const list = $('results');
    list.replaceChildren();
    $('gemini-tip').hidden = true;
    $('ask-gemini').hidden = false;
    $('ask-gemini').disabled = false;
    const { places, start } = state.plan;
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
      back.append(element('b', '', time(Date.now() + place.totalMinutes * 60000)));
      const facts = [distanceText(place.distanceMeters)];
      facts.push(place.hours?.status === 'open' && place.hours.closesAt ? `открыто до ${place.hours.closesAt}` : 'часы неизвестны');
      const go = element('button', 'action', 'Идём');
      go.type = 'button';
      go.addEventListener('click', () => startWalk(place));
      card.append(top, element('p', 'card-name', place.name), walk, back, element('p', 'card-hours', facts.join(' · ')), go);
      if (index === 0 && start.note) card.append(element('p', 'card-hours', start.note));
      list.append(card);
    });
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
        body: JSON.stringify({ lat: start.lat, lon: start.lon, minutes, maxWalkMinutes: Math.min(30, Math.max(5, Math.round(minutes / 3))),
          query: state.plan.query || '', withChild: state.mood === 'child', category: 'any', returnToStart: true }) });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Gemini сейчас недоступен.');
      tip.replaceChildren(data.generation?.mode === 'llm' ? data.generation.summary : 'Gemini сейчас не ответил. Варианты подобраны по данным OpenStreetMap.',
        element('small', '', data.generation?.mode === 'llm' ? 'Gemini · факты из OpenStreetMap' : 'Подбор без модели'));
      button.hidden = true;
    } catch (error) {
      tip.textContent = error instanceof TypeError ? 'Нет связи. Попробуйте ещё раз.' : error.message;
      button.disabled = false;
    }
  }

  function showError(message) {
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

  function setupRing(walk) {
    const there = walk.place.walkMinutes, back = walk.place.returnMinutes;
    const stay = Math.max(1, state.plan.minutes - there - back - RESERVE_MINUTES);
    walk.ringMinutes = there + stay + back + RESERVE_MINUTES;
    let start = 0;
    walk.segments = [['there', there], ['stay', stay], ['back', back], ['reserve', RESERVE_MINUTES]].map(([kind, minutes]) => {
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

  function startWalk(place) {
    const start = state.plan.start;
    const now = Date.now();
    state.heading = null;
    state.walk = {
      place, start, phase: 'to', demo: state.demo, t0: now, simNow: now, lastReal: performance.now(), realStart: performance.now(),
      deadline: now + state.plan.minutes * 60000, pos: { lat: start.lat, lon: start.lon }, accuracy: null, alerted: false, arrivedAt: null
    };
    setupRing(state.walk);
    $('demo-badge').hidden = !state.demo;
    $('view-go').classList.remove('late', 'over', 'stay', 'alert');
    if (!state.demo) {
      listenCompass();
      if (navigator.geolocation) {
        state.watchId = navigator.geolocation.watchPosition((position) => {
          if (!state.walk) return;
          state.walk.pos = { lat: position.coords.latitude, lon: position.coords.longitude };
          state.walk.accuracy = position.coords.accuracy;
        }, () => {}, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
      }
    }
    keepAwake();
    show('go');
    buzz(40);
    tick();
    state.timer = setInterval(tick, state.demo ? 200 : 1000);
  }

  function stopWalk() {
    clearInterval(state.timer);
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
    if (phase === 'stay') { walk.arrivedAt = clock(); buzz([70, 70, 70]); }
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
    setPhase('back');
  }

  function finish() {
    const walk = state.walk;
    stopWalk();
    const spent = Math.max(1, Math.round((clock() - walk.t0) / 60000));
    const late = Math.round((clock() - walk.deadline) / 60000);
    $('done-title').textContent = late > 0 ? 'Почти вовремя' : 'Вы вернулись';
    $('done-text').textContent = late > 0 ? `${spent} мин, на ${late} мин позже плана.` : `${spent} мин из ${state.plan.minutes}. Вовремя.`;
    buzz([70, 70, 70]);
    state.walk = null;
    show('done');
  }

  function tick() {
    const walk = state.walk;
    if (!walk) return;
    const target = walk.phase === 'back' ? walk.start : walk.place;
    if (walk.demo) simulate(walk, target);
    const now = clock();
    const distance = haversine(walk.pos, target);
    const toTarget = bearing(walk.pos, target);
    const backMinutes = Math.ceil(haversine(walk.pos, walk.start) / METERS_PER_MINUTE);
    const leaveBy = walk.deadline - (backMinutes + RESERVE_MINUTES) * 60000;
    const arrivalRadius = walk.demo ? 12 : Math.max(25, Math.min(walk.accuracy || 25, 60));

    if (walk.phase === 'to' && distance <= arrivalRadius) setPhase('stay');
    // Walking away from the place means the visit is over.
    else if (walk.phase === 'stay' && !walk.demo && haversine(walk.pos, walk.place) > Math.max(90, arrivalRadius * 2)) setPhase('back');
    else if (walk.phase === 'back' && distance <= arrivalRadius) { finish(); return; }
    if (walk.phase !== 'back' && now >= leaveBy) { timeToReturn(); return tick(); }

    const view = $('view-go');
    updateRing(walk, Math.min(1, Math.max(0, (now - walk.t0) / (walk.ringMinutes * 60000))));
    const walkMinutes = Math.ceil(distance / METERS_PER_MINUTE);
    view.classList.toggle('over', now > walk.deadline);
    view.classList.toggle('late', now <= walk.deadline && (walk.phase === 'back' ? now + walkMinutes * 60000 > walk.deadline : now >= leaveBy - 3 * 60000));

    const heading = state.heading;
    let rotation = heading === null ? toTarget : toTarget - heading;
    // Turn the shortest way instead of spinning through 360°.
    rotation = state.rotation + ((((rotation - state.rotation) % 360) + 540) % 360 - 180);
    state.rotation = rotation;
    $('arrow').style.transform = `rotate(${rotation}deg)`;
    $('north').style.transform = `translateY(-50%) rotate(${heading === null ? 0 : -heading}deg)`;
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
      $('go-back').replaceChildren(walk.phase === 'back' ? 'успеть к ' : 'обратно к ', element('b', '', time(walk.deadline)));
    }
    $('go-next').textContent = { to: 'Я на месте', stay: 'Обратно', back: 'Я вернулся' }[walk.phase];
  }

  function next() {
    const walk = state.walk;
    if (!walk) return;
    if (walk.phase === 'to') setPhase('stay');
    else if (walk.phase === 'stay') setPhase('back');
    else { finish(); return; }
    tick();
  }

  // Phone hand-off: /watch#to=51.1,71.4&name=…&cat=cafe&from=51.12,71.43&fromName=…&min=45&walk=4&visit=20&back=4
  function handoff() {
    const hash = new URLSearchParams(location.hash.slice(1));
    if (!hash.has('to')) return false;
    const pair = (value) => { const [lat, lon] = String(value || '').split(',').map(Number); return inAstana({ lat, lon }) ? { lat, lon } : null; };
    const to = pair(hash.get('to'));
    const from = pair(hash.get('from')) || { lat: STARTS[1].lat, lon: STARTS[1].lon };
    if (!to) return false;
    const whole = (name, fallback) => { const value = Math.round(Number(hash.get(name))); return Number.isFinite(value) && value >= 0 && value <= 240 ? value : fallback; };
    const walkMinutes = whole('walk', Math.ceil(haversine(from, to) / METERS_PER_MINUTE));
    const visitMinutes = whole('visit', 20);
    const returnMinutes = whole('back', walkMinutes);
    const total = walkMinutes + visitMinutes + returnMinutes + RESERVE_MINUTES;
    const minutes = Math.max(whole('min', total), total);
    state.mood = 'any';
    state.plan = { minutes, at: Date.now(), start: { ...from, name: (hash.get('fromName') || 'Старт').slice(0, 60) },
      places: [{ id: 'handoff', name: (hash.get('name') || 'Место').slice(0, 80), category: hash.get('cat') || 'attraction', ...to,
        distanceMeters: Math.round(haversine(from, to)), walkMinutes, visitMinutes, returnMinutes, totalMinutes: total, hours: { status: 'no_data' } }] };
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
      if (STARTS[state.startIndex].key === 'here' && !navigator.geolocation) state.startIndex = 1;
      save(); renderHome();
    });
    $('ask-gemini').addEventListener('click', askGemini);
    $('back-home').addEventListener('click', () => { history.replaceState(null, '', location.pathname + location.search); renderHome(); show('home'); });
    $('go-next').addEventListener('click', next);
    $('go-stop').addEventListener('click', () => { stopWalk(); state.walk = null; show('results'); });
    $('done-home').addEventListener('click', () => { renderHome(); show('home'); });
    $('error-retry').addEventListener('click', () => state.mood ? findPlaces(state.mood) : show('home'));
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
  if (!handoff()) show('home');
})();
