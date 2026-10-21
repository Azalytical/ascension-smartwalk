// «Что-то пошло не так» during a walk, worked out on the phone from the place list: nothing here is sent anywhere.
// The promised «вернётесь к» stays: a new place must fit the way there from where the person is, the visit and the way
// back to the start before that time, and the walk's reserve stays on top. With nothing that fits, the answer is when
// the person would be back by turning round now. A one-way walk (walk.oneWay) has no way back: a new place must fit
// the way there and the visit before the promised «закончите к».
import { haversine, walkMinutes, VISIT } from './geo.js';

const INDOOR = ['mall', 'museum', 'cafe', 'restaurant', 'culture'];
// For a closed place: the same category first, then the nearest kin («кафе закрыто» → another café, then a restaurant).
const KIN = { cafe: ['cafe', 'restaurant'], restaurant: ['restaurant', 'cafe'], park: ['park', 'attraction'], attraction: ['attraction', 'park', 'museum'],
  museum: ['museum', 'culture', 'attraction'], culture: ['culture', 'museum'], playground: ['playground', 'park', 'family'], family: ['family', 'playground'],
  mall: ['mall'], nightlife: ['nightlife', 'restaurant'] };
const MAX_WALK = 30;
const SHOWN = 3;

const backMinutes = (walk) => walk.plan.there + walk.plan.visit + walk.plan.back;

/** Whole minutes from now to the promised «вернётесь к». */
export const minutesLeft = (walk, now) => Math.floor((walk.startedAt + backMinutes(walk) * 60000 - now) / 60000);

/** Where the person is: a fresh fix, else by the plan — at the place once there, partway along the current leg before. */
export function whereNow(walk, now, fix = null) {
  if (fix && now - fix.at < 120000) return { lat: fix.lat, lon: fix.lon };
  if (walk.phase !== 'there') return { lat: walk.place.lat, lon: walk.place.lon };
  const from = walk.from || walk.start;
  const share = Math.min(1, Math.max(0, (now - (walk.legAt || walk.startedAt)) / 60000 / Math.max(1, walk.legMinutes || walk.plan.there)));
  return { lat: from.lat + (walk.place.lat - from.lat) * share, lon: from.lon + (walk.place.lon - from.lon) * share };
}

/**
 * Up to three places that still fit before the promised time. `reason` is 'closed' (kin of the closed place) or 'rain'
 * (under a roof). `hoursAt(openingHours, arrival, visitMinutes)` is the shared hours parser; places closed at arrival are left out.
 */
export function alternatives(walk, items, { reason, here, now, hoursAt }) {
  const left = minutesLeft(walk, now);
  const wanted = reason === 'rain' ? INDOOR : KIN[walk.place.category] || [walk.place.category];
  const skip = new Set([String(walk.place.id), ...(walk.skipped || [])]);
  const options = [];
  for (const place of items) {
    if (skip.has(String(place.id)) || !wanted.includes(place.category)) continue;
    const there = walkMinutes(haversine(here.lat, here.lon, place.lat, place.lon));
    if (there > MAX_WALK) continue;
    const visit = VISIT[place.category] ?? 20;
    const back = walk.oneWay ? 0 : walkMinutes(haversine(place.lat, place.lon, walk.start.lat, walk.start.lon));
    if (there + visit + back > left) continue;
    let hours = null;
    if (place.openingHours) {
      try { hours = hoursAt(place.openingHours, new Date(now + there * 60000), visit); } catch { hours = null; }
    }
    if (hours && ['closed', 'closes_early'].includes(hours.status)) continue;
    options.push({ place, there, visit, back, open: hours?.status === 'open', closesAt: hours?.closesAt ?? null });
  }
  // A closed place is replaced by its own kind first; in the rain an open door matters most. Then confirmed hours, then the nearest.
  const kinship = (option) => (reason === 'rain' ? 0 : wanted.indexOf(option.place.category));
  options.sort((a, b) => kinship(a) - kinship(b) || Number(b.open) - Number(a.open) || a.there - b.there || String(a.place.id).localeCompare(String(b.place.id)));
  const backNow = walkMinutes(haversine(here.lat, here.lon, walk.start.lat, walk.start.lon));
  return { left, options: options.slice(0, SHOWN), backNow, lateBy: Math.max(0, backNow - left) };
}

/** The walk with a new place: the elapsed minutes stay in «there», so the clock times and the reserve keep counting from the start. */
export function switchTo(walk, option, { here, now }) {
  const elapsed = Math.max(0, Math.ceil((now - walk.startedAt) / 60000));
  const plan = { ...walk.plan, there: elapsed + option.there, visit: option.visit, back: option.back };
  plan.reserve = plan.total - backMinutes({ plan });
  const { id, name, category, lat, lon } = option.place;
  return { ...walk, place: { id, name, category, lat, lon }, from: { lat: here.lat, lon: here.lon }, legAt: now, legMinutes: option.there,
    phase: 'there', phaseAt: { there: walk.startedAt }, alerted: false, promised: null, backFrom: null,
    skipped: [...(walk.skipped || []), String(walk.place.id)], plan };
}

/** Turning round now: no more visit, the way back from where the person is. */
export function turnBack(walk, { here, now }) {
  const elapsed = Math.max(0, Math.ceil((now - walk.startedAt) / 60000));
  const back = walkMinutes(haversine(here.lat, here.lon, walk.start.lat, walk.start.lon));
  const plan = { ...walk.plan, there: walk.phase === 'there' ? elapsed : walk.plan.there, visit: walk.phase === 'there' ? 0 : Math.max(0, elapsed - walk.plan.there), back };
  plan.reserve = plan.total - backMinutes({ plan });
  return { ...walk, phase: 'back', phaseAt: { ...walk.phaseAt, back: now }, backFrom: { lat: here.lat, lon: here.lon }, promised: null, alerted: true, plan };
}

/**
 * Running late by `minutes`. On the way there the visit gives the minutes back, so «вернётесь к» holds while it can;
 * on site the visit grows. Returns the new walk and what changed: `kept` (same time back), `later` (minutes later),
 * `over` (minutes beyond the reserve, 0 when the reserve still covers it).
 */
export function runLate(walk, minutes = 15) {
  const plan = { ...walk.plan };
  let later = minutes;
  if (walk.phase === 'there') {
    const cut = Math.min(plan.visit, minutes);
    plan.there += minutes;
    plan.visit -= cut;
    later = minutes - cut;
  } else plan.visit += minutes;
  plan.reserve = plan.total - backMinutes({ plan });
  const legMinutes = walk.phase === 'there' ? (walk.legMinutes || walk.plan.there) + minutes : walk.legMinutes;
  return { walk: { ...walk, plan, legMinutes, promised: later ? null : walk.promised, alerted: later ? false : walk.alerted }, kept: later === 0, later, over: Math.max(0, -plan.reserve),
    visitBefore: walk.plan.visit, visitAfter: plan.visit };
}
