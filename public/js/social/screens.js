// The "Друзья" tab: profile, friends on the map, location sharing by consent, a fair meeting point,
// meetups with friends and city events. Built from the shell's tokens and components (btn, chip).
import * as social from './service.js';
import { createSocialLayer, CATEGORY_EMOJI } from './map-layer.js';
import { coarse } from '../core/privacy.js';
import { t, plural, lang, locale, pick, placeName } from '../core/i18n.js';
import * as store from '../core/store.js';
import { places as loadPlaces } from '../core/api.js';
import { pickedPlace } from '../core/picked.js';
import './strings.js';

const EMOJIS = ['🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐸', '🐵', '🦄', '🐙', '🦉', '🐧', '🐳', '🦋', '🌻', '🌵', '🍀', '⚡', '🔥', '🌙', '⭐', '🎧', '🎨', '⚽', '🚲', '☕', '📚', '🏔'];
// Strings are looked up at render time (strings.js), so switching the language re-renders the tab in it.
const KINDS = ['any', 'coffee', 'food', 'park', 'indoor'];
const NOTES = ['coffee', 'walk', 'food', 'busy'];
const EVENT_CATEGORIES = ['walk', 'sport', 'food', 'culture', 'study', 'kids', 'other'];
const CATEGORY_NAMES = new Set(['cafe', 'restaurant', 'park', 'mall', 'attraction', 'museum', 'culture', 'playground', 'nightlife', 'family']);
// The list of every place («Позвать в место») filters by these groups of the categories in /data/places.json.
const PLACE_GROUPS = [['all', null], ['cafe', ['cafe']], ['food', ['restaurant']], ['park', ['park']], ['culture', ['museum', 'culture']], ['sight', ['attraction']],
  ['mall', ['mall']], ['kids', ['playground', 'family']], ['night', ['nightlife']]];
const PAGE = 8;
const searchable = text => String(text || '').toLocaleLowerCase().replace(/\u0451/g, '\u0435');
const round5 = value => Math.round(value * 1e5) / 1e5;
const known = key => t(key) !== key;
const statusText = status => (known(`sx.status.${status}`) ? t(`sx.status.${status}`) : status);
const categoryName = category => t(CATEGORY_NAMES.has(category) ? `sx.place.${category}` : 'sx.place.other');

// ---------- small DOM helpers ----------

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** replaceChildren that skips empty slots instead of printing "null". */
function fill(node, ...children) {
  node.replaceChildren(...children.flat(Infinity).filter(child => child !== null && child !== undefined && child !== false));
  return node;
}

function avatar(person, size = 'md', extra = '') {
  return h('span', { class: `sx-avatar sx-avatar-${size} ${extra}`, style: { '--avatar': person?.color || '#1A8CFF' }, 'aria-hidden': 'true' }, person?.emoji || '🙂');
}

function button(label, onclick, kind = 'ghost', attrs = {}) {
  return h('button', { type: 'button', class: `btn btn-${kind} sx-btn`, onclick, ...attrs }, label);
}

function chip(label, pressed, onclick, attrs = {}) {
  return h('button', { type: 'button', class: 'chip sx-chip', 'aria-pressed': String(Boolean(pressed)), onclick, ...attrs }, label);
}

const pad = n => String(n).padStart(2, '0');
// Meetups happen in Astana, so their times are Astana time (UTC+5 all year) on any device; shifting by hand
// avoids browsers with outdated time zone data.
const ASTANA = 5 * 3600000;
const astana = ts => new Date(ts + ASTANA);
const astanaDay = ts => Math.floor((ts + ASTANA) / 86400000);
function clock(ts) { const d = astana(ts); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; }
function dayLabel(ts) {
  const diff = astanaDay(ts) - astanaDay(Date.now());
  if (diff === 0) return t('sx.today');
  if (diff === 1) return t('sx.tomorrow');
  if (diff === -1) return t('sx.yesterday');
  return astana(ts).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}
const when = ts => t('sx.when', { day: dayLabel(ts), time: clock(ts) });
function ago(ts) {
  const minutes = Math.round((Date.now() - ts) / 60000);
  if (minutes < 1) return t('sx.ago.now');
  if (minutes < 60) return t('sx.ago.min', { n: minutes });
  return t('sx.ago.h', { n: Math.round(minutes / 60) });
}
function until(ts) {
  const minutes = Math.round((ts - Date.now()) / 60000);
  if (minutes <= -90) return t('sx.until.past', { when: when(ts) });
  if (minutes < 0) return t('sx.until.started', { n: -minutes });
  if (minutes === 0) return t('sx.until.now');
  if (minutes < 60) return t('sx.until.min', { n: minutes });
  if (minutes < 24 * 60) return t('sx.until.h', { n: Math.round(minutes / 60) });
  return when(ts);
}
function left(ts) {
  const minutes = Math.max(0, Math.round((ts - Date.now()) / 60000));
  return minutes < 60 ? t('sx.left.min', { n: minutes }) : t('sx.left.h', { n: Math.round(minutes / 60) });
}
function km(meters) {
  if (meters < 1000) return t('sx.m', { n: Math.round(meters / 10) * 10 });
  return t('sx.km', { n: new Intl.NumberFormat(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(meters / 1000) });
}
// The date-and-time field shows and reads Astana time too.
const localInput = ts => astana(ts).toISOString().slice(0, 16);
const fromInput = value => Date.parse(`${value.slice(0, 16)}Z`) - ASTANA;
// The dataset of a meeting place: OpenStreetMap or Overture Maps.
const sourceOf = option => option.place.source?.label || 'OpenStreetMap';
const roundTo5 = ts => Math.ceil(ts / 300000) * 300000;
const counted = (n, key) => `${n} ${plural(n, key)}`;

/** The server writes notifications in Russian; in Kazakh and English they are rebuilt from their type. */
function notificationText(item, state) {
  const key = `sx.nt.${item.type}`;
  if (lang() === 'ru' || !known(key)) return item.text;
  const meetup = state.data?.meetups?.find(entry => entry.id === item.entityId);
  const event = state.events?.find(entry => entry.id === item.entityId);
  const title = item.type.startsWith('event') ? event?.title ?? t('sx.nt.event') : meetup?.title ?? t('sx.nt.meetup');
  return t(key, { name: item.actor?.name ?? t('sx.nt.someone'), title });
}

function routeLinks(target) {
  return h('div', { class: 'sx-links' },
    h('a', { class: 'sx-link', href: `https://2gis.kz/astana/geo/${target.lon},${target.lat}`, target: '_blank', rel: 'noopener noreferrer' }, t('sx.open2gis')),
    h('a', { class: 'sx-link', href: `https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lon}&travelmode=walking`, target: '_blank', rel: 'noopener noreferrer' }, t('sx.googleRoute')));
}

function downloadCalendar({ title, startsAt, endsAt, place, description = '' }) {
  const stamp = ts => new Date(ts).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const escape = value => String(value).replace(/[\\;,]/g, match => `\\${match}`).replace(/\n/g, '\\n');
  const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Aidem//Astana//RU', 'BEGIN:VEVENT', `UID:${crypto.randomUUID()}@aidem`, `DTSTAMP:${stamp(Date.now())}`,
    `DTSTART:${stamp(startsAt)}`, `DTEND:${stamp(endsAt ?? startsAt + 3600000)}`, `SUMMARY:${escape(title)}`, `LOCATION:${escape(place.name)}`, `GEO:${place.lat};${place.lon}`,
    `DESCRIPTION:${escape(description)}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const link = h('a', { href: URL.createObjectURL(new Blob([body], { type: 'text/calendar' })), download: 'aidem.ics' });
  document.body.append(link);
  link.click();
  setTimeout(() => { URL.revokeObjectURL(link.href); link.remove(); }, 1000);
}

let qrLoader = null;
function loadQr() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  qrLoader ??= new Promise((resolve, reject) => {
    const script = h('script', { src: '/js/vendor/qrcode.js', async: true });
    script.onload = () => resolve(window.qrcode);
    script.onerror = reject;
    document.head.append(script);
  });
  return qrLoader;
}

function ensureStyles() {
  if (document.querySelector('link[data-social-styles]')) return;
  document.head.append(h('link', { rel: 'stylesheet', href: '/css/friends.css', 'data-social-styles': '' }));
}

// ---------- the tab ----------

export function mountSocial(root, ctx = {}) {
  ensureStyles();
  const maplibregl = ctx.maplibregl || window.maplibregl;
  const view = { tab: 'friends', overlay: null, eventFilter: 'all', meeting: null, busy: false };
  // While a place is picked on the map, a tap on a friend or a meetup does not leave the picker.
  const picking = () => view.overlay?.type === 'pickPlace';
  const layer = ctx.map ? createSocialLayer(ctx.map, maplibregl, {
    onFriend: id => { if (!picking()) open({ type: 'friend', id }); },
    onMeetup: id => { if (!picking()) open({ type: 'meetup', id }); },
    onEvent: id => { if (!picking()) open({ type: 'event', id }); },
    onOption: index => { if (view.meeting) { view.meeting.selected = index; renderMeeting(); } }
  }) : null;

  const container = h('div', { class: 'sx-root' });
  root.replaceChildren(container);

  function toast(message, kind = 'info') {
    if (ctx.toast) { ctx.toast(message, kind); return; }
    for (const previous of document.querySelectorAll('.sx-toast')) previous.remove();
    const node = h('div', { class: `sx-toast is-${kind}`, role: 'status' }, message);
    document.body.append(node);
    setTimeout(() => node.classList.add('is-leaving'), 3200);
    setTimeout(() => node.remove(), 3600);
  }

  async function run(task, success) {
    if (view.busy) return null;
    view.busy = true;
    container.classList.add('is-busy');
    try {
      const result = await task();
      if (success) toast(success, 'success');
      return result;
    } catch (error) {
      toast(error.message || t('sx.failed'), 'error');
      return null;
    } finally {
      view.busy = false;
      container.classList.remove('is-busy');
    }
  }

  const data = () => social.getState().data;
  const friends = () => data()?.friends ?? [];
  const friend = id => friends().find(item => item.id === id);
  const meetup = id => data()?.meetups.find(item => item.id === id);
  const event = id => social.getState().events.find(item => item.id === id);
  const myPoint = () => social.knownPosition();
  // The walk's start point (a preset, a point picked on the map or a recent GPS fix): where the person is, without asking for geolocation.
  const startPoint = () => {
    const saved = store.get('start');
    if (!saved || !Number.isFinite(saved.lat) || !Number.isFinite(saved.lon)) return null;
    if (saved.kind === 'gps') return Date.now() - (saved.at || 0) < 60 * 60_000 ? { lat: saved.lat, lon: saved.lon, name: t('sx.from.lastFix') } : null;
    return { lat: saved.lat, lon: saved.lon, name: saved.names ? pick(saved.names) : saved.name || t('sx.from.startName') };
  };
  // Every place of the database, for the list and the map in «Позвать в место» (the same file as the «Рядом» tab).
  let allPlaces = null;
  const loadAll = () => loadPlaces().then(result => { allPlaces = result.items; return allPlaces; });

  function open(overlay) {
    if (view.overlay?.type === 'meet' && overlay?.type !== 'meet') layer?.clearMeeting();
    view.overlay = overlay;
    if (overlay?.type === 'meet') view.meeting = null;
    if (overlay?.type === 'event' || view.tab === 'events') social.loadEvents();
    if (overlay?.type === 'notifications' && data()?.unread) social.act('markRead').catch(() => {});
    // Picking a place on the map leaves most of the screen to the map.
    ctx.openSheet?.(overlay?.type === 'pickPlace' ? 'peek' : 'half');
    view.justOpened = true;
    render(true);
    view.justOpened = false;
    root.scrollTop = 0;
    container.scrollTop = 0;
  }
  function close() {
    if (view.overlay?.type === 'meet') { view.meeting = null; layer?.clearMeeting(); }
    // A form opened from another screen (a friend, «Где встретиться?») or the map picker goes back to it.
    if (view.overlay?.back) { open(view.overlay.back); return; }
    view.overlay = null;
    render(true);
    root.scrollTop = 0;
  }

  // ---------- header ----------

  function header() {
    const state = data();
    if (!state) return null;
    return h('header', { class: 'sx-header' },
      h('h2', { class: 'sx-title' }, view.overlay ? backButton() : t('sx.title')),
      h('div', { class: 'sx-header-actions' },
        h('button', { type: 'button', class: 'sx-icon-button', 'aria-label': state.unread ? t('sx.notificationsNew', { n: state.unread }) : t('sx.notifications'), onclick: () => open({ type: 'notifications' }) },
          '🔔', state.unread ? h('span', { class: 'sx-badge' }, state.unread > 9 ? '9+' : state.unread) : null),
        h('button', { type: 'button', class: 'sx-icon-button', 'aria-label': t('sx.myProfile'), onclick: () => open({ type: 'profile' }) }, avatar(state.me, 'sm'))));
  }
  function backButton() {
    return h('button', { type: 'button', class: 'sx-back', onclick: close }, t('sx.back'));
  }

  // ---------- onboarding ----------

  function onboarding() {
    const invite = view.pendingInvite;
    let emoji = EMOJIS[Math.floor(Math.random() * 12)];
    const name = h('input', { class: 'sx-input', id: 'sx-name', maxlength: 32, autocomplete: 'nickname', placeholder: t('sx.ob.namePlaceholder'), required: true });
    const picker = h('div', { class: 'sx-emoji-grid', role: 'radiogroup', 'aria-label': t('sx.emoji') },
      EMOJIS.map(value => h('button', { type: 'button', class: 'sx-emoji', role: 'radio', 'aria-checked': String(value === emoji), 'aria-label': value,
        onclick: event => { emoji = value; for (const node of picker.children) node.setAttribute('aria-checked', String(node === event.currentTarget)); } }, value)));
    const start = async event => {
      event.preventDefault();
      const me = await run(() => social.register(name.value, emoji));
      if (!me) return;
      root.scrollTop = 0;
      if (invite) await acceptInvite(invite.code);
      else toast(t('sx.ob.created', { name: me.name }), 'success');
      // «Позвать друзей» on a place card before there was a profile: the invitation to that place opens now.
      const waiting = view.pendingPlace;
      view.pendingPlace = null;
      if (waiting) open({ type: 'newMeetup', prefill: { place: waiting, title: waiting.name } });
    };
    const code = h('input', { class: 'sx-input sx-code-input', inputmode: 'numeric', maxlength: 6, placeholder: '123456', 'aria-label': t('sx.ob.codeLabel') });
    return h('div', { class: 'sx-onboarding' },
      invite?.inviter ? h('div', { class: 'sx-invite-card' }, avatar(invite.inviter, 'lg'), h('div', {}, h('strong', {}, t('sx.ob.invited', { name: invite.inviter.name })), h('p', {}, t('sx.ob.invitedText')))) : null,
      view.pendingPlace ? h('p', { class: 'sx-note' }, t('sx.ob.placeNext', { name: view.pendingPlace.name })) : null,
      h('div', { class: 'sx-hero' }, h('div', { class: 'sx-hero-faces', 'aria-hidden': 'true' }, '🦊', '🐻', '🐼'),
        h('h2', {}, t('sx.ob.title')),
        h('p', {}, t('sx.ob.text'))),
      h('ul', { class: 'sx-promises' },
        h('li', {}, h('span', {}, '🔒'), t('sx.ob.p1')),
        h('li', {}, h('span', {}, '⏱'), t('sx.ob.p2')),
        h('li', {}, h('span', {}, '✋'), t('sx.ob.p3'))),
      h('form', { class: 'sx-form', onsubmit: start },
        h('label', { class: 'sx-label', for: 'sx-name' }, t('sx.name')), name,
        h('span', { class: 'sx-label' }, t('sx.emoji')), picker,
        h('button', { type: 'submit', class: 'btn btn-primary sx-btn sx-wide' }, invite?.inviter ? t('sx.ob.startWith', { name: invite.inviter.name }) : t('sx.ob.start'))),
      h('details', { class: 'sx-details' }, h('summary', {}, t('sx.ob.haveProfile')),
        h('form', { class: 'sx-inline-form', onsubmit: async event => { event.preventDefault(); const me = await run(() => social.claimDevice(code.value)); if (me) { root.scrollTop = 0; toast(t('sx.ob.signedIn', { name: me.name }), 'success'); } } },
          code, button(t('sx.ob.signIn'), null, 'primary', { type: 'submit' })),
        h('p', { class: 'sx-hint' }, t('sx.ob.codeHint'))));
  }

  async function acceptInvite(code) {
    const result = await run(() => social.act('acceptInvite', { code }));
    view.pendingInvite = null;
    if (result) toast(t(result.already ? 'sx.alreadyFriend' : 'sx.nowFriend', { name: result.friend.name }), 'success');
    render(true);
  }

  // ---------- sharing ----------

  function shareCard() {
    const share = data().share;
    const geo = social.getState().geo;
    if (!share) {
      return h('section', { class: 'sx-share is-off' },
        h('div', {}, h('strong', {}, t('sx.share.offTitle')), h('p', {}, t('sx.share.offText'))),
        button(t('sx.share.cta'), () => open({ type: 'share' }), 'gold'));
    }
    const audience = share.audience === 'all' ? t('sx.share.allFriends') : counted(share.recipients.length, 'sx.w.friend');
    return h('section', { class: 'sx-share is-on', 'aria-live': 'polite' },
      h('span', { class: 'sx-live-dot', 'aria-hidden': 'true' }),
      h('div', {}, h('strong', {}, t('sx.share.onTitle')),
        h('p', {}, t('sx.share.onText', { mode: t(share.mode === 'approximate' ? 'sx.share.approx' : 'sx.share.precise'), left: left(share.expiresAt), audience })),
        share.note ? h('p', {}, `«${share.note}»`) : null,
        geo.error ? h('p', { class: 'sx-warning' }, geo.error) : !share.hasPoint ? h('p', { class: 'sx-hint' }, t('sx.share.locating')) : null),
      button(t('sx.share.stop'), () => run(() => social.stopShare(), t('sx.share.stopped')), 'ghost', { class: 'btn btn-ghost sx-btn sx-stop' }));
  }

  function shareForm() {
    const choice = { minutes: 60, mode: 'approximate', audience: 'all', recipients: new Set(), note: '' };
    const body = h('div', { class: 'sx-form' });
    const consent = h('input', { type: 'checkbox', id: 'sx-consent' });
    const submit = button(t('sx.share.enable'), async () => {
      if (!consent.checked) { toast(t('sx.share.confirm'), 'error'); return; }
      const share = await run(() => social.startShare({ minutes: choice.minutes, mode: choice.mode, audience: choice.audience, recipients: [...choice.recipients], note: choice.note }));
      if (share) { toast(t('sx.share.started'), 'success'); close(); }
    }, 'primary', { class: 'btn btn-primary sx-btn sx-wide', disabled: true });
    consent.addEventListener('change', () => { submit.disabled = !consent.checked; });
    const consentText = h('span');
    const updateConsent = () => {
      const whom = t(choice.audience === 'all' ? 'sx.share.whomAll' : choice.recipients.size ? 'sx.share.whomSome' : 'sx.share.whomNone');
      consentText.textContent = t('sx.share.consent', { whom, what: t(choice.mode === 'approximate' ? 'sx.share.consentApprox' : 'sx.share.consentPrecise'),
        time: clock(Date.now() + choice.minutes * 60000) });
    };
    const group = (label, options, key, after) => {
      const row = h('div', { class: 'sx-chips', role: 'group', 'aria-label': label });
      const draw = () => row.replaceChildren(...options.map(([value, text]) => chip(text, choice[key] === value, () => { choice[key] = value; draw(); after?.(); updateConsent(); })));
      draw();
      return [h('span', { class: 'sx-label' }, label), row];
    };
    const picker = h('div', { class: 'sx-chips sx-friend-chips' });
    const drawPicker = () => {
      picker.hidden = choice.audience !== 'selected';
      picker.replaceChildren(...friends().map(item => chip([avatar(item, 'xs'), item.name], choice.recipients.has(item.id), () => {
        choice.recipients.has(item.id) ? choice.recipients.delete(item.id) : choice.recipients.add(item.id);
        drawPicker(); updateConsent();
      })));
    };
    const note = h('input', { class: 'sx-input', maxlength: 60, placeholder: t('sx.share.notePlaceholder'), oninput: () => { choice.note = note.value; drawNotes(); } });
    const notes = h('div', { class: 'sx-chips' });
    const drawNotes = () => notes.replaceChildren(...NOTES.map(id => t(`sx.note.${id}`)).map(text => chip(text, choice.note === text, () => { choice.note = choice.note === text ? '' : text; note.value = choice.note; drawNotes(); })));
    drawNotes(); drawPicker(); updateConsent();
    body.append(
      h('h3', { class: 'sx-section-title' }, t('sx.share.cta')),
      ...group(t('sx.share.howLong'), [[15, t('sx.share.m15')], [60, t('sx.share.h1')], [480, t('sx.share.h8')]], 'minutes'),
      ...group(t('sx.share.accuracy'), [['approximate', t('sx.share.approxOption')], ['precise', t('sx.share.precise')]], 'mode'),
      ...group(t('sx.share.whom'), [['all', t('sx.share.toAll')], ['selected', t('sx.share.toSome')]], 'audience', drawPicker), picker,
      h('span', { class: 'sx-label' }, t('sx.share.status')), notes, note,
      h('label', { class: 'sx-consent', for: 'sx-consent' }, consent, consentText),
      submit,
      h('p', { class: 'sx-hint' }, t('sx.share.privacy')));
    return body;
  }

  // ---------- friends ----------

  function friendSubtitle(item) {
    const location = item.location;
    if (!location) return t('sx.friend.hidden');
    if (location.lat === undefined) return t('sx.friend.locating');
    const mine = myPoint();
    const parts = [mine ? t('sx.friend.distance', { d: km(social.distanceMeters(mine, location)), n: social.walkMinutes(mine, location) }) : t('sx.friend.onMap')];
    parts.push(ago(location.updatedAt));
    if (location.note) parts.push(`«${location.note}»`);
    return parts.join(' · ');
  }

  function friendsView() {
    const list = friends();
    const sharing = list.filter(item => item.location?.lat !== undefined);
    const nearby = myPoint() ? sharing.map(item => ({ item, minutes: social.walkMinutes(myPoint(), item.location) })).filter(entry => entry.minutes <= 15).sort((a, b) => a.minutes - b.minutes) : [];
    return h('div', { class: 'sx-stack' },
      shareCard(),
      list.length ? h('button', { type: 'button', class: 'sx-hero-action sx-invite-place', onclick: () => open({ type: 'newMeetup' }) },
        h('span', { class: 'sx-hero-action-icon', 'aria-hidden': 'true' }, '📍'),
        h('span', {}, h('strong', {}, t('sx.inv.title')), h('span', {}, pickedPlace() ? t('sx.inv.subPicked', { name: pickedPlace().name }) : t('sx.inv.sub')))) : null,
      list.length ? h('button', { type: 'button', class: 'sx-hero-action is-light', onclick: () => open({ type: 'meet' }) },
        h('span', { class: 'sx-hero-action-icon', 'aria-hidden': 'true' }, '🤝'),
        h('span', {}, h('strong', {}, t('sx.meet.title')), h('span', {}, t('sx.meet.sub')))) : null,
      nearby.length ? h('p', { class: 'sx-nearby' }, t('sx.nearby', { list: nearby.slice(0, 3).map(entry => t('sx.nearbyItem', { name: entry.item.name, n: entry.minutes })).join(', ') })) : null,
      h('div', { class: 'sx-list-head' }, h('h3', { class: 'sx-section-title' }, list.length ? t('sx.friendsCount', { n: list.length }) : t('sx.title')), button(t('sx.add'), () => open({ type: 'invite' }), 'ghost')),
      list.length ? h('ul', { class: 'sx-list' }, list.map(item => h('li', {},
        h('button', { type: 'button', class: 'sx-row', onclick: () => open({ type: 'friend', id: item.id }) },
          avatar(item, 'md', item.location ? 'is-sharing' : ''),
          h('span', { class: 'sx-row-text' }, h('strong', {}, item.name), h('span', {}, friendSubtitle(item))),
          h('span', { class: 'sx-chevron', 'aria-hidden': 'true' }, '›')))))
        : h('div', { class: 'sx-empty' }, h('p', {}, t('sx.friends.empty')),
          button(t('sx.invite.title'), () => open({ type: 'invite' }), 'primary')),
      h('button', { type: 'button', class: 'sx-link sx-watch-entry', onclick: () => { open({ type: 'profile' }); document.getElementById('sx-watch-link')?.scrollIntoView({ block: 'center' }); } }, t('sx.watch.entry')));
  }

  function friendDetail(id) {
    const item = friend(id);
    if (!item) return h('p', { class: 'sx-empty' }, t('sx.friend.gone'));
    const location = item.location;
    if (view.justOpened && location?.lat !== undefined) layer?.fit([location]);
    return h('div', { class: 'sx-stack' },
      h('div', { class: 'sx-profile-head' }, avatar(item, 'xl', location ? 'is-sharing' : ''), h('h3', {}, item.name), h('p', {}, friendSubtitle(item)),
        location ? h('p', { class: 'sx-hint' }, t('sx.friend.sharing', { mode: t(location.mode === 'approximate' ? 'sx.friend.approx' : 'sx.friend.precise'), left: left(location.expiresAt) })) : null,
        h('p', { class: 'sx-hint' }, t(item.iShareWith ? 'sx.friend.iShare' : 'sx.friend.iDontShare'))),
      h('div', { class: 'sx-actions' },
        location?.lat !== undefined ? button(t('sx.showOnMap'), () => { layer?.fit([location]); ctx.openSheet?.('peek'); }, 'ghost') : null,
        button(t('sx.inv.title'), () => open({ type: 'newMeetup', prefill: { invitees: [item.id] }, back: view.overlay }), 'primary'),
        button(t('sx.friend.meet'), () => open({ type: 'meet', preselect: [item.id], back: view.overlay }), 'ghost'),
        !location ? button(t('sx.friend.ask'), () => run(() => social.act('pingFriend', { userId: item.id }), t('sx.friend.asked', { name: item.name })), 'ghost') : null),
      h('details', { class: 'sx-details' }, h('summary', {}, t('sx.more')),
        h('div', { class: 'sx-actions' },
          button(t('sx.friend.remove'), async () => { if (confirm(t('sx.friend.removeConfirm', { name: item.name }))) { if (await run(() => social.act('removeFriend', { userId: item.id }), t('sx.friend.removed'))) close(); } }, 'ghost'),
          button(t('sx.friend.block'), async () => { if (confirm(t('sx.friend.blockConfirm', { name: item.name }))) { if (await run(() => social.act('blockUser', { userId: item.id }), t('sx.friend.blocked'))) close(); } }, 'ghost', { class: 'btn btn-ghost sx-btn sx-danger' }))));
  }

  function inviteView() {
    const box = h('div', { class: 'sx-stack' }, h('h3', { class: 'sx-section-title' }, t('sx.invite.title')), h('p', { class: 'sx-hint' }, t('sx.invite.creating')));
    social.act('createInvite').then(({ code, expiresAt }) => {
      const link = `${location.origin}${location.pathname}?friend=${code}`;
      const qr = h('div', { class: 'sx-qr', role: 'img', 'aria-label': t('sx.invite.qr') });
      loadQr().then(factory => {
        const code = factory(0, 'M');
        code.addData(link);
        code.make();
        qr.innerHTML = code.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
      }).catch(() => { qr.hidden = true; });
      const copy = async () => { try { await navigator.clipboard.writeText(link); toast(t('sx.copied'), 'success'); } catch { prompt(t('sx.copyPrompt'), link); } };
      const share = () => navigator.share({ title: 'Aidem', text: t('sx.invite.shareText', { name: data().me.name }), url: link }).catch(() => {});
      const own = h('input', { class: 'sx-input sx-code-input', maxlength: 8, placeholder: t('sx.invite.codePlaceholder'), autocapitalize: 'characters', 'aria-label': t('sx.invite.codeLabel') });
      box.replaceChildren(
        h('h3', { class: 'sx-section-title' }, t('sx.invite.title')),
        h('p', { class: 'sx-hint' }, t('sx.invite.hint', { when: when(expiresAt) })),
        qr,
        h('p', { class: 'sx-invite-code' }, code),
        h('div', { class: 'sx-actions' }, navigator.share ? button(t('sx.invite.share'), share, 'primary') : null, button(t('sx.invite.copy'), copy, navigator.share ? 'ghost' : 'primary')),
        h('form', { class: 'sx-inline-form', onsubmit: event => { event.preventDefault(); acceptInvite(own.value.trim()); } }, own, button(t('sx.invite.add'), null, 'ghost', { type: 'submit' })),
        h('p', { class: 'sx-hint' }, t('sx.invite.haveCode')));
    }).catch(error => box.replaceChildren(h('p', { class: 'sx-warning' }, error.message)));
    return box;
  }

  // ---------- where to meet ----------

  // Where the person walks from in «Где встретиться?». Geolocation is asked only for «Определить, где я».
  function fromOptions() {
    const options = [];
    if (myPoint()) options.push(['here', t('sx.from.here')]);
    const start = startPoint();
    if (start) options.push(['start', start.name]);
    if (ctx.map) options.push(['map', t('sx.from.map')]);
    if (!myPoint()) options.push(['gps', t('sx.from.gps')]);
    // A running share always counts on the server, so «без меня» is offered only without one.
    if (!data()?.share?.hasPoint) options.push(['none', t('sx.from.none')]);
    return options;
  }

  async function fromPoint(from) {
    if (from === 'here') return myPoint();
    if (from === 'start') return startPoint();
    if (from === 'map' && ctx.map) { const center = ctx.map.getCenter(); return { lat: center.lat, lon: center.lng }; }
    if (from === 'gps') {
      const point = await social.currentPosition();
      if (!point) toast(t('sx.pp.noGeo'), 'error');
      return point;
    }
    return null;
  }

  function meetView(overlay) {
    const preselect = overlay.preselect || [];
    const located = friends().filter(item => item.location?.lat !== undefined).map(item => item.id);
    // One friend is enough: the only friend, or the one this screen was opened for, is picked from the start.
    overlay.selected ??= new Set(preselect.length ? preselect : located.length ? located.slice(0, 3) : friends().length === 1 ? [friends()[0].id] : []);
    const selected = overlay.selected;
    const options = fromOptions();
    // By default the person counts only from a point the page already knows; nothing is assumed and nothing is asked.
    if (!options.some(([value]) => value === overlay.from)) overlay.from = options.find(([value]) => value === 'here' || value === 'start')?.[0] ?? 'none';
    let kind = overlay.kind || 'any';
    const wrap = h('div', { class: 'sx-stack' });
    const results = h('div', { class: 'sx-meet-results', 'aria-live': 'polite' });
    const drawChooser = () => {
      const list = friends();
      wrap.replaceChildren(
        h('h3', { class: 'sx-section-title' }, t('sx.meet.title')),
        h('p', { class: 'sx-hint' }, t('sx.meet.hint')),
        h('span', { class: 'sx-label' }, t('sx.meet.with')),
        h('div', { class: 'sx-chips sx-friend-chips' }, list.map(item => chip([avatar(item, 'xs'), item.name, item.location?.lat === undefined ? h('span', { class: 'sx-muted' }, t('sx.meet.noPoint')) : ''], selected.has(item.id), () => {
          selected.has(item.id) ? selected.delete(item.id) : selected.add(item.id); drawChooser();
        }))),
        h('span', { class: 'sx-label' }, t('sx.from.label')),
        h('div', { class: 'sx-chips sx-from-chips' }, options.map(([value, label]) => chip(label, overlay.from === value, () => { overlay.from = value; drawChooser(); }))),
        h('span', { class: 'sx-label' }, t('sx.meet.what')),
        h('div', { class: 'sx-chips' }, KINDS.map(value => chip(t(`sx.kind.${value}`), kind === value, () => { kind = overlay.kind = value; drawChooser(); }))),
        button(t('sx.meet.find'), find, 'primary', { class: 'btn btn-primary sx-btn sx-wide', disabled: !selected.size }),
        button(t('sx.meet.pickOwn'), () => open({ type: 'newMeetup', prefill: { invitees: [...selected], place: chosenOption() }, back: overlay }), 'ghost', { class: 'btn btn-ghost sx-btn sx-wide sx-pick-own' }),
        results);
      if (view.meeting) renderMeeting();
    };
    const chosenOption = () => {
      const option = view.meeting?.result.options[view.meeting.selected];
      return option ? { id: option.place.id, name: option.place.name, category: option.place.category, lat: option.place.lat, lon: option.place.lon } : null;
    };
    async function find() {
      results.replaceChildren(h('p', { class: 'sx-hint' }, t('sx.meet.counting')));
      const here = await fromPoint(overlay.from);
      // Nobody's point is known: say so here, next to «откуда вы идёте» and «выбрать место самому», instead of an error.
      if (!here && !data()?.share?.hasPoint && ![...selected].some(id => friend(id)?.location?.lat !== undefined)) {
        results.replaceChildren(h('p', { class: 'sx-warning' }, t('sx.meet.noPoints')));
        return;
      }
      const result = await run(() => social.api('meeting-point', { userIds: [...selected], kind, ...(here ? { me: { lat: coarse(here.lat), lon: coarse(here.lon) } } : {}) }));
      if (!result) { results.replaceChildren(); return; }
      const people = result.participants.map(person => {
        if (person.self) { const point = here || myPoint(); return { ...person, ...(point ? { lat: point.lat, lon: point.lon } : {}) }; }
        const known = friend(person.id);
        return { ...person, lat: known?.location?.lat, lon: known?.location?.lon };
      });
      // Friends without a known point are invited too: the calculation is made without them, the invitation is not.
      view.meeting = { result, people, selected: 0, invitees: [...selected] };
      renderMeeting();
      layer?.fit([...people, ...result.options.map(option => option.place)], 100);
    }
    view.renderMeetResults = results;
    drawChooser();
    return wrap;
  }

  function renderMeeting() {
    const meeting = view.meeting, results = view.renderMeetResults;
    if (!meeting || !results) return;
    const { result, people } = meeting;
    layer?.showMeeting(result, people, meeting.selected);
    const name = id => people.find(person => person.id === id);
    const longest = Math.max(1, ...result.options.flatMap(option => option.walks.map(walk => walk.minutes)));
    fill(results,
      result.missing.length ? h('p', { class: 'sx-warning' }, t('sx.meet.missing', { names: result.missing.map(item => item.name).join(', ') })) : null,
      result.participants.some(person => person.self) ? null : h('p', { class: 'sx-hint' }, t('sx.meet.withoutYou')),
      result.options.length ? null : h('p', { class: 'sx-empty' }, t('sx.meet.none')),
      ...result.options.map((option, index) => h('article', { class: `sx-option${index === meeting.selected ? ' is-selected' : ''}`, onclick: () => { meeting.selected = index; renderMeeting(); } },
        h('div', { class: 'sx-option-head' }, h('span', { class: 'sx-option-number' }, index + 1),
          h('div', {}, h('strong', {}, option.place.name), h('span', {}, `${categoryName(option.place.category)} · ${whyText(option)}`))),
        h('ul', { class: 'sx-walks' }, option.walks.map(walk => {
          const person = name(walk.userId) || {};
          return h('li', {}, avatar(person, 'xs'), h('span', { class: 'sx-walk-name' }, person.self ? t('sx.you') : person.name),
            h('span', { class: 'sx-walk-bar' }, h('span', { style: { width: `${Math.round(walk.minutes / longest * 100)}%`, '--avatar': person.color } })),
            h('span', { class: 'sx-walk-min' }, t('sx.min', { n: walk.minutes })));
        })),
        h('p', { class: `sx-hours${option.hours.status === 'open' ? ' is-open' : ''}` }, option.hours.status === 'open' ? (option.hours.closesAt ? t('sx.meet.openUntil', { time: option.hours.closesAt, source: sourceOf(option) }) : t('sx.meet.open24', { source: sourceOf(option) })) : t('sx.meet.hoursUnknown')),
        h('div', { class: 'sx-actions' },
          button(t('sx.meet.inviteHere'), event => { event.stopPropagation(); inviteHere(option); }, index === meeting.selected ? 'gold' : 'ghost'),
          h('a', { class: 'sx-link', href: option.place.sourceUrl, target: '_blank', rel: 'noopener noreferrer', onclick: event => event.stopPropagation() }, t('sx.meet.source', { source: sourceOf(option) }))))),
      result.options.length >= 2 ? h('div', { class: 'sx-vote-cta' },
        h('p', {}, t('sx.vote.cta')),
        button(t('sx.vote.offer', { n: result.options.length }), () => inviteToVote(), 'primary', { class: 'btn btn-primary sx-btn sx-wide' })) : null,
      h('p', { class: 'sx-hint' }, lang() === 'ru' ? result.method.note : t('sx.meet.method')));
  }

  function whyText(option) {
    if (lang() === 'ru') return option.why;
    const minutes = option.walks.map(walk => walk.minutes);
    const shortest = Math.min(...minutes), longest = Math.max(...minutes);
    if (minutes.length === 1) return t('sx.meet.whyOne', { n: longest });
    return shortest === longest ? t('sx.meet.whySame', { n: longest }) : t('sx.meet.whyRange', { from: shortest, to: longest });
  }

  const meetupTitle = kind => t({ coffee: 'sx.mtitle.coffee', food: 'sx.mtitle.food', park: 'sx.mtitle.park' }[kind] || 'sx.mtitle.meet');

  async function inviteToVote() {
    const meeting = view.meeting;
    if (!meeting.invitees.length) { toast(t('sx.pickFriend'), 'error'); return; }
    const longest = Math.max(...meeting.result.options.map(option => option.maxMinutes));
    const startsAt = roundTo5(Date.now() + (longest + 15) * 60000);
    const options = meeting.result.options.map(option => ({ id: option.place.id, name: option.place.name, lat: option.place.lat, lon: option.place.lon }));
    const created = await run(() => social.act('createMeetup', { title: meetupTitle(meeting.result.kind), options, startsAt, invitees: meeting.invitees }), t('sx.vote.created'));
    if (created) { layer?.clearMeeting(); view.meeting = null; view.tab = 'meetups'; open({ type: 'meetup', id: created.meetup.id }); }
  }

  async function inviteHere(option) {
    const meeting = view.meeting;
    if (!meeting.invitees.length) { toast(t('sx.pickFriend'), 'error'); return; }
    const startsAt = roundTo5(Date.now() + (option.maxMinutes + 5) * 60000);
    const created = await run(() => social.act('createMeetup', { title: meetupTitle(meeting.result.kind), place: { id: option.place.id, name: option.place.name, lat: option.place.lat, lon: option.place.lon }, startsAt, invitees: meeting.invitees }), t('sx.inviteSent'));
    if (created) { layer?.clearMeeting(); view.meeting = null; view.tab = 'meetups'; open({ type: 'meetup', id: created.meetup.id }); }
  }

  // ---------- place picker ----------

  // The place of a meetup or an event: tapped on the map, chosen from the list of every place (search and groups),
  // the map centre, or «где я» (geolocation only on that tap). The choice lives in overlay.form, so it survives the map picker.
  const placeOf = item => ({ id: item.id ?? null, name: item.name, category: item.category ?? null, lat: item.lat, lon: item.lon });

  // Distances in the list count from the person when that is known, otherwise from the walk's start point or the map.
  function reference() {
    const mine = myPoint();
    if (mine) return { lat: mine.lat, lon: mine.lon, label: t('sx.pp.nearYou') };
    const start = startPoint();
    if (start) return { lat: start.lat, lon: start.lon, label: t('sx.pp.nearStart', { name: start.name }) };
    const center = ctx.map?.getCenter?.();
    return center ? { lat: center.lat, lon: center.lng, label: t('sx.pp.nearCenter') } : { lat: 51.1283, lon: 71.4304, label: t('sx.pp.nearCity') };
  }

  function placePicker(overlay) {
    const form = overlay.form;
    const state = overlay.picker ??= { open: !form.place, query: '', group: 'all', shown: PAGE };
    const box = h('div', { class: 'sx-place-picker' });
    const choose = chosen => {
      form.place = chosen; form.fromMap = false; state.open = false;
      layer?.markPlace(chosen);
      if (chosen) layer?.fit([chosen]);
      draw();
    };
    const input = h('input', { class: 'sx-input', type: 'search', value: state.query, placeholder: t('sx.pp.placeholder'), autocomplete: 'off', enterkeyhint: 'search', 'aria-label': t('sx.pp.label') });
    let timer;
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { state.query = input.value; state.shown = PAGE; drawList(); }, 150); });
    const groups = h('div', { class: 'sx-chips sx-place-groups', role: 'group', 'aria-label': t('sx.pp.groups') });
    const drawGroups = () => groups.replaceChildren(...PLACE_GROUPS.map(([id]) => chip(t(`sx.pp.g.${id}`), state.group === id, () => { state.group = id; state.shown = PAGE; drawGroups(); drawList(); })));
    const listHost = h('div', { class: 'sx-place-list', 'aria-live': 'polite' });

    function drawList() {
      if (!allPlaces) {
        listHost.replaceChildren(h('p', { class: 'sx-hint' }, t('sx.pp.loading')));
        loadAll().then(() => { if (box.isConnected) drawList(); }).catch(() => listHost.replaceChildren(h('p', { class: 'sx-warning' }, t('sx.pp.failed'))));
        return;
      }
      const from = reference();
      const query = searchable(state.query.trim());
      const categories = PLACE_GROUPS.find(([id]) => id === state.group)?.[1];
      // «кофе» finds every café, not only the ones with the word in their name; name matches come first.
      const kinds = new Set(query ? PLACE_GROUPS.filter(([id, group]) => group && searchable(t(`sx.pp.g.${id}`)).includes(query)).flatMap(([, group]) => group) : []);
      const matches = [];
      for (const item of allPlaces) {
        if (categories && !categories.includes(item.category)) continue;
        const named = !query || searchable(`${item.name} ${placeName(item.name)} ${categoryName(item.category)}`).includes(query);
        if (!named && !kinds.has(item.category)) continue;
        matches.push({ item, named, meters: social.distanceMeters(from, item) });
      }
      matches.sort((a, b) => b.named - a.named || a.meters - b.meters);
      fill(listHost,
        h('p', { class: 'sx-hint' }, t('sx.pp.count', { n: new Intl.NumberFormat(locale()).format(matches.length), from: from.label })),
        matches.length ? h('ul', { class: 'sx-suggestions' }, matches.slice(0, state.shown).map(({ item, meters }) => h('li', {},
          h('button', { type: 'button', class: 'sx-suggestion', onclick: () => choose(placeOf(item)) }, h('strong', {}, placeName(item.name)), h('span', {}, `${categoryName(item.category)} · ${km(meters)}`)))))
          : h('p', { class: 'sx-hint' }, t('sx.pp.empty')),
        matches.length > state.shown ? button(t('sx.pp.more'), () => { state.shown += 20; drawList(); }, 'ghost', { class: 'btn btn-ghost sx-btn sx-wide' }) : null);
    }

    const onMap = ctx.map ? button(t('sx.pp.onMap'), () => open({ type: 'pickPlace', back: overlay }), 'gold', { class: 'btn btn-gold sx-btn sx-pick-map' }) : null;
    const mapCenter = ctx.map ? button(t('sx.pp.center'), () => {
      const center = ctx.map.getCenter();
      choose({ id: null, name: t('sx.pp.point'), category: null, lat: round5(center.lat), lon: round5(center.lng) });
    }, 'ghost') : null;
    const here = button(t('sx.pp.here'), async () => {
      const point = await social.currentPosition();
      if (!point) { toast(t('sx.pp.noGeo'), 'error'); return; }
      choose({ id: null, name: t('sx.pp.nearMe'), category: null, lat: round5(point.lat), lon: round5(point.lon) });
    }, 'ghost');

    function draw() {
      const chosen = form.place;
      fill(box,
        chosen ? h('div', { class: 'sx-picked-card' }, h('span', { class: 'sx-picked-pin', 'aria-hidden': 'true' }, '📍'),
          h('span', { class: 'sx-row-text' }, h('strong', { class: 'sx-picked-name' }, placeName(chosen.name)),
            h('span', {}, [chosen.category ? categoryName(chosen.category) : null, form.fromMap ? t('sx.pp.fromMap') : null].filter(Boolean).join(' · ') || t('sx.pp.point'))),
          button(t(state.open ? 'sx.pp.collapse' : 'sx.pp.change'), () => { state.open = !state.open; draw(); }, 'ghost', { class: 'btn btn-ghost sx-btn sx-small' }))
          : h('p', { class: 'sx-picked is-empty' }, t('sx.pp.none')),
        state.open ? [h('div', { class: 'sx-actions' }, onMap, mapCenter, here), input, groups, listHost] : null);
      if (state.open) { drawGroups(); drawList(); }
    }
    draw();
    return box;
  }

  // Map picker: every place is a dot; a tap shows it here, «Выбрать» returns it to the form it came from.
  function pickPlaceView(overlay) {
    const panel = h('div', { class: 'sx-pick' });
    const choose = () => {
      const back = overlay.back;
      back.form.place = overlay.candidate;
      back.form.fromMap = true;
      if (back.picker) back.picker.open = false;
      open(back);
      layer?.fit([overlay.candidate]);
    };
    const draw = () => fill(panel,
      h('div', { class: 'sx-pick-head' }, h('strong', {}, t('sx.pick.title')),
        button(t('sx.pick.cancel'), () => open(overlay.back), 'ghost', { class: 'btn btn-ghost sx-btn sx-small' })),
      overlay.candidate ? h('div', { class: 'sx-pick-choice' },
        h('span', { class: 'sx-row-text' }, h('strong', {}, placeName(overlay.candidate.name)), h('span', {}, overlay.candidate.category ? categoryName(overlay.candidate.category) : t('sx.pick.point'))),
        button(t('sx.pick.choose'), choose, 'primary', { class: 'btn btn-primary sx-btn sx-pick-confirm' }))
        : h('p', { class: 'sx-hint' }, allPlaces ? t('sx.pick.hint') : t('sx.pp.loading')));
    const tap = (id, point) => {
      const item = id ? allPlaces?.find(entry => entry.id === id) : null;
      overlay.candidate = item ? placeOf(item) : { id: null, name: t('sx.pp.point'), category: null, lat: round5(point.lat), lon: round5(point.lon) };
      layer?.markPlace(overlay.candidate);
      draw();
    };
    if (allPlaces) layer?.showPlaces(allPlaces, tap);
    else loadAll().then(() => { if (view.overlay === overlay) { layer?.showPlaces(allPlaces, tap); draw(); } }).catch(() => toast(t('sx.pp.failed'), 'error'));
    draw();
    return panel;
  }

  function timePicker(initial, onPick) {
    let value = initial;
    const input = h('input', { type: 'datetime-local', class: 'sx-input', value: localInput(value), 'aria-label': t('sx.tp.label'), onchange: () => { const ts = fromInput(input.value); if (Number.isFinite(ts)) { value = ts; onPick(ts); draw(); } } });
    const evening = (() => { const today = astanaDay(Date.now()) * 86400000 + 19 * 3600000 - ASTANA; return today < Date.now() + 30 * 60000 ? today + 86400000 : today; })();
    const tonight = astanaDay(evening) === astanaDay(Date.now());
    const presets = [[t('sx.tp.m15'), roundTo5(Date.now() + 15 * 60000)], [t('sx.tp.m30'), roundTo5(Date.now() + 30 * 60000)], [t('sx.tp.h1'), roundTo5(Date.now() + 60 * 60000)], [t(tonight ? 'sx.tp.tonight' : 'sx.tp.tomorrow'), evening]];
    const row = h('div', { class: 'sx-chips' });
    const draw = () => row.replaceChildren(...presets.map(([label, ts]) => chip(label, Math.abs(ts - value) < 60000, () => { value = ts; input.value = localInput(ts); onPick(ts); draw(); })));
    draw();
    return h('div', {}, row, input);
  }

  // ---------- meetups ----------

  function meetupsView() {
    const list = (data().meetups || []).slice().sort((a, b) => (a.status === 'cancelled') - (b.status === 'cancelled') || a.startsAt - b.startsAt);
    return h('div', { class: 'sx-stack' },
      h('div', { class: 'sx-list-head' }, h('h3', { class: 'sx-section-title' }, t('sx.meetups')), button(t('sx.mu.new'), () => open({ type: 'newMeetup' }), 'ghost', { disabled: !friends().length })),
      list.length ? h('ul', { class: 'sx-list' }, list.map(item => h('li', {}, meetupRow(item))))
        : h('div', { class: 'sx-empty' }, h('p', {}, t(friends().length ? 'sx.mu.empty' : 'sx.mu.noFriends')),
          friends().length ? button(t('sx.mu.newTitle'), () => open({ type: 'newMeetup' }), 'primary') : button(t('sx.invite.title'), () => open({ type: 'invite' }), 'primary')));
  }

  function meetupRow(item) {
    const going = item.members.filter(member => ['going', 'on_way', 'arrived'].includes(member.status));
    return h('button', { type: 'button', class: `sx-row sx-meetup-row${item.status === 'cancelled' ? ' is-cancelled' : ''}`, onclick: () => open({ type: 'meetup', id: item.id }) },
      h('span', { class: 'sx-when' }, h('strong', {}, clock(item.startsAt)), h('span', {}, dayLabel(item.startsAt))),
      h('span', { class: 'sx-row-text' }, h('strong', {}, item.title),
        h('span', {}, item.status === 'cancelled' ? t('sx.mu.cancelledLower') : `${item.place.name} · ${until(item.startsAt)}`),
        h('span', { class: 'sx-faces' }, going.slice(0, 5).map(member => avatar(member, 'xs')), item.poll?.open ? h('span', { class: 'sx-pill is-gold' }, t(item.poll.myVote === null ? 'sx.vote.pill' : 'sx.vote.running')) : item.myStatus === 'invited' ? h('span', { class: 'sx-pill is-gold' }, t('sx.mu.waiting')) : item.changed ? h('span', { class: 'sx-pill is-amber' }, t('sx.mu.changedPill')) : null)),
      h('span', { class: 'sx-chevron', 'aria-hidden': 'true' }, '›'));
  }

  // «Позвать в место»: one friend or several, a place from the map or the list (the one picked on the map is there already), a time.
  function newMeetupView(overlay) {
    const prefill = overlay.prefill || {};
    const list = friends();
    const picked = prefill.place ? null : pickedPlace();
    const form = overlay.form ??= { place: prefill.place || (picked && placeOf(picked)), fromMap: Boolean(picked), startsAt: prefill.startsAt || roundTo5(Date.now() + 30 * 60000),
      invitees: new Set(prefill.invitees || (list.length === 1 ? [list[0].id] : [])), title: prefill.title || '', note: '' };
    const title = h('input', { class: 'sx-input', maxlength: 60, placeholder: t('sx.mu.titlePlaceholder'), value: form.title, oninput: () => { form.title = title.value; } });
    const note = h('input', { class: 'sx-input', maxlength: 200, placeholder: t('sx.mu.notePlaceholder'), value: form.note, oninput: () => { form.note = note.value; } });
    const people = h('div', { class: 'sx-chips sx-friend-chips' });
    const drawPeople = () => people.replaceChildren(...list.map(item => chip([avatar(item, 'xs'), item.name], form.invitees.has(item.id), () => { form.invitees.has(item.id) ? form.invitees.delete(item.id) : form.invitees.add(item.id); drawPeople(); })));
    drawPeople();
    return h('form', { class: 'sx-form', onsubmit: async event => {
      event.preventDefault();
      if (!form.invitees.size) { toast(t('sx.mu.pickFriend'), 'error'); return; }
      if (!form.place) { toast(t('sx.pickPlace'), 'error'); return; }
      const { id, name, lat, lon } = form.place;
      const created = await run(() => social.act('createMeetup', { title: form.title.trim() || t('sx.mtitle.meet'), note: form.note, place: { id, name, lat, lon }, startsAt: form.startsAt, invitees: [...form.invitees] }), t('sx.inviteSent'));
      if (created) { view.tab = 'meetups'; open({ type: 'meetup', id: created.meetup.id }); }
    } },
      h('h3', { class: 'sx-section-title' }, t('sx.inv.title')),
      h('span', { class: 'sx-label' }, t('sx.mu.whom')),
      list.length ? [people, h('p', { class: 'sx-hint' }, t('sx.inv.oneIsEnough'))]
        : h('div', { class: 'sx-empty' }, h('p', {}, t('sx.mu.noFriends')), button(t('sx.invite.title'), () => open({ type: 'invite', back: overlay }), 'primary')),
      h('span', { class: 'sx-label' }, t('sx.where')), placePicker(overlay),
      h('span', { class: 'sx-label' }, t('sx.mu.when')), timePicker(form.startsAt, value => { form.startsAt = value; }),
      h('span', { class: 'sx-label' }, t('sx.titleLabel')), title, note,
      h('button', { type: 'submit', class: 'btn btn-primary sx-btn sx-wide', disabled: !list.length }, t('sx.invite.send')),
      h('p', { class: 'sx-hint' }, t('sx.inv.noGeo')));
  }

  function meetupDetail(id) {
    const item = meetup(id);
    if (!item) return data() ? h('p', { class: 'sx-empty' }, t('sx.mu.gone')) : h('p', { class: 'sx-hint' }, t('sx.mu.loading'));
    const me = data().me;
    const rsvp = status => run(() => social.act('rsvpMeetup', { id, status }));
    const statusButtons = item.status === 'cancelled' ? null
      : ['invited', 'maybe', 'declined'].includes(item.myStatus) ? h('div', { class: 'sx-actions' }, button(t('sx.rsvp.going'), () => rsvp('going'), 'primary'), button(t('sx.rsvp.maybe'), () => rsvp('maybe'), 'ghost'), button(t('sx.rsvp.no'), () => rsvp('declined'), 'ghost'))
        : h('div', { class: 'sx-actions' },
          item.myStatus !== 'on_way' && item.myStatus !== 'arrived' ? button(t('sx.rsvp.onWay'), () => rsvp('on_way'), 'gold') : null,
          item.myStatus !== 'arrived' ? button(t('sx.rsvp.arrived'), () => rsvp('arrived'), item.myStatus === 'on_way' ? 'gold' : 'ghost') : null,
          button(t('sx.rsvp.no'), () => rsvp('declined'), 'ghost'));
    const message = h('input', { class: 'sx-input', maxlength: 280, placeholder: t('sx.chat.placeholder'), 'aria-label': t('sx.chat.label'), 'data-keep': `chat-${id}` });
    const send = async event => {
      event.preventDefault();
      const text = message.value.trim();
      if (!text) return;
      message.value = '';
      const sent = await run(() => social.act('postMessage', { id, body: text }));
      const field = container.querySelector(`[data-keep="chat-${id}"]`);
      if (!sent && field && !field.value) field.value = text;
    };
    const etaFor = member => {
      const located = friend(member.id)?.location;
      return member.status === 'on_way' && located?.lat !== undefined ? t('sx.mu.eta', { n: social.walkMinutes(located, item.place) }) : '';
    };
    if (view.justOpened) layer?.fit([item.place]);
    return h('div', { class: 'sx-stack' },
      h('div', { class: 'sx-detail-head' }, h('span', { class: 'sx-kicker' }, item.status === 'cancelled' ? t('sx.mu.cancelled') : until(item.startsAt)),
        h('h3', {}, item.title), h('p', {}, `${when(item.startsAt)} · ${item.place.name}`),
        item.changed ? h('p', { class: 'sx-warning' }, t('sx.mu.changed')) : null,
        item.note ? h('p', { class: 'sx-note' }, item.note) : null),
      pollBlock(item),
      statusButtons,
      h('h4', { class: 'sx-label' }, t('sx.mu.who')),
      h('ul', { class: 'sx-members' }, item.members.map(member => h('li', { class: `is-${member.status}` }, avatar(member, 'sm'),
        h('span', {}, h('strong', {}, member.id === me.id ? t('sx.you') : member.name), h('span', {}, `${statusText(member.status)}${etaFor(member)}${member.id === item.host?.id ? t('sx.mu.host') : ''}`))))),
      routeLinks(item.place),
      h('div', { class: 'sx-actions' }, button(t('sx.calendar'), () => downloadCalendar({ title: item.title, startsAt: item.startsAt, place: item.place, description: item.note }), 'ghost'),
        item.isHost && item.status !== 'cancelled' ? button(t('sx.mu.inviteMore'), () => open({ type: 'addToMeetup', id }), 'ghost') : null),
      h('h4', { class: 'sx-label' }, t('sx.chat.title')),
      h('ul', { class: 'sx-chat' }, item.messages.length ? item.messages.map(entry => h('li', { class: entry.author.id === me.id ? 'is-mine' : '' }, avatar(entry.author, 'xs'), h('span', {}, h('strong', {}, entry.author.id === me.id ? t('sx.you') : entry.author.name), ' ', entry.body)))
        : h('li', { class: 'sx-hint' }, t('sx.chat.empty'))),
      item.status !== 'cancelled' ? h('form', { class: 'sx-inline-form', onsubmit: send },
        message, button(t('sx.chat.send'), null, 'primary', { type: 'submit' })) : null,
      item.isHost && item.status !== 'cancelled' ? h('details', { class: 'sx-details', 'data-pause-refresh': '' }, h('summary', {}, t('sx.mu.manage')),
        h('div', { class: 'sx-form' }, h('span', { class: 'sx-label' }, t('sx.mu.reschedule')), (() => { let next = item.startsAt; return [timePicker(next, value => { next = value; }), button(t('sx.mu.saveTime'), () => run(() => social.act('updateMeetup', { id, startsAt: next }), t('sx.mu.notified')), 'ghost')]; })(),
          button(t('sx.mu.cancel'), async () => { if (confirm(t('sx.mu.cancelConfirm'))) await run(() => social.act('cancelMeetup', { id }), t('sx.mu.cancelDone')); }, 'ghost', { class: 'btn btn-ghost sx-btn sx-danger' }))) : null);
  }

  function pollBlock(item) {
    const poll = item.poll;
    if (!poll) return null;
    if (!poll.open) return h('p', { class: 'sx-hint' }, t('sx.vote.decided', { name: item.place.name }));
    const members = new Map(item.members.map(member => [member.id, member]));
    const mine = myPoint();
    const most = Math.max(1, ...poll.options.map(option => option.voters.length));
    return h('section', { class: 'sx-poll', 'aria-label': t('sx.vote.label') },
      h('div', { class: 'sx-poll-head' }, h('h4', { class: 'sx-label' }, t('sx.vote.title')), h('span', { class: 'sx-pill' }, t('sx.of', { a: poll.voted, b: poll.eligible }))),
      h('ul', { class: 'sx-poll-options' }, poll.options.map(option => {
        const chosen = poll.myVote === option.index;
        const walk = mine ? t('sx.vote.fromYou', { n: social.walkMinutes(mine, option.place) }) : '';
        return h('li', { class: chosen ? 'is-chosen' : '' },
          h('button', { type: 'button', class: 'sx-poll-option', 'aria-pressed': String(chosen), onclick: () => run(() => social.act('voteMeetup', { id: item.id, option: option.index }), chosen ? null : t('sx.vote.counted')) },
            h('span', { class: 'sx-option-number' }, option.index + 1),
            h('span', { class: 'sx-row-text' }, h('strong', {}, option.place.name), h('span', {}, `${option.voters.length ? counted(option.voters.length, 'sx.w.vote') : t('sx.vote.none')}${walk}`),
              h('span', { class: 'sx-poll-bar' }, h('span', { style: { width: `${Math.round(option.voters.length / most * 100)}%` } })),
              h('span', { class: 'sx-faces' }, option.voters.map(voter => members.get(voter)).filter(Boolean).map(member => avatar(member, 'xs')))),
            h('span', { class: 'sx-poll-check', 'aria-hidden': 'true' }, chosen ? '✓' : '')),
          item.isHost ? button(t('sx.vote.choose'), () => run(() => social.act('decideMeetup', { id: item.id, option: option.index }), t('sx.vote.chosen')), 'ghost', { class: 'btn btn-ghost sx-btn sx-small' }) : null);
      })),
      h('p', { class: 'sx-hint' }, t(item.isHost ? 'sx.vote.hintHost' : 'sx.vote.hint')));
  }

  function addToMeetupView(id) {
    const item = meetup(id);
    const present = new Set(item?.members.map(member => member.id));
    const chosen = new Set();
    const row = h('div', { class: 'sx-chips sx-friend-chips' });
    const draw = () => row.replaceChildren(...friends().filter(entry => !present.has(entry.id)).map(entry => chip([avatar(entry, 'xs'), entry.name], chosen.has(entry.id), () => { chosen.has(entry.id) ? chosen.delete(entry.id) : chosen.add(entry.id); draw(); })));
    draw();
    return h('div', { class: 'sx-form' }, h('h3', { class: 'sx-section-title' }, t('sx.mu.inviteMore')), row.children.length ? row : h('p', { class: 'sx-hint' }, t('sx.mu.allInvited')),
      button(t('sx.invite.send'), async () => { if (await run(() => social.act('inviteToMeetup', { id, userIds: [...chosen] }), t('sx.invitesSent'))) open({ type: 'meetup', id }); }, 'primary', { class: 'btn btn-primary sx-btn sx-wide' }));
  }

  // ---------- events ----------

  function eventsView() {
    const all = social.getState().events;
    const filters = [['all', t('sx.ev.all')], ['today', t('sx.ev.today')], ['friends', t('sx.ev.friends')], ['mine', t('sx.ev.mine')]];
    const endOfToday = (astanaDay(Date.now()) + 1) * 86400000 - ASTANA - 1;
    const list = all.filter(item => view.eventFilter === 'all' ? true
      : view.eventFilter === 'today' ? item.startsAt <= endOfToday
        : view.eventFilter === 'friends' ? item.friendsGoing.length > 0
          : item.isHost || item.myStatus);
    return h('div', { class: 'sx-stack' },
      h('div', { class: 'sx-list-head' }, h('h3', { class: 'sx-section-title' }, t('sx.ev.title')), button(t('sx.ev.create'), () => open({ type: 'newEvent' }), 'ghost')),
      h('div', { class: 'sx-chips' }, filters.map(([value, label]) => chip(label, view.eventFilter === value, () => { view.eventFilter = value; render(true); }))),
      list.length ? h('ul', { class: 'sx-list' }, list.map(item => h('li', {}, eventRow(item))))
        : h('div', { class: 'sx-empty' }, h('p', {}, t(all.length ? 'sx.ev.noMatch' : 'sx.ev.empty')),
          button(t('sx.ev.createCta'), () => open({ type: 'newEvent' }), 'primary')));
  }

  function capacityText(item) {
    if (item.capacity) return `${t('sx.of', { a: item.going, b: item.capacity })}${item.waitlist ? t('sx.ev.waitlistCount', { n: item.waitlist }) : ''}`;
    return counted(item.going, 'sx.w.going');
  }

  function eventRow(item) {
    return h('button', { type: 'button', class: `sx-row sx-event-row${item.status !== 'active' ? ' is-cancelled' : ''}`, onclick: () => open({ type: 'event', id: item.id }) },
      h('span', { class: 'sx-event-glyph', 'aria-hidden': 'true' }, CATEGORY_EMOJI[item.category] || '✨'),
      h('span', { class: 'sx-row-text' }, h('strong', {}, item.title),
        h('span', {}, `${when(item.startsAt)} · ${item.place.name}`),
        h('span', { class: 'sx-faces' }, item.friendsGoing.slice(0, 4).map(person => avatar(person, 'xs')), h('span', {}, item.status === 'cancelled' ? t('sx.ev.cancelledLower') : item.status === 'hidden' ? t('sx.ev.hidden') : capacityText(item)),
          item.myStatus === 'going' ? h('span', { class: 'sx-pill is-green' }, t('sx.ev.youGo')) : item.myStatus === 'waitlist' ? h('span', { class: 'sx-pill is-amber' }, t('sx.ev.waitlist')) : null)),
      h('span', { class: 'sx-chevron', 'aria-hidden': 'true' }, '›'));
  }

  function eventDetail(id) {
    const item = event(id);
    if (!item) {
      social.api(`event?id=${encodeURIComponent(id)}`).then(result => { social.getState().events.push(result.event); view.justOpened = true; render(true); view.justOpened = false; })
        .catch(error => { toast(error.message, 'error'); close(); });
      return h('p', { class: 'sx-hint' }, t('sx.ev.loading'));
    }
    if (view.justOpened) layer?.fit([item.place]);
    const signed = social.signedIn();
    const join = () => signed ? run(() => social.act('joinEvent', { id }), null).then(result => result && toast(t(result.event.myStatus === 'waitlist' ? 'sx.ev.waitlisted' : 'sx.ev.joined'), 'success')) : toast(t('sx.ev.needProfile'), 'info');
    const link = `${location.origin}${location.pathname}?event=${item.id}`;
    const share = () => navigator.share ? navigator.share({ title: item.title, text: `${item.title} · ${when(item.startsAt)} · ${item.place.name}`, url: link }).catch(() => {})
      : navigator.clipboard.writeText(link).then(() => toast(t('sx.copied'), 'success')).catch(() => prompt(t('sx.copyPrompt'), link));
    const full = item.capacity !== null && item.going >= item.capacity;
    return h('div', { class: 'sx-stack' },
      h('div', { class: 'sx-detail-head' }, h('span', { class: 'sx-kicker' }, `${CATEGORY_EMOJI[item.category] || '✨'} ${item.status === 'cancelled' ? t('sx.ev.cancelled') : until(item.startsAt)}`),
        h('h3', {}, item.title), h('p', {}, `${when(item.startsAt)}–${clock(item.endsAt)} · ${item.place.name}`),
        h('p', { class: 'sx-hint' }, t('sx.ev.hostLine', { name: item.host?.name || '—', visibility: t(item.visibility === 'friends' ? 'sx.ev.friendsOnly' : 'sx.ev.public') })),
        item.description ? h('p', { class: 'sx-note' }, item.description) : null),
      h('p', { class: 'sx-capacity' }, capacityText(item), item.friendsGoing.length ? h('span', { class: 'sx-faces' }, t('sx.ev.friendsGoing'), item.friendsGoing.map(person => avatar(person, 'xs')), item.friendsGoing.map(person => person.name).join(', ')) : null),
      item.status === 'active' ? h('div', { class: 'sx-actions' },
        !item.myStatus ? button(t(full ? 'sx.ev.joinWaitlist' : 'sx.rsvp.going'), join, 'primary')
          : item.isHost ? h('span', { class: 'sx-pill is-green' }, t('sx.ev.youHost'))
            : button(t(item.myStatus === 'waitlist' ? 'sx.ev.leaveWaitlist' : 'sx.ev.leave'), () => run(() => social.act('leaveEvent', { id }), t('sx.done')), 'ghost'),
        signed && friends().length ? button(t('sx.inviteFriends'), () => open({ type: 'inviteEvent', id }), 'ghost') : null,
        button(t('sx.share.btn'), share, 'ghost')) : null,
      routeLinks(item.place),
      h('div', { class: 'sx-actions' }, button(t('sx.calendar'), () => downloadCalendar({ title: item.title, startsAt: item.startsAt, endsAt: item.endsAt, place: item.place, description: item.description }), 'ghost'),
        item.isHost && item.status === 'active' ? button(t('sx.ev.cancel'), async () => { if (confirm(t('sx.ev.cancelConfirm'))) await run(() => social.act('cancelEvent', { id }), t('sx.ev.cancelDone')); }, 'ghost', { class: 'btn btn-ghost sx-btn sx-danger' }) : null,
        signed && !item.isHost ? button(t('sx.ev.report'), async () => { const reason = prompt(t('sx.ev.reportPrompt')); if (reason !== null) await run(() => social.act('reportEvent', { id, reason }), t('sx.ev.reported')); }, 'ghost', { class: 'btn btn-ghost sx-btn sx-quiet' }) : null));
  }

  function inviteEventView(id) {
    const chosen = new Set();
    const row = h('div', { class: 'sx-chips sx-friend-chips' });
    const draw = () => row.replaceChildren(...friends().map(entry => chip([avatar(entry, 'xs'), entry.name], chosen.has(entry.id), () => { chosen.has(entry.id) ? chosen.delete(entry.id) : chosen.add(entry.id); draw(); })));
    draw();
    return h('div', { class: 'sx-form' }, h('h3', { class: 'sx-section-title' }, t('sx.ev.inviteTitle')), row,
      button(t('sx.invite.send'), async () => { if (chosen.size && await run(() => social.act('inviteToEvent', { id, userIds: [...chosen] }), t('sx.ev.invited'))) open({ type: 'event', id }); }, 'primary', { class: 'btn btn-primary sx-btn sx-wide' }));
  }

  function newEventView(overlay) {
    const prefill = overlay.prefill || {};
    const form = overlay.form ??= { category: 'walk', place: prefill.place || null, startsAt: roundTo5(Date.now() + 2 * 3600000), hours: 2, visibility: 'public', title: '', description: '', capacity: '' };
    const title = h('input', { class: 'sx-input', maxlength: 80, minlength: 3, required: true, placeholder: t('sx.ev.titlePlaceholder'), value: form.title, oninput: () => { form.title = title.value; } });
    const description = h('textarea', { class: 'sx-input', maxlength: 600, rows: 3, placeholder: t('sx.ev.descPlaceholder'), oninput: () => { form.description = description.value; } });
    description.value = form.description;
    const capacity = h('input', { class: 'sx-input', type: 'number', min: 2, max: 500, inputmode: 'numeric', placeholder: t('sx.ev.noLimit'), value: form.capacity, oninput: () => { form.capacity = capacity.value; } });
    const group = (options, key) => {
      const row = h('div', { class: 'sx-chips' });
      const draw = () => row.replaceChildren(...options.map(([value, label]) => chip(label, form[key] === value, () => { form[key] = value; draw(); })));
      draw();
      return row;
    };
    return h('form', { class: 'sx-form', onsubmit: async submitEvent => {
      submitEvent.preventDefault();
      if (!form.place) { toast(t('sx.pickPlace'), 'error'); return; }
      const { id, name, lat, lon } = form.place;
      const created = await run(() => social.act('createEvent', { title: title.value, description: description.value, category: form.category, place: { id, name, lat, lon },
        startsAt: form.startsAt, endsAt: form.startsAt + form.hours * 3600000, capacity: capacity.value ? Number(capacity.value) : null, visibility: form.visibility }), t('sx.ev.published'));
      if (created) { view.tab = 'events'; open({ type: 'event', id: created.event.id }); }
    } },
      h('h3', { class: 'sx-section-title' }, t('sx.ev.newTitle')),
      h('span', { class: 'sx-label' }, t('sx.titleLabel')), title,
      h('span', { class: 'sx-label' }, t('sx.ev.type')), group(EVENT_CATEGORIES.map(id => [id, t(`sx.cat.${id}`)]), 'category'),
      h('span', { class: 'sx-label' }, t('sx.where')), placePicker(overlay),
      h('span', { class: 'sx-label' }, t('sx.ev.start')), timePicker(form.startsAt, value => { form.startsAt = value; }),
      h('span', { class: 'sx-label' }, t('sx.ev.duration')), group([1, 2, 3, 5].map(hours => [hours, t(`sx.dur.${hours}`)]), 'hours'),
      h('span', { class: 'sx-label' }, t('sx.ev.capacity')), capacity,
      h('span', { class: 'sx-label' }, t('sx.ev.visibility')), group([['public', t('sx.ev.visPublic')], ['friends', t('sx.ev.visFriends')]], 'visibility'),
      h('span', { class: 'sx-label' }, t('sx.ev.description')), description,
      h('button', { type: 'submit', class: 'btn btn-primary sx-btn sx-wide' }, t('sx.ev.publish')),
      h('p', { class: 'sx-hint' }, t('sx.ev.rules')));
  }

  // ---------- notifications and profile ----------

  function notificationsView() {
    const list = data().notifications;
    const target = item => ['meetup_invite', 'meetup_changed', 'meetup_cancelled', 'meetup_vote', 'meetup_going', 'meetup_declined', 'meetup_on_way', 'meetup_arrived'].includes(item.type) ? { type: 'meetup', id: item.entityId }
      : ['event_invite', 'event_spot', 'event_cancelled', 'event_joined'].includes(item.type) ? { type: 'event', id: item.entityId }
        : ['friend_added', 'location_shared'].includes(item.type) ? { type: 'friend', id: item.entityId }
          : item.type === 'location_request' ? { type: 'share' } : null;
    const canAsk = 'Notification' in window && Notification.permission === 'default';
    const ask = canAsk ? h('div', { class: 'sx-note' }, h('p', {}, t('sx.nt.ask')),
      button(t('sx.nt.enable'), async () => { await Notification.requestPermission().catch(() => {}); render(true); }, 'ghost')) : null;
    return h('div', { class: 'sx-stack' }, h('h3', { class: 'sx-section-title' }, t('sx.notifications')), ask,
      list.length ? h('ul', { class: 'sx-list' }, list.map(item => h('li', {}, h('button', { type: 'button', class: `sx-row${item.read ? '' : ' is-unread'}`, onclick: () => { const next = target(item); if (next) open(next); } },
        item.actor ? avatar(item.actor, 'sm') : h('span', { class: 'sx-avatar sx-avatar-sm' }, '🔔'),
        h('span', { class: 'sx-row-text sx-wrap' }, h('strong', {}, notificationText(item, social.getState())), h('span', {}, ago(item.createdAt)))))))
        : h('p', { class: 'sx-empty' }, t('sx.nt.empty')));
  }

  function profileView() {
    const me = data().me;
    let emoji = me.emoji;
    const name = h('input', { class: 'sx-input', maxlength: 32, value: me.name, 'aria-label': t('sx.name') });
    const picker = h('div', { class: 'sx-emoji-grid', role: 'radiogroup', 'aria-label': t('sx.emoji') },
      EMOJIS.map(value => h('button', { type: 'button', class: 'sx-emoji', role: 'radio', 'aria-checked': String(value === emoji), 'aria-label': value,
        onclick: event => { emoji = value; for (const node of picker.children) node.setAttribute('aria-checked', String(node === event.currentTarget)); } }, value)));
    const linkBox = h('div', { class: 'sx-link-box' });
    const blocked = data().blocked || [];
    return h('div', { class: 'sx-stack' },
      h('div', { class: 'sx-profile-head' }, avatar(me, 'xl'), h('h3', {}, me.name)),
      h('form', { class: 'sx-form', onsubmit: async event => { event.preventDefault(); await run(() => social.act('updateProfile', { name: name.value, emoji }), t('sx.saved')); } },
        h('span', { class: 'sx-label' }, t('sx.name')), name, h('span', { class: 'sx-label' }, t('sx.emoji')), picker, h('button', { type: 'submit', class: 'btn btn-ghost sx-btn' }, t('sx.save'))),
      h('section', { class: 'sx-card', id: 'sx-watch-link' }, h('strong', {}, t('sx.watch.title')),
        h('p', { class: 'sx-hint' }, t('sx.watch.hint')),
        button(t('sx.watch.link'), async () => {
          const result = await run(() => social.act('linkDevice'));
          if (result) linkBox.replaceChildren(h('p', { class: 'sx-invite-code sx-watch-code', 'aria-label': t('sx.watch.codeLabel', { code: result.code.split('').join(' ') }) }, result.code.replace(/(\d{3})(\d{3})/, '$1 $2')),
            h('p', {}, t('sx.watch.openBefore'), h('strong', {}, `${location.host}/watch`), t('sx.watch.openAfter')),
            h('p', { class: 'sx-hint' }, t('sx.watch.until', { time: clock(result.expiresAt) })));
        }, 'primary'), linkBox),
      blocked.length ? h('section', { class: 'sx-card' }, h('strong', {}, t('sx.blockedTitle')), h('ul', { class: 'sx-list' }, blocked.map(person => h('li', { class: 'sx-row' }, avatar(person, 'sm'), h('span', { class: 'sx-row-text' }, h('strong', {}, person.name)),
        button(t('sx.unblock'), () => run(() => social.act('unblockUser', { userId: person.id }), t('sx.unblocked')), 'ghost'))))) : null,
      h('section', { class: 'sx-card' }, h('strong', {}, t('sx.privacy.title')),
        h('p', { class: 'sx-hint' }, t('sx.privacy.text')),
        h('div', { class: 'sx-actions' }, button(t('sx.signOut'), () => run(() => social.signOut()), 'ghost'),
          button(t('sx.deleteProfile'), async () => { if (confirm(t('sx.deleteConfirm'))) await run(() => social.signOut({ deleteAccount: true }), t('sx.deleted')); }, 'ghost', { class: 'btn btn-ghost sx-btn sx-danger' }))));
  }

  // ---------- render ----------

  const STATIC = new Set(['share', 'invite', 'meet', 'newMeetup', 'newEvent', 'profile', 'addToMeetup', 'inviteEvent', 'pickPlace']);
  let body = null;

  function overlayView(overlay) {
    switch (overlay.type) {
      case 'share': return shareForm();
      case 'invite': return inviteView();
      case 'friend': return friendDetail(overlay.id);
      case 'meet': return meetView(overlay);
      case 'newMeetup': return newMeetupView(overlay);
      case 'pickPlace': return pickPlaceView(overlay);
      case 'meetup': return meetupDetail(overlay.id);
      case 'addToMeetup': return addToMeetupView(overlay.id);
      case 'newEvent': return newEventView(overlay);
      case 'event': return eventDetail(overlay.id);
      case 'inviteEvent': return inviteEventView(overlay.id);
      case 'notifications': return notificationsView();
      case 'profile': return profileView();
      default: return null;
    }
  }

  function tabs() {
    const count = (data()?.meetups || []).filter(item => item.myStatus === 'invited' && item.status === 'active').length;
    return h('div', { class: 'sx-segments', role: 'tablist' }, [['friends', t('sx.title')], ['meetups', count ? t('sx.meetupsCount', { n: count }) : t('sx.meetups')], ['events', t('sx.events')]].map(([id, label]) =>
      h('button', { type: 'button', role: 'tab', class: 'sx-segment', 'aria-selected': String(view.tab === id), onclick: () => { view.tab = id; if (id === 'events') social.loadEvents(true); render(true); } }, label)));
  }

  function render(force = false) {
    const state = social.getState();
    const overlay = view.overlay;
    // Forms keep what the person typed: polling refreshes lists and details, not open forms.
    if (!force && overlay && STATIC.has(overlay.type) && body) { updateMap(); return; }
    // An open «Управление встречей» holds a time picker: refresh it only after the host acts.
    if (!force && body && container.querySelector('details[open][data-pause-refresh]')) { updateMap(); return; }
    // Place dots are on the map only while a place is picked there.
    if (overlay?.type !== 'pickPlace') layer?.showPlaces(null);
    let content;
    if (!state.token) content = overlay?.type === 'event' ? overlayView(overlay) : onboarding();
    else if (!state.data) content = h('p', { class: 'sx-hint' }, state.error || t('sx.loading'));
    else if (overlay) content = overlayView(overlay);
    else content = h('div', {}, tabs(), view.tab === 'friends' ? friendsView() : view.tab === 'meetups' ? meetupsView() : eventsView());
    const typed = [...container.querySelectorAll('[data-keep]')].map(field => ({ key: field.dataset.keep, value: field.value, focused: field === document.activeElement,
      start: field.selectionStart, end: field.selectionEnd }));
    body = h('div', { class: 'sx-body' }, content);
    // The map picker keeps the sheet low, so it has its own one-line head instead of the tab's.
    const head = overlay?.type === 'pickPlace' ? null : state.token && state.data ? header() : overlay ? h('header', { class: 'sx-header' }, backButton()) : null;
    container.replaceChildren(...[head, body].filter(Boolean));
    layer?.markPlace(overlay?.type === 'pickPlace' ? overlay.candidate : ['newMeetup', 'newEvent'].includes(overlay?.type) ? overlay.form?.place : null);
    // Polling re-renders details every few seconds; what the person is typing survives it, with focus and caret.
    for (const entry of typed) {
      const field = container.querySelector(`[data-keep="${entry.key}"]`);
      if (!field) continue;
      field.value = entry.value;
      if (entry.focused) { field.focus({ preventScroll: true }); try { field.setSelectionRange(entry.start, entry.end); } catch { /* not a text field */ } }
    }
    updateMap();
  }

  let fittedFriends = false;
  function updateMap() {
    if (!layer) return;
    const state = social.getState();
    if (!fittedFriends && !view.overlay && view.tab === 'friends' && state.data) {
      const located = state.data.friends.filter(item => item.location?.lat !== undefined).map(item => item.location);
      if (located.length) { fittedFriends = true; const mine = myPoint(); layer.fit(mine ? [...located, mine] : located, 70); }
    }
    const showEvents = view.tab === 'events' || view.overlay?.type === 'event';
    const badges = {};
    for (const item of state.data?.meetups || []) for (const member of item.members) if (member.status === 'on_way') badges[member.id] = statusText('on_way');
    const sharedPoint = state.data?.share?.hasPoint ? { lat: state.data.share.lat, lon: state.data.share.lon } : null;
    const me = state.data && sharedPoint ? { ...state.data.me, ...sharedPoint } : null;
    layer.update({ me, friends: state.data?.friends || [], meetups: state.data?.meetups || [], events: showEvents ? state.events : [], badges });
  }

  const unsubscribe = social.onChange((state, reason) => {
    if (reason?.type === 'notifications') {
      for (const item of reason.items.slice(0, 2)) toast(notificationText(item, state), 'info');
      if (document.visibilityState === 'hidden' && 'Notification' in window && Notification.permission === 'granted') {
        for (const item of reason.items.slice(0, 2)) new Notification('Aidem', { body: notificationText(item, state), icon: '/assets/brand/seruen/icon-192.png' });
      }
      return;
    }
    if (reason === 'signed-out') { view.overlay = null; render(true); return; }
    render(reason === 'events' && (view.tab === 'events' || view.overlay?.type === 'event'));
  });

  social.setFocused(true);
  render(true);
  if (social.signedIn()) social.loadEvents();

  return {
    unmount() { social.setFocused(false); unsubscribe(); layer?.destroy(); container.remove(); },
    /** Draws the open screen again in the new language; an open form keeps what was typed and ticked. */
    relang() {
      const fields = () => [...container.querySelectorAll('input, textarea, select')];
      const ticked = field => field.type === 'checkbox' || field.type === 'radio';
      const before = fields().map(field => (ticked(field) ? field.checked : field.value));
      render(true);
      const after = fields();
      if (after.length === before.length) after.forEach((field, i) => { if (ticked(field)) field.checked = before[i]; else field.value = before[i]; });
    },
    planMeetup(placeInfo) {
      const chosen = placeOf(placeInfo);
      // Without a profile the place waits for it: the invitation opens right after the profile is created.
      if (!social.signedIn()) { view.pendingPlace = chosen; toast(t('sx.needProfile'), 'info'); view.overlay = null; render(true); return; }
      open({ type: 'newMeetup', prefill: { place: chosen, title: placeInfo.name } });
    },
    async openInvite(code) {
      try {
        const preview = await social.api(`invite?code=${encodeURIComponent(code)}`);
        if (preview.own) { toast(t('sx.ownInvite'), 'info'); return; }
        if (social.signedIn()) {
          if (preview.alreadyFriends) toast(t('sx.alreadyFriend', { name: preview.inviter.name }), 'info');
          else await acceptInvite(code);
          return;
        }
        view.pendingInvite = { code, inviter: preview.inviter };
        render(true);
      } catch (error) { toast(error.message, 'error'); }
    },
    openEvent(id) { open({ type: 'event', id }); },
    openMeetup(id) { if (social.signedIn()) open({ type: 'meetup', id }); }
  };
}
