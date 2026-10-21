// Aidem bootstrap: theme, shell, bottom sheet, map, tabs, offline support.
import { $, h, icon } from './core/dom.js';
import { t } from './core/i18n.js';
import * as store from './core/store.js';
import { on } from './core/store.js';
import { applyTheme, isDark } from './core/theme.js';
import { initShell, openTab, allTabs } from './shell.js';
import { initSheet, setSnap, getSnap } from './ui/sheet.js';
import { langSwitch } from './ui/lang-switch.js';
import { askPhoto } from './ui/vision.js';
import { initMap, setDark, setPadding, refreshOverlays, toggleTilt, getMap, mapReady, marker, flyTo, userDot } from './map/map.js';
import { toast } from './ui/toast.js';
import { locateMe } from './core/where.js';
import './tabs/index.js';

applyTheme();

const sheet = $('#sheet');
const body = $('#sheet-body');
let lastSheet = null;
function applySheet(state) {
  lastSheet = state;
  const { visible, panel, desktop } = state;
  document.documentElement.style.setProperty('--sheet-visible', `${visible}px`);
  // The buttons on the right edge take about 60 px; framed points stay clear of them.
  setPadding(desktop ? { left: panel + 8, bottom: 0, top: 0, right: 64 } : { left: 0, bottom: Math.max(0, visible - 8), top: 60, right: 60 }, Boolean(getMap()));
}
on('sheet', applySheet);
initShell(body, $('#tabbar'));
initSheet(sheet, body, $('#sheet-handle'), $('#tabbar'));
mapReady.then(() => { if (lastSheet) applySheet(lastSheet); });

on('theme', (dark) => { setDark(dark); setTimeout(refreshOverlays, 50); });

// Map controls
// A fresh fix (never a cached one); on the walk tab it also becomes the start.
$('#fab-locate').addEventListener('click', () => {
  locateMe().then((fix) => {
    const lngLat = [fix.lon, fix.lat];
    locateMarker?.remove();
    if (document.querySelector('#sheet-body')?.dataset.tab !== 'walk') locateMarker = marker(userDot(), lngLat);
    flyTo(lngLat, 15);
  }, (failure) => toast(t(failure.reason === 'denied' ? 'start.denied' : 'start.failed'), { iconName: 'warning', duration: 6000 }));
});
let locateMarker = null;
$('#fab-tilt').addEventListener('click', (event) => {
  const on3d = toggleTilt();
  event.currentTarget.setAttribute('aria-pressed', String(on3d));
});
$('#fab-camera').addEventListener('click', askPhoto);
$('#fab-zoom-in').addEventListener('click', () => getMap()?.zoomIn());
$('#fab-zoom-out').addEventListener('click', () => getMap()?.zoomOut());

function labelControls() {
  $('#fab-locate').setAttribute('aria-label', t('fab.locate'));
  $('#fab-tilt').setAttribute('aria-label', t('fab.tilt'));
  $('#fab-camera').setAttribute('aria-label', t('vision.title'));
  $('#fab-zoom-in').setAttribute('aria-label', t('fab.zoomIn'));
  $('#fab-zoom-out').setAttribute('aria-label', t('fab.zoomOut'));
  $('#map').setAttribute('aria-label', t('map.label'));
  $('#sheet').setAttribute('aria-label', t('app.tagline'));
  $('.brand-city').textContent = t('app.city');
  $('.map-fabs').setAttribute('aria-label', t('map.controls'));
  $('#tabbar').setAttribute('aria-label', t('nav.sections'));
  $('#sheet-handle').setAttribute('aria-label', t(getSnap() === 'full' ? 'sheet.collapse' : 'sheet.expand'));
  document.title = t('app.title');
}
labelControls();
on('lang', labelControls);
// РУС · ҚАЗ · ENG over the map on phones, in the panel's header on desktop.
$('.topbar').append(langSwitch());
$('.sheet-brand').append(langSwitch());

document.addEventListener('seruen:map-unavailable', () => {
  document.body.classList.add('no-map');
  $('#map-note').hidden = false;
  $('#map-note').textContent = t('map.unavailable');
});

initMap($('#map'), { dark: isDark() });

// First tab: from the URL, else the walk planner.
const wanted = new URLSearchParams(location.search).get('tab');
openTab(allTabs().includes(wanted) ? wanted : 'walk');

// A walk in progress shows a pill on other tabs.
const pill = $('#live-pill');
pill.addEventListener('click', () => openTab('walk'));
function updatePill() {
  const walk = store.get('walk');
  const onWalkTab = document.querySelector('#sheet-body')?.dataset.tab === 'walk';
  pill.hidden = !walk || onWalkTab;
  if (walk) pill.replaceChildren(h('span', { class: 'rec-dot', 'aria-hidden': 'true' }), t('live.resume'));
}
on('tab', updatePill);
on('store:walk', updatePill);
updatePill();

// Offline support
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
addEventListener('offline', () => toast(t('toast.offline'), { iconName: 'warning' }));
addEventListener('online', () => toast(t('toast.online'), { iconName: 'check' }));

document.documentElement.classList.add('is-ready');
