// App shell: the tab registry, the tab bar and a small view stack inside each tab.
// Other teams add a screen with registerTab() from their own module (see /mnt/project-files/build-with-ai-2026/v2/design/README.md).
import { h, icon, clear } from './core/dom.js';
import { t, pick, lang } from './core/i18n.js';
import * as store from './core/store.js';
import { on, emit } from './core/store.js';
import * as api from './core/api.js';
import * as mapApi from './map/map.js';
import { toast, announce } from './ui/toast.js';
import { setSnap, ensureAtLeast, getSnap } from './ui/sheet.js';

const tabs = [];
let active = null;
let root = null;
let bar = null;

export function registerTab(tab) {
  if (tabs.some((item) => item.id === tab.id)) return;
  tabs.push({ order: 50, ...tab });
  tabs.sort((a, b) => a.order - b.order);
  if (bar) renderBar();
}

// toast(message, kind) from other teams' modules is accepted too: the kind only picks an icon.
const KIND_ICON = { success: 'check', ok: 'check', error: 'warning', warning: 'warning', info: 'info' };
const toastAny = (message, options) => toast(message, typeof options === 'string' ? { iconName: KIND_ICON[options] } : options);

export const context = () => ({ map: mapApi.getMap(), maplibregl: mapApi.getMaplibre(), mapApi, h, icon, clear, t, pick, lang, store, api,
  toast: toastAny, announce, setSnap, openSheet: setSnap, ensureAtLeast, getSnap, on, emit, open: openTab });

export function initShell(rootEl, barEl) {
  root = rootEl;
  bar = barEl;
  renderBar();
  // A tab with relang() redraws itself in the new language and keeps what is open in it; the others mount again.
  on('lang', () => { renderBar(); if (active?.relang) active.relang(context()); else if (active) mount(active, true); });
}

function title(tab) { return typeof tab.title === 'string' ? t(tab.title) : pick(tab.title); }

function renderBar() {
  clear(bar, ...tabs.map((tab) => h('button', {
    class: 'tab', type: 'button', role: 'tab', id: `tab-${tab.id}`, 'aria-selected': String(active?.id === tab.id), 'aria-controls': 'sheet-body',
    onclick: () => openTab(tab.id),
  }, icon(tab.icon), h('span', { text: title(tab) }))));
}

function mount(tab, remount = false) {
  if (!remount && active?.id === tab.id) return;
  active?.unmount?.(context());
  if (active?.id !== tab.id) window.scrollTo(0, 0);
  active = tab;
  root.replaceChildren();
  root.dataset.tab = tab.id;
  root.scrollTop = 0;
  if (tab.ownMap || mapApi.getMap() || mapApi.mapFailed()) tab.mount(root, context());
  else {
    // A tab opened by a link before the map exists still gets the map once it is there (or after a short wait).
    const wait = Promise.race([mapApi.mapReady, new Promise((resolve) => setTimeout(resolve, 2500))]);
    wait.then(() => { if (active === tab && !root.childElementCount) tab.mount(root, context()); });
  }
  renderBar();
  emit('tab', tab.id);
}

export function openTab(id, params) {
  const tab = tabs.find((item) => item.id === id);
  if (!tab) return;
  if (active?.id === id) { tab.reopen?.(params); return; }
  mount(tab);
  if (params) tab.reopen?.(params);
  const url = new URL(location.href);
  if (id === tabs[0]?.id) url.searchParams.delete('tab'); else url.searchParams.set('tab', id);
  history.replaceState(null, '', url);
}

export const activeTab = () => active?.id;
export const allTabs = () => tabs.map((tab) => tab.id);
