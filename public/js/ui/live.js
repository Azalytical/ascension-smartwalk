// "Walk in progress": a return countdown computed from timestamps, phases there / on site / back,
// a single turnaround alert, and the screen kept awake. The walk survives reloads (store key "walk").
// «Только туда» (walk.oneWay): no way back, so the walk ends on site and the countdown is to «закончите к».
import { h, icon, clear } from '../core/dom.js';
import { t, time } from '../core/i18n.js';
import { haversine } from '../core/geo.js';
import * as store from '../core/store.js';
import { timeRing } from './ring.js';
import { navLinks, categoryArt, watchButton } from './common.js';
import { toast, announce } from './toast.js';
import { ratingBlock } from './rating.js';
import { replanBlock } from './replan.js';
import './trip.js';
import { marker, fitPoints, userDot } from '../map/map.js';
import { showStart, showRoutes, upgradeRoute, hideRoutes, hideStart } from '../map/layers.js';

const PHASES = ['there', 'visit', 'back'];
const phasesOf = (walk) => (walk.oneWay ? PHASES.slice(0, 2) : PHASES);

/** `backAt` is the «вернётесь к» the card and the voice already said (the server's plan.backAt), kept when the walk starts on time. */
export function startWalk({ place, start, timing, backAt = null, oneWay = false }) {
  const walk = {
    startedAt: Date.now(), promised: backAt, phase: 'there', phaseAt: { there: Date.now() }, alerted: false, oneWay,
    place: { id: place.id, name: place.name, category: place.category, lat: place.lat, lon: place.lon },
    start: { name: start.name, lat: start.lat, lon: start.lon, kind: start.kind },
    plan: { there: Math.ceil(timing.walkMinutes), visit: Math.ceil(timing.visitMinutes), back: Math.ceil(timing.returnMinutes), reserve: Math.ceil(timing.safetyReserveMinutes ?? 5), total: Math.ceil(timing.totalMinutes) },
  };
  store.set('walk', walk);
  return walk;
}

let wakeLock = null;
async function keepAwake() {
  try { if ('wakeLock' in navigator && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen'); } catch { wakeLock = null; }
}

const pad = (n) => String(n).padStart(2, '0');
const minutesOf = (clockText) => { const [hours, minutes] = String(clockText).split(':').map(Number); return hours * 60 + minutes; };

/** «Вернётесь к»: there + on site + back, as on the card and in the voice. The reserve is spare time, shown on its own line. */
function backAt(walk) {
  const own = time(walk.startedAt + (walk.plan.there + walk.plan.visit + walk.plan.back) * 60000);
  if (!/^\d{1,2}:\d{2}$/.test(walk.promised || '')) return own;
  const gap = Math.abs(minutesOf(own) - minutesOf(walk.promised)) % 1440;
  return Math.min(gap, 1440 - gap) <= 2 ? walk.promised : own;
}
const clock = (seconds) => { const s = Math.abs(Math.round(seconds)); return `${Math.floor(s / 60)}:${pad(s % 60)}`; };

export function mountLive(container, { onFinished }) {
  let walk = store.get('walk');
  if (!walk) return () => {};
  let timer = null;
  let watchId = null;
  let placeMarker = null;
  let meMarker = null;
  let finished = null;
  // The latest GPS fix stays on the phone; «Что-то пошло не так?» plans from it.
  let fix = null;

  const ringHost = h('div', { class: 'live-ring' });
  const countdown = h('strong', { class: 'live-count num' });
  const countLabel = h('span', { class: 'live-count-label' });
  const returnLine = h('p', { class: 'live-return' });
  const spareLine = h('p', { class: 'live-spare' });
  const phaseLine = h('p', { class: 'live-phase' });
  const stepper = h('ol', { class: 'stepper' });
  const action = h('button', { class: 'btn btn-gold btn-xl live-action', type: 'button' });
  const alertBox = h('div', { class: 'live-alert', role: 'alert', hidden: true });
  const navHost = h('div');
  const replan = replanBlock({ getWalk: () => walk, getFix: () => fix, apply: (next, message) => {
    walk = next;
    store.set('walk', walk);
    toast(message, { iconName: 'return', duration: 6000 });
    render();
  } });

  const finish = () => {
    const now = Date.now();
    const minutes = Math.round((now - walk.startedAt) / 60000);
    store.addHistory({ key: `${walk.place.id}:${walk.startedAt}`, kind: 'walk', place: walk.place, start: walk.start, plan: walk.plan, minutes, at: now });
    finished = { minutes, late: Math.max(0, minutes - walk.plan.total) };
    store.set('walk', null);
    render();
  };

  const stop = () => {
    const previous = walk;
    store.set('walk', null);
    toast(t('live.stopped'), { action: t('live.undo'), duration: 5000, onAction: () => { store.set('walk', previous); onFinished?.('resume'); } });
    onFinished?.('stopped');
  };

  const advance = () => {
    const phases = phasesOf(walk);
    const index = phases.indexOf(walk.phase);
    if (index === phases.length - 1) { finish(); return; }
    const phase = phases[index + 1];
    walk = { ...walk, phase, phaseAt: { ...walk.phaseAt, [phase]: Date.now() } };
    store.set('walk', walk);
    if (phase === 'back') announce(t('live.phase.back'));
    tick();
    drawMap();
  };
  action.addEventListener('click', advance);

  function tick() {
    if (!walk || finished) return;
    const now = Date.now();
    const elapsed = (now - walk.startedAt) / 1000;
    // The countdown is to «вернётесь к»; past it, the reserve that is left; past the whole budget, the time over plan.
    const toBack = (walk.plan.there + walk.plan.visit + walk.plan.back) * 60 - elapsed;
    const toEnd = walk.plan.total * 60 - elapsed;
    const remaining = toBack >= 0 ? toBack : toEnd;
    const progress = elapsed / (walk.plan.total * 60);
    clear(ringHost, timeRing({ there: walk.plan.there, visit: walk.plan.visit, back: walk.plan.back, reserve: walk.plan.reserve, size: 148, stroke: 12, progress, className: 'ring-live' }));
    countdown.textContent = `${remaining < 0 ? '+' : ''}${clock(remaining)}`;
    replan.element.hidden = walk.phase === 'back';
    countLabel.textContent = toEnd < 0 ? t('live.over') : toBack < 0 ? t('live.inReserve') : t(walk.oneWay ? 'live.toEnd' : 'live.toReturn');
    ringHost.append(h('div', { class: 'ring-center' }, countdown, countLabel));
    ringHost.classList.toggle('is-over', toEnd < 0);
    returnLine.replaceChildren(icon(walk.oneWay ? 'flag' : 'return'), t(walk.oneWay ? 'live.doneBy' : 'live.returnBy', { time: backAt(walk) }));
    spareLine.textContent = walk.plan.reserve > 0 ? t('live.spareBy', { time: time(walk.startedAt + walk.plan.total * 60000) }) : '';

    const sincePhase = (now - (walk.phaseAt[walk.phase] || walk.startedAt)) / 60000;
    const left = walk.phase === 'there' ? walk.plan.there - sincePhase : walk.phase === 'visit' ? walk.plan.visit - sincePhase : walk.plan.back - sincePhase;
    phaseLine.textContent = t(walk.phase === 'there' ? 'live.thereLeft' : walk.phase === 'visit' ? 'live.visitLeft' : 'live.backLeft', { n: Math.max(0, Math.ceil(left)) });
    const phases = phasesOf(walk);
    stepper.classList.toggle('is-one-way', Boolean(walk.oneWay));
    stepper.replaceChildren(...phases.map((phase, i) => h('li', { class: i < phases.indexOf(walk.phase) ? 'is-done' : phase === walk.phase ? 'is-current' : '' }, h('span', { class: 'step-dot', 'aria-hidden': 'true' }, i < phases.indexOf(walk.phase) ? icon('check') : null), t(`live.phase.${phase}`))));
    // One way, the visit is the last step: the button ends the walk there.
    const last = walk.phase === 'back' || (walk.oneWay && walk.phase === 'visit');
    action.replaceChildren(icon(last ? 'flag' : walk.phase === 'visit' ? 'return' : 'pin'),
      t(walk.phase === 'there' ? 'live.arrived' : walk.phase === 'back' ? 'live.done' : walk.oneWay ? 'live.endWalk' : 'live.goBack'));

    // One turnaround alert: when the planned time to leave the place has come (one way, when the time on site is up).
    const turnaroundAt = walk.startedAt + (walk.plan.there + walk.plan.visit) * 60000;
    if (walk.phase !== 'back' && now >= turnaroundAt) {
      const alertText = t(walk.oneWay ? 'live.timeUp' : 'live.turnaround', { time: backAt(walk) });
      alertBox.hidden = false;
      alertBox.replaceChildren(icon(walk.oneWay ? 'flag' : 'return'), h('span', { text: alertText }));
      if (!walk.alerted) {
        walk = { ...walk, alerted: true };
        store.set('walk', walk);
        navigator.vibrate?.([220, 120, 220]);
        announce(alertText);
      }
    } else alertBox.hidden = true;
  }

  function drawMap() {
    const target = walk.phase === 'back' ? walk.start : walk.place;
    // After a change of plan the leg starts where the person was, not at the start or the place.
    const from = walk.phase === 'back' ? walk.backFrom || walk.place : walk.from || walk.start;
    showStart(walk.start, walk.start.name);
    placeMarker?.remove();
    placeMarker = marker(h('div', { class: 'result-pin is-selected', 'aria-hidden': 'true' }, categoryArt(walk.place.category, 22, 'pin-art')), [walk.place.lon, walk.place.lat], { anchor: 'bottom' });
    showRoutes([{ coordinates: [[from.lon, from.lat], [target.lon, target.lat]], selected: true }]);
    upgradeRoute(0, from, target);
    fitPoints([[walk.start.lon, walk.start.lat], [walk.place.lon, walk.place.lat], [from.lon, from.lat]], { maxZoom: 17 });
    clear(navHost, navLinks(from, target));
  }

  function watch() {
    if (walk.start.kind !== 'gps' || !navigator.geolocation) return;
    watchId = navigator.geolocation.watchPosition((position) => {
      const { latitude: lat, longitude: lon } = position.coords;
      fix = { lat, lon, at: Date.now() };
      meMarker?.remove();
      meMarker = marker(userDot(), [lon, lat]);
      if (walk.phase === 'there' && haversine(lat, lon, walk.place.lat, walk.place.lon) < 60) advance();
      else if (walk.phase === 'back' && haversine(lat, lon, walk.start.lat, walk.start.lon) < 60) finish();
    }, () => {}, { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 });
  }

  function render() {
    if (finished) {
      cleanupTimers();
      const late = finished.late;
      clear(container, h('section', { class: 'view live-done' },
        h('div', { class: `done-badge${late ? ' is-late' : ''}` }, icon(late ? 'clock' : 'check')),
        h('h2', { class: 'title-1', text: late ? t(walk.oneWay ? 'live.finished.lateOne' : 'live.finished.late', { n: late }) : t(walk.oneWay ? 'live.finished.titleOne' : 'live.finished.title') }),
        h('p', { class: 'lead', text: t('live.finished.text', { n: finished.minutes, plan: walk.plan.total }) }),
        h('div', { class: 'done-place' }, categoryArt(walk.place.category, 40), h('strong', { text: walk.place.name })),
        ratingBlock(walk.place, { prompt: true }),
        h('button', { class: 'btn btn-primary btn-xl', type: 'button', text: t('live.close'), onclick: () => onFinished?.('done') })));
      return;
    }
    clear(container, h('section', { class: 'view live-view', 'aria-labelledby': 'live-title' },
      h('div', { class: 'view-bar' }, h('h2', { id: 'live-title', class: 'title-3' }, h('span', { class: 'rec-dot', 'aria-hidden': 'true' }), t('live.title')),
        h('button', { class: 'btn btn-quiet btn-sm', type: 'button', onclick: stop }, icon('stop'), t('live.finish'))),
      h('div', { class: 'live-hero' }, ringHost,
        h('div', { class: 'live-side' }, h('div', { class: 'live-place' }, categoryArt(walk.place.category, 28), h('strong', { text: walk.place.name })), returnLine, spareLine, phaseLine)),
      alertBox, action, stepper, replan.element, navHost,
      watchButton({ place: walk.place, start: walk.start, walk: walk.plan.there, visit: walk.plan.visit, back: walk.plan.back, minutes: walk.plan.total }),
      h('p', { class: 'fine center', text: t('live.screenOn') })));
    tick();
    drawMap();
  }

  const onVisible = () => { if (document.visibilityState === 'visible') { keepAwake(); tick(); } };
  function cleanupTimers() {
    clearInterval(timer); timer = null;
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    document.removeEventListener('visibilitychange', onVisible);
    wakeLock?.release?.().catch(() => {}); wakeLock = null;
  }

  render();
  timer = setInterval(tick, 1000);
  document.addEventListener('visibilitychange', onVisible);
  keepAwake();
  watch();

  return () => {
    cleanupTimers();
    placeMarker?.remove(); meMarker?.remove();
    hideRoutes(); hideStart();
  };
}
