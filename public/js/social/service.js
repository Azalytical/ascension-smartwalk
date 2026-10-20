// Social state for the whole page: profile token, polling, and the location share that keeps running
// while the person uses other tabs. Screens subscribe with onChange(); nothing here touches the DOM.
import { coarse } from '../core/privacy.js';
import { t, lang } from '../core/i18n.js';
import './strings.js';

const TOKEN_KEY = 'seruen.social.token';
const FAST_POLL = 10_000;
const SLOW_POLL = 45_000;
const PUBLISH_EVERY = 10_000;

const listeners = new Set();
const state = {
  token: readToken(), me: null, data: null, events: [], eventsLoadedAt: 0,
  loading: false, error: null, offline: false, geo: { watching: false, error: null, last: null }, focused: false
};
let pollTimer = null;
let watchId = null;
let lastPublish = 0;
let pendingPoint = null;
let seenNotifications = null;

function readToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
function writeToken(token) {
  state.token = token;
  try { token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY); } catch { /* private mode: the session still works until reload */ }
}

function emit(reason) {
  for (const listener of listeners) {
    try { listener(state, reason); } catch (error) { console.error(error); }
  }
}

export function onChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getState() { return state; }

// The server answers in Russian; in Kazakh and English the text comes from the error code.
function errorText(body) {
  if (body?.error && (lang() === 'ru' || body.local)) return body.error;
  const key = `sx.err.${body?.code}`;
  return body?.code && t(key) !== key ? t(key) : t('sx.err.generic');
}

export class ApiError extends Error {
  constructor(status, body) {
    super(errorText(body));
    this.status = status;
    this.code = body?.code;
    this.body = body;
  }
}

export async function api(path, body) {
  const headers = {};
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(`/api/social/${path}`, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  } catch {
    state.offline = true;
    throw new ApiError(0, { error: t('sx.err.offline'), local: true });
  }
  state.offline = false;
  let data = null;
  try { data = await response.json(); } catch { data = null; }
  if (response.status === 401 && state.token && path !== 'register') {
    // The profile was deleted or the token revoked on another device.
    writeToken(null);
    state.me = null; state.data = null;
    stopWatching();
    emit('signed-out');
  }
  if (!response.ok) throw new ApiError(response.status, data);
  return data;
}

export function signedIn() { return Boolean(state.token); }

export async function register(name, emoji) {
  const result = await api('register', { name, emoji });
  writeToken(result.token);
  state.me = result.me;
  await refresh();
  return result.me;
}

export async function claimDevice(code) {
  const result = await api('claimDevice', { code });
  writeToken(result.token);
  state.me = result.me;
  await refresh();
  return result.me;
}

export async function signOut({ deleteAccount = false } = {}) {
  try { await api(deleteAccount ? 'deleteAccount' : 'logout', {}); } catch { /* the local token is dropped either way */ }
  stopWatching();
  writeToken(null);
  state.me = null; state.data = null; seenNotifications = null;
  emit('signed-out');
}

function newNotifications(data) {
  const ids = new Set(data.notifications.map(item => item.id));
  if (seenNotifications === null) { seenNotifications = ids; return []; }
  const fresh = data.notifications.filter(item => !seenNotifications.has(item.id) && !item.read);
  seenNotifications = ids;
  return fresh;
}

export async function refresh() {
  if (!state.token) { emit('state'); return null; }
  state.loading = true;
  try {
    const data = await api('state');
    state.data = data;
    state.me = data.me;
    state.error = null;
    syncWatcher();
    const fresh = newNotifications(data);
    emit('state');
    if (fresh.length) emit({ type: 'notifications', items: fresh });
    return data;
  } catch (error) {
    state.error = error.message;
    emit('error');
    return null;
  } finally {
    state.loading = false;
  }
}

export async function loadEvents(force = false) {
  if (!force && Date.now() - state.eventsLoadedAt < 20_000) return state.events;
  try {
    const result = await api('events');
    state.events = result.events;
    state.eventsLoadedAt = Date.now();
    emit('events');
  } catch (error) {
    state.error = error.message;
    emit('error');
  }
  return state.events;
}

/** Calls an action, then refreshes state so every screen shows the result. */
export async function act(op, body = {}) {
  const result = await api(op, body);
  if (result?.event) {
    const index = state.events.findIndex(event => event.id === result.event.id);
    if (index >= 0) state.events[index] = result.event; else state.events.unshift(result.event);
  }
  await refresh();
  return result;
}

// ---- location sharing ----

function sharing() { return Boolean(state.data?.share); }

function publish(point, force = false) {
  pendingPoint = point;
  const now = Date.now();
  if (!force && now - lastPublish < PUBLISH_EVERY) return;
  lastPublish = now;
  const { lat, lon, accuracy } = pendingPoint;
  // «Примерно» is rounded here, so the exact point never leaves the phone; only «Точно», chosen by the person, sends it as is.
  const approximate = state.data?.share?.mode !== 'precise';
  const sent = approximate ? { lat: coarse(lat), lon: coarse(lon), accuracy: Math.max(150, accuracy || 0) } : { lat, lon, accuracy };
  api('publishLocation', sent).then(result => {
    if (state.data) state.data.share = result.share;
    emit('share');
  }).catch(error => {
    if (error.code === 'SHARE_INACTIVE') { stopWatching(); refresh(); }
  });
}

function startWatching() {
  if (watchId !== null || !('geolocation' in navigator)) {
    if (!('geolocation' in navigator)) { state.geo.error = t('sx.geo.unsupported'); emit('geo'); }
    return;
  }
  state.geo.watching = true;
  state.geo.error = null;
  watchId = navigator.geolocation.watchPosition(position => {
    const point = { lat: position.coords.latitude, lon: position.coords.longitude, accuracy: Math.round(position.coords.accuracy || 0) || null };
    const first = !state.geo.last;
    state.geo.last = { ...point, at: Date.now() };
    state.geo.error = null;
    publish(point, first);
    emit('geo');
  }, error => {
    state.geo.error = t(error.code === 1 ? 'sx.geo.denied' : 'sx.geo.failed');
    emit('geo');
  }, { enableHighAccuracy: true, maximumAge: 15_000, timeout: 30_000 });
}

function stopWatching() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  state.geo.watching = false;
}

/** The share lives on the server; this device keeps sending points only while the share is active and the page is open. */
function syncWatcher() {
  if (sharing()) startWatching(); else stopWatching();
}

export async function startShare(options) {
  const result = await api('startShare', { ...options, consent: true });
  if (state.data) state.data.share = result.share;
  lastPublish = 0;
  startWatching();
  if (state.geo.last) publish(state.geo.last, true);
  await refresh();
  return result.share;
}

export async function stopShare() {
  stopWatching();
  await api('stopShare', {});
  await refresh();
}

/** One-off position for "where should we meet" without starting a share. */
export function currentPosition() {
  if (state.geo.last && Date.now() - state.geo.last.at < 60_000) return Promise.resolve(state.geo.last);
  return new Promise(resolve => {
    if (!('geolocation' in navigator)) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(position => {
      state.geo.last = { lat: position.coords.latitude, lon: position.coords.longitude, accuracy: position.coords.accuracy, at: Date.now() };
      resolve(state.geo.last);
    }, () => resolve(null), { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 });
  });
}

// ---- polling ----

function schedule() {
  clearTimeout(pollTimer);
  if (!state.token) return;
  const interval = document.visibilityState === 'visible' && (state.focused || sharing()) ? FAST_POLL : SLOW_POLL;
  pollTimer = setTimeout(async () => { await refresh(); schedule(); }, interval);
}

/** The friends screen asks for fast updates while it is on screen. */
export function setFocused(focused) {
  state.focused = focused;
  schedule();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.token) refresh();
  schedule();
});

export function start() {
  if (state.token) refresh().then(schedule);
  else emit('state');
}

// ---- helpers shared by screens ----

const DETOUR = 1.35, METERS_PER_MINUTE = 4200 / 60;
export function distanceMeters(a, b) {
  const rad = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lon - a.lon) * rad / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
export function walkMinutes(a, b) { return Math.max(1, Math.round(distanceMeters(a, b) * DETOUR / METERS_PER_MINUTE)); }
