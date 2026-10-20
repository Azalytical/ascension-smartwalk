/**
 * City events from the sxodim.com listing for Astana («Сегодня в городе»). Events change and get cancelled, so every
 * event carries its source page and the note to check the time there; nothing here says that tickets are available.
 * The listing is collected into data/events.json by scripts/build_events.mjs; venues get coordinates only from a place
 * in our own base (same name or same address), never from a guess.
 */
import { haversineMeters } from './retrieval.mjs';
import listing from '../data/events.json' with { type: 'json' };

/** The collected listing: events whose venue is on the map. */
export const CITY_EVENTS = listing.events;
export const EVENTS_COLLECTED_AT = listing.source.collectedAt;

// Same walking model as the walk plan: straight line × 1.35 at 4.2 km/h.
const DETOUR = 1.35;
const METERS_PER_MINUTE = 4.2 * 1000 / 60;
const MONTHS = { января: 1, февраля: 2, марта: 3, апреля: 4, мая: 5, июня: 6, июля: 7, августа: 8, сентября: 9, октября: 10, ноября: 11, декабря: 12 };
export const EVENT_SOURCE = { id: 'sxodim', label: 'sxodim.com', url: 'https://sxodim.com/astana/afisha' };
export const EVENT_NOTE = 'Из афиши sxodim.com: время и билеты уточняйте на странице события.';

const pad = number => String(number).padStart(2, '0');
const isoDay = (year, month, day) => `${year}-${pad(month)}-${pad(day)}`;

/**
 * When an event runs, from the date text of the listing: «31 октября в 17:00», «18 октября - 28 ноября»,
 * «20 октября и 27 октября». The listing gives no year: dates are taken in the collection year, and a range that ends
 * before it starts ends the next year. Null when the listing gives no date.
 */
export function parseWhen(text, year) {
  const dates = [...String(text || '').matchAll(/(\d{1,2})\s+([а-я]+)/giu)]
    .map(([, day, month]) => ({ day: Number(day), month: MONTHS[month.toLowerCase()] })).filter(date => date.month && date.day >= 1 && date.day <= 31);
  if (!dates.length) return null;
  const time = String(text).match(/(?:^|\s)в\s+(\d{1,2}):(\d{2})/u);
  const at = time ? `${pad(time[1])}:${time[2]}` : null;
  if (/\d\s+[а-я]+\s*[-–—]\s*\d/iu.test(text) && dates.length === 2) {
    const [from, to] = dates;
    const toYear = to.month < from.month ? year + 1 : year;
    return { from: isoDay(year, from.month, from.day), to: isoDay(toYear, to.month, to.day), time: at };
  }
  return { dates: dates.map(date => isoDay(year, date.month, date.day)), time: at };
}

/** Astana calendar day and minutes since midnight (UTC+5 all year). */
function astanaClock(now) {
  const local = new Date(now.getTime() + 5 * 3600000);
  return { day: local.toISOString().slice(0, 10), minutes: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

// Bars, stand-up and quiz nights are not suggested for a walk with a child.
const ADULT = /бар\b|бар[ауе]?\s|pub|паб|lounge|клуб|стендап|stand.?up|квиз|quiz|18\+/i;

const runsOn = (when, day) => (when.dates ? when.dates.includes(day) : when.from <= day && day <= when.to);

/**
 * Events today within walking reach of the start: up to `limit`, those with a start time first.
 * An event with a time is kept until 15 minutes after its start (its length is not in the listing).
 */
export function cityEventsFor(events, { lat, lon, minutes = 60, maxWalkMinutes, withChild = false, now = new Date(), limit = 3 } = {}) {
  if (!Array.isArray(events) || !Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  const clock = astanaClock(now);
  const reach = Math.min(Number.isFinite(maxWalkMinutes) ? maxWalkMinutes : 30, Math.floor(minutes / 2));
  const found = [];
  for (const event of events) {
    if (!event.when || !Number.isFinite(event.lat) || !runsOn(event.when, clock.day)) continue;
    if (withChild && ADULT.test(`${event.title} ${event.category} ${event.venue}`)) continue;
    const walkMinutes = Math.max(1, Math.ceil(haversineMeters(lat, lon, event.lat, event.lon) * DETOUR / METERS_PER_MINUTE));
    if (walkMinutes > reach) continue;
    let startsInMinutes = null;
    if (event.when.time) {
      const [hours, mins] = event.when.time.split(':').map(Number);
      startsInMinutes = hours * 60 + mins - clock.minutes;
      if (startsInMinutes < -15) continue;
    }
    // A start that you reach on foot and can still stay for before heading back.
    const fitsWindow = startsInMinutes === null || (startsInMinutes >= walkMinutes && startsInMinutes + walkMinutes <= minutes);
    found.push({ ...view(event), lat: event.lat, lon: event.lon, walkMinutes, startsInMinutes, fitsWindow,
      whenLabel: event.when.time ? `сегодня в ${event.when.time}` : event.when.to ? `в афише до ${humanDay(event.when.to)}, время уточняйте` : 'сегодня, время уточняйте' });
  }
  return found.sort((a, b) => (a.startsInMinutes === null) - (b.startsInMinutes === null) || (a.startsInMinutes ?? 0) - (b.startsInMinutes ?? 0)
    || a.walkMinutes - b.walkMinutes).slice(0, limit);
}

/** Events that run on any of the next `days` days and have a place on the map, for the map layer. */
export function upcomingEvents(events, { now = new Date(), days = 7 } = {}) {
  const first = astanaClock(now).day;
  const last = astanaClock(new Date(now.getTime() + (days - 1) * 86400000)).day;
  return (Array.isArray(events) ? events : []).filter(event => event.when && Number.isFinite(event.lat)
    && (event.when.dates ? event.when.dates.some(day => first <= day && day <= last) : event.when.from <= last && first <= event.when.to))
    .map(event => ({ ...view(event), lat: event.lat, lon: event.lon }));
}

const view = event => ({ id: event.id, title: event.title, category: event.category, dateText: event.dateText, when: event.when, venue: event.venue,
  address: event.address, price: event.price, url: event.url, source: EVENT_SOURCE.label, note: EVENT_NOTE });

const MONTH_NAMES = Object.keys(MONTHS);
function humanDay(iso) {
  const [, month, day] = iso.split('-').map(Number);
  return `${day} ${MONTH_NAMES[month - 1]}`;
}
