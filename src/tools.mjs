// One set of tools over the Aidem place base, shared by the MCP server (/mcp) and the Gemini agent (/api/agent).
// Every tool is deterministic and read-only except get_weather, which asks Open-Meteo for the weather around a rounded point.
import { recommend, preparedPlaces, haversineMeters, VISIT } from './retrieval.mjs';
import { checkVisit } from './hours.mjs';
import { placeLinks, mapLinks } from './links.mjs';
import { astanaWeather } from './weather.mjs';

export const CATEGORIES = Object.keys(VISIT);
const DETOUR = 1.35, SPEED_M_PER_MIN = 4200 / 60, RESERVE = 5;
// Places come from OpenStreetMap and Overture Maps; each place carries its own source label.
const SOURCE = { sources: 'OpenStreetMap, Overture Maps', licenses: 'ODbL-1.0 (OpenStreetMap), CDLA-Permissive-2.0 (Overture Maps)' };
const sourceOf = poi => poi.source?.label || 'OpenStreetMap';
const BOUNDS = { minLat: 51, maxLat: 51.35, minLon: 71.25, maxLon: 71.65 };

export class ToolError extends Error {}

const walkMinutes = meters => Math.ceil(meters * DETOUR / SPEED_M_PER_MIN);
const normalize = value => String(value ?? '').toLocaleLowerCase('ru').normalize('NFKC').replace(/ё/g, 'е');

function number(args, name, { min, max, fallback, required = false }) {
  const raw = args?.[name];
  if (raw === undefined || raw === null || raw === '') {
    if (required) throw new ToolError(`Нужен параметр ${name}.`);
    return fallback;
  }
  const value = Number(String(raw).replace(',', '.'));
  if (!Number.isFinite(value) || value < min || value > max) throw new ToolError(`${name}: допустимо от ${min} до ${max}.`);
  return value;
}

function location(args, required) {
  const lat = number(args, 'lat', { min: BOUNDS.minLat, max: BOUNDS.maxLat, required });
  const lon = number(args, 'lon', { min: BOUNDS.minLon, max: BOUNDS.maxLon, required });
  if ((lat === undefined) !== (lon === undefined)) throw new ToolError('Передайте lat и lon вместе.');
  return lat === undefined ? null : { lat, lon };
}

function visitTime(args) {
  const raw = args?.visit_time;
  if (raw === undefined || raw === null || raw === '') return null;
  const date = new Date(String(raw));
  if (Number.isNaN(date.getTime())) throw new ToolError('visit_time: нужна дата и время ISO 8601, например 2026-10-20T18:30:00+05:00.');
  return date;
}

function category(args) {
  const value = args?.category;
  if (value === undefined || value === null || value === '' || value === 'any') return null;
  if (!CATEGORIES.includes(value)) throw new ToolError(`category: одно из ${CATEGORIES.join(', ')}.`);
  return value;
}

const indexes = new WeakMap();
function index(dataset) {
  const places = preparedPlaces(dataset);
  let cached = indexes.get(dataset);
  if (!cached || cached.places.length !== places.length) {
    cached = { places, byId: new Map(places.map(poi => [String(poi.id), poi])),
      names: places.map(poi => [poi.name, poi.nameRu, poi.nameKk, poi.nameEn].filter(Boolean).map(normalize)),
      // Words match at word starts: "хан" must not find "кітапхана".
      text: places.map(poi => ' ' + normalize([poi.name, poi.nameRu, poi.nameKk, poi.nameEn, poi.description, poi.tags?.cuisine].filter(Boolean).join(' ')).replace(/[^\p{L}\p{N}]+/gu, ' ')) };
    indexes.set(dataset, cached);
  }
  return cached;
}

function hoursAt(poi, arrival, stay) {
  if (!poi.openingHours) return { status: 'no_data' };
  return checkVisit(poi.openingHours, arrival, stay);
}

function brief(poi, extra = {}) {
  return { id: String(poi.id), name: poi.name, category: poi.category, lat: poi.lat, lon: poi.lon, ...extra,
    openingHours: poi.openingHours || null, dataSource: sourceOf(poi), sourceUrl: poi.sourceUrl, links: mapLinks(poi) };
}

function planWalk(args, { dataset, now }) {
  const start = location(args, true);
  const minutes = number(args, 'minutes', { min: 10, max: 180, fallback: 60 });
  const at = visitTime(args);
  const query = typeof args?.query === 'string' ? args.query.slice(0, 300) : '';
  let result;
  try {
    result = recommend(dataset, { ...start, minutes, query, category: category(args) || 'any', withChild: Boolean(args?.with_child),
      returnToStart: args?.return_to_start !== false, maxWalkMinutes: number(args, 'max_walk_minutes', { min: 1, max: 60, fallback: Math.min(30, Math.max(5, Math.round(minutes / 3))) }),
      ...(at ? { visitDate: at.toISOString() } : {}) });
  } catch (error) {
    if (error?.code === 'INVALID_INPUT') throw new ToolError(error.message);
    throw error;
  }
  const begin = at || now;
  return {
    start, minutes, query,
    places: result.recommendations.map(p => ({ id: String(p.id), name: p.name, category: p.category, lat: p.lat, lon: p.lon,
      distanceMeters: p.distanceMeters, walkMinutes: p.walkMinutes, visitMinutes: p.visitMinutes, returnMinutes: p.returnMinutes,
      totalMinutes: p.totalMinutes, hours: { status: p.hoursCheck?.status || 'no_data', closesAt: p.hoursCheck?.closesAt ?? null },
      why: p.why, ...(p.plan?.text ? { plan: p.plan.text } : {}), ...(p.confidence ? { confidence: { level: p.confidence.level, reasons: p.confidence.reasons } } : {}),
      ...(p.notability && p.notability.level !== 'low' ? { notability: p.notability.label } : {}),
      activities: p.activities, warnings: p.warnings.slice(0, 2), dataSource: sourceOf(p), sourceUrl: p.sourceUrl,
      links: placeLinks(p, { start: begin, sourceLabel: sourceOf(p) }) })),
    ...(result.route ? { microRoute: { summary: result.route.summary, totalMinutes: result.route.totalMinutes, stops: result.route.stops.map(stop => ({ id: String(stop.id), name: stop.name, category: stop.category })) } } : {}),
    ...(result.nearestBeyondLimits ? { nearestBeyondLimits: { id: String(result.nearestBeyondLimits.id), name: result.nearestBeyondLimits.name, category: result.nearestBeyondLimits.category,
      walkMinutes: result.nearestBeyondLimits.walkMinutes, neededMinutes: result.nearestBeyondLimits.neededMinutes } } : {}),
    ...(Array.isArray(result.understood) ? { understood: result.understood.map(item => item.label) } : {}),
    ...(result.unconfirmed?.length ? { unconfirmed: result.unconfirmed } : {}),
    ...(result.beyondWalk ? { beyondWalk: { name: result.beyondWalk.name, category: result.beyondWalk.category,
      distanceKm: Math.round(result.beyondWalk.distanceMeters / 100) / 10, walkMinutes: result.beyondWalk.walkMinutes, needsTransport: true } } : {}),
    notes: result.warnings, rejected: result.retrieval.rejected, ...SOURCE,
    method: 'Отбор по расстоянию, категории, времени и часам работы из OSM; время пешком — оценка по прямой ×1,35 при 4,2 км/ч, резерв 5 минут.'
  };
}

function searchPlaces(args, { dataset, now }) {
  const { places, text, names } = index(dataset);
  const near = location(args, false);
  const kind = category(args);
  const limit = Math.round(number(args, 'limit', { min: 1, max: 10, fallback: 6 }));
  const phrase = normalize(args?.query).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const words = phrase.match(/[\p{L}\p{N}]{2,}/gu) ?? [];
  if (!words.length && !kind && !near) throw new ToolError('Передайте query, category или lat и lon.');
  const found = [];
  for (let i = 0; i < places.length; i++) {
    const poi = places[i];
    if (kind && poi.category !== kind) continue;
    const hits = words.filter(word => text[i].includes(` ${word}`)).length;
    if (words.length && hits < Math.min(words.length, 2)) continue;
    const distance = near ? haversineMeters(near.lat, near.lon, poi.lat, poi.lon) : null;
    if (near && !words.length && distance > 3000) continue;
    // An exact name beats a name that contains the words, which beats a match in the description.
    const variants = names[i].map(name => name.replace(/[^\p{L}\p{N}]+/gu, ' ').trim());
    const nameRank = phrase && variants.includes(phrase) ? 2 : words.length && variants.some(name => words.every(word => ` ${name}`.includes(` ${word}`))) ? 1 : 0;
    found.push({ poi, hits, distance, nameRank });
  }
  // Near a point, only an exact name outranks distance: "кофе" should list the closest coffee first.
  const rank = near ? item => Number(item.nameRank === 2) : item => item.nameRank;
  found.sort((a, b) => rank(b) - rank(a) || (near ? a.distance - b.distance : b.hits - a.hits) || a.poi.name.localeCompare(b.poi.name, 'ru'));
  return { query: args?.query ?? null, category: kind, total: found.length,
    places: found.slice(0, limit).map(({ poi, distance }) => brief(poi, {
      ...(distance === null ? {} : { distanceMeters: Math.round(distance), walkMinutes: walkMinutes(distance) }),
      hoursNow: hoursAt(poi, now, VISIT[poi.category]) })), ...SOURCE };
}

function placeDetails(args, { dataset, now }) {
  const id = String(args?.id ?? '').trim();
  const poi = index(dataset).byId.get(id);
  if (!poi) throw new ToolError('Место с таким id не найдено. Возьмите id из search_places или plan_walk.');
  const at = visitTime(args) || now;
  const tags = poi.tags && !Array.isArray(poi.tags) ? poi.tags : {};
  const address = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(', ') || null;
  const facts = Object.fromEntries(Object.entries({
    address: poi.address || address, phone: poi.phone || tags['contact:phone'] || tags.phone, website: poi.website || tags['contact:website'] || tags.website,
    instagram: tags['contact:instagram'], cuisine: tags.cuisine, wheelchair: typeof poi.wheelchair === 'string' ? poi.wheelchair : tags.wheelchair, outdoorSeating: tags.outdoor_seating, internetAccess: tags.internet_access,
    wikidata: tags.wikidata, wikipedia: tags.wikipedia
  }).filter(([, value]) => typeof value === 'string' && value));
  return { ...brief(poi), description: poi.description || null, typicalVisitMinutes: VISIT[poi.category],
    hours: { checkedFor: at.toISOString(), ...hoursAt(poi, at, VISIT[poi.category]) }, facts,
    retrievedAt: poi.retrievedAt || null, factsAreFromSource: true, ...SOURCE };
}

function buildRoute(args, { dataset, now }) {
  const start = location(args, true);
  const minutes = number(args, 'minutes', { min: 15, max: 240, fallback: 120 });
  const ids = Array.isArray(args?.place_ids) ? [...new Set(args.place_ids.map(String))] : [];
  if (ids.length < 2 || ids.length > 3) throw new ToolError('place_ids: от 2 до 3 мест.');
  const { byId } = index(dataset);
  const stops = ids.map(id => byId.get(id));
  if (stops.some(stop => !stop)) throw new ToolError('Одно из мест не найдено. Возьмите id из search_places или plan_walk.');
  const back = args?.return_to_start !== false;
  const begin = visitTime(args) || now;
  // At most 3 stops: try every order and keep the shortest walk.
  const orders = stops.length === 2 ? [[0, 1], [1, 0]] : [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  const walkOf = order => {
    let from = start, total = 0;
    for (const i of order) { total += walkMinutes(haversineMeters(from.lat, from.lon, stops[i].lat, stops[i].lon)); from = stops[i]; }
    return total + (back ? walkMinutes(haversineMeters(from.lat, from.lon, start.lat, start.lon)) : 0);
  };
  const best = orders.reduce((a, b) => walkOf(b) < walkOf(a) ? b : a);
  let clock = begin.getTime(), from = start, walking = 0, visiting = 0;
  const legs = [];
  for (const i of best) {
    const poi = stops[i];
    const walk = walkMinutes(haversineMeters(from.lat, from.lon, poi.lat, poi.lon));
    clock += walk * 60000;
    const stay = VISIT[poi.category];
    legs.push({ ...brief(poi), walkMinutes: walk, visitMinutes: stay, arriveAt: new Date(clock).toISOString(), hours: hoursAt(poi, new Date(clock), stay) });
    clock += stay * 60000; walking += walk; visiting += stay; from = poi;
  }
  const returnMinutes = back ? walkMinutes(haversineMeters(from.lat, from.lon, start.lat, start.lon)) : 0;
  const totalMinutes = walking + returnMinutes + visiting + RESERVE;
  const closed = legs.filter(leg => ['closed', 'closes_early'].includes(leg.hours.status)).map(leg => leg.name);
  const points = [start, ...best.map(i => stops[i]), ...(back ? [start] : [])];
  // Google Maps takes the waypoints between origin and destination; the start stays out of the link when the walk is one-way.
  const route = back
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${start.lat},${start.lon}`)}&waypoints=${encodeURIComponent(best.map(i => `${stops[i].lat},${stops[i].lon}`).join('|'))}&travelmode=walking`
    : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${stops[best.at(-1)].lat},${stops[best.at(-1)].lon}`)}&waypoints=${encodeURIComponent(best.slice(0, -1).map(i => `${stops[i].lat},${stops[i].lon}`).join('|'))}&travelmode=walking`;
  return { stops: legs, walkMinutes: walking + returnMinutes, visitMinutes: visiting, returnMinutes, reserveMinutes: RESERVE, totalMinutes,
    fits: totalMinutes <= minutes && !closed.length, minutes, closedOnArrival: closed,
    finishAt: new Date(begin.getTime() + totalMinutes * 60000).toISOString(), path: points.map(p => [p.lat, p.lon]),
    googleMapsRoute: route, ...SOURCE,
    method: 'Порядок с самой короткой ходьбой из всех вариантов; время пешком — оценка по прямой ×1,35 при 4,2 км/ч; часы проверены на момент прихода.' };
}

async function getWeather(args, { fetchImpl, now }) {
  const near = location(args, false);
  return astanaWeather(near || {}, { ...(fetchImpl ? { fetchImpl } : {}), now });
}

const lat = { type: 'number', description: 'Широта точки в Астане (51.0–51.35).' };
const lon = { type: 'number', description: 'Долгота точки в Астане (71.25–71.65).' };
const visit_time = { type: 'string', description: 'Когда начать, ISO 8601 с часовым поясом, например 2026-10-20T18:30:00+05:00. По умолчанию сейчас.' };
const categoryField = { type: 'string', enum: CATEGORIES, description: 'Категория: park, cafe, museum, playground, attraction, restaurant (поесть), mall, culture (театр, кино, библиотека), family (семейный отдых), nightlife (бары и пабы).' };

export const TOOLS = [
  { name: 'plan_walk', title: 'Подобрать прогулку',
    description: 'Подбирает до 3 отдельных мест рядом с точкой старта, на которые хватит времени: дорога туда, время на месте, дорога обратно и запас 5 минут. Отсеивает места, закрытые к моменту прихода по часам работы из источника. Для каждого места даёт «почему», план с часами, уверенность, предупреждения, источник и ссылки Google Maps, 2ГИС и Google Календарь.',
    inputSchema: { type: 'object', properties: { lat, lon,
      minutes: { type: 'number', description: 'Сколько всего времени на прогулку, минут (10–180). По умолчанию 60.' },
      query: { type: 'string', description: 'Пожелание своими словами на русском, казахском или английском: «тихое кафе», «с ребёнком», «под крышей».' },
      category: categoryField,
      with_child: { type: 'boolean', description: 'С ребёнком: только парки и детские площадки.' },
      max_walk_minutes: { type: 'number', description: 'Сколько максимум идти в одну сторону, минут.' },
      return_to_start: { type: 'boolean', description: 'Нужно ли вернуться к точке старта. По умолчанию да.' }, visit_time },
    required: ['lat', 'lon'] }, run: planWalk },
  { name: 'search_places', title: 'Найти места',
    description: 'Ищет места в базе Aidem (места Астаны из OpenStreetMap и Overture Maps) по названию или словам, категории и близости к точке. Возвращает координаты, расстояние, часы работы и статус по часам на сейчас.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Название или слова: «Хан Шатыр», «кофе», «пицца».' },
      category: categoryField, lat, lon, limit: { type: 'number', description: 'Сколько мест вернуть, 1–10. По умолчанию 6.' } } }, run: searchPlaces },
  { name: 'place_details', title: 'Подробно о месте',
    description: 'Всё, что известно о месте из источника (OpenStreetMap или Overture Maps): описание, адрес, контакты, кухня, Wi-Fi, доступность для коляски, часы работы и проверка, открыто ли место на заданное время с обычной длительностью визита.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'id места из search_places или plan_walk, например osm:node:123.' }, visit_time },
      required: ['id'] }, run: placeDetails },
  { name: 'build_route', title: 'Мини-маршрут',
    description: 'Собирает мини-маршрут из 2–3 мест: выбирает порядок с самой короткой ходьбой, считает время каждого отрезка, время на местах и возвращение, проверяет часы работы на момент прихода и говорит, помещается ли маршрут в заданное время. Даёт ссылку на весь маршрут в Google Maps.',
    inputSchema: { type: 'object', properties: { lat, lon, place_ids: { type: 'array', items: { type: 'string' }, description: '2–3 id мест.' },
      minutes: { type: 'number', description: 'Сколько всего времени, минут (15–240). По умолчанию 120.' },
      return_to_start: { type: 'boolean', description: 'Вернуться к старту. По умолчанию да.' }, visit_time },
    required: ['lat', 'lon', 'place_ids'] }, run: buildRoute },
  { name: 'get_weather', title: 'Погода сейчас',
    description: 'Погода в Астане сейчас по Open-Meteo: температура, как ощущается, ветер, осадки, закат и совет, стоит ли выбирать места под крышей. Координаты округляются примерно до 5 км.',
    inputSchema: { type: 'object', properties: { lat, lon } }, run: getWeather, network: true }
];

const byName = new Map(TOOLS.map(tool => [tool.name, tool]));

/** Run a tool by name. Throws ToolError for bad arguments, which callers show to the model or client as a tool error. */
export async function runTool(name, args, context) {
  const tool = byName.get(name);
  if (!tool) throw new ToolError(`Неизвестный инструмент ${name}.`);
  if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) throw new ToolError('Аргументы должны быть объектом.');
  return tool.run(args ?? {}, { now: new Date(), ...context });
}
