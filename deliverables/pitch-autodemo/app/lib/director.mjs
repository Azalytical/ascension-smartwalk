// The hands of the autodemo on one page of the live site: the drawn cursor flies, the real mouse clicks at the same
// point, typing goes key by key, lists scroll smoothly. Every step waits while the show is paused and gives up
// quietly when the presenter skips, so a stuck animation never holds the talk. Built on the video autodemo's director.
export class Skip extends Error { constructor() { super('skip'); this.skip = true; } }

const sleepRaw = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function director(page, ctl, o = {}) {
  // ctl: { paused(), skipped(), waitResume() } from the show; o.timeout: how long to wait for an element.
  const gate = async () => {
    if (ctl.skipped()) throw new Skip();
    if (ctl.paused()) await ctl.waitResume();
    if (ctl.skipped()) throw new Skip();
  };
  const capped = (label, promise, ms) => {
    let timer;
    return Promise.race([promise, new Promise((resolve) => { timer = setTimeout(() => { ctl.log?.(`шаг «${label}» не успел за ${ms / 1000} с`); resolve(null); }, ms); })])
      .finally(() => clearTimeout(timer));
  };
  const ad = (fn, ...args) => capped(fn, page.evaluate(([fn, args]) => (window.__AD && window.__AD[fn] ? window.__AD[fn](...args) : null), [fn, args]).catch(() => null), 9000);
  const loc = (target) => (typeof target === 'string' ? page.locator(target).first() : target);
  async function box(target, timeout = o.timeout || 8000) {
    const l = loc(target);
    await l.waitFor({ state: 'visible', timeout });
    const b = await l.boundingBox();
    if (!b) throw new Error('нет элемента ' + String(target));
    return b;
  }
  async function point(target, opt = {}) {
    const b = await box(target, opt.timeout);
    return { x: b.x + b.width * (opt.fx ?? 0.5) + (opt.dx || 0), y: b.y + b.height * (opt.fy ?? 0.5) + (opt.dy || 0), b };
  }
  const d = {
    gate,
    page,
    async sleep(ms) {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        await gate();
        await sleepRaw(Math.min(120, end - Date.now()));
      }
      await gate();
    },
    ad,
    box,
    async exists(target, timeout = 0) {
      const l = loc(target);
      if (!timeout) return (await l.count().catch(() => 0)) > 0 && await l.isVisible().catch(() => false);
      return l.waitFor({ state: 'visible', timeout }).then(() => true, () => false);
    },
    async move(target, opt = {}) {
      await gate();
      const p = await point(target, opt);
      await Promise.all([ad('cursorTo', p.x, p.y, opt.dur ?? null), page.mouse.move(p.x, p.y, { steps: 6 }).catch(() => {})]);
      return p;
    },
    // A move that only points at something: if it is not on the page, the step goes on without it.
    async glance(target, opt = {}) {
      const b = await box(target, opt.timeout ?? 2500).catch(() => null);
      if (!b) return null;
      const h = await page.evaluate(() => innerHeight).catch(() => 0);
      const y = b.y + b.height * (opt.fy ?? 0.5);
      if (h && (y < 0 || y > h - 24)) return null; // off screen: pointing there would only lose the cursor
      return d.move(target, { timeout: 2500, ...opt }).catch((e) => { if (e instanceof Skip) throw e; return null; });
    },
    async moveXY(x, y, dur) { await gate(); await Promise.all([ad('cursorTo', x, y, dur ?? null), page.mouse.move(x, y, { steps: 6 }).catch(() => {})]); },
    async tap(target, opt = {}) {
      const p = await d.move(target, opt);
      await sleepRaw(opt.hover ?? 160);
      await gate();
      const pressed = ad('press');
      await page.mouse.down();
      await sleepRaw(80);
      await page.mouse.up();
      await pressed;
      await d.sleep(opt.after ?? 420);
      return p;
    },
    async tapXY(x, y, opt = {}) {
      await d.moveXY(x, y, opt.dur);
      await sleepRaw(opt.hover ?? 160);
      const pressed = ad('press');
      await page.mouse.down();
      await sleepRaw(80);
      await page.mouse.up();
      await pressed;
      await d.sleep(opt.after ?? 420);
    },
    async type(text, opt = {}) {
      await page.evaluate(() => { window.__aidemTyping = true; }).catch(() => {});
      try {
        for (const ch of text) {
          await gate();
          await page.keyboard.type(ch);
          await sleepRaw((opt.delay ?? 55) + (ch === ' ' ? 35 : 0) + Math.random() * 30);
        }
      } finally {
        await page.evaluate(() => { window.__aidemTyping = false; }).catch(() => {});
      }
    },
    cap: (text, n, ms) => (o.captions === false ? null : ad('caption', text, n || 0, ms ?? 4200)),
    capOff: () => ad('hideCaption'),
    url: (ms) => ad('urlPill', ms ?? 4200),
    fade: (to, ms) => ad('fade', to, ms ?? 500),
    card: (c, ms) => ad('card', c, ms ?? 600),
    cardOff: (ms) => ad('cardOff', ms ?? 600),
    activate: (on = true) => ad('activate', on),
    async ring(target, on = true) {
      if (!on || !target) return ad('ring', null, false);
      const b = await box(target).catch(() => null);
      if (b) await ad('ring', { x: b.x, y: b.y, w: b.width, h: b.height }, true);
      return b;
    },
    async zoom(target, opt = {}) {
      const b = await box(target).catch(() => null);
      if (b) await ad('zoomRect', { x: b.x, y: b.y, w: b.width, h: b.height }, opt);
    },
    reset: (dur) => ad('reset', dur ?? 800),
    // Smooth scroll of the element's own scroll box so the target sits at `at` (0..1) of it.
    async scrollTo(target, opt = {}) {
      await gate();
      const l = loc(target);
      await l.waitFor({ state: 'attached', timeout: o.timeout || 8000 });
      await capped('прокрутка', l.evaluate((el, opt) => new Promise((resolve) => {
        let p = el.parentElement;
        while (p && p !== document.body) { const cs = getComputedStyle(p); if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 2) break; p = p.parentElement; }
        const scroller = p && p !== document.body ? p : document.scrollingElement;
        const pr = scroller === document.scrollingElement ? { top: 0, height: innerHeight } : scroller.getBoundingClientRect();
        const er = el.getBoundingClientRect();
        const scale = scroller === document.scrollingElement ? 1 : (pr.height / scroller.clientHeight) || 1;
        const want = scroller.scrollTop + ((er.top - pr.top) - (pr.height * (opt.at ?? 0.3)) + (opt.dy || 0)) / scale;
        const y0 = scroller.scrollTop, y1 = Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight, want));
        const dur = opt.dur ?? Math.min(1500, 500 + Math.abs(y1 - y0) * 0.9);
        const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
        const snap = scroller.style.scrollSnapType; scroller.style.scrollSnapType = 'none';
        const t0 = performance.now();
        const step = () => { const k = Math.min(1, (performance.now() - t0) / dur); scroller.scrollTop = y0 + (y1 - y0) * ease(k); if (k < 1) requestAnimationFrame(step); else { scroller.style.scrollSnapType = snap; resolve(); } };
        requestAnimationFrame(step);
      }), opt), 6000);
    },
    // Brings an element of a sideways chip row (or a long list) into view before pointing at it.
    async reveal(target, ms = 300) {
      await gate();
      // Smooth scroll, then wait until the element stops moving: a click aimed during the scroll would miss it.
      await capped('показ элемента', loc(target).evaluate((el) => new Promise((resolve) => {
        const r0 = el.getBoundingClientRect();
        const off = r0.top < 60 || r0.bottom > innerHeight - 90;
        el.scrollIntoView({ block: off ? 'center' : 'nearest', inline: 'center', behavior: 'smooth' });
        let last = '', same = 0;
        const t0 = performance.now();
        const step = () => {
          const r = el.getBoundingClientRect(), key = `${Math.round(r.left)},${Math.round(r.top)}`;
          same = key === last ? same + 1 : 0; last = key;
          if (same >= 4 || performance.now() - t0 > 2000) resolve(); else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      })), 4000).catch(() => {});
      await d.sleep(ms);
    },
    // Scroll the panel to the top (a new view keeps the old scroll position on some screens).
    async scrollTop(selector = '#sheet-body') {
      await page.evaluate((sel) => { const el = document.querySelector(sel); if (el) el.scrollTo({ top: 0, behavior: 'smooth' }); }, selector).catch(() => {});
      await d.sleep(450);
    },
  };
  return d;
}
