// "Me": saved places, recent walks, language, theme, install, about and privacy.
import { registerTab, openTab } from '../shell.js';
import { h, icon, clear } from '../core/dom.js';
import { t, LANGS, lang, setLang, date as formatDate, number, time } from '../core/i18n.js';
import * as store from '../core/store.js';
import * as api from '../core/api.js';
import { categoryArt, categoryName } from '../ui/common.js';
import { applyTheme } from '../core/theme.js';
import { installState, promptInstall } from '../core/install.js';

let root = null;

function segmented(label, options, value, onChange) {
  const group = h('div', { class: 'segmented segmented-sm', role: 'radiogroup', 'aria-label': label },
    options.map(([id, text]) => h('button', { type: 'button', role: 'radio', class: 'seg', 'aria-checked': String(id === value), dataset: { id },
      onclick: () => { group.querySelectorAll('.seg').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.id === id))); onChange(id); } }, text)));
  return group;
}

function render() {
  const saved = Object.values(store.get('saved') || {}).sort((a, b) => b.savedAt - a.savedAt);
  const walks = store.get('history') || [];
  const install = installState();
  const dataLine = h('span', { class: 'num' });
  api.status().then((status) => { if (status) dataLine.textContent = t('me.dataValue', { count: number(status.poiCount), date: formatDate(status.updatedAt) || '—' }); });

  clear(root, h('section', { class: 'view me-view' },
    h('h1', { class: 'title-1', text: t('tab.me') }),
    h('h2', { class: 'block-title', text: t('me.saved') }),
    saved.length ? h('div', { class: 'list' }, saved.map((place) => h('button', { class: 'list-row', type: 'button', onclick: () => openTabWithPlace(place.id) },
      categoryArt(place.category, 36, 'art'), h('span', { class: 'row-text' }, h('strong', { text: place.name }), h('small', { text: categoryName(place.category) })), icon('chevron', 'row-chevron'))))
      : h('p', { class: 'empty-note' }, icon('heart'), t('me.savedEmpty')),
    h('h2', { class: 'block-title', text: t('me.history') }),
    walks.length ? h('div', { class: 'list' }, walks.slice(0, 6).map((item) => h('div', { class: 'list-row is-static' },
      item.place ? categoryArt(item.place.category, 36, 'art') : h('span', { class: 'row-icon', 'aria-hidden': 'true' }, icon('history')),
      h('span', { class: 'row-text' }, h('strong', { text: item.place ? item.place.name : (item.plan?.query || t('plan.submit')) }),
        h('small', { class: 'num', text: `${formatDate(item.at) || ''}, ${time(item.at)} · ${t('plan.min', { n: item.minutes ?? item.plan?.minutes ?? '' })}` })),
      item.kind === 'plan' ? h('button', { class: 'btn btn-quiet btn-sm', type: 'button', text: t('me.repeat'), onclick: () => repeat(item) }) : null)))
      : h('p', { class: 'empty-note' }, icon('history'), t('me.historyEmpty')),
    h('h2', { class: 'block-title', text: t('me.settings') }),
    h('div', { class: 'settings' },
      h('div', { class: 'setting' }, h('span', { text: t('me.lang') }), segmented(t('me.lang'), LANGS, lang(), (id) => setLang(id))),
      h('div', { class: 'setting' }, h('span', { text: t('me.theme') }), segmented(t('me.theme'), [['auto', t('me.theme.auto')], ['light', t('me.theme.light')], ['dark', t('me.theme.dark')]], store.get('theme') || 'auto', (id) => { store.set('theme', id); applyTheme(); }))),
    install === 'installed' ? h('p', { class: 'banner is-good' }, icon('check'), t('me.installed'))
      : h('div', { class: 'install-card' }, h('img', { src: '/assets/brand/seruen/icon-192.png', alt: '', width: 52, height: 52 }),
        h('div', {}, h('strong', { text: t('me.install') }), h('p', { class: 'fine', text: install === 'ios' ? t('me.installIos') : t('me.installText') })),
        install === 'available' ? h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: async () => { await promptInstall(); render(); } }, icon('install'), t('me.install').split(' ')[0]) : null),
    h('div', { class: 'install-card watch-card' }, h('span', { class: 'watch-card-icon', 'aria-hidden': 'true' }, icon('watch')),
      h('div', {}, h('strong', { text: t('me.watch') }), h('p', { class: 'fine', text: t('me.watchText') })),
      h('a', { class: 'btn btn-quiet btn-sm', href: '/watch' }, t('me.watchOpen'))),
    h('details', { class: 'disclosure' }, h('summary', {}, icon('loop'), t('me.about')), h('div', { class: 'prose' }, ['about.p1', 'about.p2', 'about.p3'].map((key) => h('p', { text: t(key) })), h('p', { class: 'fine', text: t('about.credit') }))),
    h('details', { class: 'disclosure' }, h('summary', {}, icon('info'), t('me.privacy')), h('div', { class: 'prose' }, ['privacy.p1', 'privacy.p2', 'privacy.p3', 'privacy.p4'].map((key) => h('p', { text: t(key) })))),
    h('p', { class: 'fine data-line' }, icon('map'), t('me.data'), ': ', dataLine),
    h('p', { class: 'fine center brand-foot' }, h('img', { src: '/assets/brand/seruen/mark.svg', alt: '', width: 20, height: 20 }), 'Seruen by Ascension')));
}

function openTabWithPlace(id) {
  const url = new URL(location.href);
  url.searchParams.set('place', id);
  history.replaceState(null, '', url);
  openTab('explore');
}

function repeat(item) {
  if (item.start) store.set('start', item.start);
  if (item.plan) store.set('plan', item.plan);
  const url = new URL(location.origin);
  url.searchParams.set('t', item.plan?.minutes || 45);
  if (item.plan?.query) url.searchParams.set('q', item.plan.query);
  if (item.start?.kind === 'preset') url.searchParams.set('from', item.start.id);
  else if (item.start) { url.searchParams.set('lat', item.start.lat); url.searchParams.set('lon', item.start.lon); }
  url.searchParams.set('go', '1');
  history.replaceState(null, '', url);
  openTab('walk');
}

registerTab({
  id: 'me', order: 90, icon: 'user', title: 'tab.me',
  mount(container) { root = container; render(); },
  reopen() { if (root) render(); },
  unmount() { root = null; },
});
