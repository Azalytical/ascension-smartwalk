/**
 * Deterministic, source-grounded POI retrieval. No network or LLM here: when the dictionary finds no category in a request,
 * the categories Gemini embeddings found (src/semantic.mjs) may arrive in context.semantic and are used in their place.
 * Aidem users' ratings may arrive in context.ratings (Map id → { count, sum }); from 5 ratings they nudge the order a little.
 */
import { checkVisit } from './hours.mjs';
import { queryIntents, nightReference, localClock } from './intent.mjs';
import { microRoute } from './route.mjs';
import { weatherCondition } from './weather.mjs';
import { ratingBonus, ratingSummary, RATINGS } from './ratings.mjs';

const BOUNDS = Object.freeze({ minLat: 51, maxLat: 51.35, minLon: 71.25, maxLon: 71.65 });
const DETOUR = 1.35;
const SPEED_KMH = 4.2;
const RESERVE = 5;
export const VISIT = { park: 15, cafe: 20, museum: 35, playground: 20, attraction: 15, restaurant: 45, mall: 40, culture: 60, family: 60, nightlife: 60 };
const LABELS = { park: 'парк', cafe: 'кафе', museum: 'музей', playground: 'площадка', attraction: 'достопримечательность',
  restaurant: 'место, где поесть', mall: 'торговый центр', culture: 'место для культурного досуга', family: 'место для семейного отдыха', nightlife: 'бар или паб' };
// Categories that keep a visitor under a roof. Used for rain, cold and "indoor" requests.
const INDOOR = ['mall', 'museum', 'cafe', 'restaurant', 'culture'];
const FOOD = ['cafe', 'restaurant', 'nightlife'];
const CHILD = ['park', 'playground', 'family'];
// A child also widens the search to museums, as in «площадки или музей с интерактивами».
const CHILD_ALLOWED = [...CHILD, 'museum'];
// Places that need opening hours to be visited; outdoor places without hours stay eligible.
const NEEDS_HOURS = [...INDOOR, 'family', 'nightlife'];
const SYNONYMS = {
  park: ['park', 'парк', 'сквер', 'сад', 'саябақ', 'garden'],
  cafe: ['cafe', 'café', 'coffee', 'кофе', 'кафе', 'кофейн', 'кофехана', 'кафехана', 'кофеіш'],
  museum: ['museum', 'музей', 'мұражай', 'выставк', 'exhibition'],
  playground: ['playground', 'площадк', 'ойыналаң', 'ойын алаң', 'children play'],
  attraction: ['attraction', 'достопримечатель', 'көрікті', 'monument', 'памятник', 'ескерткіш', 'memorial', 'viewpoint', 'смотров',
    'мечет', 'мешіт', 'mosque', 'собор', 'храм', 'church', 'фонтан', 'субұрқақ', 'fountain', 'набережн', 'sights'],
  restaurant: ['restaurant', 'ресторан', 'поесть', 'пообед', 'поужин', 'обед', 'ужин', 'покуш', 'еда', 'food', 'eat', 'lunch', 'dinner',
    'тамақ', 'мейрамхана', 'фастфуд', 'бургер', 'пицц'],
  mall: ['mall', 'трц', 'торгов', 'молл', 'shopping', 'сауда орталы'],
  culture: ['theatre', 'theater', 'театр', 'кино', 'cinema', 'movie', 'фильм', 'библиотек', 'library', 'кітапхана', 'концерт', 'спектакл'],
  family: ['зоопарк', 'zoo', 'аттракцион', 'amusement', 'развлекат', 'батут', 'аквапарк', 'океанариум', 'aquarium', 'хайуанаттар', 'ойын-сауық'],
};
// Narrower than a category: «мечеть» asks for a mosque, not for any sight. Used only when such a place fits the limits.
const KIND_INTENT = [
  [/мечет|мешіт|mosque|собор|храм|церк|church|cathedral/u, ['place_of_worship']],
  [/фонтан|субұрқақ|fountain/u, ['fountain']],
  [/зоопарк|(?:^|[^\p{L}])zoo|хайуанаттар/u, ['zoo']],
  [/пекарн|выпечк|bakery/u, ['bakery']],
  [/десерт|кондитер|торт|dessert|морожен|ice cream/u, ['dessert', 'ice_cream']],
  [/кино|cinema|movie|фильм/u, ['cinema']],
  [/театр|theat|спектакл/u, ['theatre']],
  [/библиотек|library|кітапхана/u, ['library']],
  [/концерт|филармон|concert/u, ['concert_hall']],
  [/галере|gallery/u, ['gallery']],
  [/памятник|ескерткіш|monument|мемориал|memorial/u, ['monument', 'memorial']],
  [/(?:^|[^\p{L}])мост|көпір|bridge/u, ['bridge']],
  [/аттракцион|amusement|развлекат/u, ['amusement_park', 'theme_park']],
];
const WALK_INTENT = /погуля|прогул|серуен|\bwalk\b/;
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
    artwork: 'attraction', gallery: 'attraction', fast_food: 'restaurant', ice_cream: 'cafe',
    theatre: 'culture', cinema: 'culture', arts_centre: 'culture', library: 'culture', exhibition_centre: 'culture',
    fountain: 'attraction', plaza: 'attraction', bridge: 'attraction', place_of_worship: 'attraction', bakery: 'cafe',
    dessert: 'cafe', food_court: 'restaurant', concert_hall: 'culture', theme_park: 'family', amusement_park: 'family',
    zoo: 'family', aquarium: 'family', water_park: 'family', beach: 'park',
    bar: 'nightlife', pub: 'nightlife', nightclub: 'nightlife', biergarten: 'nightlife' };
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

function startsWord(text, word) {
  for (let at = text.indexOf(word); at !== -1; at = text.indexOf(word, at + 1)) {
    if (at === 0 || !/[\p{L}\p{N}]/u.test(text[at - 1])) return true;
  }
  return false;
}

function queryCategories(query) {
  // Category intent is lexical. Negated categories must never become positive requirements.
  const positive = normalize(query).replace(/(?:^|[^\p{L}\p{N}])(?:не|без|not|no|without)\s+[\p{L}]+/gu, '');
  // A synonym matches at the start of a word: «недалеко» must not read as «еда», «кофейня» still reads as «кофе».
  const categories = Object.entries(SYNONYMS).filter(([, words]) => words.some(word => startsWord(positive, word))).map(([category]) => category);
  if (INDOOR_INTENT.test(positive)) {
    // Weather overrides outdoor wishes: keep only roofed categories, add all of them when none was named.
    const roofed = categories.filter(category => INDOOR.includes(category));
    return roofed.length ? roofed : [...INDOOR];
  }
  if (!categories.length && WALK_INTENT.test(positive)) return ['park', 'attraction'];
  return categories;
}

function queryKinds(query) {
  const positive = normalize(query).replace(/(?:^|[^\p{L}\p{N}])(?:не|без|not|no|without)\s+[\p{L}]+/gu, '');
  return KIND_INTENT.filter(([pattern]) => pattern.test(positive)).flatMap(([, kinds]) => kinds);
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
    cafe: ['Сделать перерыв на кофе; меню, наличие мест и удобств уточнить у заведения.'],
    museum: ['Осмотреть экспозицию после проверки режима работы, билетов и доступности входа.'],
    playground: ['Осмотреть площадку и самостоятельно оценить, подходят ли оборудование и условия ребёнку.'],
    attraction: ['Осмотреть место и сделать фотографии там, где это разрешено; доступ уточнить заранее.'],
    restaurant: ['Пообедать или перекусить; меню, цены и наличие мест уточнить у заведения.'],
    mall: ['Переждать погоду под крышей и пройтись по галереям; режим входа уточнить заранее.'],
    culture: ['Проверить афишу или расписание сеансов и выбрать то, что помещается в ваше время.'],
    family: ['Проверить билеты, возрастные ограничения и режим работы до выхода; условия для ребёнка оценить на месте.'],
    nightlife: ['Посидеть вечером; возрастные ограничения, вход и программу на сегодня уточнить у заведения.'],
  })[category];
}

function wheelchairOf(poi) {
  const value = normalize(poi.wheelchair ?? (poi.tags && !Array.isArray(poi.tags) ? poi.tags.wheelchair : null)).trim();
  return ['yes', 'limited', 'no', 'designated'].includes(value) ? (value === 'designated' ? 'yes' : value) : null;
}

const OUTDOOR = ['park', 'attraction', 'playground'];

/**
 * How complete the data behind a card is, not a probability that the visit goes well.
 * Every reason names the field that raised or lowered the level.
 */
function confidenceFor(poi, hours, constraints) {
  let points = 2;
  const reasons = [];
  if (hours?.status === 'open') { points++; reasons.push(`режим работы из источника покрывает весь визит${hours.closesAt ? ` (до ${hours.closesAt})` : ''}`); }
  else if (hours?.status === 'unknown') { points--; reasons.push('формат режима работы не разобран'); }
  else if (!poi.openingHours && OUTDOOR.includes(poi.category)) reasons.push('открытая территория, режим работы в источнике не указан');
  else if (!poi.openingHours) { points--; reasons.push('режим работы неизвестен'); }
  if (poi.nameIsGenerated) { points--; reasons.push('название в источнике не указано'); }
  if (poi.source?.id && poi.source.id !== 'osm') reasons.push(`данные ${poi.source.label ?? 'внешнего источника'}`);
  if (constraints.accessible) {
    const wheelchair = wheelchairOf(poi);
    if (wheelchair === 'yes') { points++; reasons.push('в источнике отмечен доступ для коляски'); }
    else { points--; reasons.push(wheelchair === 'limited' ? 'доступ для коляски в источнике ограниченный' : 'безбарьерность в источнике не указана'); }
  }
  const level = points >= 3 ? 'high' : points === 2 ? 'medium' : 'low';
  return { level, label: { high: 'Высокая уверенность', medium: 'Средняя уверенность', low: 'Низкая уверенность' }[level],
    basis: 'data_completeness', reasons };
}

const sourceLabel = poi => poi.source?.label ?? 'OpenStreetMap';

function provenanceFor(poi) {
  return {
    facts: { origin: 'poi_data', label: `Данные POI · ${sourceLabel(poi)}` },
    why: { origin: 'computed_from_poi', label: 'Рассчитано по данным POI и вашим условиям' },
    plan: { origin: 'computed_from_poi', label: 'Рассчитано по данным POI и вашим условиям' },
    activities: { origin: 'generated_idea', label: 'Идея сервиса, а не сведения из источника' },
  };
}

/** The visit as concrete steps with clock times, plus an optional nearby second stop from the same base. */
function planFor(pick, constraints, reference, pairing) {
  const { poi, walkMinutes, visitMinutes, returnMinutes } = pick;
  const activity = (activitiesFor(poi.category)?.[0] ?? '').split(';')[0].replace(/\.$/, '');
  const steps = [`${walkMinutes} мин пешком до «${poi.name}»`, `${visitMinutes} мин на месте: ${activity.charAt(0).toLocaleLowerCase('ru')}${activity.slice(1)}`];
  if (pairing) steps.push(`если останется время, ${pairing.label} «${pairing.name}» в ${pairing.distanceMeters} м (+${pairing.extraMinutes} мин)`);
  if (constraints.returnToStart) steps.push(`${returnMinutes} мин обратно`);
  const backAt = reference ? localClock(new Date(reference.getTime() + (walkMinutes + visitMinutes + returnMinutes) * 60000)) : null;
  return { steps, text: `План: ${steps.join(' → ')}.${backAt ? ` ${constraints.returnToStart ? 'Вернётесь' : 'Закончите'} примерно к ${backAt}.` : ''}`,
    leaveAt: reference ? localClock(reference) : null, backAt, isEstimate: true };
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

const SOCKET_WISH = /розет|socket|outlet|қуат|заряд/i;
const QUIET_WISH = /тих|quiet|тыныш|спокой/i;

/** Wishes from the request that no source confirms, so an answer must say they are unchecked rather than imply them. */
function unconfirmedFor(constraints, recommendations) {
  const items = [];
  if (SOCKET_WISH.test(constraints.query)) items.push('розетки');
  if (QUIET_WISH.test(constraints.query)) items.push('тишина');
  if (constraints.accessible && !(recommendations.length && recommendations.every(rec => rec.wheelchair === 'yes'))) items.push('безбарьерность');
  if (constraints.groupSize || constraints.group) items.push(constraints.groupSize ? `места для ${constraints.groupSize} человек` : 'места для компании');
  if (constraints.withChild) items.push('безопасность и оснащённость для ребёнка');
  return items;
}

function warningsFor(poi, constraints, hours) {
  const warnings = [hoursWarning(poi, hours),
  'Время посещения — плановая оценка, без очередей, билетов и текущей загрузки.'];
  if (!poi.retrievedAt) warnings.push('Дата получения сведений об этом месте неизвестна.');
  const access = normalize(poi.access ?? (poi.tags && !Array.isArray(poi.tags) ? poi.tags.access : null));
  if (!access) warnings.push('Условия входа и доступ на территорию неизвестны; уточните перед выходом.');
  else warnings.push(`Условия доступа в источнике: ${access}. Актуальные ограничения на вход не проверены.`);
  if (poi.source?.id && poi.source.id !== 'osm') {
    warnings.push(`Место из ${poi.source.label ?? 'внешнего источника'}: координаты и актуальность взяты из страниц бизнеса, режим работы неизвестен.`);
  }
  if (poi.nameIsGenerated) {
    warnings.push(poi.landmark ? `Название в источнике не указано; подписали по ближайшему месту «${poi.landmark.name}» (${poi.landmark.distanceMeters} м), ориентируйтесь по точке на карте.`
      : 'Название в источнике не указано; ориентируйтесь по точке на карте.');
  }
  if (constraints.withChild) warnings.push('Категория подходит для поиска прогулки с ребёнком; безопасность, возрастные ограничения и доступность не проверены.');
  if (SOCKET_WISH.test(constraints.query)) warnings.push('Наличие доступных посетителю розеток не подтверждено.');
  if (QUIET_WISH.test(constraints.query)) warnings.push('Тишина и текущий уровень шума не подтверждены.');
  if (constraints.accessible || /коляск|wheelchair|доступн|арбамен|арба/i.test(constraints.query)) {
    warnings.push(wheelchairOf(poi) === 'yes' ? 'В источнике отмечен доступ для коляски (wheelchair=yes); путь до входа и состояние пандуса не проверены.'
      : 'Безбарьерность входа и всего пути не подтверждена.');
  }
  if (constraints.night && OUTDOOR.includes(poi.category)) warnings.push('Поздно вечером выбирайте освещённые людные места; освещение и безопасность не проверены.');
  if (constraints.night && poi.category === 'nightlife') warnings.push('Возрастные ограничения и фейс-контроль не проверены.');
  if (constraints.groupSize || constraints.group) warnings.push(`Наличие мест${constraints.groupSize ? ` для ${constraints.groupSize} человек` : ' для компании'} не проверено; лучше позвонить или забронировать заранее.`);
  return warnings;
}

const GAMBLING = /(?:^|[^\p{L}])(?:бк|букмекер\p{L}*|казино|casino|betting|1xbet|parimatch|olimpbet|fonbet)(?:[^\p{L}]|$)|fairplay\.kz/iu;

// Validation, classification and deduplication do not depend on the request, so they run once per dataset.
const preparedDatasets = new WeakMap();

function prepare(pois) {
  const cached = preparedDatasets.get(pois);
  if (cached) return cached;
  const counters = { invalidRecords: 0, unsupportedCategory: 0, restrictedAccess: 0, duplicates: 0, gambling: 0 };
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
    const poi = { ...row, category, sourceUrl };
    const kind = normalize(row.category).trim() || category;
    const access = normalize(poi.access ?? (poi.tags && !Array.isArray(poi.tags) ? poi.tags.access : null));
    if (['private', 'no', 'military'].includes(access)) { counters.restrictedAccess++; continue; }
    // A safety filter, not a classification: betting shops and casinos are never suggested for a walk.
    if (GAMBLING.test(`${poi.name} ${poi.website ?? ''}`) || ['casino', 'gambling', 'betting'].includes(normalize(row.category).trim())) { counters.gambling++; continue; }
    if (seen.has(poi)) { counters.duplicates++; continue; }
    seen.add(poi);
    const names = [poi.nameRu, poi.nameKk, poi.nameEn, ...(Array.isArray(poi.aliases) ? poi.aliases : [])].filter(name => typeof name === 'string');
    unique.push({ poi, kind, text: normalize(`${poi.name} ${names.join(' ')} ${poi.keywords ?? ''} ${poi.description ?? ''} ${tagText(poi.tags)}`),
      name: normalName(poi), wheelchair: wheelchairOf(poi) });
  }
  const result = { unique, counters };
  preparedDatasets.set(pois, result);
  return result;
}

function poisOf(dataset) {
  return Array.isArray(dataset) ? dataset : Array.isArray(dataset?.pois) ? dataset.pois : [];
}

const SERVICE_KINDS = new Set(['toilets', 'drinking_water', 'bicycle_rental']);

/** App category of a record for map layers: a recommendable category, 'service' for walker amenities, or 'other'. */
export function placeCategory(poi) {
  const category = poi && typeof poi === 'object' ? categoryOf(poi) : null;
  if (category) return category;
  return SERVICE_KINDS.has(normalize(poi?.category).trim()) ? 'service' : 'other';
}

/** Prepare a dataset ahead of the first request, e.g. at Worker startup, which has its own CPU budget. */
export function prepareDataset(dataset) {
  prepare(poisOf(dataset));
}

/** Validated, deduplicated places with normalized categories, shared with features other than walk recommendations. */
export function preparedPlaces(dataset) {
  return prepare(poisOf(dataset)).unique.map(entry => entry.poi);
}

const NIGHT_CATEGORIES = ['nightlife', 'culture', 'restaurant', 'cafe', 'attraction'];
const SIGHTS = ['attraction', 'museum', 'park'];
const UNUSUAL = ['attraction', 'museum', 'culture', 'family'];
const GROUP = ['restaurant', 'park', 'culture', 'family', 'attraction'];
const CATEGORY_NAMES = { park: 'парк', cafe: 'кафе', museum: 'музей', playground: 'площадка', attraction: 'достопримечательность',
  restaurant: 'еда', mall: 'торговый центр', culture: 'культура', family: 'семейный отдых', nightlife: 'бар или паб' };

const walkBetween = (a, b) => Math.ceil(haversineMeters(a.lat, a.lon, b.lat, b.lon) * DETOUR / (SPEED_KMH * 1000 / 60));
const capitalize = text => text.charAt(0).toLocaleUpperCase('ru') + text.slice(1);

/** Requested categories once intents are applied: night, sights and «необычное» name categories the words alone do not. */
function intentCategories(requested, intents, child) {
  const categories = new Set(requested);
  if ((intents.bar || intents.night) && !child) categories.add('nightlife');
  if (!requested.length) {
    if (intents.night) NIGHT_CATEGORIES.filter(category => !child || category !== 'nightlife').forEach(category => categories.add(category));
    if (intents.sightseeing) SIGHTS.forEach(category => categories.add(category));
    if (intents.unusual) UNUSUAL.forEach(category => categories.add(category));
  }
  return [...categories];
}

// Formats that suit a company, read from the record itself: shared dishes, karaoke, a food court.
const GROUP_KINDS = { karaoke_venue: 'караоке', bar_and_grill_restaurant: 'гриль', barbecue_restaurant: 'гриль', pizza_restaurant: 'пицца',
  theme_restaurant: 'тематический ресторан', steakhouse: 'стейки', georgian_restaurant: 'грузинская кухня', food_court: 'фудкорт' };
const GROUP_CUISINES = { barbecue: 'гриль', bar_and_grill: 'гриль', grill: 'гриль', pizza: 'пицца', italian_pizza: 'пицца', steak_house: 'стейки',
  georgian: 'грузинская кухня', regional: 'местная кухня', local: 'местная кухня', kazakh: 'казахская кухня', uzbek: 'узбекская кухня' };

/** A format from the source that suits a company («караоке», «гриль»), or null. */
function groupFormat(poi, kind) {
  const tags = poi.tags && !Array.isArray(poi.tags) ? poi.tags : {};
  const cuisine = String(tags.cuisine ?? '').split(';').map(item => item.trim()).find(item => GROUP_CUISINES[item]);
  return GROUP_KINDS[normalize(tags['overture:category']).trim()] ?? GROUP_KINDS[kind] ?? GROUP_CUISINES[cuisine] ?? null;
}

/**
 * How well-known a place is in open data. Not a rating and not visitor numbers: a Wikidata or Wikipedia entry,
 * a listing in more than one source and names in several languages are what a source-grounded service can see.
 */
export function notabilityFor(poi) {
  const tags = poi.tags && !Array.isArray(poi.tags) ? poi.tags : {};
  const reasons = [];
  let points = 0;
  if (poi.wikidata || tags.wikidata) { points += 2; reasons.push('есть в Wikidata'); }
  if (poi.wikipedia || tags.wikipedia) { points += 1; reasons.push('есть статья в Википедии'); }
  const sources = 1 + (Array.isArray(poi.alsoIn) ? new Set(poi.alsoIn.map(item => item?.source).filter(Boolean)).size : 0);
  if (sources > 1) { points += 1; reasons.push(`есть в ${sources} открытых источниках`); }
  const names = new Set([poi.name, poi.nameRu, poi.nameKk, poi.nameEn, ...(Array.isArray(poi.aliases) ? poi.aliases : [])]
    .filter(name => typeof name === 'string' && name.trim()).map(name => name.trim())).size;
  if (names >= 4) { points += 1; reasons.push(`${names} вариантов названия на разных языках`); }
  const level = points >= 3 ? 'high' : points >= 1 ? 'medium' : 'low';
  return { level, points, label: { high: 'Известное место по открытым данным', medium: 'Есть в открытых справочниках', low: 'Мало упоминаний в открытых данных' }[level],
    reasons, basis: 'open_data_mentions', isRating: false };
}

function intentScore(poi, kind, hours, intents, wheelchair) {
  let points = poi.nameIsGenerated ? -20 : 0;
  const tags = poi.tags && !Array.isArray(poi.tags) ? poi.tags : {};
  // Overture lists KFC or Hardee's as restaurants; the cuisine tag still marks them as fast food.
  const fastFood = kind === 'fast_food' || ['burger', 'chicken', 'fast_food', 'hot_dog', 'shawarma'].includes(normalize(tags.cuisine).trim());
  const chain = Boolean(poi.brand || tags.brand) || fastFood;
  if (intents.unusual) points += chain ? -10 : UNUSUAL.includes(poi.category) && !poi.nameIsGenerated ? 10 : 0;
  if (intents.sightseeing && ['museum', 'attraction'].includes(poi.category) && !poi.nameIsGenerated) points += 5;
  // A tourist leans towards places open data knows well; at most +8, below the category weight. Not for «необычное»:
  // chains are listed in more sources, and an unusual request wants the opposite.
  if (intents.sightseeing && !poi.nameIsGenerated) points += 2 * Math.min(4, notabilityFor(poi).points);
  if (intents.quiet) points += ['nightlife', 'mall'].includes(poi.category) || fastFood ? -10 : ['cafe', 'park'].includes(poi.category) || kind === 'library' ? 5 : 0;
  if (intents.night) points += (hours?.status === 'open' ? 10 : 0) + ({ nightlife: 12, culture: 8 }[poi.category] ?? 0);
  if (intents.group) points += fastFood ? -10 : (GROUP.includes(poi.category) ? 5 : 0) + (groupFormat(poi, kind) ? 8 : 0);
  if (intents.accessible) points += { yes: 30, limited: 15 }[wheelchair] ?? 0;
  return points;
}

const CUISINES = { coffee_shop: 'кофейня', burger: 'бургеры', italian: 'итальянская кухня', pizza: 'пицца', asian: 'азиатская кухня', chicken: 'курица',
  regional: 'местная кухня', chinese: 'китайская кухня', sushi: 'суши', breakfast: 'завтраки', turkish: 'турецкая кухня', japanese: 'японская кухня',
  korean: 'корейская кухня', russian: 'русская кухня', european: 'европейская кухня', oriental: 'восточная кухня', georgian: 'грузинская кухня',
  french: 'французская кухня', barbecue: 'гриль', bar_and_grill: 'гриль', cake: 'десерты', pastry: 'выпечка', kazakh: 'казахская кухня', uzbek: 'узбекская кухня',
  local: 'местная кухня', kebab: 'кебаб', steak_house: 'стейки', thai: 'тайская кухня', mediterranean: 'средиземноморская кухня', brunch: 'бранчи' };

/** Up to three concrete facts from the record itself (cuisine, Wi-Fi, terrace, takeaway, halal), for the computed «why». */
function factsFor(poi) {
  const tags = poi.tags && !Array.isArray(poi.tags) ? poi.tags : {};
  const features = poi.features && typeof poi.features === 'object' ? poi.features : {};
  const facts = [];
  for (const code of String(tags.cuisine ?? '').split(';').map(item => item.trim()).filter(Boolean)) {
    const label = CUISINES[code];
    if (label && !facts.includes(label)) facts.push(label);
    if (facts.length === 2) break;
  }
  if (features.wifi || ['wlan', 'yes', 'wifi'].includes(normalize(tags.internet_access).trim())) facts.push('есть Wi-Fi');
  if (features.outdoorSeating || tags.outdoor_seating === 'yes') facts.push('есть места на улице');
  if (features.takeaway || tags.takeaway === 'yes') facts.push('можно взять с собой');
  if (features.halal || /halal/.test(String(tags['diet:halal'] ?? tags.cuisine ?? ''))) facts.push('халяль');
  return facts.slice(0, 3);
}

/** Short «why» that leads with the part of the request the place answers, then the time it takes. */
function whyFor(pick, constraints, intents, reference) {
  const { poi, walkMinutes, totalMinutes, hours, categoryIntent, kindMatch } = pick;
  const label = capitalize(LABELS[poi.category]);
  let match;
  if (kindMatch || categoryIntent) match = `${label} — под ваш запрос${constraints.withChild ? ' с ребёнком' : ''}`;
  else if (constraints.withChild) match = `${label} — подходит для прогулки с ребёнком по категории места`;
  else if (intents.sightseeing && SIGHTS.includes(poi.category)) match = `${label} — можно осмотреть за отведённое время`;
  else if (intents.night && hours?.status === 'open') match = `${label} — открыто на время визита по данным источника`;
  else if (pick.weather?.bad && INDOOR.includes(poi.category)) match = `${label} — под крышей: сейчас ${pick.weather.text}`;
  else if (intents.night && OUTDOOR.includes(poi.category)) match = `${label} — под открытым небом, режим работы для визита не нужен по категории места`;
  else if (intents.unusual && UNUSUAL.includes(poi.category)) match = `${label} — под запрос «что-то необычное»: не сетевое заведение`;
  else match = `${label} рядом с выбранной точкой`;
  if (intents.accessible && wheelchairOf(poi) === 'yes') match += ', в источнике отмечен доступ для коляски';
  const format = intents.group && !poi.nameIsGenerated ? groupFormat(poi, pick.kind) : null;
  if (format) match += `; для компании${constraints.groupSize ? ` из ${constraints.groupSize}` : ''} по данным источника: ${format}`;
  const facts = factsFor(poi).filter(fact => fact !== format);
  if (facts.length) match += `; ${format ? 'также' : 'по данным источника'}: ${facts.join(', ')}`;
  // The clock time below is the same «вернётесь к» as plan.backAt and the app: the way there, the visit and back; the reserve is spare.
  const time = `примерно ${walkMinutes} мин в одну сторону, ${totalMinutes - RESERVE} мин ${constraints.returnToStart ? 'туда, на месте и обратно' : 'туда и на месте'}`
    + ` и ещё ${RESERVE} мин в запасе из ваших ${constraints.minutes}`;
  const open = hours?.status === 'open' ? `; по режиму работы из источника открыто ${hours.closesAt ? `до ${hours.closesAt}` : 'круглосуточно'}` : '';
  const back = reference ? `; ${constraints.returnToStart ? 'вернётесь' : 'закончите'} примерно к ${localClock(new Date(reference.getTime() + (totalMinutes - RESERVE) * 60000))}` : '';
  return `${match}; ${time}${open}${back}.`;
}

/** The nearest named place within 250 m, so a nameless «Фонтан» or «Детская площадка» can be told apart and found. */
function landmarkFor(poi, prepared) {
  let best = null;
  for (const { poi: other } of prepared.unique) {
    if (other.nameIsGenerated || other.id === poi.id) continue;
    if (Math.abs(other.lat - poi.lat) > 0.0025 || Math.abs(other.lon - poi.lon) > 0.004) continue;
    const meters = haversineMeters(poi.lat, poi.lon, other.lat, other.lon);
    if (meters <= 250 && (!best || meters < best.meters)) best = { other, meters };
  }
  return best ? { id: best.other.id, name: best.other.name, distanceMeters: Math.ceil(best.meters) } : null;
}

/** The closest named place of a complementary kind that still fits the remaining time. */
function pairingFor(pick, prepared, constraints, reference, taken) {
  const { poi, totalMinutes, visitMinutes, walkMinutes } = pick;
  const wanted = FOOD.includes(poi.category) ? ['park', 'attraction'] : constraints.night ? [] : ['cafe'];
  if (!wanted.length) return null;
  const spare = constraints.minutes - totalMinutes;
  const start = { lat: constraints.lat, lon: constraints.lon };
  let best = null;
  for (const { poi: other } of prepared.unique) {
    if (!wanted.includes(other.category) || other.nameIsGenerated || taken.has(other.id)) continue;
    if (Math.abs(other.lat - poi.lat) > 0.003 || Math.abs(other.lon - poi.lon) > 0.005) continue;
    const meters = haversineMeters(poi.lat, poi.lon, other.lat, other.lon);
    if (meters > 300 || (best && meters >= best.meters)) continue;
    const extra = VISIT[other.category] + walkBetween(poi, other) + (constraints.returnToStart ? walkBetween(other, start) - pick.returnMinutes : 0);
    if (extra > spare) continue;
    if (reference && other.openingHours) {
      const arrival = new Date(reference.getTime() + (walkMinutes + visitMinutes + walkBetween(poi, other)) * 60000);
      if (['closed', 'closes_early'].includes(checkVisit(other.openingHours, arrival, VISIT[other.category]).status)) continue;
    }
    best = { other, meters, extra };
  }
  if (!best) return null;
  const { other, meters, extra } = best;
  return { id: other.id, name: other.name, category: other.category, label: other.category === 'cafe' ? 'зайти в кафе' : 'пройтись до',
    distanceMeters: Math.ceil(meters), extraMinutes: Math.max(0, Math.ceil(extra)), lat: other.lat, lon: other.lon, sourceUrl: other.sourceUrl,
    origin: 'poi_data' };
}

/** What the system used to answer: shown to the visitor, as the task requires. */
function understoodFor(constraints, requested, excluded, intents, reference, nightShift, weather, weatherRoof, meant) {
  const items = [
    { key: 'location', label: 'Точка старта: используется только для расчёта, не сохраняется и не передаётся модели' },
    { key: 'time', label: `${constraints.minutes} мин всего, до ${constraints.maxWalkMinutes} мин пешком в одну сторону${constraints.returnToStart ? ', с возвращением' : ''}` },
  ];
  if (requested.length) items.push({ key: 'categories', label: `Категории: ${requested.map(category => CATEGORY_NAMES[category]).join(', ')}` });
  if (meant.length) items.push({ key: 'semantic', label: `Смысл запроса по эмбеддингам Gemini: ${meant.map(category => CATEGORY_NAMES[category]).join(', ')}` });
  if (excluded.length) items.push({ key: 'excluded', label: `Без: ${excluded.map(category => CATEGORY_NAMES[category]).join(', ')}` });
  if (constraints.withChild) items.push({ key: 'child', label: constraints.withChildFromQuery ? 'С ребёнком (понято из запроса)' : 'С ребёнком' });
  if (intents.sightseeing) items.push({ key: 'sightseeing', label: 'Посмотреть город: достопримечательности, музеи, парки' });
  if (intents.night) items.push({ key: 'night', label: nightShift ? 'Поздно вечером: режим работы проверен на сегодня, 22:00' : 'Поздно вечером: только места, открытые на время визита' });
  if (intents.unusual) items.push({ key: 'unusual', label: 'Необычное: выше места культуры и городские объекты, ниже сетевые заведения' });
  if (intents.group) items.push({ key: 'group', label: intents.groupSize ? `Компания из ${intents.groupSize} человек` : 'Компания' });
  if (intents.accessible) items.push({ key: 'accessible', label: 'Доступно для коляски: места, где в данных отмечено «нет», убраны' });
  if (intents.quiet) items.push({ key: 'quiet', label: 'Спокойное место: ниже бары, фастфуд и торговые центры' });
  if (weather) items.push({ key: 'weather', label: `Погода сейчас: ${weather.text} (Open-Meteo)${weatherRoof ? ', поэтому только места под крышей' : ''}` });
  if (reference && !nightShift) items.push({ key: 'hours', label: `Режим работы проверен на ${localClock(reference)}` });
  return items;
}

/**
 * Categories from Gemini embeddings that this request may use: known ones only, and never one the visitor excluded
 * or one the child and night rules would filter out anyway.
 */
function meaningFor(semantic, child, intents, excluded) {
  const categories = Array.isArray(semantic?.categories) ? semantic.categories : [];
  return [...new Set(categories)].filter(category => Object.hasOwn(VISIT, category) && !excluded.includes(category)
    && (!child || CHILD_ALLOWED.includes(category)) && !(intents.night && !child && ['playground', 'family'].includes(category))).slice(0, 2);
}

/** True when the dictionary understood nothing in a request with words, so its meaning is worth asking Gemini embeddings. */
export function meaningWanted(result) {
  const { retrieval, constraints, intents } = result ?? {};
  return Boolean(constraints?.query && constraints.query.length >= 3 && !constraints.category && !intents?.length
    && !retrieval?.requestedCategories?.length && !retrieval?.requestedKinds?.length);
}

/**
 * Return up to three independent alternatives backed by existing POI records,
 * and, when the time allows, a micro-route through three of them.
 * Accepts an array, or a dataset wrapper { pois: [...] }. Does not mutate inputs.
 */
export function recommend(dataset, input, context = {}) {
  const base = constraintsFor(input);
  const intents = queryIntents(base.query);
  const child = base.withChild || intents.child;
  const constraints = { ...base, withChild: child, withChildFromQuery: !base.withChild && intents.child,
    night: intents.night, accessible: intents.accessible, group: intents.group, groupSize: intents.groupSize };
  const pois = poisOf(dataset);
  const excluded = excludedCategories(constraints.query);
  const lexical = queryCategories(constraints.query);
  const kinds = queryKinds(constraints.query);
  // Gemini embeddings stand in only for a request the dictionary understood nothing of: no category, kind or intent.
  const meant = !lexical.length && !kinds.length && !constraints.category && !Object.values(intents).includes(true)
    ? meaningFor(context.semantic, child, intents, excluded) : [];
  const named = lexical.length ? lexical : meant;
  // Live weather (server-side only, never from the request body) applies to walks that start now.
  const now = new Date(Math.floor(Date.now() / 60000) * 60000);
  const ratings = context.ratings instanceof Map ? context.ratings : null;
  const nightShift = intents.night && !constraints.visitDate ? nightReference(now) : null;
  const weather = !constraints.visitDate && !nightShift ? weatherCondition(context.weather) : null;
  const weatherRoof = Boolean(weather?.bad && !named.length && !intents.night);
  let requested = intentCategories(named, intents, child)
    .filter(category => !excluded.includes(category) && !(intents.night && !child && ['playground', 'family'].includes(category)));
  if (weatherRoof) {
    const roofed = child ? ['museum', 'family'] : INDOOR;
    const kept = requested.filter(category => roofed.includes(category));
    requested = (kept.length ? kept : roofed).filter(category => !excluded.includes(category));
  }
  // «Поужинать и погулять»: food stays the main ask, and parks and sights join with a smaller category score,
  // so the cards lead with food and the mini-route can add a walk after it.
  const walkToo = !weatherRoof && lexical.length > 0 && lexical.every(category => FOOD.includes(category)) && WALK_INTENT.test(normalize(constraints.query))
    ? ['park', 'attraction'].filter(category => !requested.includes(category) && !excluded.includes(category) && (!child || CHILD_ALLOWED.includes(category))) : [];
  requested = [...requested, ...walkToo];
  const terms = tokens(constraints.query);
  const counters = { invalidRecords: 0, unsupportedCategory: 0, restrictedAccess: 0, duplicates: 0, gambling: 0, category: 0, walkBudget: 0, totalBudget: 0,
    closedByHours: 0, unknownHoursAtNight: 0, notAccessible: 0 };
  // The nearest place that matched the request but not the time limits, offered when nothing fits.
  let nearest = null;
  const nearestByCategory = new Map();
  // For a tourist with few sights in walking range: the nearest named sight beyond it, to say that transport is needed.
  let nearestSight = null;
  // Hours are checked against the requested visit time, or against now when no time was given.
  // A date without a time cannot be checked; minutes are dropped so equal requests give equal answers.
  // A night request in the daytime is checked against tonight, 22:00.
  const reference = constraints.visitDate
    ? (constraints.visitDate.includes('T') ? new Date(constraints.visitDate) : null)
    : nightShift ?? now;
  const prepared = prepare(pois);
  Object.assign(counters, prepared.counters);
  // Only cheap numbers are computed per record; cards with evidence and warnings are built for the three picks.
  // With thousands of records this keeps a request well inside the Workers CPU limit.
  const candidates = [];
  for (const { poi, kind, text, name, wheelchair } of prepared.unique) {
    const { category } = poi;
    if ((constraints.category && category !== constraints.category)
      || (!constraints.category && requested.length > 0 && !requested.includes(category))
      || excluded.includes(category)
      || (category === 'nightlife' && constraints.category !== 'nightlife' && !requested.includes('nightlife'))
      || (child && !CHILD_ALLOWED.includes(category))
      || (intents.night && !child && ['playground', 'family'].includes(category))) { counters.category++; continue; }

    const directDistance = haversineMeters(constraints.lat, constraints.lon, poi.lat, poi.lon);
    const walkMinutes = Math.ceil(directDistance * DETOUR / (SPEED_KMH * 1000 / 60));
    const returnMinutes = constraints.returnToStart ? walkMinutes : 0;
    const visitMinutes = VISIT[category];
    const totalMinutes = walkMinutes + visitMinutes + returnMinutes + RESERVE;
    if (walkMinutes > constraints.maxWalkMinutes || totalMinutes > constraints.minutes) {
      counters[walkMinutes > constraints.maxWalkMinutes ? 'walkBudget' : 'totalBudget']++;
      if ((requested.length || constraints.category) && !(intents.accessible && wheelchair === 'no')
        && !(intents.night && NEEDS_HOURS.includes(category) && !poi.openingHours) && (!nearest || walkMinutes < nearest.walkMinutes)) {
        nearest = { poi, walkMinutes, totalMinutes };
      }
      if (named.includes(category) && !poi.nameIsGenerated && !(intents.accessible && wheelchair === 'no')
        && (nearestByCategory.get(category)?.walkMinutes ?? Infinity) > walkMinutes) nearestByCategory.set(category, { poi, walkMinutes, totalMinutes });
      if (intents.sightseeing && ['attraction', 'museum'].includes(category) && !poi.nameIsGenerated
        && (!nearestSight || walkMinutes < nearestSight.walkMinutes)) nearestSight = { poi, walkMinutes, directDistance };
      continue;
    }
    if (intents.accessible && wheelchair === 'no') { counters.notAccessible++; continue; }
    const hours = reference && poi.openingHours
      ? { ...checkVisit(poi.openingHours, new Date(reference.getTime() + walkMinutes * 60000), visitMinutes),
        arrivalAt: new Date(reference.getTime() + walkMinutes * 60000).toISOString() }
      : null;
    if (hours && ['closed', 'closes_early'].includes(hours.status)) { counters.closedByHours++; continue; }
    // Late at night a roofed place is suggested only when its recorded hours cover the visit.
    if (intents.night && NEEDS_HOURS.includes(category) && hours?.status !== 'open') { counters.unknownHoursAtNight++; continue; }

    const matchedTerms = terms.filter(term => text.includes(term));
    const categoryIntent = constraints.category === category || (requested.includes(category) && named.includes(category));
    const scoreBreakdown = {
      category: constraints.category === category || requested.includes(category) ? (walkToo.includes(category) ? 15 : 35) : 0,
      keywords: Math.min(20, matchedTerms.length * 5),
      proximity: Math.round(25 * (1 - Math.min(1, walkMinutes / constraints.maxWalkMinutes))),
      timeFit: Math.round(15 * (1 - totalMinutes / constraints.minutes)),
      childCategory: child ? 5 : 0,
      hoursConfirmed: hours?.status === 'open' ? 5 : 0,
      intent: intentScore(poi, kind, hours, intents, wheelchair),
      userRatings: ratings ? ratingBonus(ratings.get(String(poi.id))) : 0,
    };
    const score = scoreBreakdown.category + scoreBreakdown.keywords + scoreBreakdown.proximity + scoreBreakdown.timeFit
      + scoreBreakdown.childCategory + scoreBreakdown.hoursConfirmed + scoreBreakdown.intent + scoreBreakdown.userRatings;
    candidates.push({ poi, kind, name, directDistance, walkMinutes, returnMinutes, visitMinutes, totalMinutes, hours,
      matchedTerms, categoryIntent, scoreBreakdown, score });
  }

  const kindMatches = kinds.length ? candidates.filter(candidate => kinds.includes(candidate.kind)) : [];
  if (kindMatches.length) {
    candidates.splice(0, candidates.length, ...kindMatches);
    for (const candidate of candidates) candidate.kindMatch = true;
  }

  // Greedy diversity: a modest penalty for a repeated category and a larger one for a repeated name
  // («Детская площадка» three times); intent and proximity remain the main signals.
  const picks = [];
  const taken = new Set();
  const nameOf = c => c.name;
  // Two records of one kind within 80 m that share a long word («Әнші субұрқақтар» and «Ән салатын субұрқақтар»), or where one has no name,
  // are usually one place mapped twice; different cafes in one mall share neither.
  // Name words are computed once per candidate, and each candidate's adjusted score once per pick round:
  // recomputing both inside every comparison made this loop the hottest part of a request over ~2000 places.
  const wordCache = new Map();
  const words = c => {
    let set = wordCache.get(c);
    if (!set) wordCache.set(c, set = new Set(normalize(c.poi.name).split(/[^\p{L}\p{N}]+/u).filter(word => word.length >= 5)));
    return set;
  };
  const sameSpot = (a, b) => a.poi.category === b.poi.category && haversineMeters(a.poi.lat, a.poi.lon, b.poi.lat, b.poi.lon) < 80
    && (a.poi.nameIsGenerated || b.poi.nameIsGenerated || [...words(a)].some(word => words(b).has(word)));
  // A nameless place is shown with its nearest named place. Two cards reading «Детская площадка у «Wall Street»» look like
  // one place listed twice, so a second card with the same label is skipped in favour of the next candidate.
  const landmarks = new Map();
  const labelOf = c => {
    if (!c.poi.nameIsGenerated) return null;
    if (!landmarks.has(c)) landmarks.set(c, landmarkFor(c.poi, prepared));
    const landmark = landmarks.get(c);
    return landmark ? `${c.poi.name} у «${landmark.name}»` : c.poi.name;
  };
  while (picks.length < 3 && taken.size < candidates.length) {
    const roundScores = new Map();
    const adjusted = c => {
      let value = roundScores.get(c);
      if (value === undefined) {
        value = c.score - (picks.some(pick => pick.poi.category === c.poi.category) ? 8 : 0)
          - (picks.some(pick => nameOf(pick) === nameOf(c)) ? 15 : 0)
          - (picks.some(pick => sameSpot(pick, c)) ? 30 : 0)
          + (named.includes(c.poi.category) && !picks.some(pick => pick.poi.category === c.poi.category) ? 6 : 0);
        roundScores.set(c, value);
      }
      return value;
    };
    let best = null;
    for (const candidate of candidates) {
      if (taken.has(candidate)) continue;
      if (!best || adjusted(candidate) > adjusted(best) || (adjusted(candidate) === adjusted(best)
        && (candidate.walkMinutes < best.walkMinutes || (candidate.walkMinutes === best.walkMinutes
          && String(candidate.poi.id).localeCompare(String(best.poi.id), 'en') < 0)))) best = candidate;
    }
    taken.add(best);
    const label = labelOf(best);
    if (label && picks.some(pick => labelOf(pick) === label)) continue;
    picks.push(best);
  }
  const pickedIds = new Set(picks.map(pick => pick.poi.id));
  const recommendations = picks.map(pick => {
    const { directDistance, walkMinutes, returnMinutes, visitMinutes, totalMinutes, hours, matchedTerms, scoreBreakdown, score } = pick;
    // A nameless record is shown with the nearest named place, as in «Фонтан у «Mega Silk Way»».
    const landmark = pick.poi.nameIsGenerated ? landmarks.get(pick) ?? landmarkFor(pick.poi, prepared) : null;
    const poi = landmark ? { ...pick.poi, name: `${pick.poi.name} у «${landmark.name}»`, landmark } : pick.poi;
    const { category, sourceUrl } = poi;
    const evidence = [
      { field: 'name', label: landmark ? 'Название по типу места и ближайшему месту из источника' : 'Название из источника', value: poi.name, sourceUrl, retrievedAt: poi.retrievedAt ?? null },
      { field: 'category', label: 'Категория из данных POI', value: category, sourceUrl, retrievedAt: poi.retrievedAt ?? null },
      { field: 'coordinates', label: 'Координаты из источника', value: `${poi.lat}, ${poi.lon}`, sourceUrl, retrievedAt: poi.retrievedAt ?? null },
    ];
    if (poi.description) evidence.push({ field: 'description', label: 'Описание из данных POI', value: String(poi.description), sourceUrl, retrievedAt: poi.retrievedAt ?? null });
    if (poi.openingHours) evidence.push({ field: 'openingHours', label: 'Режим работы из источника, без проверки открытия', value: String(poi.openingHours), sourceUrl, retrievedAt: poi.retrievedAt ?? null });
    if (wheelchairOf(poi)) evidence.push({ field: 'wheelchair', label: 'Доступ для коляски из источника', value: wheelchairOf(poi), sourceUrl, retrievedAt: poi.retrievedAt ?? null });
    if (typeof poi.address === 'string' && poi.address) {
      // A field filled from another source cites that source, not the main record.
      const filledFrom = Array.isArray(poi.alsoIn) ? poi.alsoIn.find(item => item.id === poi.fieldSources?.address) : null;
      const addressUrl = safeSourceUrl(filledFrom?.sourceUrl) ?? sourceUrl;
      evidence.push({ field: 'address', label: 'Адрес из источника', value: poi.address, sourceUrl: addressUrl, retrievedAt: poi.retrievedAt ?? null });
    }
    const pairing = pairingFor(pick, prepared, constraints, reference, pickedIds);
    return { ...poi, kind: pick.kind, distanceMeters: Math.ceil(directDistance), estimatedWalkDistanceMeters: Math.ceil(directDistance * DETOUR),
      walkMinutes, visitMinutes, returnMinutes, safetyReserveMinutes: RESERVE, totalMinutes,
      why: whyFor({ ...pick, weather }, constraints, intents, reference), activities: activitiesFor(category), activitiesAreSuggestions: true,
      plan: planFor({ ...pick, poi }, constraints, reference, pairing), pairing,
      confidence: confidenceFor(poi, hours, constraints), notability: notabilityFor(poi), provenance: provenanceFor(poi), wheelchair: wheelchairOf(poi),
      // People's stars, kept apart from notability (open data): shown as «Оценки пользователей Aidem».
      ...(ratings ? { userRating: ratingSummary(ratings.get(String(pick.poi.id))?.count, ratings.get(String(pick.poi.id))?.sum) } : {}),
      warnings: warningsFor(poi, constraints, hours), evidence, score, scoreBreakdown, matchedTerms,
      hoursCheck: hours ?? { status: poi.openingHours ? 'not_checked' : 'no_data' } };
  });
  const route = microRoute(candidates, { ...constraints, foodFocus: requested.length > 0 && requested.every(category => FOOD.includes(category)), routeAsked: intents.route === true }, reference, walkBetween);
  const warnings = [
    'Расстояние указано по прямой. Время пешком — оценка: расстояние × 1,35 при 4,2 км/ч; переходы, ограждения, входы и погода не проверены.',
    'Каждая карточка — отдельный вариант прогулки. В суммарное время входят путь, посещение, выбранный возврат и резерв 5 минут.',
    'Актуальное открытие мест, цены и наличие свободных мест не проверены.',
  ];
  if (kinds.length && !kindMatches.length && recommendations.length) {
    warnings.push('Мест именно этого вида в пределах вашего времени не нашлось; ниже ближайшие варианты той же категории.');
  }
  if (constraints.visitDate && !reference) warnings.push('Указана дата без времени: режим работы на эту дату автоматически не проверяется.');
  if (weather?.bad && !weatherRoof && named.some(category => OUTDOOR.includes(category))) {
    warnings.push(`Сейчас ${weather.text} по данным Open-Meteo: на улице оденьтесь по погоде или добавьте к запросу «под крышей».`);
  }
  if (nightShift) warnings.push(`Ночной запрос сделан днём: режим работы проверен на сегодня, 22:00 (сейчас ${localClock(now)}).`);
  if (counters.closedByHours) warnings.push(`Исключено мест, закрытых к моменту визита по режиму работы из источника: ${counters.closedByHours}.`);
  if (counters.unknownHoursAtNight) warnings.push(`Поздно вечером не предлагаем заведения без режима работы в источнике: исключено ${counters.unknownHoursAtNight}.`);
  if (counters.notAccessible) warnings.push(`Исключено мест, где в источнике отмечено отсутствие доступа для коляски: ${counters.notAccessible}.`);
  if (intents.accessible && recommendations.length && !recommendations.some(rec => rec.wheelchair === 'yes')) {
    warnings.push('Среди подходящих по времени мест нет отмеченных в источнике как доступные для коляски; безбарьерность вариантов ниже не подтверждена.');
  }
  const nearestBeyondLimits = !recommendations.length && nearest ? { id: nearest.poi.id, name: nearest.poi.name, category: nearest.poi.category,
    walkMinutes: nearest.walkMinutes, neededMinutes: nearest.totalMinutes, sourceUrl: nearest.poi.sourceUrl, lat: nearest.poi.lat, lon: nearest.poi.lon,
    hoursChecked: false } : null;
  if (!recommendations.length) warnings.unshift('В текущем наборе данных нет подтверждённых вариантов под все ограничения. Увеличьте время или измените категорию и точку старта.');
  if (nearestBeyondLimits) {
    warnings.unshift(`Ближе всего подходит «${nearestBeyondLimits.name}» (${LABELS[nearestBeyondLimits.category]}): около ${nearestBeyondLimits.walkMinutes} мин пешком в одну сторону, `
      + `нужно примерно ${nearestBeyondLimits.neededMinutes} мин${constraints.returnToStart ? ' с возвращением' : ''}. Режим работы для него не проверялся. `
      + `${[nearestBeyondLimits.neededMinutes > constraints.minutes ? `Увеличьте время до ${nearestBeyondLimits.neededMinutes} мин` : '',
        nearestBeyondLimits.walkMinutes > constraints.maxWalkMinutes ? `разрешите до ${nearestBeyondLimits.walkMinutes} мин пешком в одну сторону` : '']
        .filter(Boolean).join(' и ').replace(/^р/, 'Р')} или измените точку старта.`);
  }
  // A category the visitor named but no card covers: say where the nearest one is and how much time it needs.
  const nearestMissing = recommendations.length ? named
    .filter(category => requested.includes(category) && nearestByCategory.has(category) && !recommendations.some(rec => rec.category === category))
    .map(category => {
      const { poi, walkMinutes, totalMinutes } = nearestByCategory.get(category);
      return { category, id: poi.id, name: poi.name, walkMinutes, neededMinutes: totalMinutes, sourceUrl: poi.sourceUrl, lat: poi.lat, lon: poi.lon, hoursChecked: false };
    }) : [];
  for (const missing of [...nearestMissing].reverse()) {
    warnings.unshift(`${capitalize(LABELS[missing.category])} в ваше время не помещается: ближайший вариант «${missing.name}», около ${missing.walkMinutes} мин пешком в одну сторону, `
      + `нужно примерно ${missing.neededMinutes} мин${constraints.returnToStart ? ' с возвращением' : ''}. Режим работы для него не проверялся.`);
  }
  const beyondWalk = intents.sightseeing && recommendations.length && recommendations.length < 3 && nearestSight
    ? { id: nearestSight.poi.id, name: nearestSight.poi.name, category: nearestSight.poi.category, distanceMeters: Math.round(nearestSight.directDistance),
      walkMinutes: nearestSight.walkMinutes, needsTransport: true } : null;
  if (beyondWalk) {
    const km = (nearestSight.directDistance / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 1 });
    warnings.unshift(`Пешком отсюда мест для осмотра мало. Ближайшее за пределами вашего времени: «${nearestSight.poi.name}», около ${km} км по прямой, `
      + `примерно ${nearestSight.walkMinutes} мин пешком в одну сторону. Дальше нужен транспорт; его время сервис не считает.`);
  }
  return { recommendations, route, nearestBeyondLimits, nearestMissing, beyondWalk, constraints, warnings, unconfirmed: unconfirmedFor(constraints, recommendations),
    intents: Object.keys(intents).filter(key => intents[key] === true),
    understood: understoodFor(constraints, requested, excluded, intents, reference, nightShift, weather, weatherRoof, meant),
    weather: weather ? { ...context.weather, condition: weather.label, text: weather.text, roofOnly: weatherRoof } : null,
    retrieval: { method: meant.length ? 'geo_keyword_retrieval_with_gemini_embeddings' : 'deterministic_geo_keyword_retrieval',
      usesEmbeddings: meant.length > 0, usesLanguageModel: false,
      summary: 'Фильтры по географии, категории, времени и режиму работы из OSM; поиск по словам, словарю ru/kk/en и намерениям запроса (ребёнок, ночь, турист, необычное, компания, коляска); объяснение по данным POI.'
        + (meant.length ? ' Слова запроса словарь не узнал, поэтому категорию определили эмбеддинги Gemini по примерам запросов.' : ''),
      semantic: meant.length ? { model: context.semantic.model ?? null, categories: meant, ranking: context.semantic.ranking ?? [] } : null,
      inputRecords: pois.length, validUniqueRecords: prepared.unique.length, feasibleCandidates: candidates.length, returned: recommendations.length,
      requestedCategories: requested, requestedKinds: kinds, excludedCategories: excluded, queryTerms: terms, rejected: counters,
      scoring: { category: 35, keywordsPerMatch: 5, keywordsCap: 20, proximityMax: 25, timeFitMax: 15, childCategory: 5, hoursConfirmed: 5,
        intentRange: [-32, 30], repeatCategoryPenalty: 8, repeatNamePenalty: 15,
        userRatings: { from: RATINGS.rankedFrom, prior: RATINGS.prior, priorWeight: RATINGS.priorWeight, range: [-RATINGS.maxBonus, RATINGS.maxBonus], used: Boolean(ratings) } },
      hoursReferenceTime: reference ? reference.toISOString() : null, hoursTimezone: 'UTC+05:00',
      scoreIsConfidence: false } };
}
