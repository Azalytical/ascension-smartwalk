// GET /api/ratings?ids=…, POST /api/ratings, and the rating table that ranking reads.
// The browser sends a random device key it made up; only its SHA-256 reaches storage. No profile or name is needed.
import { ratingSummary, RATINGS } from './ratings.mjs';
import { socialHub } from './social/routes.mjs';
import { sha256 } from './social/store.mjs';

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin'
};
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: HEADERS });

export const RATINGS_ABOUT = Object.freeze({
  source: 'aidem_users', isOpenData: false, oneRatingPerDevice: true, seeded: false,
  averageShownFrom: RATINGS.shownFrom, influencesRankingFrom: RATINGS.rankedFrom,
  ranking: `Сглаженное среднее: к оценкам добавляются ${RATINGS.priorWeight} условных оценок ${String(RATINGS.prior).replace('.', ',')}; `
    + `сдвиг не больше ±${RATINGS.maxBonus} баллов, слабее расстояния и категории.`
});

async function call(hub, op, input, meta = {}) {
  const response = await hub.fetch(new Request('https://social.internal/run', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, token: null, input, meta })
  }));
  if (!response.ok) throw new Error(`hub_${response.status}`);
  return response.json();
}

const placeIds = new WeakMap();
function knownIds(dataset) {
  const pois = Array.isArray(dataset) ? dataset : dataset?.pois || [];
  let ids = placeIds.get(pois);
  if (!ids) { ids = new Set(pois.map(poi => String(poi.id))); placeIds.set(pois, ids); }
  return ids;
}

// Ranking reads every rated place's count and sum, cached per isolate for half a minute. A slow or missing hub
// never holds up a walk: after the timeout the last copy (or none) is used and the order is as without ratings.
const TABLE_TTL = 30_000;
const tables = new WeakMap();
export async function placeRatings(env = {}, { timeoutMs = 700 } = {}) {
  const hub = socialHub(env);
  if (!hub || !env || typeof env !== 'object') return null;
  const cached = tables.get(env);
  if (cached && Date.now() - cached.at < TABLE_TTL) return cached.map;
  let timer;
  try {
    const result = await Promise.race([call(hub, 'ratings.table', {}),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); })]);
    if (result.status !== 200 || !Array.isArray(result.body?.rows)) throw new Error('table');
    const map = new Map(result.body.rows.map(([id, count, sum]) => [String(id), { count: Number(count), sum: Number(sum) }]));
    tables.set(env, { at: Date.now(), map });
    return map;
  } catch {
    return cached?.map ?? null;
  } finally { clearTimeout(timer); }
}

async function clientId(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0].trim() || 'anonymous';
  // Only a salted daily hash of the address reaches storage, and only inside rate-limit counters.
  return (await sha256(`${env.SOCIAL_SALT || env.GEMINI_API_KEY || 'seruen'}:${Math.floor(Date.now() / 86400000)}:${ip}`)).slice(0, 24);
}

const reads = new Map();
function readAllowed(request) {
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0].trim() || 'anonymous';
  const minute = Math.floor(Date.now() / 60000);
  const key = `${minute}:${ip}`;
  const used = (reads.get(key) || 0) + 1;
  reads.set(key, used);
  if (reads.size > 5000) for (const old of reads.keys()) if (!old.startsWith(`${minute}:`)) reads.delete(old);
  return used <= 120;
}

export async function handleRatings(request, env, dataset) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return json({ error: 'Запрос должен исходить с сайта Aidem' }, 403);
  const hub = socialHub(env);
  if (!hub) return json({ error: 'Оценки на этом сервере выключены', code: 'RATINGS_DISABLED' }, 503);
  const known = knownIds(dataset);
  try {
    if (request.method === 'GET') {
      if (!env.LOCAL_DEVELOPMENT && !readAllowed(request)) return json({ error: 'Слишком много запросов. Попробуйте через минуту.' }, 429);
      const ids = [...new Set(String(url.searchParams.get('ids') || '').split(',').map(id => id.trim()).filter(id => known.has(id)))].slice(0, 30);
      const result = ids.length ? await call(hub, 'ratings.get', { ids }) : { status: 200, body: { rows: [] } };
      if (result.status !== 200) return json(result.body, result.status);
      const found = new Map(result.body.rows.map(([id, count, sum]) => [id, ratingSummary(count, sum)]));
      return json({ ratings: Object.fromEntries(ids.map(id => [id, found.get(id) ?? ratingSummary(0, 0)])), about: RATINGS_ABOUT });
    }
    if (request.method !== 'POST') return json({ error: 'Метод не поддерживается' }, 405);
    if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return json({ error: 'Ожидается JSON' }, 415);
    if (Number(request.headers.get('Content-Length')) > 1024) return json({ error: 'Запрос слишком большой' }, 413);
    const raw = await request.text();
    if (raw.length > 1024) return json({ error: 'Запрос слишком большой' }, 413);
    let body;
    try { body = JSON.parse(raw); } catch { return json({ error: 'Некорректный JSON' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Ожидается объект JSON' }, 400);
    const placeId = typeof body.placeId === 'string' ? body.placeId : '';
    if (!known.has(placeId)) return json({ error: 'Место не найдено' }, 404);
    if (typeof body.device !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(body.device)) return json({ error: 'Некорректный ключ устройства' }, 400);
    const stars = body.stars === null ? null : body.stars;
    if (stars !== null && !(Number.isInteger(stars) && stars >= 1 && stars <= 5)) return json({ error: 'Оценка — от 1 до 5 звёзд' }, 400);
    const rater = await sha256(`aidem-rating:${body.device}`);
    const result = await call(hub, 'ratings.rate', { placeId, rater, stars }, { client: await clientId(request, env) });
    if (result.status !== 200) return json(result.body, result.status);
    const { count, sum } = result.body;
    // This isolate's ranking copy sees the new rating at once; others within half a minute.
    tables.get(env)?.map.set(placeId, { count, sum });
    if (count === 0) tables.get(env)?.map.delete(placeId);
    return json({ placeId, mine: result.body.mine, rating: ratingSummary(count, sum), about: RATINGS_ABOUT });
  } catch (error) {
    console.error(JSON.stringify({ event: 'ratings_error', message: String(error?.message || 'Unknown').slice(0, 300) }));
    return json({ error: 'Оценки временно недоступны. Попробуйте ещё раз.' }, 503);
  }
}
