/**
 * Minimal evaluator for the OSM opening_hours subset found in data/pois.json.
 * Supported: "24/7", "closed"/"off", weekday ranges and lists, several time spans, spans past midnight.
 * Anything else (PH, SH, months, sunrise, comments) is reported as unknown, never guessed.
 */
const DAYS = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'];
const DAY_RE = '(?:mo|tu|we|th|fr|sa|su)';
const SELECTOR = new RegExp(`^${DAY_RE}(?:-${DAY_RE})?(?:,${DAY_RE}(?:-${DAY_RE})?)*$`);
const SPAN = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/;
// Astana has used UTC+5 all year since 1 March 2024.
const OFFSET_MINUTES = 5 * 60;

function daysOf(selector) {
  const days = new Set();
  for (const part of selector.split(',')) {
    const [from, to = from] = part.split('-').map(day => DAYS.indexOf(day));
    for (let i = from; ; i = (i + 1) % 7) { days.add(i); if (i === to) break; }
  }
  return days;
}

function spansOf(text) {
  const spans = [];
  for (const part of text.split(',')) {
    const match = SPAN.exec(part.trim());
    if (!match) return null;
    const [h1, m1, h2, m2] = match.slice(1).map(Number);
    if (h1 > 24 || h2 > 48 || m1 > 59 || m2 > 59) return null;
    const start = h1 * 60 + m1;
    let end = h2 * 60 + m2;
    if (end <= start) end += 24 * 60;
    spans.push([start, end]);
  }
  return spans;
}

/** Parse into one entry per weekday (Monday = 0): a list of [start, end] minute spans, possibly past 24:00. */
export function parseOpeningHours(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase()
    .replace(/\s*-\s*(?=\d)/g, '-')
    // "Mo-Th 11:00-23:00, Fr,Sa 12:00-24:00": a comma after a time starts a new rule.
    .replace(/(?<=\d)\s*,\s*(?=(?:mo|tu|we|th|fr|sa|su|ph)[a-z,\s-]*\d)/g, '; ')
    .replace(/,\s+(?=(?:mo|tu|we|th|fr|sa|su|ph)\b)/g, ',')
    // Public holidays are not modelled; the remaining weekday rules still apply.
    .replace(/(?:^|(?<=[;\s]))ph,|,ph\b/g, '');
  if (!text || text.length > 200) return null;
  if (text === '24/7') return Array.from({ length: 7 }, () => [[0, 24 * 60]]);
  const week = Array.from({ length: 7 }, () => []);
  // OSM semantics: a later rule replaces earlier rules for the days it names.
  for (const rule of text.split(';').map(r => r.trim()).filter(Boolean)) {
    const [first, ...rest] = rule.split(/\s+/);
    const hasDays = SELECTOR.test(first);
    const body = (hasDays ? rest.join(' ') : rule).trim();
    const days = hasDays ? daysOf(first) : new Set(DAYS.keys());
    let spans;
    if (body === 'off' || body === 'closed') spans = [];
    else if (body === '24/7' || body === '00:00-24:00') spans = [[0, 24 * 60]];
    else spans = spansOf(body);
    if (!spans) return null;
    for (const day of days) week[day] = spans;
  }
  return week;
}

function localParts(date) {
  const local = new Date(date.getTime() + OFFSET_MINUTES * 60000);
  return { day: (local.getUTCDay() + 6) % 7, minute: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

function clock(minutes) {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * Check a visit window against recorded hours.
 * Returns { status: 'open' | 'closed' | 'closes_early' | 'unknown', closesAt?, opensAt? }.
 * 'open' means the whole window from arrival to departure falls inside a recorded span.
 */
export function checkVisit(openingHours, arrival, stayMinutes) {
  const week = parseOpeningHours(openingHours);
  if (!week) return { status: 'unknown' };
  const { day, minute } = localParts(arrival);
  // A span from the previous day may continue past midnight.
  const windows = [
    ...week[(day + 6) % 7].map(([s, e]) => [s - 1440, e - 1440]),
    ...week[day],
  ];
  const current = windows.find(([s, e]) => minute >= s && minute < e);
  if (!current) {
    const next = week[day].map(([s]) => s).filter(s => s > minute).sort((a, b) => a - b)[0];
    return { status: 'closed', ...(next !== undefined ? { opensAt: clock(next) } : {}) };
  }
  const roundTheClock = current[1] - current[0] >= 1440;
  if (roundTheClock) return { status: 'open', closesAt: null };
  if (minute + stayMinutes > current[1]) return { status: 'closes_early', closesAt: clock(current[1]) };
  return { status: 'open', closesAt: clock(current[1]) };
}
