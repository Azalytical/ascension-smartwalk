// Per-device preferences and history. Nothing here leaves the browser, except the rating key sent with a place rating.
const KEY = 'seruen:v1';
const defaults = { lang: null, theme: 'auto', start: null, recentStarts: [], saved: {}, history: [], walk: null, plan: null, onboarded: false,
  // Place ratings: a random key that identifies this device to /api/ratings (the server stores only its hash) and this device's own stars.
  rater: null, ratings: {} };
let state = load();

function load() {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { return { ...defaults }; }
}
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode: keep in memory */ }
}

export const bus = new EventTarget();
export const on = (type, handler) => { const listener = (event) => handler(event.detail); bus.addEventListener(type, listener); return () => bus.removeEventListener(type, listener); };
export const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));

export const get = (key) => state[key];
export function set(key, value) {
  state = { ...state, [key]: value };
  persist();
  emit(`store:${key}`, value);
}

export function toggleSaved(place) {
  const saved = { ...state.saved };
  if (saved[place.id]) delete saved[place.id];
  else saved[place.id] = { id: place.id, name: place.name, category: place.category, lat: place.lat, lon: place.lon, savedAt: Date.now() };
  set('saved', saved);
  return Boolean(saved[place.id]);
}
export const isSaved = (id) => Boolean(state.saved[id]);

export function addHistory(entry) {
  set('history', [{ ...entry, at: Date.now() }, ...state.history.filter((item) => item.key !== entry.key)].slice(0, 12));
}
export function rememberStart(start) {
  if (!start || start.kind === 'gps') return;
  set('recentStarts', [start, ...state.recentStarts.filter((item) => item.name !== start.name)].slice(0, 4));
}
