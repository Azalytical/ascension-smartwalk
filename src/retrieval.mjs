/** Deterministic, source-grounded POI retrieval. No network, LLM or embeddings. */
const BOUNDS = Object.freeze({ minLat: 51, maxLat: 51.35, minLon: 71.25, maxLon: 71.65 });
const DETOUR = 1.35;
const SPEED_KMH = 4.2;
const RESERVE = 5;
const VISIT = { park: 15, cafe: 20, museum: 35, playground: 20, attraction: 15 };
const LABELS = { park: 'парк', cafe: 'кафе', museum: 'музей', playground: 'площадка', attraction: 'достопримечательность' };
const SYNONYMS = {
  park: ['park', 'парк', 'сквер', 'сад', 'саябақ', 'garden'],
  cafe: ['cafe', 'café', 'coffee', 'кофе', 'кафе', 'кофейн', 'кофехана', 'кафехана', 'кофеіш'],
  museum: ['museum', 'музей', 'мұражай', 'выставк', 'exhibition'],
  playground: ['playground', 'площадк', 'ойыналаң', 'ойын алаң', 'children play'],
  attraction: ['attraction', 'достопримечатель', 'көрікті', 'monument', 'памятник', 'ескерткіш', 'memorial', 'viewpoint', 'смотров'],
};
const STOP_WORDS = new Set(['хочу', 'нужен', 'нужна', 'нужно', 'рядом', 'меня', 'есть', 'сейчас', 'что', 'как', 'для', 'куда', 'можно', 'минут', 'час', 'часа', 'with', 'the', 'near', 'want', 'and', 'мен', 'үшін']);

function normalize(value) {
  return String(value ?? '').toLocaleLowerCase('ru').normalize('NFKC').replace(/ё/g, 'е');
}

function tokens(value) {
  return [...new Set(normalize(value).match(/[\p{L}\p{N}]+/gu) ?? [])]
    .filter(token => token.length >= 3 && !STOP_WORDS.has(token) && !/^\d+$/.test(token));
}

function tagText(tags) {
  if (Array.isArray(tags)) return tags.map(tag => typeof tag === 'string' ? tag : '').join(' ');
  if (tags && typeof tags === 'object') {
    return Object.entries(tags).map(([key, value]) => `${key}=${typeof value === 'string' ? value : ''}`).join(' ');
  }
  return typeof tags === 'string' ? tags : '';
}

function categoryOf(poi) {
  const direct = normalize(poi.category).trim();
  if (Object.hasOwn(VISIT, direct)) return direct;
  const aliases = { garden: 'park', monument: 'attraction', memorial: 'attraction', viewpoint: 'attraction',
    artwork: 'attraction', gallery: 'attraction', theme_park: 'attraction' };
  if (aliases[direct]) return aliases[direct];
  // Never inspect a name, brand, or description for structural classification.
  // For example, the cinema name "Кинопарк" does not make it a park.
  const tags = poi.tags;
  const values = Array.isArray(tags) ? tags.map(tag => normalize(tag).split('=')).filter(parts => parts.length <= 2).map(parts => parts.at(-1))
    : tags && typeof tags === 'object' ? ['amenity', 'leisure', 'tourism', 'historic'].map(key => normalize(tags[key]))
      : typeof tags === 'string' ? normalize(tags).split(/[;,\s]+/).map(tag => tag.split('=').at(-1)) : [];
  for (const value of values) {
    if (Object.hasOwn(VISIT, value)) return value;
    if (aliases[value]) return aliases[value];
  }
  return null;
}

function validCoordinate(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon)
    && lat >= BOUNDS.minLat && lat <= BOUNDS.maxLat && lon >= BOUNDS.minLon && lon <= BOUNDS.maxLon;
}

function invalid(message) {
  const error = new Error(message);
  error.code = 'INVALID_INPUT';
  error.status = 400;
  throw error;
}

function numeric(value, fallback, label, min, max) {
  const number = value === undefined ? fallback
    : typeof value === 'number' ? value
      : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isFinite(number) || number < min || number > max) invalid(`${label}: допустимо значение от ${min} до ${max}.`);
  return number;
}

function constraintsFor(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('Передайте координаты и ограничения прогулки.');
  const lat = numeric(input.lat, NaN, 'Широта', BOUNDS.minLat, BOUNDS.maxLat);
  const lon = numeric(input.lon, NaN, 'Долгота', BOUNDS.minLon, BOUNDS.maxLon);
  const minutes = numeric(input.minutes, 60, 'Время прогулки', 10, 180);
  const maxWalkMinutes = numeric(input.maxWalkMinutes, 20, 'Путь в одну сторону', 1, 180);
  if (input.withChild !== undefined && typeof input.withChild !== 'boolean') invalid('withChild должен быть логическим значением.');
  if (input.returnToStart !== undefined && typeof input.returnToStart !== 'boolean') invalid('returnToStart должен быть логическим значением.');
  if (input.query !== undefined && typeof input.query !== 'string') invalid('Запрос должен быть текстом.');
  const query = (input.query ?? '').trim();
  if (query.length > 500) invalid('Запрос должен быть не длиннее 500 символов.');
  const suppliedCategory = normalize(input.category).trim();
  const category = ['', 'all', 'any', 'все'].includes(suppliedCategory) ? null
    : Object.hasOwn(VISIT, suppliedCategory) ? suppliedCategory
      : Object.entries(SYNONYMS).find(([, synonyms]) => synonyms.includes(suppliedCategory))?.[0];
  if (suppliedCategory && category === undefined) invalid('Неизвестная категория места.');
  let visitDate = null;
  if (input.visitDate !== undefined && input.visitDate !== null && input.visitDate !== '') {
    if (typeof input.visitDate !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(input.visitDate)
      || Number.isNaN(Date.parse(input.visitDate))) invalid('Некорректная дата посещения.');
    visitDate = input.visitDate;
  }
  return { lat, lon, minutes, maxWalkMinutes, query, category, withChild: input.withChild ?? false,
    returnToStart: input.returnToStart ?? true, visitDate, timezone: 'Asia/Qyzylorda',
    safetyReserveMinutes: RESERVE, detourFactor: DETOUR, walkingSpeedKmh: SPEED_KMH,
    distanceMethod: 'haversine', walkTimeIsEstimate: true, alternativesAreSeparate: true };
}

/** Straight-line distance, in meters. Walking distances require a routing service. */
export function haversineMeters(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * rad / 2) ** 2
    + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin((lon2 - lon1) * rad / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(Math.min(1, Math.max(0, a))), Math.sqrt(Math.max(0, 1 - a)));
}

function queryCategories(query) {
  // Category intent is lexical. Negated categories must never become positive requirements.
  const positive = normalize(query).replace(/(?:^|[^\p{L}\p{N}])(?:не|без|not|no|without)\s+[\p{L}]+/gu, '');
  const categories = Object.entries(SYNONYMS).filter(([, words]) => words.some(word => positive.includes(word))).map(([category]) => category);
  if (!categories.length && /погуля|прогул|серуен|\bwalk\b/.test(positive)) return ['park', 'attraction'];
  return categories;
}

function excludedCategories(query) {
  const negativePhrases = normalize(query).match(/(?:^|[^\p{L}\p{N}])(?:не|без|not|no|without)\s+[\p{L}]+/gu) ?? [];
  return Object.entries(SYNONYMS).filter(([, words]) => negativePhrases.some(phrase => words.some(word => phrase.includes(word)))).map(([category]) => category);
}

function safeSourceUrl(value) {
  if (typeof value !== 'string') return null;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}

function normalName(poi) {
  return normalize(poi.name).replace(/[^\p{L}\p{N}]/gu, '');
}

function samePlace(a, b) {
  return String(a.id) === String(b.id) || a.sourceUrl === b.sourceUrl
    || (normalName(a) === normalName(b) && haversineMeters(a.lat, a.lon, b.lat, b.lon) < 40);
}

function activitiesFor(category) {
  return ({
    park: ['Выделить время на короткую прогулку; доступ на территорию и условия на месте уточнить заранее.'],
    cafe: ['Сделать перерыв на кофе; меню, наличие мест и удобств уточнить у заведения.'],
    museum: ['Осмотреть экспозицию после проверки режима работы, билетов и доступности входа.'],
    playground: ['Осмотреть площадку и самостоятельно оценить, подходят ли оборудование и условия ребёнку.'],
    attraction: ['Осмотреть место и сделать фотографии там, где это разрешено; доступ уточнить заранее.'],
  })[category];
}

function warningsFor(poi, constraints) {
  const warnings = [poi.openingHours
    ? 'Указан режим работы из источника; открытие в момент визита и исключения не проверены.'
    : 'Режим работы неизвестен; открытие в момент визита не подтверждено.',
  'Время посещения — плановая оценка, без очередей, билетов и текущей загрузки.'];
  if (!poi.retrievedAt) warnings.push('Дата получения сведений об этом месте неизвестна.');
  const access = normalize(poi.access ?? (poi.tags && !Array.isArray(poi.tags) ? poi.tags.access : null));
  if (!access) warnings.push('Условия входа и доступ на территорию неизвестны; уточните перед выходом.');
  else warnings.push(`Условия доступа в источнике: ${access}. Актуальные ограничения на вход не проверены.`);
  if (constraints.withChild) warnings.push('Категория подходит для поиска прогулки с ребёнком; безопасность, возрастные ограничения и доступность не проверены.');
  if (/розет|socket|outlet|қуат|заряд/i.test(constraints.query)) warnings.push('Наличие доступных посетителю розеток не подтверждено.');
  if (/тих|quiet|тыныш|спокой/i.test(constraints.query)) warnings.push('Тишина и текущий уровень шума не подтверждены.');
  if (/коляск|wheelchair|доступн|арбамен|арба/i.test(constraints.query)) warnings.push('Безбарьерность входа и всего пути не подтверждена.');
  return warnings;
}

/**
 * Return up to three independent alternatives backed by existing POI records.
 * Accepts an array, or a dataset wrapper { pois: [...] }. Does not mutate inputs.
 */
export function recommend(dataset, input) {
  const constraints = constraintsFor(input);
  const pois = Array.isArray(dataset) ? dataset : Array.isArray(dataset?.pois) ? dataset.pois : [];
  const requested = queryCategories(constraints.query);
  const excluded = excludedCategories(constraints.query);
  const terms = tokens(constraints.query);
  const counters = { invalidRecords: 0, unsupportedCategory: 0, restrictedAccess: 0, duplicates: 0, category: 0, walkBudget: 0, totalBudget: 0 };
  const seen = [];
  const candidates = [];

  for (const row of pois) {
    const category = row && typeof row === 'object' ? categoryOf(row) : null;
    const sourceUrl = safeSourceUrl(row?.sourceUrl);
    if (!row || !['string', 'number'].includes(typeof row.id) || String(row.id).trim() === ''
      || typeof row.name !== 'string' || !row.name.trim() || !validCoordinate(row.lat, row.lon) || !sourceUrl) {
      counters.invalidRecords++; continue;
    }
    if (!category) { counters.unsupportedCategory++; continue; }
    const poi = { ...row, category, sourceUrl };
    const access = normalize(poi.access ?? (poi.tags && !Array.isArray(poi.tags) ? poi.tags.access : null));
    if (['private', 'no', 'military'].includes(access)) { counters.restrictedAccess++; continue; }
    if (seen.some(other => samePlace(poi, other))) { counters.duplicates++; continue; }
    seen.push(poi);
    if ((constraints.category && category !== constraints.category)
      || (!constraints.category && requested.length > 0 && !requested.includes(category))
      || excluded.includes(category)
      || (constraints.withChild && !['park', 'playground'].includes(category))) { counters.category++; continue; }

    const directDistance = haversineMeters(constraints.lat, constraints.lon, poi.lat, poi.lon);
    const walkMinutes = Math.ceil(directDistance * DETOUR / (SPEED_KMH * 1000 / 60));
    const returnMinutes = constraints.returnToStart ? walkMinutes : 0;
    const visitMinutes = VISIT[category];
    const totalMinutes = walkMinutes + visitMinutes + returnMinutes + RESERVE;
    if (walkMinutes > constraints.maxWalkMinutes) { counters.walkBudget++; continue; }
    if (totalMinutes > constraints.minutes) { counters.totalBudget++; continue; }

    const text = normalize(`${poi.name} ${poi.description ?? ''} ${tagText(poi.tags)}`);
    const matchedTerms = terms.filter(term => text.includes(term));
    const categoryIntent = constraints.category === category || requested.includes(category);
    const scoreBreakdown = {
      category: categoryIntent ? 35 : 0,
      keywords: Math.min(20, matchedTerms.length * 5),
      proximity: Math.round(25 * (1 - Math.min(1, walkMinutes / constraints.maxWalkMinutes))),
      timeFit: Math.round(15 * (1 - totalMinutes / constraints.minutes)),
      childCategory: constraints.withChild ? 5 : 0,
    };
    const score = Object.values(scoreBreakdown).reduce((a, b) => a + b, 0);
    const reason = `${LABELS[category]}${categoryIntent ? ' соответствует выбранной категории' : ' рядом с выбранной точкой'}; `
      + `примерно ${walkMinutes} мин в одну сторону, ${totalMinutes} мин ${constraints.returnToStart ? 'с возвращением' : 'без возвращения'} и резервом ${RESERVE} мин.`;
    const evidence = [
      { field: 'name', label: 'Название из источника', value: poi.name, sourceUrl, retrievedAt: poi.retrievedAt ?? null },
      { field: 'category', label: 'Категория из данных POI', value: category, sourceUrl, retrievedAt: poi.retrievedAt ?? null },
      { field: 'coordinates', label: 'Координаты из источника', value: `${poi.lat}, ${poi.lon}`, sourceUrl, retrievedAt: poi.retrievedAt ?? null },
    ];
    if (poi.description) evidence.push({ field: 'description', label: 'Описание из данных POI', value: String(poi.description), sourceUrl, retrievedAt: poi.retrievedAt ?? null });
    if (poi.openingHours) evidence.push({ field: 'openingHours', label: 'Режим работы из источника, без проверки открытия', value: String(poi.openingHours), sourceUrl, retrievedAt: poi.retrievedAt ?? null });
    candidates.push({ ...poi, distanceMeters: Math.ceil(directDistance), estimatedWalkDistanceMeters: Math.ceil(directDistance * DETOUR),
      walkMinutes, visitMinutes, returnMinutes, safetyReserveMinutes: RESERVE, totalMinutes,
      why: reason, activities: activitiesFor(category), activitiesAreSuggestions: true,
      warnings: warningsFor(poi, constraints), evidence, score, scoreBreakdown, matchedTerms });
  }

  candidates.sort((a, b) => b.score - a.score || a.walkMinutes - b.walkMinutes || String(a.id).localeCompare(String(b.id), 'en'));
  // Greedy diversity: a modest penalty only; intent and proximity remain the main signals.
  const recommendations = [];
  const remaining = [...candidates];
  while (remaining.length && recommendations.length < 3) {
    remaining.sort((a, b) => (b.score - (recommendations.some(r => r.category === b.category) ? 8 : 0))
      - (a.score - (recommendations.some(r => r.category === a.category) ? 8 : 0))
      || a.walkMinutes - b.walkMinutes || String(a.id).localeCompare(String(b.id), 'en'));
    recommendations.push(remaining.shift());
  }
  const warnings = [
    'Расстояние указано по прямой. Время пешком — оценка: расстояние × 1,35 при 4,2 км/ч; переходы, ограждения, входы и погода не проверены.',
    'Каждая карточка — отдельный вариант прогулки. В суммарное время входят путь, посещение, выбранный возврат и резерв 5 минут.',
    'Актуальное открытие мест, цены и наличие свободных мест не проверены.',
  ];
  if (constraints.visitDate) warnings.push('Дата учтена как контекст запроса; часы и специальные закрытия на эту дату автоматически не проверяются.');
  if (!recommendations.length) warnings.unshift('В текущем наборе данных нет подтверждённых вариантов под все ограничения. Увеличьте время или измените категорию и точку старта.');
  return { recommendations, constraints, warnings,
    retrieval: { method: 'deterministic_geo_keyword_retrieval', usesEmbeddings: false, usesLanguageModel: false,
      summary: 'Фильтры по географии, категории и времени; поиск по словам и словарю ru/kk/en; объяснение по данным POI.',
      inputRecords: pois.length, validUniqueRecords: seen.length, feasibleCandidates: candidates.length, returned: recommendations.length,
      requestedCategories: requested, excludedCategories: excluded, queryTerms: terms, rejected: counters,
      scoring: { category: 35, keywordsPerMatch: 5, keywordsCap: 20, proximityMax: 25, timeFitMax: 15, childCategory: 5, repeatCategoryPenalty: 8 },
      scoreIsConfidence: false } };
}
