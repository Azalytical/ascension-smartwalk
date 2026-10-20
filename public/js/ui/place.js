// Place details: the time ring, why it fits, a step plan, what is known and what is not, and the actions.
// Each block that the server labels with its origin (data, computed, idea) shows that label.
import { h, icon, externalLink, safeUrl } from '../core/dom.js';
import { t, date as formatDate } from '../core/i18n.js';
import { formatDistance } from '../core/geo.js';
import { lang } from '../core/i18n.js';
import * as store from '../core/store.js';
import { timeRing } from './ring.js';
import { categoryArt, categoryName, hoursStatus, hoursChip, navLinks, share, backTime, confidenceChip, notabilityChip, versusText, backButton, watchButton, listenButton } from './common.js';
import { toast } from './toast.js';
import { ratingBlock, ratingChip } from './rating.js';

const WHEELCHAIR = { yes: 'place.wheelchair.yes', limited: 'place.wheelchair.limited', no: 'place.wheelchair.no' };

export function placeView({ place, timing, start, serverHours, why, activities = [], warnings = [], onBack, backLabel, onStart, routeInfo, shareUrl, voice = null, backAt = null, spareAt = null, onHide = null }) {
  const back = backAt || backTime(timing);
  const versus = versusText(place);
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
  const shareButton = h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('place.share'), onclick: () => share({ title: place.name, text: `${place.name}: ${t('place.returnNow', { time: back })}`, url: shareUrl }) }, icon('share'));

  const total = Math.ceil(timing.totalMinutes);
  const legend = [['there', 'place.there', timing.walkMinutes], ['visit', 'place.visit', timing.visitMinutes], ['back', 'place.back', timing.returnMinutes], ['reserve', 'place.reserve', timing.safetyReserveMinutes]]
    .map(([key, label, value]) => h('li', { class: `legend-${key}` }, h('span', { class: 'legend-dot', 'aria-hidden': 'true' }), h('span', { text: t(label) }), h('strong', { class: 'num', text: t('plan.min', { n: Math.ceil(value) }) })));

  const facts = [];
  if (place.openingHours) facts.push(row('clock', t('place.hours'), place.openingHours));
  const phone = place.phone || place.contacts?.phone;
  if (phone) facts.push(row('phone', t('place.phone'), h('a', { class: 'link', href: `tel:${String(phone).replace(/[^+\d]/g, '')}`, text: phone })));
  const site = safeUrl(place.website || place.contacts?.website);
  if (site) facts.push(row('globe', t('place.site'), h('a', { class: 'link', href: site, target: '_blank', rel: 'noopener noreferrer', text: new URL(site).hostname.replace(/^www\./, '') })));
  if (place.address) facts.push(row('pin', t('place.address'), place.address));
  if (WHEELCHAIR[place.wheelchair]) facts.push(row('accessible', t('place.wheelchair'), t(WHEELCHAIR[place.wheelchair])));

  const sourceName = place.source?.label || 'OpenStreetMap';
  const checks = [
    ['check', 'good', t('place.check.in', { source: sourceName })],
    ['check', 'good', t('place.check.coords')],
    place.openingHours ? ['check', 'good', t('place.check.hours')] : ['info', 'muted', t('place.check.noHours')],
    ...(place.confidence?.reasons || []).slice(0, 3).map((reason) => ['info', 'muted', capitalize(reason)]),
    ...(place.notability?.reasons?.length ? [['info', 'muted', t('place.check.notability', { list: place.notability.reasons.join(', ') })]] : []),
    ['info', 'muted', t('place.check.ratings')],
    ['info', 'muted', t('place.check.live')],
  ];
  const snapshot = formatDate(place.retrievedAt);
  const gemini = () => h('p', { class: 'origin is-ai' }, h('span', { class: 'ai-chip' }, icon('sparkle', 'icon-xs'), 'Gemini'), t('place.aiShort'));

  const routeLine = routeInfo ? h('p', { class: 'fine', text: t('place.route', { d: formatDistance(routeInfo.meters, lang()), n: Math.ceil(routeInfo.seconds / 60) }) }) : null;
  const friends = window.SeruenSocial?.planMeetup
    ? h('button', { class: 'btn btn-quiet btn-sm', type: 'button', onclick: () => window.SeruenSocial.planMeetup({ id: place.id, name: place.name, lat: place.lat, lon: place.lon, category: place.category }) }, icon('friends'), t('place.friends'))
    : null;
  const steps = Array.isArray(place.plan?.steps) ? place.plan.steps : [];
  const pairing = place.pairing?.name ? place.pairing : null;

  return h('article', { class: 'view place-view', 'aria-labelledby': 'place-title' },
    h('div', { class: 'view-bar' }, backButton(backLabel || t('common.back'), onBack), h('div', { class: 'view-bar-actions' }, voice, saveButton, shareButton)),
    h('header', { class: 'place-head' }, categoryArt(place.category, 56, 'art art-lg'),
      h('div', {}, h('h2', { id: 'place-title', class: 'title-2', text: place.name }),
        h('p', { class: 'meta' }, categoryName(place.category), timing.distanceMeters ? h('span', { class: 'meta-sep', 'aria-hidden': 'true' }) : null,
          timing.distanceMeters ? t('place.straight', { d: formatDistance(timing.distanceMeters, lang()) }) : null),
        h('div', { class: 'place-badges' }, hoursChip(hours), confidenceChip(place.confidence), notabilityChip(place.notability), ratingChip(place)))),
    h('section', { class: 'time-card' },
      timeRing({ there: timing.walkMinutes, visit: timing.visitMinutes, back: timing.returnMinutes, reserve: timing.safetyReserveMinutes, size: 132, stroke: 13, label: `${total}`, sublabel: t('plan.min', { n: '' }).trim() }),
      h('div', { class: 'time-card-side' }, h('ul', { class: 'legend' }, legend), h('p', { class: 'return-by' }, icon('return'), t('place.returnNow', { time: back })),
        spareAt ? h('p', { class: 'spare-by', text: t('live.spareBy', { time: spareAt }) }) : null)),
    routeLine,
    versus ? h('p', { class: 'versus-line' }, icon('check', 'icon-xs'), h('span', {}, h('strong', { text: `${t('place.versus')} ` }), versus)) : null,
    h('button', { class: 'btn btn-gold btn-xl', type: 'button', onclick: onStart }, icon('play'), t('place.start')),
    h('div', { class: 'place-actions' }, watchButton({ place, start, walk: timing.walkMinutes, visit: timing.visitMinutes, back: timing.returnMinutes, minutes: timing.totalMinutes }), friends,
      safeUrl(place.links?.googleCalendar) ? h('a', { class: 'btn btn-quiet btn-sm', href: safeUrl(place.links.googleCalendar), target: '_blank', rel: 'noopener noreferrer' }, icon('calendar'), t('place.calendar')) : null,
      // «Больше не предлагать»: the place leaves these results and the next searches; «Моё» can bring it back.
      onHide ? h('button', { class: 'btn btn-quiet btn-sm place-hide', type: 'button', onclick: onHide }, icon('close'), t('place.hide')) : null),
    start ? navLinks(start, place, place.links) : null,
    place.aiWhy ? section(t('place.why'), h('p', { class: 'prose', text: place.aiWhy }), gemini(), listenButton(() => [place.aiWhy, place.aiTodo].filter(Boolean).join(' ')))
      : why ? section(t('place.why'), h('p', { class: 'prose', text: why })) : null,
    place.aiTodo || steps.length ? section(t('place.plan'), place.aiTodo ? h('p', { class: 'prose', text: place.aiTodo }) : null, place.aiTodo ? gemini() : null,
      !place.aiTodo && steps.length ? h('ol', { class: 'plan-steps' }, steps.map((step) => h('li', { text: step }))) : null) : null,
    pairing ? section(t('place.pairing'), h('div', { class: 'pairing' }, categoryArt(pairing.category, 32, 'art'),
      h('span', { class: 'row-text' }, h('strong', { text: pairing.name }), h('small', { text: t('place.pairingValue', { d: formatDistance(pairing.distanceMeters, lang()), n: pairing.extraMinutes }) })))) : null,
    activities.length && !place.aiTodo && !steps.length ? section(t('place.todo'), h('ul', { class: 'bullets' }, activities.map((item) => h('li', { text: item })))) : null,
    facts.length ? section(t('place.info'), h('dl', { class: 'facts' }, facts)) : null,
    ratingBlock(place),
    // Sources, what was and was not checked, and caveats: one closed line for whoever wants the details.
    h('details', { class: 'disclosure' }, h('summary', {}, icon('info'), t('place.checks')),
      h('ul', { class: 'checks' }, checks.map(([name, tone, text]) => h('li', { class: `check-${tone}` }, icon(name), h('span', { text })))),
      warnings.length ? h('ul', { class: 'bullets fine' }, warnings.map((item) => h('li', { text: item }))) : null,
      h('p', { class: 'fine' }, externalLink(t('place.sourceOf', { source: sourceName }), place.sourceUrl), snapshot ? h('span', { text: ` ${t('place.snapshot', { date: snapshot })}` }) : null)),
  );
}

const capitalize = (text) => String(text).charAt(0).toLocaleUpperCase() + String(text).slice(1);

function row(iconName, label, value) {
  return h('div', { class: 'fact' }, h('dt', {}, icon(iconName), label), h('dd', {}, value));
}
function section(title, ...content) {
  return h('section', { class: 'block' }, h('h3', { class: 'block-title', text: title }), ...content);
}
