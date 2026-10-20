import { fairMeetingPoints, MEETING_KINDS } from './meeting.mjs';
import { OPERATIONS, sha256 } from './store.mjs';
import { preparedPlaces, haversineMeters } from '../retrieval.mjs';

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin'
};
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: HEADERS });

// Read-only operations are GET with query parameters; everything that changes state is POST /api/social/<operation>.
const GET_OPS = { state: 'state', events: 'listEvents', event: 'getEvent', invite: 'previewInvite' };
const POST_OPS = new Set([...OPERATIONS.public, ...OPERATIONS.user].filter(op => !['state', 'listEvents', 'getEvent', 'previewInvite', 'meetingParticipants'].includes(op)));
const CITY_SHARD = 'astana';

/** The city's Durable Object in production; a local in-process hub in development and tests. */
export function socialHub(env = {}) {
  if (env.SOCIAL) return env.SOCIAL.get(env.SOCIAL.idFromName(CITY_SHARD));
  return env.SOCIAL_LOCAL ?? null;
}

async function call(hub, op, token, input, meta) {
  const response = await hub.fetch(new Request('https://social.internal/run', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, token, input, meta })
  }));
  if (!response.ok) throw new Error(`hub_${response.status}`);
  return response.json();
}

async function clientId(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0].trim() || 'anonymous';
  // Only a salted daily hash of the address reaches storage, and only inside rate-limit counters.
  return (await sha256(`${env.SOCIAL_SALT || env.GEMINI_API_KEY || 'seruen'}:${Math.floor(Date.now() / 86400000)}:${ip}`)).slice(0, 24);
}

const normalize = value => String(value ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[«»"'.,]/g, ' ').replace(/\s+/g, ' ').trim();
const searchIndex = new WeakMap();

function searchPlaces(url, dataset) {
  const query = normalize(url.searchParams.get('q')).slice(0, 60);
  if (query.length < 2) return json({ places: [] });
  const lat = Number(url.searchParams.get('lat')), lon = Number(url.searchParams.get('lon'));
  const hasCenter = Number.isFinite(lat) && Number.isFinite(lon);
  const places = preparedPlaces(dataset);
  let index = searchIndex.get(dataset);
  if (!index || index.length !== places.length) {
    index = places.map(poi => ({ poi, text: normalize([poi.name, poi.nameRu, poi.nameKk, poi.nameEn].filter(Boolean).join(' ')) }));
    searchIndex.set(dataset, index);
  }
  const matches = [];
  for (const entry of index) {
    const position = entry.text.indexOf(query);
    if (position === -1) continue;
    const distance = hasCenter ? haversineMeters(lat, lon, entry.poi.lat, entry.poi.lon) : 0;
    matches.push({ entry, rank: (position === 0 || entry.text[position - 1] === ' ' ? 0 : 1), distance });
  }
  matches.sort((a, b) => a.rank - b.rank || a.distance - b.distance);
  return json({ places: matches.slice(0, 8).map(({ entry, distance }) => ({ id: String(entry.poi.id), name: entry.poi.name, category: entry.poi.category,
    lat: entry.poi.lat, lon: entry.poi.lon, sourceUrl: entry.poi.sourceUrl, source: { label: entry.poi.source?.label || 'OpenStreetMap' }, ...(hasCenter ? { distanceMeters: Math.round(distance) } : {}) })) });
}

async function meetingPoint(hub, token, body, meta, dataset) {
  const kind = Object.hasOwn(MEETING_KINDS, body.kind) ? body.kind : 'any';
  const result = await call(hub, 'meetingParticipants', token, { userIds: body.userIds }, meta);
  if (result.status !== 200) return json(result.body, result.status);
  const { me, located, missing } = result.body;
  // The caller's current position may be sent for this one calculation; it is not stored.
  const here = body.me && Number.isFinite(Number(body.me.lat)) && Number.isFinite(Number(body.me.lon)) ? { lat: Number(body.me.lat), lon: Number(body.me.lon) } : null;
  const people = here ? [{ ...me, ...here, self: true }, ...located.filter(person => !person.self)] : located;
  if (people.length < 2) {
    return json({ error: 'Нужны хотя бы двое с известной точкой: вы и друг, который показывает, где он.', code: 'NOT_ENOUGH_PEOPLE', missing }, 409);
  }
  const at = typeof body.at === 'string' && Number.isFinite(Date.parse(body.at)) ? new Date(body.at) : new Date();
  const points = fairMeetingPoints(dataset, people, { kind, at });
  return json({ ...points, kind, participants: people.map(({ lat, lon, mode, ...person }) => person), missing });
}

export async function handleSocial(request, env, dataset) {
  const url = new URL(request.url);
  const name = url.pathname.slice('/api/social/'.length);
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return json({ error: 'Запрос должен исходить с сайта Aidem' }, 403);
  if (name === 'places') return request.method === 'GET' ? searchPlaces(url, dataset) : json({ error: 'Метод не поддерживается' }, 405);
  const hub = socialHub(env);
  if (!hub) return json({ error: 'Друзья и встречи на этом сервере выключены', code: 'SOCIAL_DISABLED' }, 503);
  const authorization = request.headers.get('Authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : null;
  let op, input = {};
  if (request.method === 'GET') {
    op = GET_OPS[name];
    if (!op) return json({ error: 'Не найдено' }, 404);
    input = Object.fromEntries([...url.searchParams].slice(0, 10));
  } else if (request.method === 'POST') {
    if (!POST_OPS.has(name) && name !== 'meeting-point') return json({ error: 'Не найдено' }, 404);
    if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return json({ error: 'Ожидается JSON' }, 415);
    if (Number(request.headers.get('Content-Length')) > 8192) return json({ error: 'Запрос слишком большой' }, 413);
    const raw = await request.text();
    if (raw.length > 8192) return json({ error: 'Запрос слишком большой' }, 413);
    try { input = raw ? JSON.parse(raw) : {}; } catch { return json({ error: 'Некорректный JSON' }, 400); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return json({ error: 'Ожидается объект JSON' }, 400);
    op = name;
  } else {
    return json({ error: 'Метод не поддерживается' }, 405);
  }
  try {
    const meta = { client: await clientId(request, env) };
    if (op === 'meeting-point') return await meetingPoint(hub, token, input, meta, dataset);
    const result = await call(hub, op, token, input, meta);
    return json(result.body, result.status);
  } catch (error) {
    console.error(JSON.stringify({ event: 'social_error', op, message: String(error?.message || 'Unknown').slice(0, 300) }));
    return json({ error: 'Сервис друзей временно недоступен. Попробуйте ещё раз.' }, 503);
  }
}
