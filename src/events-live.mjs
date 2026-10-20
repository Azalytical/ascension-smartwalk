/**
 * The Worker collects the sxodim.com listing for Astana itself, once a day (Cron Trigger at 05:50 Astana time) and
 * again whenever the stored copy is more than a day old. One Durable Object does the collection in small steps woken by
 * its alarm: one listing page per step, then the venues of 15 events per step, so each step stays inside the CPU budget
 * of a Workers Free invocation. A collection is kept only when it finds at least 8 dated events and 5 venues on the map;
 * otherwise, and until the first one succeeds, the saved snapshot in data/events.json is used.
 */
import { CITY_EVENTS, EVENTS_COLLECTED_AT } from './events.mjs';
import { parseListing } from './events-sxodim.mjs';
import { placeEvent, shareAddresses } from './events-venues.mjs';

// The listing in pages, then the categories it may leave out. Paging stops at the first page with nothing new.
export const LISTING_PAGES = ['afisha', 'afisha?page=2', 'afisha?page=3', 'afisha?page=4', 'afisha?page=5', 'afisha?page=6',
  'events/kontserty', 'events/teatr', 'events/vystavki', 'events/dlya-detey', 'events/festivali', 'events/stand-up'];
const PAGE_DELAY_MS = 2000;
const PLACE_BATCH = 15;
const RUN_TIMEOUT_MS = 20 * 60000;
const STALE_MS = 26 * 3600000;
const RETRY_AFTER_MS = 3600000;
// Raised with every change to the parser or the venue placement: a listing read by an older version is collected again
// on the next visit after the deploy, instead of waiting for the morning run.
export const PARSER_VERSION = 2;
const MIN_DATED = 8;
const MIN_LOCATED = 5;
const MAX_EVENTS = 200;
const USER_AGENT = 'AidemBot/1.0 (+https://ascension-smartwalk.azamatbreach.workers.dev; walks in Astana, links every event to its sxodim.com page)';

const astanaDay = time => new Date(time + 5 * 3600000).toISOString().slice(0, 10);

// The place base and its ready-made venue index, handed over by the Worker entry (scripts/build.mjs) or by the tests.
let base = { places: [], venues: null };
export function prepareCityEvents(dataset, venues = null) {
  base = { places: Array.isArray(dataset) ? dataset : dataset?.pois || [], venues };
}

async function startRun(storage, now, reason) {
  const run = await storage.get('run');
  if (run && now - run.startedAt < RUN_TIMEOUT_MS) return false;
  await storage.put('run', { startedAt: now, reason, queue: [...LISTING_PAGES], rows: [], events: [], pages: [] });
  await storage.setAlarm(now + 100);
  return true;
}

const LISTING_BASE = 'https://sxodim.com/astana/';
// A local copy of the listing for trying the collection under `wrangler dev`; nothing else is accepted.
const listingBase = value => (/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\//.test(String(value || '')) ? String(value) : LISTING_BASE);

async function fetchPage(path, fetcher, base = LISTING_BASE) {
  try {
    const response = await fetcher(`${base}${path}`, { redirect: 'follow', signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html', 'Accept-Language': 'ru-RU,ru;q=0.9' } });
    if (!response.ok) return { status: response.status, rows: [], error: `http_${response.status}` };
    return { status: response.status, rows: parseListing(await response.text()) };
  } catch (error) {
    return { status: 0, rows: [], error: error?.name === 'TimeoutError' ? 'timeout' : String(error?.message || 'fetch_failed').slice(0, 120) };
  }
}

/**
 * One step of a collection run kept in `storage` under 'run'. Returns the delay before the next step, or null when
 * the run is over (its result is then in 'live' when it succeeded, and in 'status' either way).
 */
export async function collectStep(storage, { fetcher = fetch, now = Date.now(), places = base.places, venues = base.venues, listing = LISTING_BASE } = {}) {
  const run = await storage.get('run');
  if (!run) return null;
  if (run.queue.length) {
    const path = run.queue.shift();
    const page = await fetchPage(path, fetcher, listing);
    const known = new Set(run.rows.map(row => row.url));
    const fresh = page.rows.filter(row => !known.has(row.url)).slice(0, Math.max(0, MAX_EVENTS - run.rows.length));
    run.rows.push(...fresh);
    run.pages.push({ path, status: page.status, cards: page.rows.length, added: fresh.length, ...(page.error ? { error: page.error } : {}) });
    if (path.startsWith('afisha') && !fresh.length) run.queue = run.queue.filter(next => !next.startsWith('afisha'));
    // The site refuses or is down: no point in asking for the other pages.
    if (run.pages.length >= 2 && run.pages.every(item => item.error)) run.queue = [];
    await storage.put('run', run);
    return PAGE_DELAY_MS;
  }
  const collectedAt = astanaDay(run.startedAt);
  if (run.events.length < run.rows.length) {
    const batch = run.rows.slice(run.events.length, run.events.length + PLACE_BATCH);
    run.events.push(...batch.map(row => placeEvent(row, places, { collectedAt, venues })));
    await storage.put('run', run);
    return 100;
  }
  const events = shareAddresses(run.events).filter(event => event.when);
  const located = events.filter(event => Number.isFinite(event.lat));
  const fetchedAt = new Date(now).toISOString();
  const failed = run.pages.filter(item => item.error).length;
  const stats = { pages: run.pages.length, failedPages: failed, cards: run.rows.length, dated: events.length, located: located.length };
  const ok = events.length >= MIN_DATED && located.length >= MIN_LOCATED;
  if (ok) await storage.put('live', { collectedAt, fetchedAt, parser: PARSER_VERSION, stats, events: located });
  await storage.put('status', { at: fetchedAt, startedAt: new Date(run.startedAt).toISOString(), reason: run.reason, ok,
    ...(ok ? {} : { problem: failed === run.pages.length ? run.pages[0]?.error || 'fetch_failed' : 'too_few_events' }), stats, pages: run.pages });
  await storage.delete('run');
  return null;
}

/** Keeps the collected listing and runs the collection. One instance for Astana. */
export class CityEventsStore {
  constructor(ctx, env, options = {}) {
    this.ctx = ctx;
    this.env = env;
    this.options = { ...(env?.EVENTS_LISTING_BASE ? { listing: listingBase(env.EVENTS_LISTING_BASE) } : {}), ...options };
  }

  async fetch(request) {
    const { pathname } = new URL(request.url);
    const storage = this.ctx.storage;
    const now = this.options.now ?? Date.now();
    if (pathname === '/refresh' && request.method === 'POST') return Response.json({ started: await startRun(storage, now, 'schedule') });
    if (pathname !== '/current') return new Response('Not found', { status: 404 });
    const [live, status] = await Promise.all([storage.get('live'), storage.get('status')]);
    // A missed or failed daily run is made up on the next visit, at most once an hour.
    const outdated = Boolean(live) && live.parser !== PARSER_VERSION;
    const stale = !live || outdated || now - Date.parse(live.fetchedAt) > STALE_MS;
    // After a failed attempt the next one waits an hour; a listing read by an older parser is collected again at once.
    const waiting = status && !status.ok && now - Date.parse(status.at) < RETRY_AFTER_MS;
    if (stale && !waiting) await startRun(storage, now, !live ? 'first' : outdated ? 'parser' : 'stale');
    return Response.json({ live: live ?? null,
      lastAttempt: status ? { at: status.at, ok: status.ok, reason: status.reason, problem: status.problem ?? null, stats: status.stats } : null });
  }

  async alarm() {
    const delay = await collectStep(this.ctx.storage, this.options);
    if (delay !== null) await this.ctx.storage.setAlarm(Date.now() + delay);
  }
}

/** In-process stand-in for `npm run dev` and tests: the same class, storage in memory, the alarm on a timer unless `manual`. */
export function localCityEvents({ manual = false, env = {}, ...options } = {}) {
  const data = new Map();
  let timer = null;
  const storage = {
    alarmAt: null,
    get: async key => structuredClone(data.get(key)),
    put: async (key, value) => { data.set(key, structuredClone(value)); },
    delete: async key => data.delete(key),
    setAlarm: async at => {
      storage.alarmAt = at;
      if (manual) return;
      clearTimeout(timer);
      timer = setTimeout(() => { storage.alarmAt = null; store.alarm().catch(() => {}); }, Math.max(0, at - Date.now()));
      timer.unref?.();
    }
  };
  const store = new CityEventsStore({ storage }, env, options);
  store.storage = storage;
  return store;
}

export function cityEventsStore(env) {
  if (env?.CITY_EVENTS_STORE) return env.CITY_EVENTS_STORE.get(env.CITY_EVENTS_STORE.idFromName('astana'));
  return env?.CITY_EVENTS_LOCAL ?? null;
}

/** Cron Trigger: start today's collection. */
export async function refreshCityEvents(env) {
  const store = cityEventsStore(env);
  if (!store) return null;
  return (await store.fetch(new Request('https://events.internal/refresh', { method: 'POST' }))).json();
}

const SNAPSHOT = Object.freeze({ mode: 'snapshot', events: CITY_EVENTS, collectedAt: EVENTS_COLLECTED_AT, fetchedAt: null, stats: null, lastAttempt: null });

// The events in use, cached per isolate for five minutes. A slow or missing store never holds up a walk: after the
// timeout the last copy, or the snapshot, is used. The snapshot also wins when it was collected later than the store.
const STATE_TTL = 5 * 60000;
const RETRY_TTL = 60000;
const states = new WeakMap();
export async function cityEventsState(env = {}, { timeoutMs = 700 } = {}) {
  const store = cityEventsStore(env);
  if (!store || !env || typeof env !== 'object') return SNAPSHOT;
  const cached = states.get(env);
  if (cached && Date.now() - cached.at < cached.ttl) return cached.state;
  let timer;
  try {
    const response = await Promise.race([store.fetch(new Request('https://events.internal/current')),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); })]);
    if (!response.ok) throw new Error(`events_${response.status}`);
    const { live, lastAttempt } = await response.json();
    const state = live?.events?.length && live.collectedAt >= EVENTS_COLLECTED_AT
      ? { mode: 'live', events: live.events, collectedAt: live.collectedAt, fetchedAt: live.fetchedAt, stats: live.stats, lastAttempt }
      : { ...SNAPSHOT, lastAttempt };
    // Until the first collection lands, ask again after a minute.
    states.set(env, { at: Date.now(), ttl: state.mode === 'live' ? STATE_TTL : RETRY_TTL, state });
    return state;
  } catch {
    const state = cached?.state ?? SNAPSHOT;
    states.set(env, { at: Date.now(), ttl: RETRY_TTL, state });
    return state;
  } finally { clearTimeout(timer); }
}
