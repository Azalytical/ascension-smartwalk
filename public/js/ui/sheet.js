// Bottom sheet for phones (three snap points, 1:1 drag, momentum snap, rubber band) that becomes a side panel on desktop.
import { isDesktop, reducedMotion } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { emit } from '../core/store.js';

const SNAPS = ['peek', 'half', 'full'];
let sheet, body, handle, tabbar;
let snap = 'half';
let y = 0;

function heights() {
  const viewport = window.innerHeight;
  const tab = tabbar?.offsetHeight || 0;
  const full = viewport - tab - safeTop() - 10;
  return { full, half: Math.min(full, Math.round(viewport * 0.54)), peek: Math.min(full, 148), tab };
}
const visibleFor = (name) => heights()[name];

let probe = null;
function safeTop() {
  if (!probe) {
    probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;padding-top:env(safe-area-inset-top,0px)';
    document.body.append(probe);
  }
  return parseFloat(getComputedStyle(probe).paddingTop) || 0;
}

function place(nextY, animate) {
  y = nextY;
  sheet.style.transition = animate && !reducedMotion() ? `transform var(--t-sheet) var(--ease-drawer)` : 'none';
  sheet.style.transform = `translate3d(0, ${y}px, 0)`;
}

function settle(name, animate = true) {
  snap = name;
  if (isDesktop()) { sheet.style.transform = ''; body.style.height = ''; report(); return; }
  const { full } = heights();
  sheet.style.height = `${full}px`;
  const visible = visibleFor(name);
  place(full - visible, animate);
  body.style.height = `${Math.max(0, visible - body.offsetTop)}px`;
  sheet.dataset.snap = name;
  handle.setAttribute('aria-expanded', String(name === 'full'));
  handle.setAttribute('aria-label', name === 'full' ? t('sheet.collapse') : t('sheet.expand'));
  report();
}

function report() {
  const desktop = isDesktop();
  const visible = desktop ? 0 : visibleFor(snap) + heights().tab;
  const panel = desktop ? sheet.getBoundingClientRect().right : 0;
  emit('sheet', { snap, visible, panel, desktop });
}

export const getSnap = () => snap;
export function setSnap(name) { if (SNAPS.includes(name) && (name !== snap || isDesktop())) settle(name); }
export function ensureAtLeast(name) { if (SNAPS.indexOf(snap) < SNAPS.indexOf(name)) settle(name); }

export function initSheet(sheetEl, bodyEl, handleEl, tabbarEl) {
  sheet = sheetEl; body = bodyEl; handle = handleEl; tabbar = tabbarEl;
  handle.addEventListener('click', () => settle(snap === 'full' ? 'half' : snap === 'half' ? 'full' : 'half'));
  sheet.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !isDesktop() && snap !== 'peek' && !event.defaultPrevented) settle(snap === 'full' ? 'half' : 'peek');
  });
  body.addEventListener('focusin', (event) => { if (!isDesktop() && event.target.matches('input[type="search"], input[type="text"], textarea')) settle('full'); });

  let start = null;
  const begin = (clientY, clientX, fromBody) => { start = { y: clientY, x: clientX, sheetY: y, t: performance.now(), last: clientY, lastT: performance.now(), v: 0, dragging: false, fromBody, decided: false }; };
  const move = (clientY, clientX, event) => {
    if (!start) return;
    const dy = clientY - start.y;
    const dx = clientX - start.x;
    if (!start.decided) {
      if (Math.abs(dy) < 8 && Math.abs(dx) < 8) return;
      start.decided = true;
      // Horizontal swipes (chip rows) and scrolling inside an expanded sheet belong to the content.
      if (Math.abs(dx) > Math.abs(dy)) { start = null; return; }
      if (start.fromBody && snap === 'full' && (body.scrollTop > 0 || dy < 0)) { start = null; return; }
      start.dragging = true;
    }
    if (!start.dragging) return;
    event?.cancelable && event.preventDefault();
    const { full } = heights();
    const min = full - visibleFor('full');
    const max = full - visibleFor('peek');
    let next = start.sheetY + dy;
    if (next < min) next = min - Math.sqrt(min - next) * 3;
    if (next > max) next = max + Math.sqrt(next - max) * 3;
    const now = performance.now();
    start.v = (clientY - start.last) / Math.max(1, now - start.lastT);
    start.last = clientY; start.lastT = now;
    place(next, false);
    // Keep the scroll area as tall as the visible part, so the content (and its sticky button) follows the finger.
    body.style.height = `${Math.max(0, Math.min(full, full - next) - body.offsetTop)}px`;
  };
  const end = () => {
    if (!start) return;
    const wasDragging = start.dragging;
    const velocity = start.v;
    start = null;
    if (!wasDragging) return;
    const { full } = heights();
    // A flick (over 0.11 px/ms) carries the sheet towards the next snap point in its direction.
    const target = Math.abs(velocity) > 0.11 ? y + velocity * 220 : y;
    let best = 'half'; let bestDistance = Infinity;
    for (const name of SNAPS) {
      const distance = Math.abs((full - visibleFor(name)) - target);
      if (distance < bestDistance) { best = name; bestDistance = distance; }
    }
    settle(best);
  };

  const touchTarget = sheet;
  touchTarget.addEventListener('touchstart', (event) => {
    if (isDesktop() || event.touches.length > 1) return;
    const fromBody = body.contains(event.target);
    if (event.target.closest('.no-drag, input, textarea, .maplibregl-map')) return;
    begin(event.touches[0].clientY, event.touches[0].clientX, fromBody);
  }, { passive: true });
  touchTarget.addEventListener('touchmove', (event) => { if (event.touches.length === 1) move(event.touches[0].clientY, event.touches[0].clientX, event); }, { passive: false });
  touchTarget.addEventListener('touchend', end);
  touchTarget.addEventListener('touchcancel', end);
  // Mouse drag on the handle for narrow desktop windows.
  handle.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'mouse' || isDesktop()) return;
    handle.setPointerCapture(event.pointerId);
    begin(event.clientY, event.clientX, false);
    const onMove = (e) => move(e.clientY, e.clientX, e);
    const onUp = () => { end(); handle.removeEventListener('pointermove', onMove); handle.removeEventListener('pointerup', onUp); };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
  });

  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => settle(snap, false), 80); });
  settle(snap, false);
}
