// Pieces shared by the walk, nearby and saved screens: category art, opening-hours status, navigation links, sharing.
import { h, icon } from '../core/dom.js';
import { speakText, stopSpeaking, unlockAudio } from '../core/media.js';
import { t, time, lang } from '../core/i18n.js';
import { checkVisit } from '../lib/hours.mjs';
import { toast } from './toast.js';

export const CATEGORY_ART = { cafe: 'coffee', restaurant: 'food', park: 'park', playground: 'family', museum: 'museum', attraction: 'landmark', mall: 'indoor', culture: 'museum', family: 'family', nightlife: 'food' };
export const CATEGORY_COLOR = { cafe: '--cat-cafe', restaurant: '--cat-food', park: '--cat-park', playground: '--cat-family', museum: '--cat-culture', attraction: '--cat-landmark', mall: '--cat-mall', culture: '--cat-culture', family: '--cat-family', nightlife: '--cat-night' };

export function art(name, size = 32, className = 'art') {
  const file = name || 'landmark';
  return h('img', { class: className, src: `/assets/icons/categories/${file}-64.webp`,
    srcset: `/assets/icons/categories/${file}-64.webp 1x, /assets/icons/categories/${file}-128.webp 2x, /assets/icons/categories/${file}-256.webp 4x`,
    alt: '', width: size, height: size, decoding: 'async', loading: 'lazy' });
}
export const categoryArt = (category, size, className) => art(CATEGORY_ART[category], size, className);
export const categoryName = (category) => { const key = `cat.${category}`; const name = t(key); return name === key ? t('cat.other') : name; };

/** Opening-hours status for a visit starting after `walkMinutes`, from the server's check when there is one. */
export function hoursStatus(place, walkMinutes = 0, visitMinutes = 20, serverCheck = null) {
  let check = serverCheck;
  if (!check || ['not_checked'].includes(check.status)) {
    if (!place.openingHours) return { tone: 'muted', text: t('hours.none'), status: 'none' };
    try { check = checkVisit(place.openingHours, new Date(Date.now() + walkMinutes * 60000), visitMinutes); }
    catch { check = { status: 'unknown' }; }
  }
  if (check.status === 'no_data') return { tone: 'muted', text: t('hours.none'), status: 'none' };
  if (check.status === 'open') return { tone: 'good', text: check.closesAt ? t('hours.open', { time: check.closesAt === '24:00' ? '00:00' : check.closesAt }) : t('hours.open247'), status: 'open' };
  if (check.status === 'closed') return { tone: 'bad', text: t('hours.closed'), status: 'closed' };
  if (check.status === 'closes_early') return { tone: 'warn', text: t('hours.closesEarly'), status: 'closes_early' };
  return { tone: 'muted', text: t('hours.unknown'), status: 'unknown' };
}

export function hoursChip(status) {
  return h('span', { class: `status status-${status.tone}` }, h('span', { class: 'status-dot', 'aria-hidden': 'true' }), status.text);
}

export function navLinks(from, to, serverLinks = null) {
  // The server's links carry no start point: the map app starts from where the person is.
  const links = [
    ['2ГИС', serverLinks?.twoGis || `https://2gis.kz/astana/routeSearch/rsType/pedestrian/from/${from.lon},${from.lat}/to/${to.lon},${to.lat}`],
    [lang() === 'en' ? 'Yandex Maps' : 'Яндекс Карты', `https://yandex.kz/maps/?rtext=${from.lat},${from.lon}~${to.lat},${to.lon}&rtt=pd`],
    ['Google Maps', serverLinks?.googleMapsWalk || `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lon}&destination=${to.lat},${to.lon}&travelmode=walking`],
  ];
  return h('div', { class: 'nav-links' }, h('span', { class: 'nav-links-label', text: t('place.routeIn') }),
    h('div', { class: 'nav-links-row' }, links.map(([label, href]) => h('a', { class: 'btn btn-quiet btn-sm', href, target: '_blank', rel: 'noopener noreferrer' }, label))));
}

export async function share({ title, text, url }) {
  try {
    if (navigator.share) { await navigator.share({ title, text, url }); return; }
  } catch (error) { if (error?.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(url); toast(t('toast.copied'), { iconName: 'check' }); }
  catch { prompt(t('toast.copied'), url); }
}

// Hand-off to the watch client (/watch, see docs/watch.md): the place card opens ready on the watch.
export function watchUrl({ place, start, walk, visit, back, minutes }) {
  const fixed = (value) => Number(value).toFixed(5);
  const params = new URLSearchParams({ to: `${fixed(place.lat)},${fixed(place.lon)}`, name: place.name || '', cat: place.category || 'attraction' });
  if (start) { params.set('from', `${fixed(start.lat)},${fixed(start.lon)}`); if (start.name) params.set('fromName', start.name); }
  for (const [key, value] of Object.entries({ min: minutes, walk, visit, back })) if (Number.isFinite(value)) params.set(key, String(Math.ceil(value)));
  return `${location.origin}/watch#${params.toString().replace(/%2C/g, ',')}`;
}

export function watchButton(options) {
  return h('button', { class: 'btn btn-quiet btn-sm watch-btn', type: 'button', onclick: () => share({ title: 'Aidem', text: t('place.watchText', { name: options.place.name }), url: watchUrl(options) }) }, icon('watch'), t('place.watch'));
}

/** «Слушать»: Gemini reads the text aloud; a second tap stops it. */
export function listenButton(getText) {
  const button = h('button', { class: 'btn btn-quiet btn-sm listen-btn', type: 'button', 'aria-pressed': 'false' }, icon('speaker'), h('span', { text: t('common.listen') }));
  const label = button.querySelector('span');
  button.addEventListener('click', async () => {
    if (button.getAttribute('aria-pressed') === 'true') { stopSpeaking(); return; }
    unlockAudio();
    button.setAttribute('aria-pressed', 'true'); label.textContent = t('common.stop');
    try { await speakText(typeof getText === 'function' ? getText() : getText); }
    finally { button.setAttribute('aria-pressed', 'false'); label.textContent = t('common.listen'); }
  });
  return button;
}

export const returnBy = (minutes, startAt = Date.now()) => time(new Date(startAt + minutes * 60000));

export function backButton(label, onClick) {
  return h('button', { class: 'btn btn-quiet btn-sm back-btn', type: 'button', onclick: onClick }, icon('back'), label);
}
