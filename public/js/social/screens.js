// The "Друзья" tab: profile, friends on the map, location sharing by consent, a fair meeting point,
// meetups with friends and city events. Built from the shell's tokens and components (btn, chip).
import * as social from './service.js';
import { createSocialLayer, CATEGORY_EMOJI } from './map-layer.js';

const EMOJIS = ['🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐸', '🐵', '🦄', '🐙', '🦉', '🐧', '🐳', '🦋', '🌻', '🌵', '🍀', '⚡', '🔥', '🌙', '⭐', '🎧', '🎨', '⚽', '🚲', '☕', '📚', '🏔'];
const KINDS = [['any', 'Любое'], ['coffee', '☕ Кофе'], ['food', '🍽 Поесть'], ['park', '🌳 Парк'], ['indoor', '🏬 Под крышей']];
const NOTES = ['☕ Свободен на кофе', '🚶 Гуляю', '🍽 Хочу поесть', '⏳ Занят, позже'];
const EVENT_CATEGORIES = [['walk', '🚶 Прогулка'], ['sport', '🏃 Спорт'], ['food', '🍽 Еда'], ['culture', '🎭 Культура'], ['study', '📚 Учёба'], ['kids', '🧸 С детьми'], ['other', '✨ Другое']];
const STATUS = { going: 'идёт', maybe: 'может быть', declined: 'не сможет', on_way: 'в пути', arrived: 'на месте', invited: 'ещё не ответил(а)' };
const CATEGORY_NAMES = { cafe: 'кафе', restaurant: 'еда', park: 'парк', mall: 'ТРЦ', attraction: 'место', museum: 'музей', culture: 'культура', playground: 'площадка' };

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
function clock(ts) { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function dayLabel(ts) {
  const d = new Date(ts), today = new Date();
  const start = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(d) - start(today)) / 86400000);
  if (diff === 0) return 'сегодня';
  if (diff === 1) return 'завтра';
  if (diff === -1) return 'вчера';
  return d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' });
}
const when = ts => `${dayLabel(ts)} в ${clock(ts)}`;
function ago(ts) {
  const minutes = Math.round((Date.now() - ts) / 60000);
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин назад`;
  return `${Math.round(minutes / 60)} ч назад`;
}
function until(ts) {
  const minutes = Math.round((ts - Date.now()) / 60000);
  if (minutes <= -90) return `было ${when(ts)}`;
  if (minutes < 0) return `началось ${-minutes} мин назад`;
  if (minutes === 0) return 'прямо сейчас';
  if (minutes < 60) return `через ${minutes} мин`;
  if (minutes < 24 * 60) return `через ${Math.round(minutes / 60)} ч`;
  return when(ts);
}
function left(ts) {
  const minutes = Math.max(0, Math.round((ts - Date.now()) / 60000));
  return minutes < 60 ? `ещё ${minutes} мин` : `ещё ${Math.round(minutes / 60)} ч`;
}
function km(meters) { return meters < 1000 ? `${Math.round(meters / 10) * 10} м` : `${(meters / 1000).toFixed(1).replace('.', ',')} км`; }
function localInput(ts) { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }
const roundTo5 = ts => Math.ceil(ts / 300000) * 300000;
function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
}

function routeLinks(target) {
  return h('div', { class: 'sx-links' },
    h('a', { class: 'sx-link', href: `https://2gis.kz/astana/geo/${target.lon},${target.lat}`, target: '_blank', rel: 'noopener noreferrer' }, 'Открыть в 2ГИС'),
    h('a', { class: 'sx-link', href: `https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lon}&travelmode=walking`, target: '_blank', rel: 'noopener noreferrer' }, 'Маршрут в Google Maps'));
}

function downloadCalendar({ title, startsAt, endsAt, place, description = '' }) {
  const stamp = ts => new Date(ts).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const escape = value => String(value).replace(/[\\;,]/g, match => `\\${match}`).replace(/\n/g, '\\n');
  const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ulger//Astana//RU', 'BEGIN:VEVENT', `UID:${crypto.randomUUID()}@ulger`, `DTSTAMP:${stamp(Date.now())}`,
    `DTSTART:${stamp(startsAt)}`, `DTEND:${stamp(endsAt ?? startsAt + 3600000)}`, `SUMMARY:${escape(title)}`, `LOCATION:${escape(place.name)}`, `GEO:${place.lat};${place.lon}`,
    `DESCRIPTION:${escape(description)}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const link = h('a', { href: URL.createObjectURL(new Blob([body], { type: 'text/calendar' })), download: 'ulger.ics' });
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
  const layer = ctx.map ? createSocialLayer(ctx.map, maplibregl, {
    onFriend: id => open({ type: 'friend', id }),
    onMeetup: id => open({ type: 'meetup', id }),
    onEvent: id => open({ type: 'event', id }),
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
      toast(error.message || 'Не получилось', 'error');
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
  const myPoint = () => {
    const share = data()?.share;
    if (share?.hasPoint) return { lat: share.lat, lon: share.lon };
    const last = social.getState().geo.last;
    return last && Date.now() - last.at < 5 * 60_000 ? last : null;
  };

  function open(overlay) {
    view.overlay = overlay;
    if (overlay?.type === 'meet') view.meeting = null;
    if (overlay?.type === 'event' || view.tab === 'events') social.loadEvents();
    if (overlay?.type === 'notifications' && data()?.unread) social.act('markRead').catch(() => {});
    ctx.openSheet?.('half');
    view.justOpened = true;
    render(true);
    view.justOpened = false;
    root.scrollTop = 0;
    container.scrollTop = 0;
  }
  function close() {
    if (view.overlay?.type === 'meet') { view.meeting = null; layer?.clearMeeting(); }
    view.overlay = null;
    render(true);
    root.scrollTop = 0;
  }

  // ---------- header ----------

  function header() {
    const state = data();
    if (!state) return null;
    return h('header', { class: 'sx-header' },
      h('h2', { class: 'sx-title' }, view.overlay ? backButton() : 'Друзья'),
      h('div', { class: 'sx-header-actions' },
        h('button', { type: 'button', class: 'sx-icon-button', 'aria-label': `Уведомления${state.unread ? `: ${state.unread} новых` : ''}`, onclick: () => open({ type: 'notifications' }) },
          '🔔', state.unread ? h('span', { class: 'sx-badge' }, state.unread > 9 ? '9+' : state.unread) : null),
        h('button', { type: 'button', class: 'sx-icon-button', 'aria-label': 'Мой профиль', onclick: () => open({ type: 'profile' }) }, avatar(state.me, 'sm'))));
  }
  function backButton() {
    return h('button', { type: 'button', class: 'sx-back', onclick: close }, '‹ Назад');
  }

  // ---------- onboarding ----------

  function onboarding() {
    const invite = view.pendingInvite;
    let emoji = EMOJIS[Math.floor(Math.random() * 12)];
    const name = h('input', { class: 'sx-input', id: 'sx-name', maxlength: 32, autocomplete: 'nickname', placeholder: 'Как вас зовут друзья', required: true });
    const picker = h('div', { class: 'sx-emoji-grid', role: 'radiogroup', 'aria-label': 'Значок' },
      EMOJIS.map(value => h('button', { type: 'button', class: 'sx-emoji', role: 'radio', 'aria-checked': String(value === emoji), 'aria-label': value,
        onclick: event => { emoji = value; for (const node of picker.children) node.setAttribute('aria-checked', String(node === event.currentTarget)); } }, value)));
    const start = async event => {
      event.preventDefault();
      const me = await run(() => social.register(name.value, emoji));
      if (!me) return;
      root.scrollTop = 0;
      if (invite) await acceptInvite(invite.code);
      else toast(`Профиль создан, ${me.name}!`, 'success');
    };
    const code = h('input', { class: 'sx-input sx-code-input', inputmode: 'numeric', maxlength: 6, placeholder: '123456', 'aria-label': 'Код с другого устройства' });
    return h('div', { class: 'sx-onboarding' },
      invite?.inviter ? h('div', { class: 'sx-invite-card' }, avatar(invite.inviter, 'lg'), h('div', {}, h('strong', {}, `${invite.inviter.name} зовёт вас в друзья`), h('p', {}, 'Создайте профиль за 10 секунд, и вы сразу окажетесь в друзьях.'))) : null,
      h('div', { class: 'sx-hero' }, h('div', { class: 'sx-hero-faces', 'aria-hidden': 'true' }, '🦊', '🐻', '🐼'),
        h('h2', {}, 'Гуляйте вместе'),
        h('p', {}, 'Смотрите, кто из друзей рядом, и встречайтесь там, куда всем идти примерно одинаково.')),
      h('ul', { class: 'sx-promises' },
        h('li', {}, h('span', {}, '🔒'), 'Без почты и телефона: только имя и значок.'),
        h('li', {}, h('span', {}, '⏱'), 'Ваше место видно друзьям, только когда вы сами включите, и только на 15 минут, час или 8 часов.'),
        h('li', {}, h('span', {}, '✋'), 'Остановить можно в одно касание. Истории перемещений нет.')),
      h('form', { class: 'sx-form', onsubmit: start },
        h('label', { class: 'sx-label', for: 'sx-name' }, 'Имя'), name,
        h('span', { class: 'sx-label' }, 'Значок'), picker,
        h('button', { type: 'submit', class: 'btn btn-primary sx-btn sx-wide' }, invite?.inviter ? `Начать и добавить: ${invite.inviter.name}` : 'Начать')),
      h('details', { class: 'sx-details' }, h('summary', {}, 'Уже есть профиль на телефоне? Войти по коду'),
        h('form', { class: 'sx-inline-form', onsubmit: async event => { event.preventDefault(); const me = await run(() => social.claimDevice(code.value)); if (me) { root.scrollTop = 0; toast(`Вы вошли как ${me.name}`, 'success'); } } },
          code, button('Войти', null, 'primary', { type: 'submit' })),
        h('p', { class: 'sx-hint' }, 'Код показывается в профиле на другом устройстве: «Связать часы».')));
  }

  async function acceptInvite(code) {
    const result = await run(() => social.act('acceptInvite', { code }));
    view.pendingInvite = null;
    if (result) toast(result.already ? `${result.friend.name} уже у вас в друзьях` : `${result.friend.name} теперь у вас в друзьях`, 'success');
    render(true);
  }

  // ---------- sharing ----------

  function shareCard() {
    const share = data().share;
    const geo = social.getState().geo;
    if (!share) {
      return h('section', { class: 'sx-share is-off' },
        h('div', {}, h('strong', {}, 'Вас не видно на карте'), h('p', {}, 'Включите, когда хотите, чтобы друзья нашли вас.')),
        button('Показать друзьям, где я', () => open({ type: 'share' }), 'gold'));
    }
    const audience = share.audience === 'all' ? 'все друзья' : `${share.recipients.length} ${plural(share.recipients.length, 'друг', 'друга', 'друзей')}`;
    return h('section', { class: 'sx-share is-on', 'aria-live': 'polite' },
      h('span', { class: 'sx-live-dot', 'aria-hidden': 'true' }),
      h('div', {}, h('strong', {}, 'Вы на карте'),
        h('p', {}, `${share.mode === 'approximate' ? 'Примерно' : 'Точно'} · ${left(share.expiresAt)} · видят ${audience}`),
        share.note ? h('p', {}, `«${share.note}»`) : null,
        geo.error ? h('p', { class: 'sx-warning' }, geo.error) : !share.hasPoint ? h('p', { class: 'sx-hint' }, 'Определяем местоположение…') : null),
      button('Остановить', () => run(() => social.stopShare(), 'Показ места остановлен, точка удалена'), 'ghost', { class: 'btn btn-ghost sx-btn sx-stop' }));
  }

  function shareForm() {
    const choice = { minutes: 60, mode: 'approximate', audience: 'all', recipients: new Set(), note: '' };
    const body = h('div', { class: 'sx-form' });
    const consent = h('input', { type: 'checkbox', id: 'sx-consent' });
    const submit = button('Включить', async () => {
      if (!consent.checked) { toast('Подтвердите согласие', 'error'); return; }
      const share = await run(() => social.startShare({ minutes: choice.minutes, mode: choice.mode, audience: choice.audience, recipients: [...choice.recipients], note: choice.note }));
      if (share) { toast('Друзья видят вас на карте', 'success'); close(); }
    }, 'primary', { class: 'btn btn-primary sx-btn sx-wide', disabled: true });
    consent.addEventListener('change', () => { submit.disabled = !consent.checked; });
    const consentText = h('span');
    const updateConsent = () => {
      const whom = choice.audience === 'all' ? 'все мои друзья' : choice.recipients.size ? 'выбранные друзья' : 'выбранные друзья (выберите хотя бы одного)';
      consentText.textContent = `Я согласен(на): ${whom} увидят ${choice.mode === 'approximate' ? 'примерное' : 'точное'} место до ${clock(Date.now() + choice.minutes * 60000)}. Остановить можно в любой момент.`;
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
    const note = h('input', { class: 'sx-input', maxlength: 60, placeholder: 'Свой статус, например «У Байтерека до 18:00»', oninput: () => { choice.note = note.value; drawNotes(); } });
    const notes = h('div', { class: 'sx-chips' });
    const drawNotes = () => notes.replaceChildren(...NOTES.map(text => chip(text, choice.note === text, () => { choice.note = choice.note === text ? '' : text; note.value = choice.note; drawNotes(); })));
    drawNotes(); drawPicker(); updateConsent();
    body.append(
      h('h3', { class: 'sx-section-title' }, 'Показать друзьям, где я'),
      ...group('На сколько', [[15, '15 мин'], [60, '1 час'], [480, '8 часов']], 'minutes'),
      ...group('Точность', [['approximate', 'Примерно, ≈150 м'], ['precise', 'Точно']], 'mode'),
      ...group('Кому', [['all', 'Всем друзьям'], ['selected', 'Выбранным']], 'audience', drawPicker), picker,
      h('span', { class: 'sx-label' }, 'Статус для друзей'), notes, note,
      h('label', { class: 'sx-consent', for: 'sx-consent' }, consent, consentText),
      submit,
      h('p', { class: 'sx-hint' }, 'Храним только последнюю точку, без истории. Когда срок закончится или вы нажмёте «Остановить», точка удаляется. В ИИ координаты не передаются.'));
    return body;
  }

  // ---------- friends ----------

  function friendSubtitle(item) {
    const location = item.location;
    if (!location) return 'не показывает место';
    if (location.lat === undefined) return 'включил(а) показ, место ещё определяется';
    const mine = myPoint();
    const parts = [mine ? `${km(social.distanceMeters(mine, location))} · ≈${social.walkMinutes(mine, location)} мин пешком` : 'на карте'];
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
      list.length ? h('button', { type: 'button', class: 'sx-hero-action', onclick: () => open({ type: 'meet' }) },
        h('span', { class: 'sx-hero-action-icon', 'aria-hidden': 'true' }, '🤝'),
        h('span', {}, h('strong', {}, 'Где встретиться?'), h('span', {}, 'Место, до которого всем идти примерно одинаково'))) : null,
      nearby.length ? h('p', { class: 'sx-nearby' }, `Рядом с вами: ${nearby.slice(0, 3).map(entry => `${entry.item.name} (${entry.minutes} мин)`).join(', ')}`) : null,
      h('div', { class: 'sx-list-head' }, h('h3', { class: 'sx-section-title' }, list.length ? `Друзья · ${list.length}` : 'Друзья'), button('+ Добавить', () => open({ type: 'invite' }), 'ghost')),
      list.length ? h('ul', { class: 'sx-list' }, list.map(item => h('li', {},
        h('button', { type: 'button', class: 'sx-row', onclick: () => open({ type: 'friend', id: item.id }) },
          avatar(item, 'md', item.location ? 'is-sharing' : ''),
          h('span', { class: 'sx-row-text' }, h('strong', {}, item.name), h('span', {}, friendSubtitle(item))),
          h('span', { class: 'sx-chevron', 'aria-hidden': 'true' }, '›')))))
        : h('div', { class: 'sx-empty' }, h('p', {}, 'Пока нет друзей. Отправьте ссылку или покажите QR-код: друг откроет его и сразу окажется у вас в списке.'),
          button('Пригласить друга', () => open({ type: 'invite' }), 'primary')),
      h('button', { type: 'button', class: 'sx-link sx-watch-entry', onclick: () => { open({ type: 'profile' }); document.getElementById('sx-watch-link')?.scrollIntoView({ block: 'center' }); } }, '⌚ Связать часы: встречи и друзья на запястье'));
  }

  function friendDetail(id) {
    const item = friend(id);
    if (!item) return h('p', { class: 'sx-empty' }, 'Этого человека больше нет в друзьях.');
    const location = item.location;
    if (view.justOpened && location?.lat !== undefined) layer?.fit([location]);
    return h('div', { class: 'sx-stack' },
      h('div', { class: 'sx-profile-head' }, avatar(item, 'xl', location ? 'is-sharing' : ''), h('h3', {}, item.name), h('p', {}, friendSubtitle(item)),
        location ? h('p', { class: 'sx-hint' }, `Показывает место ${location.mode === 'approximate' ? 'примерно' : 'точно'}, ${left(location.expiresAt)}`) : null,
        h('p', { class: 'sx-hint' }, item.iShareWith ? 'Вы показываете ему(ей) своё место' : 'Вы не показываете ему(ей) своё место')),
      h('div', { class: 'sx-actions' },
        location?.lat !== undefined ? button('Показать на карте', () => { layer?.fit([location]); ctx.openSheet?.('peek'); }, 'ghost') : null,
        button('Позвать встретиться', () => open({ type: 'meet', preselect: [item.id] }), 'primary'),
        !location ? button('Попросить показать место', () => run(() => social.act('pingFriend', { userId: item.id }), `${item.name} получит просьбу. Решать ему(ей).`), 'ghost') : null),
      h('details', { class: 'sx-details' }, h('summary', {}, 'Ещё'),
        h('div', { class: 'sx-actions' },
          button('Удалить из друзей', async () => { if (confirm(`Удалить ${item.name} из друзей?`)) { if (await run(() => social.act('removeFriend', { userId: item.id }), 'Удалено')) close(); } }, 'ghost'),
          button('Заблокировать', async () => { if (confirm(`Заблокировать ${item.name}? Он(а) не сможет снова добавить вас и увидеть ваше место.`)) { if (await run(() => social.act('blockUser', { userId: item.id }), 'Заблокировано')) close(); } }, 'ghost', { class: 'btn btn-ghost sx-btn sx-danger' }))));
  }

  function inviteView() {
    const box = h('div', { class: 'sx-stack' }, h('h3', { class: 'sx-section-title' }, 'Пригласить друга'), h('p', { class: 'sx-hint' }, 'Создаём ссылку…'));
    social.act('createInvite').then(({ code, expiresAt }) => {
      const link = `${location.origin}${location.pathname}?friend=${code}`;
      const qr = h('div', { class: 'sx-qr', role: 'img', 'aria-label': 'QR-код приглашения' });
      loadQr().then(factory => {
        const code = factory(0, 'M');
        code.addData(link);
        code.make();
        qr.innerHTML = code.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
      }).catch(() => { qr.hidden = true; });
      const copy = async () => { try { await navigator.clipboard.writeText(link); toast('Ссылка скопирована', 'success'); } catch { prompt('Скопируйте ссылку', link); } };
      const share = () => navigator.share({ title: 'Ulger', text: `${data().me.name} зовёт вас в друзья в Ulger: гулять по Астане вместе`, url: link }).catch(() => {});
      const own = h('input', { class: 'sx-input sx-code-input', maxlength: 8, placeholder: 'Код друга', autocapitalize: 'characters', 'aria-label': 'Код приглашения друга' });
      box.replaceChildren(
        h('h3', { class: 'sx-section-title' }, 'Пригласить друга'),
        h('p', { class: 'sx-hint' }, 'Друг наводит камеру на код или открывает ссылку — и вы сразу друзья. Ссылка действует до ' + when(expiresAt) + '.'),
        qr,
        h('p', { class: 'sx-invite-code' }, code),
        h('div', { class: 'sx-actions' }, navigator.share ? button('Поделиться ссылкой', share, 'primary') : null, button('Скопировать ссылку', copy, navigator.share ? 'ghost' : 'primary')),
        h('form', { class: 'sx-inline-form', onsubmit: event => { event.preventDefault(); acceptInvite(own.value.trim()); } }, own, button('Добавить', null, 'ghost', { type: 'submit' })),
        h('p', { class: 'sx-hint' }, 'Есть код друга? Введите его здесь.'));
    }).catch(error => box.replaceChildren(h('p', { class: 'sx-warning' }, error.message)));
    return box;
  }

  // ---------- where to meet ----------

  function meetView(preselect = []) {
    const selected = new Set(preselect.length ? preselect : friends().filter(item => item.location?.lat !== undefined).map(item => item.id).slice(0, 3));
    let kind = 'any';
    const wrap = h('div', { class: 'sx-stack' });
    const results = h('div', { class: 'sx-meet-results', 'aria-live': 'polite' });
    const drawChooser = () => {
      const list = friends();
      wrap.replaceChildren(
        h('h3', { class: 'sx-section-title' }, 'Где встретиться?'),
        h('p', { class: 'sx-hint' }, 'Подберём место из базы, до которого всем идти примерно одинаково, и проверим часы работы на время прихода.'),
        h('span', { class: 'sx-label' }, 'С кем'),
        h('div', { class: 'sx-chips sx-friend-chips' }, list.map(item => chip([avatar(item, 'xs'), item.name, item.location?.lat === undefined ? h('span', { class: 'sx-muted' }, ' · без места') : ''], selected.has(item.id), () => {
          selected.has(item.id) ? selected.delete(item.id) : selected.add(item.id); drawChooser();
        }))),
        h('span', { class: 'sx-label' }, 'Что ищем'),
        h('div', { class: 'sx-chips' }, KINDS.map(([value, label]) => chip(label, kind === value, () => { kind = value; drawChooser(); }))),
        button('Найти место', find, 'primary', { class: 'btn btn-primary sx-btn sx-wide', disabled: !selected.size }),
        results);
      if (view.meeting) renderMeeting();
    };
    async function find() {
      results.replaceChildren(h('p', { class: 'sx-hint' }, 'Считаем, кому сколько идти…'));
      const here = data().share?.hasPoint ? null : await social.currentPosition();
      const result = await run(() => social.api('meeting-point', { userIds: [...selected], kind, ...(here ? { me: { lat: here.lat, lon: here.lon } } : {}) }));
      if (!result) { results.replaceChildren(); return; }
      const people = result.participants.map(person => {
        if (person.self) { const point = here || myPoint(); return { ...person, ...(point ? { lat: point.lat, lon: point.lon } : {}) }; }
        const known = friend(person.id);
        return { ...person, lat: known?.location?.lat, lon: known?.location?.lon };
      });
      view.meeting = { result, people, selected: 0, invitees: [...selected].filter(id => result.participants.some(person => person.id === id)) };
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
      result.missing.length ? h('p', { class: 'sx-warning' }, `Без точки: ${result.missing.map(item => item.name).join(', ')}. Их можно позвать, но расчёт сделан без них.`) : null,
      result.options.length ? null : h('p', { class: 'sx-empty' }, 'Не нашли подходящего открытого места в пределах 45 минут для всех. Попробуйте «Любое».'),
      ...result.options.map((option, index) => h('article', { class: `sx-option${index === meeting.selected ? ' is-selected' : ''}`, onclick: () => { meeting.selected = index; renderMeeting(); } },
        h('div', { class: 'sx-option-head' }, h('span', { class: 'sx-option-number' }, index + 1),
          h('div', {}, h('strong', {}, option.place.name), h('span', {}, `${CATEGORY_NAMES[option.place.category] || 'место'} · ${option.why}`))),
        h('ul', { class: 'sx-walks' }, option.walks.map(walk => {
          const person = name(walk.userId) || {};
          return h('li', {}, avatar(person, 'xs'), h('span', { class: 'sx-walk-name' }, person.self ? 'Вы' : person.name),
            h('span', { class: 'sx-walk-bar' }, h('span', { style: { width: `${Math.round(walk.minutes / longest * 100)}%`, '--avatar': person.color } })),
            h('span', { class: 'sx-walk-min' }, `${walk.minutes} мин`));
        })),
        h('p', { class: `sx-hours${option.hours.status === 'open' ? ' is-open' : ''}` }, option.hours.status === 'open' ? (option.hours.closesAt ? `Открыто до ${option.hours.closesAt} (по данным OSM)` : 'Открыто круглосуточно (по данным OSM)') : 'Часы работы неизвестны, проверьте перед выходом'),
        h('div', { class: 'sx-actions' },
          button('Позвать сюда', event => { event.stopPropagation(); inviteHere(option); }, index === meeting.selected ? 'gold' : 'ghost'),
          h('a', { class: 'sx-link', href: option.place.sourceUrl, target: '_blank', rel: 'noopener noreferrer', onclick: event => event.stopPropagation() }, 'Источник: OSM')))),
      result.options.length >= 2 ? h('div', { class: 'sx-vote-cta' },
        h('p', {}, 'Не можете решить? Отправьте друзьям все варианты: место выберется голосованием.'),
        button(`Предложить на выбор (${result.options.length})`, () => inviteToVote(), 'primary', { class: 'btn btn-primary sx-btn sx-wide' })) : null,
      h('p', { class: 'sx-hint' }, result.method.note));
  }

  async function inviteToVote() {
    const meeting = view.meeting;
    if (!meeting.invitees.length) { toast('Выберите хотя бы одного друга', 'error'); return; }
    const longest = Math.max(...meeting.result.options.map(option => option.maxMinutes));
    const startsAt = roundTo5(Date.now() + (longest + 15) * 60000);
    const titles = { coffee: 'Кофе', food: 'Поесть вместе', park: 'Прогулка', indoor: 'Встреча', any: 'Встреча' };
    const options = meeting.result.options.map(option => ({ id: option.place.id, name: option.place.name, lat: option.place.lat, lon: option.place.lon }));
    const created = await run(() => social.act('createMeetup', { title: titles[meeting.result.kind] || 'Встреча', options, startsAt, invitees: meeting.invitees }), 'Друзья выбирают место');
    if (created) { layer?.clearMeeting(); view.meeting = null; view.tab = 'meetups'; open({ type: 'meetup', id: created.meetup.id }); }
  }

  async function inviteHere(option) {
    const meeting = view.meeting;
    if (!meeting.invitees.length) { toast('Выберите хотя бы одного друга', 'error'); return; }
    const startsAt = roundTo5(Date.now() + (option.maxMinutes + 5) * 60000);
    const titles = { coffee: 'Кофе', food: 'Поесть вместе', park: 'Прогулка', indoor: 'Встреча', any: 'Встреча' };
    const created = await run(() => social.act('createMeetup', { title: titles[meeting.result.kind] || 'Встреча', place: { id: option.place.id, name: option.place.name, lat: option.place.lat, lon: option.place.lon }, startsAt, invitees: meeting.invitees }), 'Приглашение отправлено');
    if (created) { layer?.clearMeeting(); view.meeting = null; view.tab = 'meetups'; open({ type: 'meetup', id: created.meetup.id }); }
  }

  // ---------- place picker ----------

  function placePicker(initial, onPick) {
    let chosen = initial || null;
    const input = h('input', { class: 'sx-input', placeholder: 'Название места, например «Байтерек» или «кофе»', autocomplete: 'off', 'aria-label': 'Поиск места' });
    const list = h('ul', { class: 'sx-suggestions' });
    const current = h('p', { class: 'sx-picked' });
    const show = () => { current.textContent = chosen ? `📍 ${chosen.name}` : 'Место не выбрано'; current.classList.toggle('is-empty', !chosen); };
    let timer;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const query = input.value.trim();
        if (query.length < 2) { list.replaceChildren(); return; }
        const center = ctx.map?.getCenter?.();
        try {
          const result = await social.api(`places?q=${encodeURIComponent(query)}${center ? `&lat=${center.lat}&lon=${center.lng}` : ''}`);
          list.replaceChildren(...result.places.map(item => h('li', {}, h('button', { type: 'button', class: 'sx-suggestion', onclick: () => {
            chosen = { id: item.id, name: item.name, lat: item.lat, lon: item.lon }; onPick(chosen); show(); list.replaceChildren(); input.value = '';
          } }, h('strong', {}, item.name), h('span', {}, `${CATEGORY_NAMES[item.category] || 'место'}${item.distanceMeters !== undefined ? ` · ${km(item.distanceMeters)} от центра карты` : ''}`)))));
          if (!result.places.length) list.replaceChildren(h('li', { class: 'sx-hint' }, 'Ничего не нашли. Можно взять центр карты.'));
        } catch (error) { list.replaceChildren(h('li', { class: 'sx-warning' }, error.message)); }
      }, 250);
    });
    const mapCenter = ctx.map ? button('Центр карты', () => {
      const center = ctx.map.getCenter();
      chosen = { id: null, name: 'Точка на карте', lat: Math.round(center.lat * 1e5) / 1e5, lon: Math.round(center.lng * 1e5) / 1e5 };
      onPick(chosen); show();
    }, 'ghost') : null;
    const here = button('Где я сейчас', async () => {
      const point = await social.currentPosition();
      if (!point) { toast('Не удалось определить местоположение', 'error'); return; }
      chosen = { id: null, name: 'Рядом со мной', lat: Math.round(point.lat * 1e5) / 1e5, lon: Math.round(point.lon * 1e5) / 1e5 };
      onPick(chosen); show();
    }, 'ghost');
    show();
    return h('div', { class: 'sx-place-picker' }, current, input, list, h('div', { class: 'sx-actions' }, mapCenter, here));
  }

  function timePicker(initial, onPick) {
    let value = initial;
    const input = h('input', { type: 'datetime-local', class: 'sx-input', value: localInput(value), 'aria-label': 'Дата и время', onchange: () => { const ts = new Date(input.value).getTime(); if (Number.isFinite(ts)) { value = ts; onPick(ts); draw(); } } });
    const evening = (() => { const d = new Date(); d.setHours(19, 0, 0, 0); if (d.getTime() < Date.now() + 30 * 60000) d.setDate(d.getDate() + 1); return d.getTime(); })();
    const presets = [['Через 15 мин', roundTo5(Date.now() + 15 * 60000)], ['Через 30 мин', roundTo5(Date.now() + 30 * 60000)], ['Через час', roundTo5(Date.now() + 60 * 60000)], [dayLabel(evening) === 'сегодня' ? 'Вечером в 19:00' : 'Завтра в 19:00', evening]];
    const row = h('div', { class: 'sx-chips' });
    const draw = () => row.replaceChildren(...presets.map(([label, ts]) => chip(label, Math.abs(ts - value) < 60000, () => { value = ts; input.value = localInput(ts); onPick(ts); draw(); })));
    draw();
    return h('div', {}, row, input);
  }

  // ---------- meetups ----------

  function meetupsView() {
    const list = (data().meetups || []).slice().sort((a, b) => (a.status === 'cancelled') - (b.status === 'cancelled') || a.startsAt - b.startsAt);
    return h('div', { class: 'sx-stack' },
      h('div', { class: 'sx-list-head' }, h('h3', { class: 'sx-section-title' }, 'Встречи'), button('+ Новая', () => open({ type: 'newMeetup' }), 'ghost', { disabled: !friends().length })),
      list.length ? h('ul', { class: 'sx-list' }, list.map(item => h('li', {}, meetupRow(item))))
        : h('div', { class: 'sx-empty' }, h('p', {}, friends().length ? 'Встреч пока нет. Нажмите «Где встретиться?» на вкладке друзей или создайте встречу.' : 'Сначала добавьте друга, потом зовите его встретиться.'),
          friends().length ? button('Новая встреча', () => open({ type: 'newMeetup' }), 'primary') : button('Пригласить друга', () => open({ type: 'invite' }), 'primary')));
  }

  function meetupRow(item) {
    const going = item.members.filter(member => ['going', 'on_way', 'arrived'].includes(member.status));
    return h('button', { type: 'button', class: `sx-row sx-meetup-row${item.status === 'cancelled' ? ' is-cancelled' : ''}`, onclick: () => open({ type: 'meetup', id: item.id }) },
      h('span', { class: 'sx-when' }, h('strong', {}, clock(item.startsAt)), h('span', {}, dayLabel(item.startsAt))),
      h('span', { class: 'sx-row-text' }, h('strong', {}, item.title),
        h('span', {}, item.status === 'cancelled' ? 'отменена' : `${item.place.name} · ${until(item.startsAt)}`),
        h('span', { class: 'sx-faces' }, going.slice(0, 5).map(member => avatar(member, 'xs')), item.poll?.open ? h('span', { class: 'sx-pill is-gold' }, item.poll.myVote === null ? 'Голосуйте за место' : 'Идёт голосование') : item.myStatus === 'invited' ? h('span', { class: 'sx-pill is-gold' }, 'Ждут ответа') : item.changed ? h('span', { class: 'sx-pill is-amber' }, 'Изменено') : null)),
      h('span', { class: 'sx-chevron', 'aria-hidden': 'true' }, '›'));
  }

  function newMeetupView(prefill = {}) {
    const form = { place: prefill.place || null, startsAt: prefill.startsAt || roundTo5(Date.now() + 30 * 60000), invitees: new Set(prefill.invitees || []) };
    const title = h('input', { class: 'sx-input', maxlength: 60, placeholder: 'Например: кофе после пар', value: prefill.title || '' });
    const note = h('input', { class: 'sx-input', maxlength: 200, placeholder: 'Комментарий, необязательно' });
    const people = h('div', { class: 'sx-chips sx-friend-chips' });
    const drawPeople = () => people.replaceChildren(...friends().map(item => chip([avatar(item, 'xs'), item.name], form.invitees.has(item.id), () => { form.invitees.has(item.id) ? form.invitees.delete(item.id) : form.invitees.add(item.id); drawPeople(); })));
    drawPeople();
    return h('form', { class: 'sx-form', onsubmit: async event => {
      event.preventDefault();
      if (!form.place) { toast('Выберите место', 'error'); return; }
      if (!form.invitees.size) { toast('Позовите хотя бы одного друга', 'error'); return; }
      const created = await run(() => social.act('createMeetup', { title: title.value, note: note.value, place: form.place, startsAt: form.startsAt, invitees: [...form.invitees] }), 'Приглашение отправлено');
      if (created) { view.tab = 'meetups'; open({ type: 'meetup', id: created.meetup.id }); }
    } },
      h('h3', { class: 'sx-section-title' }, 'Новая встреча'),
      h('span', { class: 'sx-label' }, 'Кого позвать'), people,
      h('span', { class: 'sx-label' }, 'Где'), placePicker(form.place, value => { form.place = value; }),
      h('span', { class: 'sx-label' }, 'Когда'), timePicker(form.startsAt, value => { form.startsAt = value; }),
      h('span', { class: 'sx-label' }, 'Название'), title, note,
      h('button', { type: 'submit', class: 'btn btn-primary sx-btn sx-wide' }, 'Позвать'));
  }

  function meetupDetail(id) {
    const item = meetup(id);
    if (!item) return data() ? h('p', { class: 'sx-empty' }, 'Встреча не найдена или уже прошла.') : h('p', { class: 'sx-hint' }, 'Загружаем встречу…');
    const me = data().me;
    const rsvp = status => run(() => social.act('rsvpMeetup', { id, status }));
    const statusButtons = item.status === 'cancelled' ? null
      : ['invited', 'maybe', 'declined'].includes(item.myStatus) ? h('div', { class: 'sx-actions' }, button('Иду', () => rsvp('going'), 'primary'), button('Может быть', () => rsvp('maybe'), 'ghost'), button('Не смогу', () => rsvp('declined'), 'ghost'))
        : h('div', { class: 'sx-actions' },
          item.myStatus !== 'on_way' && item.myStatus !== 'arrived' ? button('🚶 Я в пути', () => rsvp('on_way'), 'gold') : null,
          item.myStatus !== 'arrived' ? button('📍 Я на месте', () => rsvp('arrived'), item.myStatus === 'on_way' ? 'gold' : 'ghost') : null,
          button('Не смогу', () => rsvp('declined'), 'ghost'));
    const message = h('input', { class: 'sx-input', maxlength: 280, placeholder: 'Написать участникам', 'aria-label': 'Сообщение', 'data-keep': `chat-${id}` });
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
      return member.status === 'on_way' && located?.lat !== undefined ? ` · ≈${social.walkMinutes(located, item.place)} мин до места` : '';
    };
    if (view.justOpened) layer?.fit([item.place]);
    return h('div', { class: 'sx-stack' },
      h('div', { class: 'sx-detail-head' }, h('span', { class: 'sx-kicker' }, item.status === 'cancelled' ? 'Отменена' : until(item.startsAt)),
        h('h3', {}, item.title), h('p', {}, `${when(item.startsAt)} · ${item.place.name}`),
        item.changed ? h('p', { class: 'sx-warning' }, 'Организатор изменил время или место. Подтвердите, что придёте.') : null,
        item.note ? h('p', { class: 'sx-note' }, item.note) : null),
      pollBlock(item),
      statusButtons,
      h('h4', { class: 'sx-label' }, 'Кто идёт'),
      h('ul', { class: 'sx-members' }, item.members.map(member => h('li', { class: `is-${member.status}` }, avatar(member, 'sm'),
        h('span', {}, h('strong', {}, member.id === me.id ? 'Вы' : member.name), h('span', {}, `${STATUS[member.status] || member.status}${etaFor(member)}${member.id === item.host?.id ? ' · организатор' : ''}`))))),
      routeLinks(item.place),
      h('div', { class: 'sx-actions' }, button('В календарь', () => downloadCalendar({ title: item.title, startsAt: item.startsAt, place: item.place, description: item.note }), 'ghost'),
        item.isHost && item.status !== 'cancelled' ? button('Позвать ещё', () => open({ type: 'addToMeetup', id }), 'ghost') : null),
      h('h4', { class: 'sx-label' }, 'Сообщения'),
      h('ul', { class: 'sx-chat' }, item.messages.length ? item.messages.map(entry => h('li', { class: entry.author.id === me.id ? 'is-mine' : '' }, avatar(entry.author, 'xs'), h('span', {}, h('strong', {}, entry.author.id === me.id ? 'Вы' : entry.author.name), ' ', entry.body)))
        : h('li', { class: 'sx-hint' }, 'Напишите, если опаздываете.')),
      item.status !== 'cancelled' ? h('form', { class: 'sx-inline-form', onsubmit: send },
        message, button('Отправить', null, 'primary', { type: 'submit' })) : null,
      item.isHost && item.status !== 'cancelled' ? h('details', { class: 'sx-details', 'data-pause-refresh': '' }, h('summary', {}, 'Управление встречей'),
        h('div', { class: 'sx-form' }, h('span', { class: 'sx-label' }, 'Перенести'), (() => { let next = item.startsAt; return [timePicker(next, value => { next = value; }), button('Сохранить новое время', () => run(() => social.act('updateMeetup', { id, startsAt: next }), 'Участники получили уведомление'), 'ghost')]; })(),
          button('Отменить встречу', async () => { if (confirm('Отменить встречу для всех?')) await run(() => social.act('cancelMeetup', { id }), 'Встреча отменена'); }, 'ghost', { class: 'btn btn-ghost sx-btn sx-danger' }))) : null);
  }

  function pollBlock(item) {
    const poll = item.poll;
    if (!poll) return null;
    if (!poll.open) return h('p', { class: 'sx-hint' }, `Место выбрано голосованием: ${item.place.name}.`);
    const members = new Map(item.members.map(member => [member.id, member]));
    const mine = myPoint();
    const most = Math.max(1, ...poll.options.map(option => option.voters.length));
    return h('section', { class: 'sx-poll', 'aria-label': 'Голосование за место' },
      h('div', { class: 'sx-poll-head' }, h('h4', { class: 'sx-label' }, 'Где встречаемся? Голосуйте'), h('span', { class: 'sx-pill' }, `${poll.voted} из ${poll.eligible}`)),
      h('ul', { class: 'sx-poll-options' }, poll.options.map(option => {
        const chosen = poll.myVote === option.index;
        const walk = mine ? ` · ≈${social.walkMinutes(mine, option.place)} мин от вас` : '';
        return h('li', { class: chosen ? 'is-chosen' : '' },
          h('button', { type: 'button', class: 'sx-poll-option', 'aria-pressed': String(chosen), onclick: () => run(() => social.act('voteMeetup', { id: item.id, option: option.index }), chosen ? null : 'Голос учтён') },
            h('span', { class: 'sx-option-number' }, option.index + 1),
            h('span', { class: 'sx-row-text' }, h('strong', {}, option.place.name), h('span', {}, `${option.voters.length ? `${option.voters.length} ${plural(option.voters.length, 'голос', 'голоса', 'голосов')}` : 'пока без голосов'}${walk}`),
              h('span', { class: 'sx-poll-bar' }, h('span', { style: { width: `${Math.round(option.voters.length / most * 100)}%` } })),
              h('span', { class: 'sx-faces' }, option.voters.map(voter => members.get(voter)).filter(Boolean).map(member => avatar(member, 'xs')))),
            h('span', { class: 'sx-poll-check', 'aria-hidden': 'true' }, chosen ? '✓' : '')),
          item.isHost ? button('Выбрать это место', () => run(() => social.act('decideMeetup', { id: item.id, option: option.index }), 'Место выбрано, участники получили уведомление'), 'ghost', { class: 'btn btn-ghost sx-btn sx-small' }) : null);
      })),
      h('p', { class: 'sx-hint' }, item.isHost ? 'Место выберется само, когда проголосуют все. Можно выбрать и раньше.' : 'Место выберется само, когда проголосуют все.'));
  }

  function addToMeetupView(id) {
    const item = meetup(id);
    const present = new Set(item?.members.map(member => member.id));
    const chosen = new Set();
    const row = h('div', { class: 'sx-chips sx-friend-chips' });
    const draw = () => row.replaceChildren(...friends().filter(entry => !present.has(entry.id)).map(entry => chip([avatar(entry, 'xs'), entry.name], chosen.has(entry.id), () => { chosen.has(entry.id) ? chosen.delete(entry.id) : chosen.add(entry.id); draw(); })));
    draw();
    return h('div', { class: 'sx-form' }, h('h3', { class: 'sx-section-title' }, 'Позвать ещё'), row.children.length ? row : h('p', { class: 'sx-hint' }, 'Все друзья уже приглашены.'),
      button('Позвать', async () => { if (await run(() => social.act('inviteToMeetup', { id, userIds: [...chosen] }), 'Приглашения отправлены')) open({ type: 'meetup', id }); }, 'primary', { class: 'btn btn-primary sx-btn sx-wide' }));
  }

  // ---------- events ----------

  function eventsView() {
    const all = social.getState().events;
    const filters = [['all', 'Все'], ['today', 'Сегодня'], ['friends', 'Друзья идут'], ['mine', 'Мои']];
    const today = new Date(); today.setHours(23, 59, 59, 999);
    const list = all.filter(item => view.eventFilter === 'all' ? true
      : view.eventFilter === 'today' ? item.startsAt <= today.getTime()
        : view.eventFilter === 'friends' ? item.friendsGoing.length > 0
          : item.isHost || item.myStatus);
    return h('div', { class: 'sx-stack' },
      h('div', { class: 'sx-list-head' }, h('h3', { class: 'sx-section-title' }, 'События в городе'), button('+ Создать', () => open({ type: 'newEvent' }), 'ghost')),
      h('div', { class: 'sx-chips' }, filters.map(([value, label]) => chip(label, view.eventFilter === value, () => { view.eventFilter = value; render(true); }))),
      list.length ? h('ul', { class: 'sx-list' }, list.map(item => h('li', {}, eventRow(item))))
        : h('div', { class: 'sx-empty' }, h('p', {}, all.length ? 'Под этот фильтр ничего нет.' : 'Пока никто не создал событие. Соберите пробежку, прогулку или настолки — люди рядом увидят его на карте.'),
          button('Создать событие', () => open({ type: 'newEvent' }), 'primary')));
  }

  function capacityText(item) {
    if (item.capacity) return `${item.going} из ${item.capacity}${item.waitlist ? ` · в листе ожидания ${item.waitlist}` : ''}`;
    return `${item.going} ${plural(item.going, 'идёт', 'идут', 'идут')}`;
  }

  function eventRow(item) {
    return h('button', { type: 'button', class: `sx-row sx-event-row${item.status !== 'active' ? ' is-cancelled' : ''}`, onclick: () => open({ type: 'event', id: item.id }) },
      h('span', { class: 'sx-event-glyph', 'aria-hidden': 'true' }, CATEGORY_EMOJI[item.category] || '✨'),
      h('span', { class: 'sx-row-text' }, h('strong', {}, item.title),
        h('span', {}, `${when(item.startsAt)} · ${item.place.name}`),
        h('span', { class: 'sx-faces' }, item.friendsGoing.slice(0, 4).map(person => avatar(person, 'xs')), h('span', {}, item.status === 'cancelled' ? 'отменено' : item.status === 'hidden' ? 'скрыто после жалоб' : capacityText(item)),
          item.myStatus === 'going' ? h('span', { class: 'sx-pill is-green' }, 'Вы идёте') : item.myStatus === 'waitlist' ? h('span', { class: 'sx-pill is-amber' }, 'Лист ожидания') : null)),
      h('span', { class: 'sx-chevron', 'aria-hidden': 'true' }, '›'));
  }

  function eventDetail(id) {
    const item = event(id);
    if (!item) {
      social.api(`event?id=${encodeURIComponent(id)}`).then(result => { social.getState().events.push(result.event); view.justOpened = true; render(true); view.justOpened = false; })
        .catch(error => { toast(error.message, 'error'); close(); });
      return h('p', { class: 'sx-hint' }, 'Загружаем событие…');
    }
    if (view.justOpened) layer?.fit([item.place]);
    const signed = social.signedIn();
    const join = () => signed ? run(() => social.act('joinEvent', { id }), null).then(result => result && toast(result.event.myStatus === 'waitlist' ? 'Мест нет: вы в листе ожидания, сообщим, если освободится' : 'Вы идёте!', 'success')) : toast('Создайте профиль на вкладке «Друзья», чтобы записаться', 'info');
    const link = `${location.origin}${location.pathname}?event=${item.id}`;
    const share = () => navigator.share ? navigator.share({ title: item.title, text: `${item.title} · ${when(item.startsAt)} · ${item.place.name}`, url: link }).catch(() => {})
      : navigator.clipboard.writeText(link).then(() => toast('Ссылка скопирована', 'success')).catch(() => prompt('Скопируйте ссылку', link));
    const full = item.capacity !== null && item.going >= item.capacity;
    return h('div', { class: 'sx-stack' },
      h('div', { class: 'sx-detail-head' }, h('span', { class: 'sx-kicker' }, `${CATEGORY_EMOJI[item.category] || '✨'} ${item.status === 'cancelled' ? 'Отменено' : until(item.startsAt)}`),
        h('h3', {}, item.title), h('p', {}, `${when(item.startsAt)}–${clock(item.endsAt)} · ${item.place.name}`),
        h('p', { class: 'sx-hint' }, `Организатор: ${item.host?.name || '—'} · ${item.visibility === 'friends' ? 'только для друзей организатора' : 'открытое событие'}`),
        item.description ? h('p', { class: 'sx-note' }, item.description) : null),
      h('p', { class: 'sx-capacity' }, capacityText(item), item.friendsGoing.length ? h('span', { class: 'sx-faces' }, ' · друзья: ', item.friendsGoing.map(person => avatar(person, 'xs')), item.friendsGoing.map(person => person.name).join(', ')) : null),
      item.status === 'active' ? h('div', { class: 'sx-actions' },
        !item.myStatus ? button(full ? 'В лист ожидания' : 'Иду', join, 'primary')
          : item.isHost ? h('span', { class: 'sx-pill is-green' }, 'Вы организатор')
            : button(item.myStatus === 'waitlist' ? 'Выйти из листа ожидания' : 'Не пойду', () => run(() => social.act('leaveEvent', { id }), 'Готово'), 'ghost'),
        signed && friends().length ? button('Позвать друзей', () => open({ type: 'inviteEvent', id }), 'ghost') : null,
        button('Поделиться', share, 'ghost')) : null,
      routeLinks(item.place),
      h('div', { class: 'sx-actions' }, button('В календарь', () => downloadCalendar({ title: item.title, startsAt: item.startsAt, endsAt: item.endsAt, place: item.place, description: item.description }), 'ghost'),
        item.isHost && item.status === 'active' ? button('Отменить событие', async () => { if (confirm('Отменить событие для всех участников?')) await run(() => social.act('cancelEvent', { id }), 'Событие отменено'); }, 'ghost', { class: 'btn btn-ghost sx-btn sx-danger' }) : null,
        signed && !item.isHost ? button('Пожаловаться', async () => { const reason = prompt('Что не так с событием?'); if (reason !== null) await run(() => social.act('reportEvent', { id, reason }), 'Спасибо, жалоба отправлена'); }, 'ghost', { class: 'btn btn-ghost sx-btn sx-quiet' }) : null));
  }

  function inviteEventView(id) {
    const chosen = new Set();
    const row = h('div', { class: 'sx-chips sx-friend-chips' });
    const draw = () => row.replaceChildren(...friends().map(entry => chip([avatar(entry, 'xs'), entry.name], chosen.has(entry.id), () => { chosen.has(entry.id) ? chosen.delete(entry.id) : chosen.add(entry.id); draw(); })));
    draw();
    return h('div', { class: 'sx-form' }, h('h3', { class: 'sx-section-title' }, 'Позвать друзей на событие'), row,
      button('Позвать', async () => { if (chosen.size && await run(() => social.act('inviteToEvent', { id, userIds: [...chosen] }), 'Друзья получили приглашение')) open({ type: 'event', id }); }, 'primary', { class: 'btn btn-primary sx-btn sx-wide' }));
  }

  function newEventView(prefill = {}) {
    const form = { category: 'walk', place: prefill.place || null, startsAt: roundTo5(Date.now() + 2 * 3600000), hours: 2, visibility: 'public' };
    const title = h('input', { class: 'sx-input', maxlength: 80, minlength: 3, required: true, placeholder: 'Например: вечерняя пробежка по набережной' });
    const description = h('textarea', { class: 'sx-input', maxlength: 600, rows: 3, placeholder: 'Что будет, кому подойдёт, что взять с собой' });
    const capacity = h('input', { class: 'sx-input', type: 'number', min: 2, max: 500, inputmode: 'numeric', placeholder: 'Без ограничения' });
    const group = (options, key) => {
      const row = h('div', { class: 'sx-chips' });
      const draw = () => row.replaceChildren(...options.map(([value, label]) => chip(label, form[key] === value, () => { form[key] = value; draw(); })));
      draw();
      return row;
    };
    return h('form', { class: 'sx-form', onsubmit: async submitEvent => {
      submitEvent.preventDefault();
      if (!form.place) { toast('Выберите место', 'error'); return; }
      const created = await run(() => social.act('createEvent', { title: title.value, description: description.value, category: form.category, place: form.place,
        startsAt: form.startsAt, endsAt: form.startsAt + form.hours * 3600000, capacity: capacity.value ? Number(capacity.value) : null, visibility: form.visibility }), 'Событие опубликовано');
      if (created) { view.tab = 'events'; open({ type: 'event', id: created.event.id }); }
    } },
      h('h3', { class: 'sx-section-title' }, 'Новое событие'),
      h('span', { class: 'sx-label' }, 'Название'), title,
      h('span', { class: 'sx-label' }, 'Тип'), group(EVENT_CATEGORIES, 'category'),
      h('span', { class: 'sx-label' }, 'Где'), placePicker(form.place, value => { form.place = value; }),
      h('span', { class: 'sx-label' }, 'Начало'), timePicker(form.startsAt, value => { form.startsAt = value; }),
      h('span', { class: 'sx-label' }, 'Длительность'), group([[1, '1 час'], [2, '2 часа'], [3, '3 часа'], [5, '5 часов']], 'hours'),
      h('span', { class: 'sx-label' }, 'Мест'), capacity,
      h('span', { class: 'sx-label' }, 'Кто увидит'), group([['public', 'Все в городе'], ['friends', 'Только мои друзья']], 'visibility'),
      h('span', { class: 'sx-label' }, 'Описание'), description,
      h('button', { type: 'submit', class: 'btn btn-primary sx-btn sx-wide' }, 'Опубликовать'),
      h('p', { class: 'sx-hint' }, 'Не публикуйте личные данные. После трёх жалоб событие скрывается.'));
  }

  // ---------- notifications and profile ----------

  function notificationsView() {
    const list = data().notifications;
    const target = item => ['meetup_invite', 'meetup_changed', 'meetup_cancelled', 'meetup_vote', 'meetup_going', 'meetup_declined', 'meetup_on_way', 'meetup_arrived'].includes(item.type) ? { type: 'meetup', id: item.entityId }
      : ['event_invite', 'event_spot', 'event_cancelled', 'event_joined'].includes(item.type) ? { type: 'event', id: item.entityId }
        : ['friend_added', 'location_shared'].includes(item.type) ? { type: 'friend', id: item.entityId }
          : item.type === 'location_request' ? { type: 'share' } : null;
    const canAsk = 'Notification' in window && Notification.permission === 'default';
    const ask = canAsk ? h('div', { class: 'sx-note' }, h('p', {}, 'Можно получать уведомления, пока вкладка Ulger открыта в фоне.'),
      button('Включить уведомления', async () => { await Notification.requestPermission().catch(() => {}); render(true); }, 'ghost')) : null;
    return h('div', { class: 'sx-stack' }, h('h3', { class: 'sx-section-title' }, 'Уведомления'), ask,
      list.length ? h('ul', { class: 'sx-list' }, list.map(item => h('li', {}, h('button', { type: 'button', class: `sx-row${item.read ? '' : ' is-unread'}`, onclick: () => { const next = target(item); if (next) open(next); } },
        item.actor ? avatar(item.actor, 'sm') : h('span', { class: 'sx-avatar sx-avatar-sm' }, '🔔'),
        h('span', { class: 'sx-row-text sx-wrap' }, h('strong', {}, item.text), h('span', {}, ago(item.createdAt)))))))
        : h('p', { class: 'sx-empty' }, 'Пока тихо. Здесь появятся приглашения и ответы друзей.'));
  }

  function profileView() {
    const me = data().me;
    let emoji = me.emoji;
    const name = h('input', { class: 'sx-input', maxlength: 32, value: me.name, 'aria-label': 'Имя' });
    const picker = h('div', { class: 'sx-emoji-grid', role: 'radiogroup', 'aria-label': 'Значок' },
      EMOJIS.map(value => h('button', { type: 'button', class: 'sx-emoji', role: 'radio', 'aria-checked': String(value === emoji), 'aria-label': value,
        onclick: event => { emoji = value; for (const node of picker.children) node.setAttribute('aria-checked', String(node === event.currentTarget)); } }, value)));
    const linkBox = h('div', { class: 'sx-link-box' });
    const blocked = data().blocked || [];
    return h('div', { class: 'sx-stack' },
      h('div', { class: 'sx-profile-head' }, avatar(me, 'xl'), h('h3', {}, me.name)),
      h('form', { class: 'sx-form', onsubmit: async event => { event.preventDefault(); await run(() => social.act('updateProfile', { name: name.value, emoji }), 'Сохранено'); } },
        h('span', { class: 'sx-label' }, 'Имя'), name, h('span', { class: 'sx-label' }, 'Значок'), picker, h('button', { type: 'submit', class: 'btn btn-ghost sx-btn' }, 'Сохранить')),
      h('section', { class: 'sx-card', id: 'sx-watch-link' }, h('strong', {}, '⌚ Связать часы'),
        h('p', { class: 'sx-hint' }, 'На часах будут ваши встречи и друзья. Код действует 10 минут и срабатывает один раз. Также можно подключить второй телефон или планшет.'),
        button('Связать часы', async () => {
          const result = await run(() => social.act('linkDevice'));
          if (result) linkBox.replaceChildren(h('p', { class: 'sx-invite-code sx-watch-code', 'aria-label': `Код ${result.code.split('').join(' ')}` }, result.code.replace(/(\d{3})(\d{3})/, '$1 $2')),
            h('p', {}, 'Откройте на часах ', h('strong', {}, `${location.host}/watch`), ' → Встречи → Ввести код'),
            h('p', { class: 'sx-hint' }, `Код действует до ${clock(result.expiresAt)}. На другом телефоне или планшете: «Друзья и встречи» → «Войти по коду».`));
        }, 'primary'), linkBox),
      blocked.length ? h('section', { class: 'sx-card' }, h('strong', {}, 'Заблокированные'), h('ul', { class: 'sx-list' }, blocked.map(person => h('li', { class: 'sx-row' }, avatar(person, 'sm'), h('span', { class: 'sx-row-text' }, h('strong', {}, person.name)),
        button('Разблокировать', () => run(() => social.act('unblockUser', { userId: person.id }), 'Разблокировано'), 'ghost'))))) : null,
      h('section', { class: 'sx-card' }, h('strong', {}, 'Данные и приватность'),
        h('p', { class: 'sx-hint' }, 'Мы храним имя, значок, список друзей, встречи и события. Место — только пока вы его показываете, одну последнюю точку. Почты, телефона и истории перемещений нет.'),
        h('div', { class: 'sx-actions' }, button('Выйти на этом устройстве', () => run(() => social.signOut()), 'ghost'),
          button('Удалить профиль и все данные', async () => { if (confirm('Удалить профиль, друзей, встречи и события навсегда?')) await run(() => social.signOut({ deleteAccount: true }), 'Профиль удалён'); }, 'ghost', { class: 'btn btn-ghost sx-btn sx-danger' }))));
  }

  // ---------- render ----------

  const STATIC = new Set(['share', 'invite', 'meet', 'newMeetup', 'newEvent', 'profile', 'addToMeetup', 'inviteEvent']);
  let body = null;

  function overlayView(overlay) {
    switch (overlay.type) {
      case 'share': return shareForm();
      case 'invite': return inviteView();
      case 'friend': return friendDetail(overlay.id);
      case 'meet': return meetView(overlay.preselect);
      case 'newMeetup': return newMeetupView(overlay.prefill);
      case 'meetup': return meetupDetail(overlay.id);
      case 'addToMeetup': return addToMeetupView(overlay.id);
      case 'newEvent': return newEventView(overlay.prefill);
      case 'event': return eventDetail(overlay.id);
      case 'inviteEvent': return inviteEventView(overlay.id);
      case 'notifications': return notificationsView();
      case 'profile': return profileView();
      default: return null;
    }
  }

  function tabs() {
    const count = (data()?.meetups || []).filter(item => item.myStatus === 'invited' && item.status === 'active').length;
    return h('div', { class: 'sx-segments', role: 'tablist' }, [['friends', 'Друзья'], ['meetups', count ? `Встречи · ${count}` : 'Встречи'], ['events', 'События']].map(([id, label]) =>
      h('button', { type: 'button', role: 'tab', class: 'sx-segment', 'aria-selected': String(view.tab === id), onclick: () => { view.tab = id; if (id === 'events') social.loadEvents(true); render(true); } }, label)));
  }

  function render(force = false) {
    const state = social.getState();
    const overlay = view.overlay;
    // Forms keep what the person typed: polling refreshes lists and details, not open forms.
    if (!force && overlay && STATIC.has(overlay.type) && body) { updateMap(); return; }
    // An open «Управление встречей» holds a time picker: refresh it only after the host acts.
    if (!force && body && container.querySelector('details[open][data-pause-refresh]')) { updateMap(); return; }
    let content;
    if (!state.token) content = overlay?.type === 'event' ? overlayView(overlay) : onboarding();
    else if (!state.data) content = h('p', { class: 'sx-hint' }, state.error || 'Загружаем друзей…');
    else if (overlay) content = overlayView(overlay);
    else content = h('div', {}, tabs(), view.tab === 'friends' ? friendsView() : view.tab === 'meetups' ? meetupsView() : eventsView());
    const typed = [...container.querySelectorAll('[data-keep]')].map(field => ({ key: field.dataset.keep, value: field.value, focused: field === document.activeElement,
      start: field.selectionStart, end: field.selectionEnd }));
    body = h('div', { class: 'sx-body' }, content);
    container.replaceChildren(...[state.token && state.data ? header() : overlay ? h('header', { class: 'sx-header' }, backButton()) : null, body].filter(Boolean));
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
    for (const item of state.data?.meetups || []) for (const member of item.members) if (member.status === 'on_way') badges[member.id] = 'в пути';
    const sharedPoint = state.data?.share?.hasPoint ? { lat: state.data.share.lat, lon: state.data.share.lon } : null;
    const me = state.data && sharedPoint ? { ...state.data.me, ...sharedPoint } : null;
    layer.update({ me, friends: state.data?.friends || [], meetups: state.data?.meetups || [], events: showEvents ? state.events : [], badges });
  }

  const unsubscribe = social.onChange((state, reason) => {
    if (reason?.type === 'notifications') {
      for (const item of reason.items.slice(0, 2)) toast(item.text, 'info');
      if (document.visibilityState === 'hidden' && 'Notification' in window && Notification.permission === 'granted') {
        for (const item of reason.items.slice(0, 2)) new Notification('Ulger', { body: item.text, icon: '/assets/brand/seruen/icon-192.png' });
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
    planMeetup(placeInfo) {
      if (!social.signedIn()) { toast('Создайте профиль, чтобы звать друзей', 'info'); view.overlay = null; render(true); return; }
      open({ type: 'newMeetup', prefill: { place: { id: placeInfo.id ?? null, name: placeInfo.name, lat: placeInfo.lat, lon: placeInfo.lon }, title: placeInfo.name } });
    },
    async openInvite(code) {
      try {
        const preview = await social.api(`invite?code=${encodeURIComponent(code)}`);
        if (preview.own) { toast('Это ваша ссылка-приглашение. Отправьте её другу.', 'info'); return; }
        if (social.signedIn()) {
          if (preview.alreadyFriends) toast(`${preview.inviter.name} уже у вас в друзьях`, 'info');
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
