// Ratings of places by Aidem users: 1–5 stars, one per device per place, and the device can change or remove it.
// They are a separate signal from open data: the notability chip (Wikidata, Wikipedia, sources) is never mixed with them,
// and no rating is ever seeded. Rows live in the city's SQLite Durable Object next to friends and meetups;
// a rater is stored only as a hash of a random key that the browser made up, never a name or an address.
import { SocialError } from './social/store.mjs';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * shownFrom: an average is shown from this many ratings; below it the card says «мало оценок».
 * rankedFrom: from this many ratings the smoothed average nudges the order of the cards.
 * The smoothed (Bayesian) average counts priorWeight extra ratings of prior stars, so a few fives do not outrank everything;
 * the nudge is bonusPerStar points per star above or below the prior, at most maxBonus either way —
 * weaker than distance (up to 25) and the requested category (35).
 */
export const RATINGS = Object.freeze({ shownFrom: 3, rankedFrom: 5, prior: 3.5, priorWeight: 5, bonusPerStar: 4, maxBonus: 6 });

export const RATING_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS place_ratings (place_id TEXT NOT NULL, rater TEXT NOT NULL, stars INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (place_id, rater))`
];

/** What the public sees: the count always, the average only from RATINGS.shownFrom ratings. */
export function ratingSummary(count = 0, sum = 0) {
  const n = Number.isFinite(count) && count > 0 ? Math.round(count) : 0;
  const state = n === 0 ? 'none' : n < RATINGS.shownFrom ? 'few' : 'enough';
  return { count: n, average: state === 'enough' ? Math.round((sum / n) * 10) / 10 : null, state,
    influencesRanking: n >= RATINGS.rankedFrom, source: 'aidem_users', isOpenData: false };
}

/** Score points for ranking: 0 below RATINGS.rankedFrom ratings, otherwise the smoothed average's distance from the prior. */
export function ratingBonus(entry) {
  if (!entry || !(entry.count >= RATINGS.rankedFrom)) return 0;
  const smoothed = (RATINGS.prior * RATINGS.priorWeight + entry.sum) / (RATINGS.priorWeight + entry.count);
  const points = Math.round(RATINGS.bonusPerStar * (smoothed - RATINGS.prior));
  return Math.max(-RATINGS.maxBonus, Math.min(RATINGS.maxBonus, points)) || 0;
}

const fail = (status, code, message) => { throw new SocialError(status, code, message); };

/**
 * Synchronous operations over the hub's SQLite database, so inside the Durable Object each one is atomic.
 * limit(bucket, max, windowMs, now, message) is the hub's own rate limiter (it throws SocialError).
 */
export class RatingStore {
  constructor(db, { now = () => Date.now(), limit = () => {} } = {}) {
    this.db = db;
    this.now = now;
    this.limit = limit;
    for (const statement of RATING_SCHEMA) db.run(statement);
  }

  /** Returns { status, body }. Operations: ratings.rate, ratings.get, ratings.table. */
  handle(op, input = {}, meta = {}) {
    try {
      if (op === 'ratings.rate') return { status: 200, body: this.rate(input ?? {}, meta ?? {}) };
      if (op === 'ratings.get') return { status: 200, body: this.get(input?.ids) };
      if (op === 'ratings.table') return { status: 200, body: this.table() };
      fail(404, 'UNKNOWN_OPERATION', 'Неизвестное действие');
    } catch (error) {
      if (error instanceof SocialError) return { status: error.status, body: { error: error.message, code: error.code } };
      throw error;
    }
  }

  rate({ placeId, rater, stars }, meta) {
    if (typeof placeId !== 'string' || !placeId || placeId.length > 120) fail(400, 'INVALID_INPUT', 'Некорректное место');
    if (typeof rater !== 'string' || !/^[0-9a-f]{64}$/.test(rater)) fail(400, 'INVALID_INPUT', 'Некорректное устройство');
    if (stars !== null && !(Number.isInteger(stars) && stars >= 1 && stars <= 5)) fail(400, 'INVALID_INPUT', 'Оценка — от 1 до 5 звёзд');
    const now = this.now();
    const client = meta.client ?? 'anonymous';
    this.limit(`rate:${client}`, 60, HOUR, now, 'Слишком много оценок подряд. Попробуйте через час.');
    const existing = this.db.get('SELECT stars FROM place_ratings WHERE place_id = ? AND rater = ?', placeId, rater);
    if (stars === null) {
      if (existing) this.db.run('DELETE FROM place_ratings WHERE place_id = ? AND rater = ?', placeId, rater);
    } else if (existing) {
      this.db.run('UPDATE place_ratings SET stars = ?, updated_at = ? WHERE place_id = ? AND rater = ?', stars, now, placeId, rater);
    } else {
      // A new rater for this place: one address may add only a few a day, so clearing the browser does not stuff a place.
      this.limit(`rate-place:${client}:${placeId}`, 10, DAY, now, 'С этого адреса это место сегодня уже оценили много раз.');
      this.db.run('INSERT INTO place_ratings (place_id, rater, stars, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', placeId, rater, stars, now, now);
    }
    const row = this.db.get('SELECT COUNT(*) AS count, COALESCE(SUM(stars), 0) AS sum FROM place_ratings WHERE place_id = ?', placeId);
    return { placeId, mine: stars, count: Number(row?.count ?? 0), sum: Number(row?.sum ?? 0) };
  }

  get(ids) {
    const list = Array.isArray(ids) ? [...new Set(ids.filter(id => typeof id === 'string' && id && id.length <= 120))].slice(0, 30) : [];
    if (!list.length) return { rows: [] };
    const rows = this.db.all(`SELECT place_id AS id, COUNT(*) AS count, SUM(stars) AS sum FROM place_ratings WHERE place_id IN (${list.map(() => '?').join(', ')}) GROUP BY place_id`, ...list);
    return { rows: rows.map(row => [row.id, Number(row.count), Number(row.sum)]) };
  }

  /** Count and sum per rated place, for ranking; the Worker keeps a copy for half a minute. */
  table() {
    const rows = this.db.all('SELECT place_id AS id, COUNT(*) AS count, SUM(stars) AS sum FROM place_ratings GROUP BY place_id LIMIT 5000');
    return { rows: rows.map(row => [row.id, Number(row.count), Number(row.sum)]) };
  }
}
