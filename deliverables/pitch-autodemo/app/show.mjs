// Aidem pitch show. One program for the 10-minute pitch on 22 October 2026:
//  • the show window, full screen on the projector: the deck (14 slides) and the live site in tabs behind it;
//    on the live slides one → plays one step of the demo on the real site (cursor, clicks, scrolling);
//  • the prompter window on the laptop's own screen: the speech, the current step, the timer, the jury Q&A;
//  • optionally the same prompter on a phone, which also works as a remote (◀ ▶ ⏸).
// Keys work in either window: → / PageDown / clicker = next, ← = back, Space = pause in the demo, Esc = leave the demo,
// B = black screen, 4 on slide 07 = the agent bonus. Close the black console window (or Ctrl+C) to stop.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs';
import { join, extname, resolve, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { networkInterfaces, platform } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseSpeech } from './lib/speech.mjs';
import { director } from './lib/director.mjs';
import { findBrowser, profileDir, closeOldShow, pickScreens, place } from './lib/browser.mjs';
import { BEATS, CUES, LINKS } from './scenes/pitch.mjs';
import { TOUR } from './scenes/tour.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..');
const argv = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const SITE = String(argv.site || 'https://ascension-smartwalk.azamatbreach.workers.dev').replace(/\/$/, '');
const SITE_HOST = new URL(SITE).host;
const SITE_LABEL = String(argv['site-label'] || 'ascension-smartwalk.azamatbreach.workers.dev');
const PORT = Number(argv.port || 7788);
const TOKEN = String(argv.token || randomBytes(6).toString('hex'));
const SPEECH_FILE = resolve(String(argv.speech || [join(PKG, 'speech-10min.md'), join(HERE, 'speech-10min.md')].find(existsSync) || join(HERE, 'speech-10min.md')));
const DECK_HTML = resolve(String(argv.deck || [join(PKG, 'deck-10min.html'), join(PKG, 'deck', 'index.html')].find(existsSync) || ''));
const DECK_ASSETS = [join(PKG, '..', 'deck', 'assets'), join(PKG, 'deck', 'assets'), join(dirname(DECK_HTML), 'assets')].find((p) => existsSync(p));
const OFFLINE_VIDEO = [join(PKG, 'offline', 'aidem-autodemo-desktop.mp4'), join(PKG, '..', 'video', 'aidem-final.mp4')].find(existsSync) || null;
const TEST = Boolean(argv.test); // the checks in the cloud: no real screens, no closing of other windows
const CHECK = Boolean(argv.check);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);

// ---------- the speech ----------
let speech = parseSpeech(SPEECH_FILE);
// The demo links: the speech's own «Ссылки для демо» win over the built-in ones.
const links = { ...LINKS };
{
  const md = readFileSync(SPEECH_FILE, 'utf8');
  for (const [, label, url] of md.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g)) {
    if (!url.startsWith(SITE) && !url.includes('ascension-smartwalk.azamatbreach.workers.dev')) continue;
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    if (/^Кофе/i.test(label)) links.coffee = path;
    else if (/^Турист/i.test(label)) links.tourist = path;
  }
}

// Segments of a slide (or of the bonus): an optional stage direction that brings the piece, then its text.
function segmentsOf(items, cues) {
  const segs = [];
  let cur = null;
  const pool = [...(cues || [])];
  for (const item of items || []) {
    if (item.type === 'dir') {
      const i = pool.findIndex((c) => c.match.test(item.text));
      const beat = i >= 0 ? pool.splice(0, i + 1).pop().beat : null;
      cur = { dir: item.text, beat, texts: [], notes: [] };
      segs.push(cur);
    } else {
      if (!cur) { cur = { dir: null, beat: null, texts: [], notes: [] }; segs.push(cur); }
      (item.type === 'note' ? cur.notes : cur.texts).push(item.text);
    }
  }
  return segs.length ? segs : [{ dir: null, beat: null, texts: [], notes: [] }];
}
function buildPlan() {
  return speech.slides.map((s) => ({
    n: s.n, title: s.title, from: s.from, to: s.to, speaker: s.speaker, screen: s.screen,
    segs: segmentsOf(s.items, CUES[s.n]),
    bonus: s.bonus ? { title: s.bonus.title, segs: segmentsOf(s.bonus.items, CUES[`bonus${s.n}`]) } : null,
  }));
}
let plan = buildPlan();

// ---------- state ----------
const S = {
  mode: 'idle', // idle | pitch | tour
  online: null, gemini: null, places: null, siteError: '',
  slide: 0, seg: 0, inBonus: false, carry: [],
  view: 'deck', busy: false, beat: null, queue: 0, paused: false, skip: false,
  t0: null, captions: true, blackout: false,
  screens: { count: 0 }, placement: '', mirrored: false,
  tabs: {}, phone: null, note: '', tour: null, messages: [], ui: { qa: false, font: 0 },
};
const log = (text, kind = 'info') => { S.messages = [...S.messages.slice(-5), { at: Date.now(), text, kind }]; say(text); push(); };

// ---------- the prompter server ----------
const clients = new Set();
function snapshot() {
  return {
    mode: S.mode, online: S.online, gemini: S.gemini, places: S.places, siteError: S.siteError,
    slide: S.slide, seg: S.seg, inBonus: S.inBonus, carry: S.carry, view: S.view, busy: S.busy, beat: S.beat, queue: S.queue, paused: S.paused,
    t0: S.t0, now: Date.now(), captions: S.captions, blackout: S.blackout, screens: S.screens, placement: S.placement, mirrored: S.mirrored,
    tabs: Object.fromEntries(Object.entries(S.tabs).map(([k, t]) => [k, { state: t.state, at: t.loadedAt }])), phone: S.phone, note: S.note,
    tour: S.tour, messages: S.messages, ui: S.ui, site: SITE_LABEL, offlineVideo: Boolean(OFFLINE_VIDEO),
  };
}
let pushTimer = null;
function push() {
  if (pushTimer) return;
  pushTimer = setTimeout(() => {
    pushTimer = null;
    const data = `data: ${JSON.stringify(snapshot())}\n\n`;
    for (const res of clients) res.write(data);
  }, 30);
}
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 15000).unref();

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webp': 'image/webp' };
function sendFile(req, res, file) {
  if (!file || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end('not found'); return; }
  const size = statSync(file).size;
  const type = TYPES[extname(file).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
  if (range && type === 'video/mp4') {
    const start = range[1] ? Number(range[1]) : 0, end = range[2] ? Number(range[2]) : size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
    createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Cache-Control': 'no-cache', ...(type === 'video/mp4' ? { 'Accept-Ranges': 'bytes' } : {}) });
  createReadStream(file).pipe(res);
}
function speechJson() {
  return { title: speech.title, end: speech.end, slides: plan, qa: speech.qa, short: speech.short, broken: speech.broken, morning: speech.morning,
    beforeStage: speech.beforeStage, beats: Object.fromEntries(Object.entries(BEATS).map(([k, b]) => [k, b.label])), tour: TOUR.map((t) => ({ title: t.title, say: t.say })) };
}
function handler(lan) {
  return async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = decodeURIComponent(url.pathname);
    const authed = url.searchParams.get('k') === TOKEN || req.headers['x-aidem'] === TOKEN;
    if (p === '/' || p === '/pult' || p === '/phone') {
      if (lan && !authed) { res.writeHead(403); res.end('нужна ссылка с ключом'); return; }
      return sendFile(req, res, join(HERE, 'ui', 'pult.html'));
    }
    if (/^\/ui\/[\w.-]+$/.test(p)) return sendFile(req, res, join(HERE, 'ui', p.slice(4)));
    if (!lan && p === '/deck/index.html') return sendFile(req, res, DECK_HTML);
    if ((!lan || p.startsWith('/deck/assets/fonts/')) && p.startsWith('/deck/assets/') && DECK_ASSETS) {
      const file = resolve(DECK_ASSETS, p.slice('/deck/assets/'.length));
      if (!file.startsWith(resolve(DECK_ASSETS))) { res.writeHead(403); res.end(); return; }
      return sendFile(req, res, file);
    }
    if (!lan && p === '/offline/video.mp4') return sendFile(req, res, OFFLINE_VIDEO);
    if (!lan && p === '/offline') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(OFFLINE_PAGE); return; }
    if (!authed) { res.writeHead(403); res.end(); return; }
    if (p === '/speech.json') { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' }); res.end(JSON.stringify(speechJson())); return; }
    if (p === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (p === '/cmd' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 20000) break; }
      let cmd = {};
      try { cmd = JSON.parse(body || '{}'); } catch { /* empty */ }
      res.writeHead(204); res.end();
      command(cmd).catch((e) => log(`Команда не удалась: ${e.message}`, 'bad'));
      return;
    }
    res.writeHead(404); res.end();
  };
}
const OFFLINE_PAGE = `<!doctype html><meta charset="utf-8"><title>Aidem · запись</title><style>html,body{margin:0;height:100%;background:#000}video{width:100%;height:100%;object-fit:contain}</style><video src="/offline/video.mp4" autoplay muted playsinline></video>`;

const server = createServer(handler(false));
let port = PORT;
await new Promise((ok, fail) => {
  const tryListen = () => { server.once('error', (e) => { if (e.code === 'EADDRINUSE' && port < PORT + 20) { port++; tryListen(); } else fail(e); }); server.listen(port, '127.0.0.1', ok); };
  tryListen();
});
const SHOW = `http://127.0.0.1:${port}`;
const SHOW_HOST = `127.0.0.1:${port}`;

// The phone prompter: a second listener on the local network, only when asked for (Windows asks about the firewall then).
async function startPhone() {
  if (S.phone) return;
  const lan = createServer(handler(true));
  const lanPort = port + 100;
  await new Promise((ok, fail) => { lan.once('error', fail); lan.listen(lanPort, '0.0.0.0', ok); });
  const addresses = Object.values(networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
  S.phone = { urls: addresses.map((ip) => `http://${ip}:${lanPort}/phone?k=${TOKEN}`) };
  log(addresses.length ? `Суфлёр на телефоне: ${S.phone.urls[0]} (телефон в той же сети Wi-Fi)` : 'Суфлёр на телефоне: у ноутбука нет сети Wi-Fi', addresses.length ? 'ok' : 'bad');
}

// ---------- the site ----------
async function checkSite() {
  try {
    const r = await fetch(`${SITE}/api/status`, { signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    S.online = r.ok; S.gemini = Boolean(j.generationAvailable); S.places = j.poiCount ?? null; S.siteError = '';
  } catch (e) {
    S.online = false; S.gemini = false; S.siteError = e.name === 'TimeoutError' ? 'сайт не ответил за 8 с' : 'нет связи с сайтом';
  }
  push();
  return S.online;
}

// ---------- the browser ----------
const found = findBrowser(argv.browser);
if (!found) {
  console.log('\nНе нашёл Google Chrome или Microsoft Edge. Установите Chrome: https://www.google.com/chrome/ и запустите показ снова.\n');
  process.exit(2);
}
const PROFILE = String(argv.profile || profileDir());
if (!TEST) closeOldShow(PROFILE);
say(`Браузер: ${found.name}. Профиль показа: ${PROFILE}`);
say(`Сайт: ${SITE}. Речь: ${SPEECH_FILE}`);
checkSite().then((ok) => log(ok ? `Сайт на связи: ${S.places ?? '?'} мест, Gemini ${S.gemini ? 'отвечает' : 'выключен (подбор работает без него)'}` : `Сайт недоступен (${S.siteError}): живое демо заменят слайды`, ok ? 'ok' : 'bad'));

const context = await chromium.launchPersistentContext(PROFILE, {
  executablePath: found.path,
  headless: false,
  viewport: null,
  locale: 'ru-RU',
  colorScheme: 'light',
  ignoreDefaultArgs: ['--enable-automation'],
  args: ['--no-first-run', '--no-default-browser-check', '--disable-session-crashed-bubble', '--hide-crash-restore-bubble', '--autoplay-policy=no-user-gesture-required',
    '--disable-features=Translate,MediaRouter,GlobalMediaControls,HardwareMediaKeyHandling,PrivacySandboxSettings4', '--lang=ru', '--deny-permission-prompts',
    ...(TEST ? ['--test-type', '--window-position=0,0', '--window-size=1920,1080'] : []), ...(argv['chrome-arg'] ? [String(argv['chrome-arg'])] : [])],
});
const CFG = { siteHost: SITE_HOST, showHost: SHOW_HOST, siteLabel: SITE_LABEL, lang: 'ru', zoom: argv.zoom === undefined ? 'auto' : Number(argv.zoom), zoomBase: 1280, captions: true };
await context.addInitScript({ content: `window.__AIDEM = ${JSON.stringify(CFG)};` });
await context.addInitScript({ path: join(HERE, 'lib', 'page-init.js') });
await context.addInitScript({ path: join(HERE, 'lib', 'overlay.js') });
await context.exposeBinding('__aidemKey', ({ page }, o) => { onKey(o, page).catch((e) => log(`Клавиша: ${e.message}`, 'bad')); });
await context.exposeBinding('__aidemScreens', (_src, screens) => { onScreens(screens).catch(() => {}); });
let closing = false;
context.on('close', () => { if (!closing) { say('Окно показа закрыто, выключаюсь.'); process.exit(0); } });

const deck = context.pages()[0] || await context.newPage();
S.tabs.deck = { page: deck, state: 'ready', name: 'deck' };
const deckCdp = await context.newCDPSession(deck);
await deck.goto(`${SHOW}/deck/index.html`);
await deck.waitForFunction(() => window.deck && window.deck.slides && window.deck.i >= 0, null, { timeout: 15000 }).catch(() => log('Колода загрузилась без управления: листать её можно стрелками', 'bad'));

// The prompter: its own window, on the laptop screen.
let pult = null, pultCdp = null;
{
  const opened = context.waitForEvent('page', { timeout: 10000 });
  await deckCdp.send('Target.createTarget', { url: `${SHOW}/pult?k=${TOKEN}&laptop=1`, newWindow: true });
  pult = await opened;
  pultCdp = await context.newCDPSession(pult);
  await pultCdp.send('Browser.grantPermissions', { permissions: ['windowManagement'], origin: SHOW }).catch(() => {});
}

async function readScreens() {
  return pult.evaluate(async () => {
    const list = (d) => d.screens.map((s) => ({ left: s.left, top: s.top, width: s.width, height: s.height, availLeft: s.availLeft, availTop: s.availTop,
      availWidth: s.availWidth, availHeight: s.availHeight, isPrimary: s.isPrimary, isInternal: s.isInternal, label: s.label || '', scale: s.devicePixelRatio }));
    try {
      const d = await window.getScreenDetails();
      if (!window.__aidemWatching) { window.__aidemWatching = true; d.addEventListener('screenschange', () => window.__aidemScreens(list(d))); }
      return list(d);
    } catch (e) {
      const s = window.screen;
      return [{ left: s.availLeft || 0, top: s.availTop || 0, width: s.width, height: s.height, availLeft: s.availLeft || 0, availTop: s.availTop || 0,
        availWidth: s.availWidth, availHeight: s.availHeight, isPrimary: true, isInternal: true, label: '', scale: devicePixelRatio, extended: s.isExtended }];
    }
  }).catch(() => []);
}
async function onScreens(list) {
  const pick = pickScreens(list || await readScreens());
  // «Поменять экраны местами» on the prompter: for when the laptop's own screen was not recognised.
  if (S.swapScreens && pick.count >= 2) [pick.projector, pick.laptop] = [pick.laptop, pick.projector];
  S.screens = { count: pick.count, projector: pick.projector && { w: pick.projector.width, h: pick.projector.height, label: pick.projector.label },
    laptop: pick.laptop && { w: pick.laptop.width, h: pick.laptop.height, label: pick.laptop.label } };
  if (TEST) {
    // The cloud check: one wide virtual screen, the show on the left half and the prompter on the right.
    const a = await place(deckCdp, { left: 0, top: 0, width: 1920, height: 1080 }, 'normal');
    const b = await place(pultCdp, { left: 1920, top: 0, width: 1440, height: 900 }, 'normal');
    say('окна', JSON.stringify(a.bounds), JSON.stringify(b.bounds));
    S.placement = 'проверка: показ слева, суфлёр справа'; push(); return;
  }
  if (pick.count >= 2) {
    // Full screen on the laptop too: no browser bars, only the prompter. Alt+Tab (Cmd+Tab) still reaches other windows.
    await place(pultCdp, pick.laptop, argv['pult-window'] ? 'maximized' : 'fullscreen');
    await place(deckCdp, pick.projector, 'fullscreen');
    S.placement = `показ на весь экран проектора ${pick.projector.width}×${pick.projector.height}, суфлёр на экране ноутбука`;
    S.mirrored = false;
    log(`Экранов: ${pick.count}. ${S.placement}`, 'ok');
  } else if (pick.count === 1) {
    // One screen (or the projector mirrors the laptop): whatever is on the laptop is on the wall, so the prompter hides behind the show.
    await place(pultCdp, pick.laptop, 'maximized');
    S.placement = 'один экран: суфлёр не спрятать, его увидит зал';
    S.mirrored = true;
    log('Найден один экран. Если проектор подключён, нажмите Win+P → «Расширить» (на Mac: Системные настройки → Мониторы → «Расширенный рабочий стол»). Окна встанут сами.', 'bad');
  }
  push();
}
await onScreens();
await pult.bringToFront();

// ---------- tabs of the site ----------
const order = ['coffee', 'tourist', 'agent'];
async function openTab(name, url) {
  let t = S.tabs[name];
  if (!t) {
    const page = await context.newPage();
    t = S.tabs[name] = { name, page, state: 'new', loadedAt: 0, ready: null };
    page.on('crash', () => { t.state = 'failed'; log(`Вкладка «${name}» упала`, 'bad'); });
    await deck.bringToFront();
  }
  t.state = 'loading';
  t.url = url;
  push();
  t.ready = (async () => {
    try {
      await t.page.goto(SITE + url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      if (name === 'agent') await t.page.waitForSelector('#examples .chip', { timeout: 15000 });
      else await t.page.waitForSelector('.result-row, .state-view', { timeout: 25000 });
      t.state = (name === 'agent' || await t.page.locator('.result-row').count()) ? 'ready' : 'failed';
    } catch (e) { t.state = 'failed'; t.error = e.message.split('\n')[0]; }
    t.loadedAt = Date.now();
    push();
    if (t.state === 'failed') log(`Вкладка «${name}» не загрузилась: живой шаг заменит слайд`, 'bad');
    return t.state;
  })();
  return t;
}
async function loadSiteTabs(force = false) {
  if (!S.online) return;
  for (const name of order) {
    const t = S.tabs[name];
    const url = links[name];
    if (!force && t && t.state === 'ready' && Date.now() - t.loadedAt < 3 * 60000) continue;
    if (t && t.state === 'loading') continue;
    await openTab(name, url);
    await sleep(400); // the free Gemini key: a small gap between the walk requests
  }
}

// ---------- the step runner ----------
let resumeWaiters = [];
const ctl = { paused: () => S.paused, skipped: () => S.skip, waitResume: () => new Promise((r) => resumeWaiters.push(r)), log: (t) => log(t, 'bad') };
const directors = new Map();
const dOf = (page) => { if (!directors.has(page)) directors.set(page, director(page, ctl, { captions: S.captions })); return directors.get(page); };
async function veil(page, to, ms) { await page.evaluate(([to, ms]) => window.__AD && window.__AD.fade(to, ms), [to, ms]).catch(() => {}); }
async function front(name, opt = {}) {
  const t = S.tabs[name] || (S.online ? await openTab(name, links[name]) : null);
  if (!t) throw new Error('сайт недоступен');
  if (t.state === 'loading') await Promise.race([t.ready, sleep(opt.wait ?? 12000)]);
  if (t.state !== 'ready') throw new Error(`вкладка «${name}» не загрузилась`);
  const d = dOf(t.page);
  if (S.view !== name) {
    await veil(t.page, 1, 1);
    await t.page.bringToFront();
    S.view = name;
    push();
    await d.activate(true);
    await veil(t.page, 0, 450);
  } else await d.activate(true);
  if (opt.results && !(await t.page.locator('.result-row, .place-view').count())) throw new Error('на странице нет вариантов');
  return { page: t.page, d };
}
async function toDeck() {
  if (S.view === 'deck') return;
  const t = S.tabs[S.view];
  if (t) await dOf(t.page).activate(false);
  await deck.bringToFront();
  S.view = 'deck';
  push();
}
async function deckShow(n) {
  await deck.evaluate((n) => window.deck && window.deck.show(n), n).catch(() => {});
}
const beatCtx = {
  front, toDeck, sleep: (ms) => dOf(deck).sleep(ms), isLoaded: (name) => S.tabs[name]?.state === 'ready',
  note: (text) => { S.note = text; push(); },
  nextSlide: async () => { S.carry = currentSeg()?.texts || []; await goSlide(S.slide + 1, { fromBeat: true }); },
};
async function runBeat(id) {
  const beat = BEATS[id];
  if (!beat) return;
  S.busy = true; S.skip = false; S.note = '';
  S.beat = { id, label: beat.label, state: 'run', at: Date.now() };
  push();
  try {
    if (!S.online && id !== 'deck' && id !== 'deckNext') throw new Error('нет интернета');
    await beat.run(beatCtx);
    S.beat.state = 'ok';
  } catch (e) {
    if (e.skip) S.beat.state = 'skipped';
    else {
      S.beat.state = 'fail'; S.beat.error = e.message.split('\n')[0];
      log(`Шаг «${beat.label}» не получился: ${S.beat.error}. Показываю слайд.`, 'bad');
      S.note = S.note || 'Живой шаг не получился: ты на слайде, говори тот же текст, «это экраны того же сайта».';
      await toDeck().catch(() => {});
    }
  } finally {
    S.busy = false; S.skip = false;
    push();
  }
  if (S.queue > 0) { S.queue = 0; await next(); }
}

// ---------- slides and steps ----------
const segsNow = () => (S.inBonus ? plan[S.slide]?.bonus?.segs : plan[S.slide]?.segs) || [];
const currentSeg = () => segsNow()[S.seg];
async function goSlide(n, opt = {}) {
  if (n < 0 || n >= plan.length) return;
  if (!opt.fromBeat) S.carry = [];
  const back = n < S.slide;
  S.slide = n; S.seg = 0; S.inBonus = false; S.note = '';
  if (n > 0 && !S.t0) S.t0 = Date.now();
  if (S.view !== 'deck') await toDeck();
  await deckShow(n);
  push();
  if (n === 1 || n === 2) loadSiteTabs().catch(() => {});
  const first = segsNow()[0];
  if (!back && first?.beat) await runBeatAfterBusy(first.beat);
}
async function runBeatAfterBusy(id) {
  if (S.busy) { S.busy = false; } // a beat that moved the slide (deckNext) hands over to the slide's own first step
  await runBeat(id);
}
async function next() {
  if (S.busy) { S.queue = Math.min(1, S.queue + 1); if (S.queue >= 1 && Date.now() - (S.lastNext || 0) < 900) S.skip = true; S.lastNext = Date.now(); push(); return; }
  S.lastNext = Date.now();
  if (S.mode === 'tour') return tourNext();
  if (S.mode === 'idle') { await startPitch(); return; }
  const segs = segsNow();
  if (S.seg + 1 < segs.length) {
    S.seg++; S.carry = [];
    push();
    if (segs[S.seg].beat) await runBeat(segs[S.seg].beat);
    return;
  }
  if (S.inBonus) { S.inBonus = false; await goSlide(S.slide + 1); return; }
  await goSlide(S.slide + 1);
}
async function prev() {
  if (S.busy) { S.skip = true; return; }
  if (S.mode === 'tour') return;
  if (S.view !== 'deck') { await toDeck(); return; }
  await goSlide(S.slide - 1);
}
async function leaveDemo() {
  if (S.busy) S.skip = true;
  if (S.mode === 'tour') { await stopTour(); return; }
  await toDeck();
  const segs = segsNow();
  S.seg = Math.max(0, segs.length - 1); S.inBonus = false;
  push();
}
async function bonus() {
  const b = plan[S.slide]?.bonus;
  if (!b) { log('Бонус есть только на слайде 07', 'bad'); return; }
  if (S.busy) return;
  S.inBonus = true; S.seg = 0;
  push();
  if (b.segs[0]?.beat) await runBeat(b.segs[0].beat);
}
function setPaused(on) {
  S.paused = on;
  if (!on) { const w = resumeWaiters; resumeWaiters = []; w.forEach((r) => r()); }
  const t = S.tabs[S.view];
  if (t && S.view !== 'deck') {
    t.page.evaluate((on) => { window.__aidemPassKeys = on; window.__AD && window.__AD.activate(!on); }, on).catch(() => {});
  }
  push();
}
async function startPitch() {
  if (S.mode === 'tour') await stopTour();
  S.mode = 'pitch'; S.t0 = null;
  if (S.mirrored && !TEST) await place(deckCdp, (await readScreens())[0] || {}, 'fullscreen').catch(() => {});
  await deck.bringToFront();
  push();
  loadSiteTabs().catch(() => {});
  await goSlide(0);
}
async function restart() { if (S.busy) S.skip = true; S.t0 = null; await goSlide(0); }

// ---------- the full tour ----------
let tourRun = null;
async function startTour(opt = {}) {
  if (S.busy) S.skip = true;
  await toDeck();
  const loop = !!opt.loop;
  const from = Math.max(0, Math.min(TOUR.length - 1, Number(opt.from) || 0));
  S.mode = 'tour'; S.tour = { step: from, total: TOUR.length, title: TOUR[from]?.title, state: 'run', loop };
  push();
  const t = S.tabs.tour || (S.tabs.tour = { name: 'tour', page: await context.newPage(), state: 'ready', loadedAt: Date.now() });
  await deck.bringToFront();
  const d = dOf(t.page);
  const tctx = { page: t.page, d, site: SITE, front: () => front('tour'), toDeck, note: beatCtx.note, links, log, online: () => S.online };
  const my = (tourRun = Symbol('tour'));
  (async () => {
    // «По кругу» (a stand, the jury walking round): the tour starts again after the final card until Esc.
    do {
      for (let i = from; i < TOUR.length && S.mode === 'tour' && tourRun === my; i++) {
        if (opt.only && i !== from) break;
        S.tour = { ...S.tour, step: i, title: TOUR[i].title, state: 'run' }; S.busy = true; S.skip = false; S.note = '';
        push();
        try { await TOUR[i].run(tctx); } catch (e) { if (!e.skip) log(`Тур, «${TOUR[i].title}»: ${e.message.split('\n')[0]}`, 'bad'); }
        S.busy = false;
      }
    } while (loop && S.mode === 'tour' && tourRun === my);
    S.busy = false;
    if (S.mode === 'tour' && tourRun === my) {
      // Done: back to the title slide, ready for the pitch or another tour.
      S.tour = null; S.mode = 'idle';
      await toDeck(); await deckShow(0);
      log('Тур закончен. Колода на титульном слайде.', 'ok');
      push();
    }
  })();
}
async function tourNext() { if (S.busy) S.skip = true; }
async function stopTour() {
  S.mode = 'pitch'; S.skip = true; S.tour = null;
  setPaused(false);
  await toDeck();
  S.mode = 'idle';
  push();
}

// ---------- keys ----------
const viewOfPage = (page) => Object.values(S.tabs).find((t) => t.page === page)?.name;
async function onKey(o, page) {
  const k = o.key;
  const from = viewOfPage(page);
  // The presenter may have switched tabs by hand (Ctrl+1/2/3): the tab a key came from is the one in front.
  if (from && from !== S.view && page !== pult) { S.view = from; push(); }
  if (o.ctrl) return;
  if (['ArrowRight', 'ArrowDown', 'PageDown', 'Enter'].includes(k)) { if (S.paused) return setPaused(false); return next(); }
  if (k === ' ') { if (S.mode !== 'idle' && (S.busy || S.view !== 'deck' || S.paused)) return setPaused(!S.paused); return next(); }
  if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(k)) { if (S.paused) setPaused(false); return prev(); }
  if (k === 'Escape') { if (S.paused) setPaused(false); if (S.ui.qa) { S.ui.qa = false; push(); return; } return leaveDemo(); }
  if (k === 'Home') return restart();
  if (k === 'End') return goSlide(plan.length - 1);
  if (/^[bBиИ.]$/.test(k)) { await toDeck(); S.blackout = await deck.evaluate(() => { const b = document.getElementById('blackout'); b.classList.toggle('on'); return b.classList.contains('on'); }).catch(() => false); push(); return; }
  if (/^[cCсС]$/.test(k)) { S.captions = !S.captions; for (const t of Object.values(S.tabs)) t.page.evaluate((on) => window.__AD && window.__AD.captions(on), S.captions).catch(() => {}); push(); return; }
  if (/^[pPзЗ]$/.test(k)) return setPaused(!S.paused);
  if (/^[4gGпП]$/.test(k)) return bonus();
  if (/^[qQйЙ]$/.test(k)) { S.ui.qa = !S.ui.qa; push(); return; }
  if (/^[+=]$/.test(k)) { S.ui.font = Math.min(6, S.ui.font + 1); push(); return; }
  if (/^[-_]$/.test(k)) { S.ui.font = Math.max(-4, S.ui.font - 1); push(); return; }
  if (/^[vVмМ]$/.test(k)) return offlineVideo();
}
async function offlineVideo() {
  if (!OFFLINE_VIDEO) { log('Записи для показа без интернета нет в папке', 'bad'); return; }
  const t = S.tabs.video || (S.tabs.video = { name: 'video', page: await context.newPage(), state: 'ready' });
  if (S.view === 'video') { await toDeck(); return; }
  await t.page.goto(`${SHOW}/offline`);
  await t.page.bringToFront();
  S.view = 'video';
  push();
}

// ---------- commands from the prompter buttons and the phone ----------
async function command(cmd) {
  switch (cmd.type) {
    case 'key': return onKey({ key: cmd.key }, pult);
    case 'start': return startPitch();
    case 'tour': return startTour({ loop: cmd.loop, from: cmd.from, only: TEST && cmd.only });
    case 'stopTour': return stopTour();
    case 'goto': return goSlide(Number(cmd.slide) || 0);
    case 'phone': return startPhone();
    case 'screens': return onScreens();
    case 'swapScreens': S.swapScreens = !S.swapScreens; return onScreens();
    case 'recheck': await checkSite(); if (S.online) await loadSiteTabs(true); return;
    case 'reloadTabs': return loadSiteTabs(true);
    case 'reloadSpeech': speech = parseSpeech(SPEECH_FILE); plan = buildPlan(); log('Речь перечитана из файла', 'ok'); push(); return;
    case 'bonus': return bonus();
    case 'video': return offlineVideo();
    case 'ui': S.ui = { ...S.ui, ...cmd.ui }; push(); return;
    case 'beat': if (TEST) return runBeat(String(cmd.beat)); return;
    default: return null;
  }
}

// ---------- start ----------
// The deck shows the title slide while the site tabs load behind it.
await checkSite();
loadSiteTabs().catch(() => {});
await deck.bringToFront();
await pult.bringToFront();
log('Готово. Пульт и суфлёр на экране ноутбука. Первое → или кнопка «Начать питч» запускает показ.', 'ok');
if (CHECK) {
  await Promise.all(Object.values(S.tabs).map((t) => t.ready).filter(Boolean));
  say('Проверка:', JSON.stringify(snapshot().tabs), 'экранов', S.screens.count);
  setTimeout(() => shutdown(), 500);
}

async function shutdown() {
  if (closing) return;
  closing = true;
  say('Выключаю показ…');
  await context.close().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
if (platform() === 'win32') process.on('SIGHUP', shutdown);
export { S, command, next, prev, goSlide, startTour, onKey };
