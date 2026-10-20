// Place details: the time ring, why it fits, what is known and what is not, and the actions.
import { h, icon, externalLink, safeUrl } from '../core/dom.js';
import { t, date as formatDate } from '../core/i18n.js';
import { formatDistance } from '../core/geo.js';
import { lang } from '../core/i18n.js';
import * as store from '../core/store.js';
import { timeRing } from './ring.js';
import { categoryArt, categoryName, hoursStatus, hoursChip, navLinks, share, returnBy, backButton, watchButton } from './common.js';
import { toast } from './toast.js';

const WHEELCHAIR = { yes: 'place.wheelchair.yes', limited: 'place.wheelchair.limited', no: 'place.wheelchair.no' };

export function placeView({ place, timing, start, serverHours, why, activities = [], warnings = [], onBack, backLabel, onStart, routeInfo, shareUrl }) {
  const hours = hoursStatus(place, timing.walkMinutes, timing.visitMinutes, serverHours);
  const saved = store.isSaved(place.id);
  const saveButton = h('button', { class: `icon-btn${saved ? ' is-on' : ''}`, type: 'button', 'aria-pressed': String(saved), 'aria-label': t(saved ? 'place.saved' : 'place.save') }, icon(saved ? 'heart-fill' : 'heart'));
  saveButton.addEventListener('click', () => {
    const now = store.toggleSaved(place);
    saveButton.classList.toggle('is-on', now);
    saveButton.setAttribute('aria-pressed', String(now));
    saveButton.setAttribute('aria-label', t(now ? 'place.saved' : 'place.save'));
    saveButton.replaceChildren(icon(now ? 'heart-fill' : 'heart'));
    toast(t(now ? 'toast.saved' : 'toast.unsaved'), { iconName: now ? 'heart-fill' : 'heart' });
  });
  const shareButton = h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('place.share'), onclick: () => share({ title: place.name, text: `${place.name}: ${t('place.returnNow', { time: returnBy(timing.totalMinutes) })}`, url: shareUrl }) }, icon('share'));

  const total = Math.ceil(timing.totalMinutes);
  const legend = [['there', 'place.there', timing.walkMinutes], ['visit', 'place.visit', timing.visitMinutes], ['back', 'place.back', timing.returnMinutes], ['reserve', 'place.reserve', timing.safetyReserveMinutes]]
    .map(([key, label, value]) => h('li', { class: `legend-${key}` }, h('span', { class: 'legend-dot', 'aria-hidden': 'true' }), h('span', { text: t(label) }), h('strong', { class: 'num', text: t('plan.min', { n: Math.ceil(value) }) })));

  const facts = [];
  if (place.openingHours) facts.push(row('clock', t('place.hours'), place.openingHours));
  const phone = place.phone || place.contacts?.phone;
  if (phone) facts.push(row('phone', t('place.phone'), h('a', { class: 'link', href: `tel:${String(phone).replace(/[^+\d]/g, '')}`, text: phone })));
  const site = safeUrl(place.website || place.contacts?.website);
  if (site) facts.push(row('globe', t('place.site'), h('a', { class: 'link', href: site, target: '_blank', rel: 'noopener noreferrer', text: new URL(site).hostname.replace(/^www\./, '') })));
  if (WHEELCHAIR[place.wheelchair]) facts.push(row('accessible', t('place.wheelchair'), t(WHEELCHAIR[place.wheelchair])));

  const checks = [
    ['check', 'good', t('place.check.osm')],
    ['check', 'good', t('place.check.coords')],
    place.openingHours ? ['check', 'good', t('place.check.hours')] : ['info', 'muted', t('place.check.noHours')],
    ['info', 'muted', t('place.check.live')],
  ];
  const snapshot = formatDate(place.retrievedAt);

  const routeLine = h('p', { class: 'fine', text: routeInfo ? t('place.route', { d: formatDistance(routeInfo.meters, lang()), n: Math.ceil(routeInfo.seconds / 60) }) : t('place.estimate') });

  return h('article', { class: 'view place-view', 'aria-labelledby': 'place-title' },
    h('div', { class: 'view-bar' }, backButton(backLabel || t('common.back'), onBack), h('div', { class: 'view-bar-actions' }, saveButton, shareButton)),
    h('header', { class: 'place-head' }, categoryArt(place.category, 56, 'art art-lg'),
      h('div', {}, h('h2', { id: 'place-title', class: 'title-2', text: place.name }),
        h('p', { class: 'meta' }, categoryName(place.category), timing.distanceMeters ? h('span', { class: 'meta-sep', 'aria-hidden': 'true' }) : null,
          timing.distanceMeters ? t('place.straight', { d: formatDistance(timing.distanceMeters, lang()) }) : null),
        hoursChip(hours))),
    h('section', { class: 'time-card' },
      timeRing({ there: timing.walkMinutes, visit: timing.visitMinutes, back: timing.returnMinutes, reserve: timing.safetyReserveMinutes, size: 132, stroke: 13, label: `${total}`, sublabel: t('plan.min', { n: '' }).trim() }),
      h('div', { class: 'time-card-side' }, h('ul', { class: 'legend' }, legend), h('p', { class: 'return-by' }, icon('return'), t('place.returnNow', { time: returnBy(total) })))),
    routeLine,
    h('button', { class: 'btn btn-gold btn-xl', type: 'button', onclick: onStart }, icon('play'), t('place.start')),
    start ? navLinks(start, place) : null,
    watchButton({ place, start, walk: timing.walkMinutes, visit: timing.visitMinutes, back: timing.returnMinutes, minutes: timing.totalMinutes }),
    why ? section(t('place.why'), h('p', { class: 'prose', text: why })) : null,
    activities.length ? section(t('place.todo'), h('ul', { class: 'bullets' }, activities.map((item) => h('li', { text: item })))) : null,
    facts.length ? section(t('place.info'), h('dl', { class: 'facts' }, facts)) : null,
    section(t('place.checks'), h('ul', { class: 'checks' }, checks.map(([name, tone, text]) => h('li', { class: `check-${tone}` }, icon(name), h('span', { text })))),
      h('p', { class: 'fine' }, externalLink(t('place.source'), place.sourceUrl), snapshot ? h('span', { text: ` ${t('place.snapshot', { date: snapshot })}` }) : null)),
    warnings.length ? h('details', { class: 'disclosure' }, h('summary', {}, icon('warning'), t('place.warnings'), h('span', { class: 'count num', text: warnings.length })), h('ul', { class: 'bullets fine' }, warnings.map((item) => h('li', { text: item })))) : null,
  );
}

function row(iconName, label, value) {
  return h('div', { class: 'fact' }, h('dt', {}, icon(iconName), label), h('dd', {}, value));
}
function section(title, ...content) {
  return h('section', { class: 'block' }, h('h3', { class: 'block-title', text: title }), ...content);
}
