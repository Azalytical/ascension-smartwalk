// Builds data/events.json, the saved snapshot of the sxodim.com listing, from the rows in data/events-sxodim.txt.
// The Worker collects the listing itself every day (src/events-live.mjs); this snapshot is what it shows until the
// first collection succeeds, and whenever a collection fails. Venues are placed the same way (src/events-venues.mjs).
// Usage: node scripts/build_events.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { EVENT_SOURCE } from '../src/events.mjs';
import { placeEvents } from '../src/events-venues.mjs';

const root = new URL('..', import.meta.url);
const places = JSON.parse(readFileSync(new URL('data/places.json', root), 'utf8'));
const text = readFileSync(new URL('data/events-sxodim.txt', root), 'utf8');
const collectedAt = text.match(/^# collected: (\d{4}-\d{2}-\d{2})/m)?.[1];
if (!collectedAt) throw new Error('data/events-sxodim.txt needs a "# collected: YYYY-MM-DD" line');

const rows = text.split('\n').filter(line => line.trim() && !line.startsWith('#')).map(line => {
  const [title, category, dateText, venue, address, price, url] = line.split(' | ').map(value => value.trim()).map(value => (value === '-' ? null : value));
  if (!title || !url?.startsWith('https://sxodim.com/')) throw new Error(`bad row: ${line}`);
  return { title, category, dateText, venue, address, price, url };
});
const events = placeEvents(rows, places, { collectedAt });

const located = events.filter(event => Number.isFinite(event.lat));
writeFileSync(new URL('data/events.json', root), `${JSON.stringify({ source: { ...EVENT_SOURCE, collectedAt,
  note: 'Название, дата, площадка, адрес и цена как в афише sxodim.com; координаты только у площадок, найденных в базе мест.' },
  events: located, unlocated: events.filter(event => !Number.isFinite(event.lat)).map(event => ({ title: event.title, venue: event.venue, address: event.address })) }, null, 1)}\n`);
console.log(JSON.stringify({ rows: events.length, located: located.length, by: located.reduce((all, event) => ({ ...all, [event.located]: (all[event.located] || 0) + 1 }), {}),
  undated: events.filter(event => !event.when).length }));
