(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const starts = {
    mega: { lat: 51.0880152, lon: 71.4097489, name: 'Mega Silk Way · вход D' },
    baiterek: { lat: 51.1283, lon: 71.4304, name: 'Байтерек' },
    embankment: { lat: 51.161, lon: 71.423, name: 'Набережная Есиля' }
  };
  const scenarios = {
    coffee: { start: 'mega', minutes: 45, maxWalk: 15, child: false, query: 'Хочу выпить кофе и немного отдохнуть. Нужно вернуться к началу прогулки.' },
    child: { start: 'baiterek', minutes: 60, maxWalk: 10, child: true, query: 'Прогуляться с ребёнком: парк, сквер или интересное место на свежем воздухе.' },
    water: { start: 'embankment', minutes: 45, maxWalk: 15, child: false, query: 'Хочу выдохнуть у воды, спокойно пройтись и полюбоваться видом.' }
  };
  const categoryNames = { cafe: 'Кофе и еда', coffee: 'Кофе', restaurant: 'Кофе и еда', park: 'Зелёное место', garden: 'Зелёное место', nature: 'На природе', waterfront: 'У воды', water: 'У воды', attraction: 'Достопримечательность', museum: 'Музей', culture: 'Культура', playground: 'С ребёнком', leisure: 'Отдых', viewpoint: 'Красивый вид', monument: 'Городская история', square: 'Городское пространство', tourism: 'Открыть город', art: 'Искусство', mall: 'В помещении' };
  const categoryIcons = { cafe: 'coffee', coffee: 'coffee', restaurant: 'food', park: 'park', garden: 'park', nature: 'park', waterfront: 'waterfront', water: 'waterfront', attraction: 'landmark', museum: 'museum', culture: 'museum', playground: 'family', leisure: 'park', viewpoint: 'landmark', monument: 'landmark', square: 'landmark', tourism: 'landmark', art: 'museum', mall: 'indoor' };
  const utilityIcons = new Set(['search', 'location', 'pin', 'clock', 'walk', 'return', 'family', 'lock', 'expand', 'download', 'external', 'info', 'warning', 'close', 'nearby', 'route', 'saved', 'layers']);
  const state = { start: { ...starts.mega }, map: null, startMarker: null, placesLayer: null, routeLayer: null, markers: [], mapPick: false, result: null, request: null, loading: false, status: null, tileErrors: 0, hasTiles: false, selected: null };

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function icon(name, className = '') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', `ui-icon${className ? ` ${className}` : ''}`);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `/assets/icons/ui.svg#sw-${utilityIcons.has(name) ? name : 'pin'}`);
    svg.append(use);
    return svg;
  }

  function categoryIcon(category, className = 'category-icon') {
    const asset = Object.hasOwn(categoryIcons, category) ? categoryIcons[category] : null;
    if (!asset) return icon('pin', className);
    const image = element('img', className);
    image.src = `/assets/icons/categories/${asset}-64.webp`;
    image.srcset = `/assets/icons/categories/${asset}-32.webp 1x, /assets/icons/categories/${asset}-64.webp 2x, /assets/icons/categories/${asset}-128.webp 4x`;
    image.alt = '';
    image.width = 32;
    image.height = 32;
    image.decoding = 'async';
    return image;
  }

  function warningLine(message) {
    const line = element('p', 'warning-line');
    line.append(icon('warning'), element('span', '', message));
    return line;
  }

  function cleanText(value, fallback = '') {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return fallback;
  }

  function numeric(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function safeUrl(value) {
    try {
      const url = new URL(value);
      return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
    } catch { return null; }
  }

  function externalLink(label, url, className = 'source-link') {
    const href = safeUrl(url);
    if (!href) return null;
    const link = element('a', className, label);
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.append(icon('external'));
    return link;
  }

  function formatDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function readableEvidence(value) {
    if (Array.isArray(value)) return value.map((item) => readableEvidence(item)).filter(Boolean).join(', ');
    if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
    if (value && typeof value === 'object') return Object.entries(value).filter(([, item]) => typeof item !== 'object').map(([key, item]) => `${key}: ${item}`).join('; ');
    return cleanText(value);
  }

  function initializeMap() {
    if (!window.L) {
      $('map-fallback').hidden = false;
      $('pick-start-button').disabled = true;
      $('pick-start-button').title = 'Выбор точки доступен после загрузки карты';
      $('recenter-button').hidden = true;
      return;
    }
    try {
      const L = window.L;
      state.map = L.map('map', { zoomControl: false, scrollWheelZoom: false, minZoom: 10, maxZoom: 18 }).setView([51.123, 71.425], 12);
      L.control.zoom({ position: 'topright' }).addTo(state.map);
      const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors' });
      tiles.on('tileerror', () => {
        state.tileErrors += 1;
        if (state.tileErrors >= 4 && !state.hasTiles) $('map-tile-warning').hidden = false;
      });
      tiles.on('tileload', () => { state.hasTiles = true; $('map-tile-warning').hidden = true; });
      tiles.addTo(state.map);
      state.placesLayer = L.layerGroup().addTo(state.map);
      state.routeLayer = L.layerGroup().addTo(state.map);
      state.map.on('click', (event) => {
        if (!state.mapPick) return;
        const { lat, lng } = event.latlng;
        if (lat < 50.9 || lat > 51.35 || lng < 71.1 || lng > 71.75) {
          showLocationMessage('Пока подбираем прогулки только в Астане. Выберите точку в городе.', true);
          return;
        }
        setCustomStart({ lat, lon: lng, name: 'Выбранная точка' });
        setMapPick(false);
      });
      updateStartMarker();
    } catch {
      $('map-fallback').hidden = false;
      $('pick-start-button').disabled = true;
      $('recenter-button').hidden = true;
    }
  }

  function markerIcon(kind, number, category) {
    const marker = element('div', kind === 'start' ? 'map-start-marker' : 'map-poi-marker');
    marker.setAttribute('aria-hidden', 'true');
    if (kind !== 'start') marker.append(categoryIcon(category, 'marker-category-icon'), element('span', 'marker-number', number));
    return window.L.divIcon({ className: 'custom-marker', html: marker, iconSize: kind === 'start' ? [22, 22] : [42, 42], iconAnchor: kind === 'start' ? [11, 11] : [21, 38], popupAnchor: [0, -30] });
  }

  function updateStartMarker() {
    $('map-start-name').textContent = state.start.name;
    if (!state.map) return;
    if (state.startMarker) state.startMarker.remove();
    state.startMarker = window.L.marker([state.start.lat, state.start.lon], { icon: markerIcon('start'), zIndexOffset: 500 }).addTo(state.map);
    const popup = element('div');
    popup.append(element('strong', '', 'Начало и конец прогулки'), element('span', '', state.start.name));
    state.startMarker.bindPopup(popup);
  }

  function setCustomStart(point) {
    state.start = point;
    let option = $('start').querySelector('option[value="custom"]');
    if (!option) {
      option = element('option', '', point.name);
      option.value = 'custom';
      $('start').append(option);
    }
    option.textContent = point.name;
    $('start').value = 'custom';
    invalidateResults();
    updateStartMarker();
    showLocationMessage(`${point.name}: ${point.lat.toFixed(4)}, ${point.lon.toFixed(4)}`);
  }

  function setMapPick(active) {
    state.mapPick = active;
    $('map-pick-hint').hidden = !active;
    $('pick-start-button').classList.toggle('is-active', active);
    $('pick-start-button').setAttribute('aria-pressed', String(active));
    document.querySelector('.map-panel').classList.toggle('is-picking', active);
    if (active && window.innerWidth < 621) $('map').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function showLocationMessage(message, error = false) {
    $('location-message').textContent = message;
    $('location-message').classList.toggle('error', error);
    $('location-message').hidden = !message;
  }

  function updateRange(inputId, outputId) {
    const input = $(inputId);
    $(outputId).replaceChildren(document.createTextNode(`${input.value} `), element('span', '', 'мин'));
    input.style.setProperty('--fill', `${100 * (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min))}%`);
    if (inputId === 'minutes') $('map-minutes').textContent = input.value;
  }

  function invalidateResults() {
    if (!state.result) return;
    state.result = null;
    state.selected = null;
    $('results').hidden = true;
    $('feedback').hidden = true;
    $('map-estimate').hidden = true;
    $('map-bottom-description').textContent = 'Три хороших места рядом — и время на возвращение.';
    document.querySelector('.map-panel').classList.remove('has-results');
    state.placesLayer?.clearLayers();
    state.routeLayer?.clearLayers();
    state.markers = [];
  }

  function getRequest() {
    return { lat: state.start.lat, lon: state.start.lon, minutes: Number($('minutes').value), maxWalkMinutes: Number($('max-walk').value), query: $('query').value.trim(), withChild: $('with-child').checked, category: 'any', returnToStart: true };
  }

  async function locate() {
    if (!navigator.geolocation) {
      showLocationMessage('Браузер не поддерживает геолокацию. Выберите знакомую точку или нажмите на карту.', true);
      return;
    }
    $('locate-button').disabled = true;
    showLocationMessage('Определяем точку старта…');
    navigator.geolocation.getCurrentPosition((position) => {
      $('locate-button').disabled = false;
      if (state.loading) {
        $('locate-button').disabled = true;
        showLocationMessage('Подбор уже начался. Повторите определение точки после него.');
        return;
      }
      const { latitude: lat, longitude: lon } = position.coords;
      if (lat < 50.9 || lat > 51.35 || lon < 71.1 || lon > 71.75) {
        showLocationMessage('Вы сейчас за пределами Астаны. Выберите точку старта из списка или на карте.', true);
        return;
      }
      setCustomStart({ lat, lon, name: 'Моё местоположение' });
      state.map?.setView([lat, lon], 14);
    }, (error) => {
      $('locate-button').disabled = false;
      showLocationMessage(error.code === 1 ? 'Доступ к геолокации не разрешён. Можно выбрать точку из списка или на карте.' : 'Не удалось определить местоположение. Выберите точку вручную.', true);
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
  }

  function setLoading(loading) {
    state.loading = loading;
    document.querySelectorAll('#planner input, #planner select, #planner textarea, #planner button').forEach((control) => { control.disabled = loading; });
    $('pick-start-button').disabled = loading || !state.map;
    $('submit-button').classList.toggle('is-loading', loading);
    $('submit-label').textContent = loading ? 'Ищем вашу прогулку…' : 'Найти мою прогулку';
    $('planner').setAttribute('aria-busy', String(loading));
    document.querySelectorAll('.scenario-button').forEach((button) => { button.disabled = loading; });
  }

  function feedback(kind, title, message) {
    const box = $('feedback');
    box.className = `feedback is-${kind}`;
    box.replaceChildren();
    if (kind === 'loading') box.append(element('span', 'loading-icon'));
    const copy = element('div');
    copy.append(element('h2', '', title), element('p', '', message));
    box.append(copy);
    box.hidden = false;
    return copy;
  }

  async function recommend(event) {
    event?.preventDefault();
    if (state.loading) return;
    setMapPick(false);
    invalidateResults();
    const request = getRequest();
    state.request = { ...request, startName: state.start.name };
    setLoading(true);
    feedback('loading', 'Хорошая прогулка уже близко.', 'Ищем места рядом и проверяем, хватит ли времени на дорогу туда и обратно.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetch('/api/recommend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: controller.signal });
      let result;
      try { result = await response.json(); } catch { throw new Error('Сервис вернул неожиданный ответ. Попробуйте ещё раз чуть позже.'); }
      if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : cleanText(result.error?.message, 'Не удалось подобрать прогулку. Попробуйте ещё раз.'));
      if (!result || !Array.isArray(result.recommendations)) throw new Error('Не удалось получить список мест. Попробуйте ещё раз.');
      state.result = result;
      $('feedback').hidden = true;
      if (!result.recommendations.length) renderEmpty(result);
      else renderResults(result);
    } catch (error) {
      const message = error.name === 'AbortError' ? 'Подбор занял больше минуты. Проверьте соединение и попробуйте ещё раз.' : error instanceof TypeError ? 'Сервис сейчас недоступен. Проверьте соединение и попробуйте ещё раз — параметры прогулки уже заполнены.' : error.message;
      const copy = feedback('error', 'Прогулка подождёт минутку.', message);
      const retry = element('button', 'secondary-button', 'Попробовать снова');
      retry.append(icon('external'));
      retry.type = 'button';
      retry.addEventListener('click', recommend);
      copy.append(retry);
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  }

  function renderEmpty(result) {
    const copy = feedback('empty', 'Под этот ритм пока нет вариантов.', 'В нашей базе не нашлось места, куда получится сходить и вернуться за выбранное время. Попробуйте увеличить время, выбрать другую точку или уточнить пожелания.');
    const actions = element('div', 'empty-actions');
    const addTime = element('button', 'secondary-button', 'Добавить 15 минут');
    addTime.append(icon('external'));
    addTime.type = 'button';
    addTime.disabled = Number($('minutes').value) >= 120;
    addTime.addEventListener('click', () => {
      $('minutes').value = Math.min(120, Number($('minutes').value) + 15);
      updateRange('minutes', 'minutes-output');
      recommend();
    });
    actions.append(addTime);
    copy.append(actions);
    const warnings = Array.isArray(result.warnings) ? result.warnings.filter((item) => typeof item === 'string') : [];
    if (warnings.length) copy.append(element('p', 'generation-note', warnings.join(' ')));
    state.placesLayer?.clearLayers();
    state.routeLayer?.clearLayers();
    $('map-bottom-description').textContent = 'Попробуйте больше времени или другую точку старта.';
  }

  function renderResults(result) {
    const recommendations = result.recommendations.slice(0, 3);
    const count = recommendations.length;
    // Caveats repeated on every card are shown once above the cards; each card keeps only its own.
    const cardWarnings = recommendations.map((place) => (Array.isArray(place.warnings) ? place.warnings : []).filter((item) => typeof item === 'string'));
    const shared = new Set(count > 1 ? cardWarnings[0].filter((warning) => cardWarnings.every((list) => list.includes(warning))) : []);
    $('result-grid').replaceChildren(...recommendations.map((place, index) => createPlaceCard(place, index, shared)));
    $('results-title').textContent = count === 1 ? 'Одно место. В самый раз.' : `${count === 2 ? 'Два' : 'Три'} места. Выберите своё.`;
    const summary = cleanText(result.generation?.summary).trim();
    $('result-summary').textContent = summary;
    $('result-summary').hidden = !summary;
    const fallback = result.generation?.mode === 'fallback';
    const model = result.generation?.provider === 'gemini' ? 'Gemini' : 'Языковая модель';
    $('generation-note').textContent = fallback ? 'Подбор составлен по данным мест и вашим ограничениям. Персональное описание сейчас недоступно.'
      : summary ? `${model} написала это описание только по данным карточек ниже. Время, расстояние и часы работы считает сервер, а не модель.` : '';
    $('generation-note').hidden = !$('generation-note').textContent;
    const warnings = [...new Set([...(Array.isArray(result.warnings) ? result.warnings : []).filter((item) => typeof item === 'string'), ...shared])];
    $('result-notices').replaceChildren(...warnings.map(warningLine));
    $('result-notices').hidden = !warnings.length;
    $('results').hidden = false;
    $('map-bottom-description').textContent = `${count === 1 ? 'Один вариант' : count === 2 ? 'Два варианта' : 'Три варианта'} — каждый с возвращением к началу.`;
    updateResultMap(recommendations);
    if (window.innerWidth < 621) $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function createPlaceCard(place, index, shared = new Set()) {
    const card = element('article', 'place-card');
    card.id = `place-${index}`;
    const top = element('div', 'card-topline');
    const labels = element('span', 'card-labels');
    const category = element('span', 'category-label');
    category.append(categoryIcon(place.category), element('span', '', Object.hasOwn(categoryNames, place.category) ? categoryNames[place.category] : 'Место в городе'));
    labels.append(element('span', 'source-badge', 'Данные OSM'), category);
    top.append(element('span', 'place-number', `ВАРИАНТ 0${index + 1}`), labels);
    const name = cleanText(place.name, 'Место в Астане');
    card.append(top, element('h3', '', name), element('p', 'place-why', cleanText(place.why, 'Подходит по расстоянию и времени на прогулку.')));
    const walk = Math.max(0, Math.ceil(numeric(place.walkMinutes)));
    const visit = Math.max(0, Math.ceil(numeric(place.visitMinutes)));
    const back = Math.max(0, Math.ceil(numeric(place.returnMinutes, walk)));
    const total = Math.ceil(numeric(place.totalMinutes, walk + visit + back));
    const totalLine = element('div', 'time-total');
    totalLine.append(element('strong', '', `~${total}`), element('span', '', 'минут вместе с возвращением'));
    const track = element('div', 'time-budget-track');
    track.setAttribute('aria-hidden', 'true');
    [['there', walk], ['visit', visit], ['back', back]].forEach(([className, value]) => {
      const part = element('span', className);
      part.style.flex = Math.max(value, 1);
      track.append(part);
    });
    const breakdown = element('div', 'time-breakdown');
    [[walk, 'Туда', 'walk'], [visit, 'На месте', 'clock'], [back, 'Обратно', 'return']].forEach(([minutes, label, iconName]) => {
      const column = element('div');
      const caption = element('span', 'time-caption');
      caption.append(icon(iconName), document.createTextNode(label));
      column.append(element('strong', '', `~${minutes} мин`), caption);
      breakdown.append(column);
    });
    card.append(totalLine, track, breakdown);
    const reserve = Math.max(0, total - walk - visit - back);
    if (reserve > 0) card.append(element('p', 'time-reserve-note', `В общем времени ещё ${reserve} мин запаса.`));
    const activities = (Array.isArray(place.activities) ? place.activities : []).filter((item) => typeof item === 'string');
    if (activities.length) {
      const list = element('ul', 'activities');
      list.append(...activities.slice(0, 4).map((activity) => element('li', '', activity)));
      card.append(element('p', 'activities-title', 'Чем заняться'), list);
    }
    const warnings = (Array.isArray(place.warnings) ? place.warnings : []).filter((item) => typeof item === 'string' && !shared.has(item));
    if (warnings.length) {
      const notice = element('div', 'place-warnings');
      notice.append(...warnings.map(warningLine));
      card.append(notice);
    }
    card.append(element('div', 'card-spacer'));
    card.append(createEvidence(place));
    const actions = element('div', 'card-actions');
    const mapButton = element('button', 'show-on-map', state.map ? 'Посмотреть на карте' : 'Координаты места');
    mapButton.append(icon('external'));
    mapButton.type = 'button';
    mapButton.addEventListener('click', () => selectPlace(index, place));
    const distance = numeric(place.distanceMeters);
    actions.append(mapButton, element('span', 'distance-note', distance > 0 ? `~${distance >= 1000 ? `${(distance / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} км` : `${Math.round(distance)} м`} по прямой` : ''));
    card.append(actions);
    return card;
  }

  function createEvidence(place) {
    const details = element('details', 'source-details');
    const summary = element('summary');
    summary.append(icon('info'), document.createTextNode('Источники и сведения о месте'));
    details.append(summary);
    const facts = element('div', 'source-facts');
    const evidence = Array.isArray(place.evidence) ? place.evidence : [];
    let date = place.retrievedAt || place.updatedAt || state.status?.updatedAt;
    let sourceUrl = safeUrl(place.sourceUrl);
    evidence.slice(0, 8).forEach((item) => {
      if (typeof item === 'string') { facts.append(element('p', '', item)); return; }
      if (!item || typeof item !== 'object') return;
      const value = readableEvidence(item.value);
      const label = cleanText(item.label, cleanText(item.field));
      if (label && value) {
        const row = element('p');
        row.append(element('strong', '', `${label}: `), document.createTextNode(value));
        facts.append(row);
      }
      sourceUrl ||= safeUrl(item.sourceUrl);
      date ||= item.retrievedAt;
    });
    if (!facts.childElementCount) facts.append(element('p', '', 'Место найдено в базе городских объектов. Полнота сведений может различаться.'));
    if (sourceUrl) {
      const sourceName = /openstreetmap\.org/.test(new URL(sourceUrl).hostname) ? 'Открыть источник: OpenStreetMap' : 'Открыть источник';
      facts.append(externalLink(sourceName, sourceUrl));
    }
    const dateLabel = formatDate(date);
    facts.append(element('span', 'source-date', dateLabel ? `Снимок данных: ${dateLabel}. Не проверка в реальном времени.` : 'Дата снимка не указана. Сведения не проверяются в реальном времени.'));
    details.append(facts);
    return details;
  }

  function updateResultMap(recommendations) {
    if (!state.map) return;
    state.placesLayer.clearLayers();
    state.routeLayer.clearLayers();
    state.markers = [];
    const bounds = [[state.start.lat, state.start.lon]];
    recommendations.forEach((place, index) => {
      const lat = numeric(place.lat, NaN);
      const lon = numeric(place.lon, NaN);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      const marker = window.L.marker([lat, lon], { icon: markerIcon('place', index + 1, place.category), title: `${index + 1}. ${cleanText(place.name, 'Место в Астане')}`, alt: `Вариант ${index + 1}: ${cleanText(place.name, 'Место в Астане')}` }).addTo(state.placesLayer);
      const popup = element('div');
      popup.append(element('strong', '', cleanText(place.name, 'Место в Астане')), element('span', '', `~${Math.ceil(numeric(place.totalMinutes))} мин с возвращением`));
      marker.bindPopup(popup);
      marker.on('click', () => highlightCard(index));
      state.markers[index] = marker;
      window.L.polyline([[state.start.lat, state.start.lon], [lat, lon]], { color: '#176958', weight: 2, dashArray: '5 7', opacity: .6, interactive: false }).addTo(state.routeLayer);
      bounds.push([lat, lon]);
    });
    document.querySelector('.map-panel').classList.add('has-results');
    $('map-estimate').hidden = bounds.length < 2;
    state.map.fitBounds(bounds, { paddingTopLeft: [55, 90], paddingBottomRight: [55, 130], maxZoom: 15 });
  }

  function highlightCard(index) {
    document.querySelectorAll('.place-card').forEach((card, cardIndex) => card.classList.toggle('is-selected', cardIndex === index));
    state.markers.forEach((marker, markerIndex) => {
      const icon = marker.getElement()?.querySelector('.map-poi-marker');
      icon?.classList.toggle('is-selected', markerIndex === index);
    });
    state.selected = index;
  }

  function selectPlace(index, place) {
    highlightCard(index);
    if (state.map && state.markers[index]) {
      state.map.setView(state.markers[index].getLatLng(), Math.max(state.map.getZoom(), 14), { animate: true });
      state.markers[index].openPopup();
      if (window.innerWidth < 621) $('map').scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      const url = `https://www.openstreetmap.org/?mlat=${encodeURIComponent(place.lat)}&mlon=${encodeURIComponent(place.lon)}#map=16/${encodeURIComponent(place.lat)}/${encodeURIComponent(place.lon)}`;
      const link = externalLink('Открыть координаты на OpenStreetMap', url);
      if (link) {
        const details = $(`place-${index}`).querySelector('details');
        details.open = true;
        if (!details.querySelector('.coordinate-link')) {
          link.classList.add('coordinate-link');
          details.append(link);
        }
        link.focus();
      }
    }
  }

  function recenter() {
    if (!state.map) return;
    if (state.result?.recommendations?.length) updateResultMap(state.result.recommendations.slice(0, 3));
    else state.map.setView([state.start.lat, state.start.lon], 14);
  }

  function exportPlan() {
    if (!state.result) return;
    const { lat, lon, ...requestWithoutLocation } = state.request;
    const payload = { title: 'SmartWalk — план прогулки', exportedAt: new Date().toISOString(), request: { ...requestWithoutLocation, startCoordinates: { lat, lon } }, ...state.result, note: 'Время и расстояние ориентировочные. Варианты — отдельные прогулки с возвращением к точке старта. Экспорт содержит выбранные координаты старта.' };
    const file = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(file);
    const link = element('a');
    link.href = url;
    link.download = `smartwalk-astana-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function loadStatus() {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      let response;
      try { response = await fetch('/api/status', { signal: controller.signal }); }
      finally { clearTimeout(timeout); }
      if (!response.ok) throw new Error('status unavailable');
      state.status = await response.json();
      const count = Math.max(0, Math.floor(numeric(state.status.poiCount)));
      const date = formatDate(state.status.updatedAt);
      $('data-status').textContent = `${count ? `${count.toLocaleString('ru-RU')} мест в базе` : 'База городских мест'}${date ? ` · снимок ${date}` : ''} · OpenStreetMap`;
    } catch {
      $('data-status').textContent = 'Сведения о базе сейчас недоступны';
    }
  }

  function openDialog(kind) {
    const content = $('dialog-content');
    content.replaceChildren();
    if (kind === 'privacy') {
      content.append(element('h2', '', 'Вы выбираете, чем поделиться.'), element('p', '', 'Геолокация запрашивается только после нажатия «Я здесь». Можно обойтись без неё: выбрать известную точку или нажать на карту.'), element('p', '', 'Координаты старта и пожелания отправляются сервису для подбора этой прогулки. Точная локация не записывается в историю приложения. Запрос может обрабатываться внешним сервисом генерации текста; не указывайте персональные данные.'), element('p', '', 'Карта загружается с серверов OpenStreetMap, а шрифт — с Google Fonts. При загрузке эти сервисы получают обычные сетевые данные, включая IP-адрес.'), element('p', '', 'При сохранении плана координаты старта попадут в скачанный JSON-файл. Файл остаётся у вас — учитывайте это, если делитесь им.'), element('p', 'dialog-footnote', 'База собрана из открытых источников. Часы работы, доступность, наличие розеток и другие условия могут быть неполными или устаревшими. Отсутствие сведений не считается подтверждением.'));
      const source = externalLink('Данные OpenStreetMap и условия использования', 'https://www.openstreetmap.org/copyright');
      if (source) content.append(source);
    } else {
      content.append(element('h2', '', 'Хорошему дню достаточно небольшой прогулки.'), element('p', '', 'SmartWalk помогает выбрать место в Астане, когда свободного времени немного. У каждого варианта есть оценка дороги туда, времени на месте и возвращения к началу.'), element('p', '', 'Подбор опирается на базу настоящих городских объектов и ваши ограничения. Мы показываем источники и отмечаем неподтверждённые сведения.'), element('p', '', 'Пунктир на карте связывает точки по прямой. Это ориентир для выбора, а не готовая пешеходная навигация. Для прогулки проверьте реальные переходы и маршрут.'), element('p', 'dialog-footnote', 'Ascension · Build with AI Hackathon 2026 · Smart City · Астана'));
    }
    $('info-dialog').showModal();
  }

  $('planner').addEventListener('submit', recommend);
  $('start').addEventListener('change', () => {
    const start = starts[$('start').value];
    if (!start) return;
    state.start = { ...start };
    invalidateResults();
    updateStartMarker();
    showLocationMessage('');
    state.map?.setView([start.lat, start.lon], 14);
  });
  [['minutes', 'minutes-output'], ['max-walk', 'max-walk-output']].forEach(([inputId, outputId]) => {
    updateRange(inputId, outputId);
    $(inputId).addEventListener('input', () => { updateRange(inputId, outputId); invalidateResults(); });
  });
  ['query', 'with-child'].forEach((id) => $(id).addEventListener(id === 'query' ? 'input' : 'change', invalidateResults));
  $('locate-button').addEventListener('click', locate);
  $('pick-start-button').addEventListener('click', () => setMapPick(!state.mapPick));
  $('cancel-pick-button').addEventListener('click', () => setMapPick(false));
  $('recenter-button').addEventListener('click', recenter);
  $('export-button').addEventListener('click', exportPlan);
  $('about-button').addEventListener('click', () => openDialog('about'));
  $('privacy-button').addEventListener('click', () => openDialog('privacy'));
  $('close-dialog').addEventListener('click', () => $('info-dialog').close());
  $('info-dialog').addEventListener('click', (event) => { if (event.target === $('info-dialog')) { const bounds = $('info-dialog').getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) $('info-dialog').close(); } });
  document.querySelectorAll('[data-scenario]').forEach((button) => {
    button.addEventListener('click', () => {
      const scenario = scenarios[button.dataset.scenario];
      state.start = { ...starts[scenario.start] };
      $('start').value = scenario.start;
      $('minutes').value = scenario.minutes;
      $('max-walk').value = scenario.maxWalk;
      $('with-child').checked = scenario.child;
      $('query').value = scenario.query;
      updateRange('minutes', 'minutes-output');
      updateRange('max-walk', 'max-walk-output');
      invalidateResults();
      updateStartMarker();
      showLocationMessage('');
      document.querySelectorAll('[data-scenario]').forEach((item) => item.classList.toggle('is-active', item === button));
      recommend();
    });
  });
  initializeMap();
  loadStatus();
})();
