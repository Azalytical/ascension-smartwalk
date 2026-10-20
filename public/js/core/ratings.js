// Aidem users' ratings of places. Anyone can read them; this device rates with a random key it made up once,
// and the server keeps only a hash of it. The device remembers its own stars so the card can show them.
import * as store from './store.js';

const TTL = 60000;
const cache = new Map();

function deviceKey() {
  let key = store.get('rater');
  if (!key) {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    key = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    store.set('rater', key);
  }
  return key;
}

export const mine = (id) => store.get('ratings')?.[id] ?? null;

export function remember(id, rating) {
  if (id && rating && Number.isFinite(rating.count)) cache.set(String(id), { at: Date.now(), rating });
}

/** The last known summary and whether it is younger than a minute. A summary sent with a walk (place.userRating) counts
 * only when nothing newer is known: a rating given since then must not be replaced by the walk's older copy. */
export function cached(id, fallback = null) {
  const entry = cache.get(String(id));
  if (!entry && fallback && Number.isFinite(fallback.count)) return { rating: fallback, fresh: false };
  return entry ? { rating: entry.rating, fresh: Date.now() - entry.at < TTL } : { rating: null, fresh: false };
}

/** Summaries for up to 30 places: { [id]: { count, average, state } }. Missing ids are places the server does not know. */
export async function ratingsFor(ids) {
  const wanted = [...new Set(ids.map(String))].filter(Boolean);
  const fresh = {};
  const missing = [];
  for (const id of wanted) {
    const entry = cache.get(id);
    if (entry && Date.now() - entry.at < TTL) fresh[id] = entry.rating;
    else missing.push(id);
  }
  if (missing.length) {
    const response = await fetch(`/api/ratings?ids=${missing.slice(0, 30).map(encodeURIComponent).join(',')}`);
    if (!response.ok) throw new Error(`ratings_${response.status}`);
    const data = await response.json();
    for (const [id, rating] of Object.entries(data.ratings || {})) { remember(id, rating); fresh[id] = rating; }
  }
  return fresh;
}

/** stars 1–5, or null to remove this device's rating. Returns the place's new summary. */
export async function rate(id, stars) {
  const response = await fetch('/api/ratings', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ placeId: String(id), stars, device: deviceKey() }) });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.rating) throw new Error(data?.error || `ratings_${response.status}`);
  const own = { ...(store.get('ratings') || {}) };
  if (data.mine) own[id] = data.mine; else delete own[id];
  store.set('ratings', own);
  remember(id, data.rating);
  return data.rating;
}
