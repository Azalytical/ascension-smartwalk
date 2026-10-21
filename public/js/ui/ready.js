// «Перед выходом»: a short checklist between the place card and the walk: when you will be back, the weather now,
// opening hours the source does not confirm. A reminder, not a safety promise: the screen says so.
import { h, icon } from '../core/dom.js';
import { t } from '../core/i18n.js';
import * as api from '../core/api.js';
import { categoryArt, hoursStatus, backButton } from './common.js';
import './trip.js';

const WET = [51, 53, 55, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99];
const SNOW = [71, 73, 75, 77, 85, 86];

function item(name, tone, title, text) {
  return h('li', { class: `ready-item is-${tone}` }, h('span', { class: 'ready-icon', 'aria-hidden': 'true' }, icon(name)),
    h('span', { class: 'row-text' }, h('strong', { text: title }), text ? h('small', { text }) : null));
}

function weatherItem(current) {
  if (!current) return item('cloud', 'warn', t('ready.weatherNone'), t('ready.weatherNoneText'));
  const temp = Math.round(current.temperature_2m);
  const degrees = `${temp > 0 ? '+' : ''}${temp}°`;
  const wind = Math.round(current.wind_speed_10m);
  const snowy = SNOW.includes(current.weather_code);
  const wet = current.precipitation > 0 || WET.includes(current.weather_code);
  if (wet) return item(snowy ? 'snow' : 'rain', 'warn', t(snowy ? 'ready.snow' : 'ready.rain', { t: degrees }), t('ready.wetText'));
  if (temp <= -10) return item('snow', 'warn', t('ready.cold', { t: degrees }), t('ready.coldText'));
  if (wind >= 12) return item('cloud', 'warn', t('ready.wind', { t: degrees, w: wind }), t('ready.windText'));
  return item(current.weather_code <= 1 ? 'sun' : 'cloud', 'good', t('ready.calm', { t: degrees, w: wind }), t('ready.calmText'));
}

function hoursItem(status) {
  if (status.status === 'open') return item('clock', 'good', status.text, t('ready.hoursSource'));
  if (status.status === 'closed' || status.status === 'closes_early') return item('warning', 'bad', status.text, t('ready.hoursClosed'));
  return item('clock', 'warn', t('ready.hoursUnknown'), t('ready.hoursCheck'));
}

/** `backAt` is the same «вернётесь к» as the card («закончите к» for `oneWay`); `onGo` starts the walk. */
export function readyView({ place, timing, backAt, serverHours = null, onGo, onBack, oneWay = false }) {
  const weatherHost = item('cloud', 'muted', t('ready.weatherLoading'), null);
  api.weather().then((current) => weatherHost.replaceWith(weatherItem(current)));
  const reserve = timing.safetyReserveMinutes ?? 5;
  return h('section', { class: 'view ready-view', 'aria-labelledby': 'ready-title' },
    h('div', { class: 'view-bar' }, backButton(t('common.back'), onBack)),
    h('h2', { id: 'ready-title', class: 'title-2', text: t('ready.title') }),
    h('div', { class: 'ready-place' }, categoryArt(place.category, 36, 'art'), h('strong', { text: place.name })),
    h('ul', { class: 'ready-list' },
      item(oneWay ? 'flag' : 'return', 'good', t(oneWay ? 'ready.done' : 'ready.back', { time: backAt }),
        t(oneWay ? 'ready.oneWayText' : 'ready.backText', { walk: timing.walkMinutes, visit: timing.visitMinutes, back: timing.returnMinutes, reserve })),
      weatherHost,
      hoursItem(hoursStatus(place, timing.walkMinutes, timing.visitMinutes, serverHours))),
    h('p', { class: 'ready-note' }, icon('info', 'icon-xs'), h('span', { text: t('ready.note') })),
    h('button', { class: 'btn btn-gold btn-xl', type: 'button', onclick: onGo }, icon('play'), t('ready.go')));
}
