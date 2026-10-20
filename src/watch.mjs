import { recommend } from './retrieval.mjs';

// Compact plans for the watch client and voice assistants. Deterministic only: no language model,
// so a glance on the wrist answers within one request and does not spend the Gemini quota.
const MOODS = {
  coffee: { query: 'Хочу выпить кофе и немного отдохнуть.' },
  park: { query: 'Погулять на свежем воздухе: парк, сквер или памятник.' },
  child: { query: 'Прогуляться с ребёнком: детская площадка, парк или сквер.', withChild: true },
  indoor: { query: 'Идёт дождь, хочу под крышу.' },
  food: { query: 'Хочу поесть или перекусить в кафе.' },
  sights: { query: 'Посмотреть город: достопримечательность, памятник или музей.' },
  any: { query: '' }
};
const LABELS = { park: 'парк', cafe: 'кафе', museum: 'музей', playground: 'детская площадка', attraction: 'достопримечательность',
  restaurant: 'где поесть', mall: 'торговый центр', culture: 'культурное место' };
const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' };

const buckets = new Map();
function allowed(ip) {
  const key = `${Math.floor(Date.now() / 60000)}:${ip}`;
  const used = (buckets.get(key) || 0) + 1;
  buckets.set(key, used);
  if (buckets.size > 5000) for (const old of buckets.keys()) if (!old.startsWith(`${Math.floor(Date.now() / 60000)}:`)) buckets.delete(old);
  return used <= 30;
}

export function plural(number, one, few, many) {
  const n = Math.abs(number) % 100, last = n % 10;
  if (n > 10 && n < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}
const minutes = number => `${number} ${plural(number, 'минуту', 'минуты', 'минут')}`;

// Astana is UTC+5 all year.
function astanaTime(date) {
  const local = new Date(date.getTime() + 5 * 3600000);
  return `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`;
}

export function spokenPlan(plan, now = new Date()) {
  const [first, ...rest] = plan.places;
  if (!first) return 'Рядом не нашлось мест, на которые хватит времени. Попробуйте дать прогулке больше времени.';
  const back = astanaTime(new Date(now.getTime() + first.totalMinutes * 60000));
  let text = `${first.name}, ${LABELS[first.category] || 'место'}. Идти примерно ${minutes(first.walkMinutes)}, `
    + `вся прогулка с дорогой обратно займёт примерно ${minutes(first.totalMinutes)}, вернётесь к ${back}.`;
  if (first.hours?.status === 'open' && first.hours.closesAt) text += ` По данным OpenStreetMap работает до ${first.hours.closesAt}.`;
  if (rest.length) text += ` Ещё: ${rest.map(place => `${place.name}, ${minutes(place.walkMinutes)} пешком`).join('; ')}.`;
  return text;
}

function failure(message, status, text) {
  // Voice assistants read the body aloud; an error status would only show a generic failure.
  if (text) return new Response(message, { status: 200, headers: { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8' } });
  return new Response(JSON.stringify({ error: message }), { status, headers: { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8' } });
}

export function handleWatch(request, env, pois) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/watch/plan') return null;
  const text = url.searchParams.get('format') === 'text';
  if (!['GET', 'HEAD'].includes(request.method)) return failure('Метод не поддерживается', 405, false);
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0].trim() || 'anonymous';
  if (!env.LOCAL_DEVELOPMENT && !allowed(ip)) return failure('Слишком много запросов. Попробуйте через минуту.', 429, text);
  // Shortcuts on iOS may send a comma as the decimal separator.
  const number = name => Number(String(url.searchParams.get(name) ?? '').replace(',', '.'));
  const mood = url.searchParams.get('mood') || 'any';
  if (!Object.hasOwn(MOODS, mood)) return failure('Неизвестное настроение прогулки.', 400, text);
  const query = [MOODS[mood].query, (url.searchParams.get('q') || '').slice(0, 200)].filter(Boolean).join(' ');
  const total = url.searchParams.has('minutes') ? number('minutes') : 45;
  const input = { lat: number('lat'), lon: number('lon'), minutes: total, query, category: 'any', returnToStart: true,
    maxWalkMinutes: Number.isFinite(total) ? Math.min(30, Math.max(5, Math.round(total / 3))) : 15,
    withChild: Boolean(MOODS[mood].withChild) || url.searchParams.get('child') === '1' };
  let result;
  try { result = recommend(pois, input); }
  catch (error) {
    if (error?.code !== 'INVALID_INPUT') throw error;
    const outside = /Широта|Долгота/.test(error.message);
    return failure(outside ? 'Seruen пока подбирает прогулки только в Астане.' : error.message, 400, text);
  }
  const plan = {
    start: { lat: input.lat, lon: input.lon }, minutes: total, mood, query,
    places: result.recommendations.map(place => ({
      id: place.id, name: place.name, category: place.category, lat: place.lat, lon: place.lon,
      distanceMeters: place.distanceMeters, walkMinutes: place.walkMinutes, visitMinutes: place.visitMinutes,
      returnMinutes: place.returnMinutes, totalMinutes: place.totalMinutes,
      hours: { status: place.hoursCheck?.status || 'no_data', closesAt: place.hoursCheck?.closesAt || null },
      sourceUrl: place.sourceUrl
    })),
    source: 'OpenStreetMap', license: 'ODbL-1.0', estimate: 'Время пешком — оценка по прямой ×1,35 при 4,2 км/ч, с резервом 5 минут.'
  };
  if (text) return new Response(spokenPlan(plan), { headers: { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8' } });
  return new Response(JSON.stringify(plan), { headers: { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8' } });
}
