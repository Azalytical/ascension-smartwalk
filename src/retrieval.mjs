/** Deterministic, source-grounded POI retrieval. No network, LLM or embeddings. */
import { checkVisit } from './hours.mjs';
import { placeMetadata, requestedConditions, conditionEvidence, budgetAssessment, sourceTags } from './place-data.mjs';

const BOUNDS = Object.freeze({ minLat: 51, maxLat: 51.35, minLon: 71.25, maxLon: 71.65 });
const DETOUR = 1.35;
const SPEED_KMH = 4.2;
const RESERVE = 5;
const VISIT = { park: 15, cafe: 20, museum: 35, playground: 20, attraction: 15, restaurant: 45, mall: 40, culture: 60 };
// These are explicitly short visits, never promises of completing a meal, exhibition or performance.
const MIN_VISIT = { park: 5, cafe: 10, museum: 20, playground: 10, attraction: 5, restaurant: 25, mall: 15, culture: 60 };
const LABELS = { park: 'парк', cafe: 'кафе', museum: 'музей', playground: 'площадка', attraction: 'достопримечательность',
  restaurant: 'место, где поесть', mall: 'торговый центр', culture: 'место для культурного досуга' };
// Categories that keep a visitor under a roof. Used for rain, cold and "indoor" requests.
const INDOOR = ['mall', 'museum', 'cafe', 'restaurant', 'culture'];
const SYNONYMS = {
  park: ['park', 'парк', 'сквер', 'сад', 'саябақ', 'garden'],
  cafe: ['cafe', 'café', 'coffee', 'кофе', 'кафе', 'кофейн', 'кофехана', 'кафехана', 'кофеіш'],
  museum: ['museum', 'музей', 'мұражай', 'выставк', 'exhibition'],
  playground: ['playground', 'площадк', 'ойыналаң', 'ойын алаң', 'children play'],
  attraction: ['attraction', 'достопримечатель', 'көрікті', 'monument', 'памятник', 'ескерткіш', 'memorial', 'viewpoint', 'смотров'],
  restaurant: ['restaurant', 'ресторан', 'поесть', 'пообед', 'поужин', 'обед', 'ужин', 'покуш', 'еда', 'food', 'eat', 'lunch', 'dinner',
    'тамақ', 'мейрамхана', 'фастфуд', 'бургер', 'пицц'],
  mall: ['mall', 'трц', 'торгов', 'молл', 'shopping', 'сауда орталы'],
  culture: ['theatre', 'theater', 'театр', 'кино', 'cinema', 'movie', 'фильм', 'библиотек', 'library', 'кітапхана', 'концерт', 'спектакл'],
};
const INDOOR_INTENT = /дожд|ливень|rain|под крыш|в помещен|indoor|жаңбыр|мороз|холодн|cold|снег|snow|қар/;
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
    artwork: 'attraction', gallery: 'attraction', theme_park: 'attraction', fast_food: 'restaurant', ice_cream: 'cafe',
    theatre: 'culture', cinema: 'culture', arts_centre: 'culture', library: 'culture', exhibition_centre: 'culture' };
  if (aliases[direct]) return aliases[direct];
  // Never inspect a name, brand, or description for structural classification.
  // For example, the cinema name "Кинопарк" does not make it a park.
  const tags = poi.tags;
  const values = Array.isArray(tags) ? tags.map(tag => normalize(tag).split('=')).filter(parts => parts.length <= 2).map(parts => parts.at(-1))
    : tags && typeof tags === 'object' ? ['amenity', 'leisure', 'tourism', 'historic', 'shop'].map(key => normalize(tags[key]))
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
  if (input.withChild !== undefined && typeof input.withChild !== 'boolean') invalid('withChild должен быть логическим значением.');
  if (input.returnToStart !== undefined && typeof input.returnToStart !== 'boolean') invalid('returnToStart должен быть логическим значением.');
  if (input.query !== undefined && typeof input.query !== 'string') invalid('Запрос должен быть текстом.');
  const query = (input.query ?? '').trim();
  if (query.length > 500) invalid('Запрос должен быть не длиннее 500 символов.');
  if (input.preferences !== undefined && typeof input.preferences !== 'string') invalid('Особые предпочтения должны быть текстом.');
  const preferences = (input.preferences ?? '').trim();
  if (preferences.length > 500) invalid('Особые предпочтения должны быть не длиннее 500 символов.');
  if (input.indoor !== undefined && typeof input.indoor !== 'boolean') invalid('indoor должен быть логическим значением.');
  const budget = input.budget === undefined || input.budget === null || input.budget === '' ? null
    : numeric(input.budget, null, 'Бюджет в тенге', 0, 1000000);
  const preferenceText = `${query}. ${preferences}`;
  const explicitWalk = preferenceText.match(/(?:не (?:больше|более)|максимум|до|at most|no more than)\s*(\d{1,3})\s*(?:минут[уы]?|мин|min(?:utes?)?)\s*(?:пешком|ходьбы|walk)/iu);
  const derivedWalk = explicitWalk ? Number(explicitWalk[1]) : Math.max(1, Math.floor((minutes - RESERVE) / (input.returnToStart === false ? 1 : 2)));
  const maxWalkMinutes = numeric(input.maxWalkMinutes, derivedWalk, 'Путь в одну сторону', 1, 180);
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
  return { lat, lon, minutes, maxWalkMinutes, query, preferences, budget, budgetCurrency: 'KZT', indoor: input.indoor ?? false,
    specialConditions: requestedConditions(preferenceText, preferences), category, withChild: input.withChild ?? false,
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
  if (/поесть|пообед|поужин|перекус|покуш|еда|food|\beat\b|lunch|dinner|тамақ/iu.test(positive)) {
    if (!categories.includes('restaurant')) categories.push('restaurant');
    if (!categories.includes('cafe')) categories.push('cafe');
  }
  if (/необыч|интересн|unusual|something new|ерекше/iu.test(positive)) {
    for (const category of ['museum', 'attraction', 'culture']) if (!categories.includes(category)) categories.push(category);
  }
  if (INDOOR_INTENT.test(positive)) {
    // Weather overrides outdoor wishes: keep only roofed categories, add all of them when none was named.
    const roofed = categories.filter(category => INDOOR.includes(category));
    return roofed.length ? roofed : [...INDOOR];
  }
  if (!categories.length && /погуля|прогул|серуен|\bwalk\b/.test(positive)) return ['park', 'attraction'];
  return categories;
}

function excludedCategories(query) {
  const negativePhrases = normalize(query).match(/(?:^|[^\p{L}\p{N}])(?:не|без|not|no|without)\s+[\p{L}]+/gu) ?? [];
  return Object.entries(SYNONYMS).filter(([, words]) => negativePhrases.some(phrase => words.some(word => phrase.includes(word)))).map(([category]) => category);
}

function requestedFreeVisit(text) {
  return normalize(text).split(/[.;,\n]|\s+(?:но|but|бірақ)\s+/iu).some(clause => {
    // A free amenity is not a request for a free visit or a free meal.
    const visit = clause.replace(/(?:бесплат\p{L}*|free|тегін)\s+(?:wi[\s-]?fi|вай[\s-]?фай|интернет\p{L}*)/giu, '');
    if (!/бесплат|\bfree\b|тегін/iu.test(visit)) return false;
    if (/(?:без|не)\s+(?:(?:обязател\p{L}*|нуж\p{L}*|хочу)\s+)?бесплат|(?:желательно|по возможности).{0,30}бесплат|бесплат.{0,30}не\s+(?:обязател\p{L}*|нуж\p{L}*)/iu.test(visit)) return false;
    if (/\b(?:not|without|no|prefer|ideally)\b.{0,30}\bfree\b|\bfree\b.{0,30}(?:if possible|not (?:required|necessary|needed))/iu.test(visit)) return false;
    if (/тегін.{0,30}(?:қажет|керек|міндетті)\s+емес|мүмкін болса.{0,30}тегін/iu.test(visit)) return false;
    return true;
  });
}

function safeSourceUrl(value) {
  if (typeof value !== 'string') return null;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}

function evidenceSource(poi, field) {
  const source = poi.fieldSources?.[field];
  return source && typeof source === 'object' ? {
    sourceUrl: safeSourceUrl(source.sourceUrl), retrievedAt: source.retrievedAt ?? null,
    ...(source.source ? { source: source.source } : {}),
  } : { sourceUrl: poi.sourceUrl, retrievedAt: poi.retrievedAt ?? null, source: poi.source };
}

function normalName(poi) {
  return normalize(poi.name).replace(/[^\p{L}\p{N}]/gu, '');
}

// Two records are the same place when they share an id or source URL, or a normalized name within 40 m.
// Indexed lookups keep deduplication linear: a pairwise scan exceeds the Workers CPU limit at ~900 records.
function placeIndex() {
  const ids = new Set();
  const urls = new Set();
  const names = new Map();
  return {
    size: 0,
    has(poi) {
      return ids.has(String(poi.id)) || urls.has(poi.sourceUrl)
        || (names.get(normalName(poi)) ?? []).some(other => haversineMeters(poi.lat, poi.lon, other.lat, other.lon) < 40);
    },
    add(poi) {
      ids.add(String(poi.id));
      urls.add(poi.sourceUrl);
      const name = normalName(poi);
      if (!names.has(name)) names.set(name, []);
      names.get(name).push(poi);
      this.size++;
    },
  };
}

function activitiesFor(category) {
  return ({
    park: ['Выделить время на короткую прогулку; доступ на территорию и условия на месте уточнить заранее.'],
    cafe: ['Перекусить или сделать перерыв; меню, наличие мест и удобств уточнить у заведения.'],
    museum: ['Осмотреть экспозицию после проверки режима работы, билетов и доступности входа.'],
    playground: ['Осмотреть площадку и самостоятельно оценить, подходят ли оборудование и условия ребёнку.'],
    attraction: ['Осмотреть место и сделать фотографии там, где это разрешено; доступ уточнить заранее.'],
    restaurant: ['Пообедать или перекусить; меню, цены и наличие мест уточнить у заведения.'],
    mall: ['Переждать погоду под крышей и пройтись по галереям; режим входа уточнить заранее.'],
    culture: ['Проверить афишу или расписание сеансов и выбрать то, что помещается в ваше время.'],
  })[category];
}

function hoursWarning(poi, hours) {
  if (!poi.openingHours) return 'Режим работы неизвестен; открытие в момент визита не подтверждено.';
  if (hours?.status === 'open') {
    return `По режиму работы из источника место открыто на всё время визита${hours.closesAt ? ` (до ${hours.closesAt})` : ', круглосуточно'}; `
      + 'открытие в момент визита, праздники и исключения не проверены.';
  }
  if (hours?.status === 'unknown') return 'Указан режим работы из источника, но его формат не разобран автоматически; открытие в момент визита и исключения не проверены.';
  return 'Указан режим работы из источника; открытие в момент визита и исключения не проверены.';
}

function warningsFor(poi, constraints, hours) {
  const warnings = [hoursWarning(poi, hours),
  'Время посещения — плановая оценка, без очередей, билетов и текущей загрузки.'];
  if (!poi.retrievedAt) warnings.push('Дата получения сведений об этом месте неизвестна.');
  const access = normalize(poi.access ?? (poi.tags && !Array.isArray(poi.tags) ? poi.tags.access : null));
  if (!access) warnings.push('Условия входа и доступ на территорию неизвестны; уточните перед выходом.');
  else warnings.push(`Условия доступа в источнике: ${access}. Актуальные ограничения на вход не проверены.`);
  if (constraints.withChild) warnings.push('Условия посещения с ребёнком, безопасность, возрастные ограничения и доступность не проверены.');
  for (const condition of constraints.specialConditions) {
    warnings.push(conditionEvidence(poi, condition.key)
      ? `${condition.label}: отмечено в источнике; актуальное состояние${condition.key === 'wheelchair' ? ' и доступность всего пути' : ''} не проверены.`
      : condition.unknown);
  }
  if (!poi.averageCheck && ['cafe', 'restaurant'].includes(poi.category)) warnings.push('Средний чек неизвестен; уточните цены у заведения.');
  if (poi.budgetStatus === 'unknown') warnings.push('Соответствие бюджету не подтверждено: стоимость в тенге неизвестна.');
  if (poi.budgetStatus === 'confirmed') warnings.push('Средний чек из источника укладывается в бюджет; итоговая сумма зависит от заказа.');
  return warnings;
}

// Validation, classification and deduplication do not depend on the request, so they run once per dataset.
const preparedDatasets = new WeakMap();

function prepare(pois) {
  const cached = preparedDatasets.get(pois);
  if (cached) return cached;
  const counters = { invalidRecords: 0, unsupportedCategory: 0, restrictedAccess: 0, duplicates: 0 };
  const seen = placeIndex();
  const unique = [];
  for (const row of pois) {
    const category = row && typeof row === 'object' ? categoryOf(row) : null;
    const sourceUrl = safeSourceUrl(row?.sourceUrl);
    if (!row || !['string', 'number'].includes(typeof row.id) || String(row.id).trim() === ''
      || typeof row.name !== 'string' || !row.name.trim() || !validCoordinate(row.lat, row.lon) || !sourceUrl) {
      counters.invalidRecords++; continue;
    }
    if (!category) { counters.unsupportedCategory++; continue; }
    const poi = { ...row, id: String(row.id), category, sourceUrl, ...placeMetadata({ ...row, sourceUrl }) };
    const access = normalize(poi.access ?? (poi.tags && !Array.isArray(poi.tags) ? poi.tags.access : null));
    if (['private', 'no', 'military'].includes(access)) { counters.restrictedAccess++; continue; }
    if (seen.has(poi)) { counters.duplicates++; continue; }
    seen.add(poi);
    const names = [poi.name, poi.nameRu, poi.nameKk, poi.nameEn, ...(Array.isArray(poi.aliases) ? poi.aliases : [])].filter(value => typeof value === 'string');
    unique.push({ poi, nameText: normalize(names.join(' ')), text: normalize(`${names.join(' ')} ${poi.description ?? ''} ${tagText(poi.tags)}`) });
  }
  const result = { unique, counters };
  preparedDatasets.set(pois, result);
  return result;
}

function poisOf(dataset) {
  return Array.isArray(dataset) ? dataset : Array.isArray(dataset?.pois) ? dataset.pois : [];
}

/** Prepare a dataset ahead of the first request, e.g. at Worker startup, which has its own CPU budget. */
export function prepareDataset(dataset) {
  prepare(poisOf(dataset));
}

/** Search the same validated, public, deduplicated source records used by retrieval. */
export function searchLocations(dataset, options = {}) {
  if (typeof options.q !== 'undefined' && typeof options.q !== 'string') invalid('Поиск локации должен быть текстом.');
  const q = (options.q ?? '').trim();
  if (q.length > 100) invalid('Поиск локации должен быть не длиннее 100 символов.');
  const limit = numeric(options.limit, 30, 'Количество локаций', 1, 50);
  if (!Number.isInteger(limit)) invalid('Количество локаций должно быть целым числом.');
  const terms = normalize(q).split(/\s+/u).filter(Boolean);
  const matches = prepare(poisOf(dataset)).unique.filter(record => terms.every(term => record.nameText.includes(term)));
  const initialRank = poi => /экспо|expo|байтерек|baiterek|национальн.{0,20}музей|national museum/iu.test(poi.name) ? 3
    : ['park', 'museum', 'attraction', 'culture', 'mall'].includes(poi.category) ? 1 : 0;
  matches.sort((a, b) => (q ? Number(b.nameText.startsWith(normalize(q))) - Number(a.nameText.startsWith(normalize(q))) : initialRank(b.poi) - initialRank(a.poi))
    || a.poi.name.localeCompare(b.poi.name, 'ru') || String(a.poi.id).localeCompare(String(b.poi.id), 'en'));
  const locations = matches.slice(0, limit).map(({ poi }) => {
    const tags = sourceTags(poi);
    const address = typeof poi.address === 'string' ? poi.address : tags['addr:full']
      ?? [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(', ');
    return { id: poi.id, name: poi.name, lat: poi.lat, lon: poi.lon, category: poi.category,
      ...(address ? { address } : {}) };
  });
  return { locations, total: matches.length, returned: locations.length, query: q };
}

/**
 * Return up to three independent alternatives backed by existing POI records.
 * Accepts an array, or a dataset wrapper { pois: [...] }. Does not mutate inputs.
 */
export function recommend(dataset, input) {
  const constraints = constraintsFor(input);
  const pois = poisOf(dataset);
  const preferenceText = `${constraints.query}. ${constraints.preferences}`;
  const requested = queryCategories(constraints.query);
  const excluded = excludedCategories(preferenceText);
  const terms = tokens(preferenceText);
  const wantsFree = requestedFreeVisit(preferenceText);
  const needsIndoor = constraints.indoor || INDOOR_INTENT.test(normalize(preferenceText));
  const counters = { invalidRecords: 0, unsupportedCategory: 0, restrictedAccess: 0, duplicates: 0, category: 0, walkBudget: 0, totalBudget: 0, closedByHours: 0, budget: 0, specialConditions: 0, indoor: 0 };
  // Hours are checked against the requested visit time, or against now when no time was given.
  // A date without a time cannot be checked; minutes are dropped so equal requests give equal answers.
  const reference = constraints.visitDate
    ? (constraints.visitDate.includes('T') ? new Date(constraints.visitDate) : null)
    : new Date(Math.floor(Date.now() / 60000) * 60000);
  const prepared = prepare(pois);
  Object.assign(counters, prepared.counters);
  const candidates = [];

  for (const { poi, text } of prepared.unique) {
    const { category, sourceUrl } = poi;
    if ((constraints.category && category !== constraints.category)
      || (!constraints.category && requested.length > 0 && !requested.includes(category))
      || excluded.includes(category)) { counters.category++; continue; }
    if (needsIndoor && (!INDOOR.includes(category) || normalize(sourceTags(poi).indoor) === 'no')) { counters.indoor++; continue; }
    if (constraints.specialConditions.some(condition => condition.required && !conditionEvidence(poi, condition.key))) { counters.specialConditions++; continue; }
    const cost = budgetAssessment(poi, constraints.budget, wantsFree);
    if (!cost.allowed) { counters.budget++; continue; }

    const directDistance = haversineMeters(constraints.lat, constraints.lon, poi.lat, poi.lon);
    const walkMinutes = Math.ceil(directDistance * DETOUR / (SPEED_KMH * 1000 / 60));
    const returnMinutes = constraints.returnToStart ? walkMinutes : 0;
    const availableVisit = Math.floor(constraints.minutes - walkMinutes - returnMinutes - RESERVE);
    const visitMinutes = Math.min(VISIT[category], availableVisit);
    const totalMinutes = walkMinutes + visitMinutes + returnMinutes + RESERVE;
    if (walkMinutes > constraints.maxWalkMinutes) { counters.walkBudget++; continue; }
    if (visitMinutes < MIN_VISIT[category]) { counters.totalBudget++; continue; }
    const hours = reference && poi.openingHours
      ? { ...checkVisit(poi.openingHours, new Date(reference.getTime() + walkMinutes * 60000), visitMinutes),
        arrivalAt: new Date(reference.getTime() + walkMinutes * 60000).toISOString() }
      : null;
    if (hours && ['closed', 'closes_early'].includes(hours.status)) { counters.closedByHours++; continue; }

    const matchedTerms = terms.filter(term => text.includes(term));
    const categoryIntent = constraints.category === category || requested.includes(category);
    const scoreBreakdown = {
      category: categoryIntent ? 35 : 0,
      keywords: Math.min(20, matchedTerms.length * 5),
      proximity: Math.round(25 * (1 - Math.min(1, walkMinutes / constraints.maxWalkMinutes))),
      timeFit: Math.round(15 * (1 - totalMinutes / constraints.minutes)),
      childCategory: constraints.withChild && ['park', 'playground'].includes(category) ? 5 : 0,
      hoursConfirmed: hours?.status === 'open' ? 5 : 0,
      preferences: constraints.specialConditions.filter(condition => conditionEvidence(poi, condition.key)).length * 10,
      knownBudget: constraints.budget !== null && ['confirmed', 'free'].includes(cost.status) ? 10 : 0,
    };
    const score = Object.values(scoreBreakdown).reduce((a, b) => a + b, 0);
    const reason = `${LABELS[category]}${categoryIntent ? ' соответствует выбранной категории' : ' рядом с выбранной точкой'}; `
      + `примерно ${walkMinutes} мин в одну сторону, ${totalMinutes} мин ${constraints.returnToStart ? 'с возвращением' : 'без возвращения'} и резервом ${RESERVE} мин`
      + (hours?.status === 'open' ? `; по режиму работы из источника открыто ${hours.closesAt ? `до ${hours.closesAt}` : 'круглосуточно'}.` : '.');
    const evidence = [
      { field: 'name', label: 'Название из источника', value: poi.name, sourceUrl, retrievedAt: poi.retrievedAt ?? null },
      { field: 'category', label: 'Категория из данных POI', value: category, sourceUrl, retrievedAt: poi.retrievedAt ?? null },
      { field: 'coordinates', label: 'Координаты из источника', value: `${poi.lat}, ${poi.lon}`, sourceUrl, retrievedAt: poi.retrievedAt ?? null },
    ];
    if (poi.description) evidence.push({ field: 'description', label: 'Описание из данных POI', value: String(poi.description), ...evidenceSource(poi, 'description') });
    if (poi.openingHours) evidence.push({ field: 'openingHours', label: 'Режим работы из источника, без проверки открытия', value: String(poi.openingHours), ...evidenceSource(poi, 'openingHours') });
    for (const field of ['averageCheck', 'rating', 'reviewCount', 'popularity', 'contacts']) {
      const value = poi[field];
      if (value !== null && (field !== 'contacts' || Object.values(value).some(Boolean))) evidence.push({ field, label: 'Сведения из источника', value, ...evidenceSource(poi, field) });
    }
    for (const condition of constraints.specialConditions.filter(condition => conditionEvidence(poi, condition.key))) {
      evidence.push({ field: condition.key, label: `${condition.label}: отмечено в источнике`, value: true, ...evidenceSource(poi, condition.key) });
    }
    const assessedPoi = { ...poi, budgetStatus: cost.status };
    candidates.push({ ...assessedPoi, distanceMeters: Math.ceil(directDistance), estimatedWalkDistanceMeters: Math.ceil(directDistance * DETOUR),
      walkMinutes, visitMinutes, returnMinutes, safetyReserveMinutes: RESERVE, totalMinutes,
      visitIsShortened: visitMinutes < VISIT[category],
      why: reason, activities: visitMinutes < VISIT[category]
        ? [`Короткий визит: около ${visitMinutes} мин. ${activitiesFor(category)[0]}`] : activitiesFor(category), activitiesAreSuggestions: true,
      specialConditions: constraints.specialConditions.map(condition => ({ key: condition.key, label: condition.label, required: condition.required, evidenced: conditionEvidence(poi, condition.key) })),
      warnings: [...warningsFor(assessedPoi, constraints, hours), ...(visitMinutes < VISIT[category]
        ? ['Запланирован сокращённый визит; полноценный осмотр или обслуживание за это время не подтверждены.'] : [])], evidence, score, scoreBreakdown, matchedTerms,
      hoursCheck: hours ?? { status: poi.openingHours ? 'not_checked' : 'no_data' } });
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
  if (constraints.visitDate && !reference) warnings.push('Указана дата без времени: режим работы на эту дату автоматически не проверяется.');
  if (counters.closedByHours) warnings.push(`Исключено мест, закрытых к моменту визита по режиму работы из источника: ${counters.closedByHours}.`);
  if (counters.specialConditions) warnings.push(`Исключено мест без подтверждения обязательных условий из запроса: ${counters.specialConditions}.`);
  if (counters.budget) warnings.push(`Исключено мест, не соответствующих бюджету или запросу о бесплатном посещении: ${counters.budget}.`);
  if (!recommendations.length) warnings.unshift('В текущем наборе данных нет подтверждённых вариантов под все ограничения. Увеличьте время или измените категорию и точку старта.');
  if (!recommendations.length && constraints.specialConditions.some(condition => condition.required)) warnings.push(`Нужны данные, подтверждающие условия: ${constraints.specialConditions.filter(condition => condition.required).map(condition => condition.label).join(', ')}.`);
  return { recommendations, preferredId: recommendations[0]?.id ?? null, constraints, warnings,
    retrieval: { method: 'deterministic_geo_keyword_retrieval', usesEmbeddings: false, usesLanguageModel: false,
      summary: 'Фильтры по географии, категории, времени, бюджету и подтверждённым условиям; поиск по словам и словарю ru/kk/en; объяснение по данным источников POI.',
      inputRecords: pois.length, validUniqueRecords: prepared.unique.length, feasibleCandidates: candidates.length, returned: recommendations.length,
      requestedCategories: requested, excludedCategories: excluded, queryTerms: terms, rejected: counters,
      scoring: { category: 35, keywordsPerMatch: 5, keywordsCap: 20, proximityMax: 25, timeFitMax: 15, childCategory: 5, hoursConfirmed: 5, repeatCategoryPenalty: 8 },
      hoursReferenceTime: reference ? reference.toISOString() : null, hoursTimezone: 'UTC+05:00',
      scoreIsConfidence: false } };
}
