// Deep links into Google Maps, 2GIS and Google Calendar. Plain URLs: no API key, no request from the server,
// and nothing reaches Google or 2GIS until the visitor taps a link.

const point = place => `${Number(place.lat).toFixed(6)},${Number(place.lon).toFixed(6)}`;

// Astana is UTC+5 all year.
function astanaClock(date) {
  const local = new Date(date.getTime() + 5 * 3600000);
  return `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`;
}

const calendarTime = date => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** A walk as a Google Calendar event: leave now (or at the requested time), come back with the 5-minute reserve. */
export function calendarLink(place, { start = new Date(), sourceLabel = 'OpenStreetMap' } = {}) {
  const total = Number(place.totalMinutes);
  if (!Number.isFinite(total) || total <= 0) return null;
  // Round up to the next 5 minutes so the event does not start in the past.
  const begin = new Date(Math.ceil(start.getTime() / 300000) * 300000);
  const end = new Date(begin.getTime() + total * 60000);
  const parts = [`Прогулка Ulger: ${place.name}.`];
  if (Number.isFinite(place.walkMinutes)) {
    parts.push(`Туда ~${place.walkMinutes} мин, на месте ~${place.visitMinutes} мин`
      + (place.returnMinutes ? `, обратно ~${place.returnMinutes} мин` : '') + ', запас 5 мин.');
  }
  parts.push(`Вернуться к ${astanaClock(end)} (Астана). Время — оценка, не обещание.`);
  if (place.sourceUrl) parts.push(`Источник данных: ${sourceLabel}, ${place.sourceUrl}`);
  parts.push(`Маршрут пешком: ${mapLinks(place).googleMapsWalk}`);
  const query = new URLSearchParams({ action: 'TEMPLATE', text: `Ulger: ${place.name}`, dates: `${calendarTime(begin)}/${calendarTime(end)}`,
    details: parts.join('\n'), location: point(place), ctz: 'Asia/Almaty' });
  return `https://calendar.google.com/calendar/render?${query}`;
}

/** Where the place is, and walking directions from wherever the visitor is. */
export function mapLinks(place) {
  const destination = point(place);
  return {
    googleMaps: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destination)}`,
    // No origin: the maps app starts from the visitor's own position on their device, so Ulger never writes it into a link.
    googleMapsWalk: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=walking`,
    twoGis: `https://2gis.kz/astana/directions/points/%7C${Number(place.lon).toFixed(6)}%2C${Number(place.lat).toFixed(6)}`
  };
}

/** All links for one recommended place. */
export function placeLinks(place, options = {}) {
  const calendar = calendarLink(place, options);
  return { ...mapLinks(place), ...(calendar ? { googleCalendar: calendar } : {}) };
}
