/* Aidem pitch autodemo: what the show draws on top of the live site. Injected into every page of the show browser,
   it wakes up only on the site itself (window.__AIDEM.siteHost) and never changes the product: cursor, click ripple,
   caption bar, the «живой сайт» address pill, an outline around what is being talked about, a title card.
   Built on the overlay of the Aidem video autodemo (v2/video/autodemo/src/lib/overlay.js). Window API: window.__AD. */
(() => {
  const CFG = window.__AIDEM || {};
  if (window.top !== window || window.__AD || location.host !== CFG.siteHost) return;
  const OUT_EASE = 'cubic-bezier(0.23, 1, 0.32, 1)';
  const CAM_EASE = 'cubic-bezier(0.65, 0, 0.25, 1)';
  const TIP = { x: 8, y: 5 };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const minJerk = (t) => t * t * t * (10 + t * (-15 + 6 * t));
  const MARK = '<svg viewBox="0 0 64 64"><rect width="64" height="64" rx="15" fill="#0E1621"/><path d="M37.6 16.7A16 16 0 1 0 48 30" fill="none" stroke="#F5B700" stroke-width="6" stroke-linecap="round"/><circle cx="43.5" cy="20.5" r="3.6" fill="#4AA8FF"/></svg>';

  // The page may be zoomed as a whole (see page-init.js) so the site reads from the back of the hall.
  // The overlay undoes that zoom on its own root and works in the window's pixels, like Playwright's boxes.
  const pageZoom = () => parseFloat(document.documentElement.style.zoom) || 1;

  const CSS = `
html.ad-active,html.ad-active *{cursor:none!important}
#ad-root{position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483647;font-family:Onest,"Onest Variable",Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
#ad-root *{box-sizing:border-box}
#ad-cursor{position:absolute;left:0;top:0;width:38px;height:44px;transform:translate(-200px,-200px);opacity:0;transition:opacity .25s ease-out}
#ad-cursor.on{opacity:1}
#ad-cursor .in{width:100%;height:100%;transform-origin:8px 5px}
#ad-cursor svg{display:block;width:100%;height:100%;overflow:visible;filter:drop-shadow(0 2px 2.5px rgba(0,0,0,.38))}
.ad-ripple{position:absolute;width:56px;height:56px;margin:-28px 0 0 -28px;border-radius:50%;border:3px solid rgba(245,183,0,.95);background:rgba(245,183,0,.2);opacity:0}
#ad-capwrap{position:absolute;left:0;right:0;bottom:40px;display:flex;justify-content:center;padding:0 40px}
#ad-cap{display:flex;align-items:center;gap:14px;max-width:min(1500px,92vw);padding:14px 30px 14px 14px;border-radius:999px;background:rgba(14,22,33,.94);color:#fff;font-size:26px;font-weight:600;letter-spacing:-.01em;line-height:1.2;box-shadow:0 14px 36px rgba(0,0,0,.32);opacity:0}
#ad-cap b{display:inline-grid;place-items:center;min-width:40px;height:40px;padding:0 10px;border-radius:999px;background:#F5B700;color:#0E1621;font-size:18px;font-weight:800}
#ad-cap i{font-style:normal;color:#F5B700}
#ad-cap b[hidden]{display:none}
#ad-root.no-cap #ad-capwrap{display:none}
#ad-urlwrap{position:absolute;left:0;right:0;top:22px;display:flex;justify-content:center}
#ad-url{display:flex;align-items:center;gap:10px;padding:10px 22px 10px 12px;border-radius:999px;background:rgba(255,255,255,.97);color:#0E1621;font-size:20px;font-weight:600;box-shadow:0 10px 30px rgba(0,0,0,.18),0 0 0 1px rgba(14,22,33,.08);opacity:0}
#ad-url svg{width:28px;height:28px}
#ad-url span{color:#5b6573;font-weight:500}
#ad-url i{width:10px;height:10px;border-radius:50%;background:#2fa36b;box-shadow:0 0 0 4px rgba(47,163,107,.18)}
#ad-veil{position:absolute;inset:0;background:#0A0F15;opacity:0}
#ad-card{position:absolute;inset:0;display:grid;place-items:center;background:radial-gradient(1200px 700px at 50% 40%,#18263a 0%,#0B1119 60%,#06090e 100%);color:#fff;opacity:0}
#ad-card .c{display:flex;flex-direction:column;align-items:center;gap:22px;text-align:center;padding:0 60px}
#ad-card .logo{display:flex;align-items:center;gap:22px}
#ad-card .logo svg{width:92px;height:92px}
#ad-card .wm{font-family:Unbounded,sans-serif;font-weight:700;font-size:92px;letter-spacing:-.03em;line-height:1}
#ad-card .wm em{font-style:normal;color:#F5B700}
#ad-card .t{font-size:42px;font-weight:600;letter-spacing:-.015em;max-width:1300px;line-height:1.2}
#ad-card .s{font-size:26px;color:#9fb0c3;font-weight:500;max-width:1200px;line-height:1.35}
#ad-card .tag{font-size:20px;letter-spacing:.14em;text-transform:uppercase;color:#F5B700;font-weight:700}
#ad-ring{position:absolute;border:4px solid #F5B700;border-radius:18px;box-shadow:0 0 0 9999px rgba(10,15,21,.0),0 0 0 6px rgba(245,183,0,.25);opacity:0;transition:opacity .35s ease-out}
#ad-ring.on{opacity:1}
`;
  let root, cursorEl, cursorIn, cap, capNum, capText, urlEl, veilEl, cardEl, ringEl;
  function build() {
    if (root && root.isConnected) return;
    const st = document.createElement('style');
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
    root = document.createElement('div');
    root.id = 'ad-root';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = `
<div id="ad-ring"></div>
<div id="ad-capwrap"><div id="ad-cap"><b hidden></b><span></span></div></div>
<div id="ad-urlwrap"><div id="ad-url">${MARK}<b>${CFG.siteLabel || location.host}</b><span>· живой сайт</span><i></i></div></div>
<div id="ad-cursor"><div class="in"><svg viewBox="0 0 24 28"><path d="M5 3v19.4l4.7-4.5 3.2 7.3 3.4-1.5-3.2-7.2h6.6z" fill="#111" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"/></svg></div></div>
<div id="ad-card"></div>
<div id="ad-veil"></div>`;
    document.documentElement.appendChild(root);
    cursorEl = root.querySelector('#ad-cursor');
    cursorIn = cursorEl.querySelector('.in');
    cap = root.querySelector('#ad-cap');
    capNum = cap.querySelector('b');
    capText = cap.querySelector('span');
    urlEl = root.querySelector('#ad-url');
    veilEl = root.querySelector('#ad-veil');
    cardEl = root.querySelector('#ad-card');
    ringEl = root.querySelector('#ad-ring');
    if (CFG.captions === false) root.classList.add('no-cap');
    fitRoot();
  }
  // The root lives in window pixels whatever the page zoom is.
  function fitRoot() {
    if (!root) return;
    const z = pageZoom();
    root.style.zoom = String(1 / z);
    root.style.width = `${innerWidth}px`;
    root.style.height = `${innerHeight}px`;
  }
  addEventListener('resize', fitRoot);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build, { once: true });
  else build();

  const S = { x: -200, y: -200 };
  function setCursor(x, y) {
    S.x = x; S.y = y;
    if (cursorEl) cursorEl.style.transform = `translate(${(x - TIP.x).toFixed(1)}px, ${(y - TIP.y).toFixed(1)}px)`;
  }
  const show = (on = true) => { build(); cursorEl.classList.toggle('on', !!on); };
  function cursorTo(x, y, dur) {
    build(); fitRoot(); show(true);
    const x0 = S.x < -50 ? x + 260 : S.x;
    const y0 = S.y < -50 ? y + 180 : S.y;
    const dx = x - x0, dy = y - y0, dist = Math.hypot(dx, dy);
    if (dist < 1.5) { setCursor(x, y); return Promise.resolve(); }
    const d = dur != null ? dur : clamp(380 + dist * 0.45, 460, 1200);
    const bend = clamp(dist * 0.1, 0, 80) * (dx >= 0 ? -1 : 1);
    const cx = x0 + dx / 2 - (dy / dist) * bend, cy = y0 + dy / 2 + (dx / dist) * bend;
    const frames = [];
    for (let i = 0; i < 48; i++) {
      const t = minJerk(i / 47), u = 1 - t;
      const px = u * u * x0 + 2 * u * t * cx + t * t * x, py = u * u * y0 + 2 * u * t * cy + t * t * y;
      frames.push({ transform: `translate(${(px - TIP.x).toFixed(1)}px, ${(py - TIP.y).toFixed(1)}px)` });
    }
    const a = cursorEl.animate(frames, { duration: d, easing: 'linear', fill: 'forwards' });
    return a.finished.then(() => { setCursor(x, y); a.cancel(); }, () => setCursor(x, y));
  }
  function press() {
    build();
    const down = cursorIn.animate([{ transform: 'scale(1)' }, { transform: 'scale(.82)' }], { duration: 110, easing: 'ease-out', fill: 'forwards' });
    const r = document.createElement('div');
    r.className = 'ad-ripple';
    r.style.left = S.x + 'px'; r.style.top = S.y + 'px';
    root.insertBefore(r, cursorEl);
    r.animate([{ transform: 'scale(.3)', opacity: 0.95 }, { transform: 'scale(1.3)', opacity: 0 }], { duration: 600, easing: OUT_EASE, fill: 'forwards' })
      .finished.then(() => r.remove(), () => r.remove());
    return down.finished.then(() => {
      const up = cursorIn.animate([{ transform: 'scale(.82)' }, { transform: 'scale(1)' }], { duration: 220, easing: OUT_EASE, fill: 'forwards' });
      up.finished.then(() => { down.cancel(); up.cancel(); }, () => {});
    }, () => {});
  }

  // ---------- camera: a CSS transform on the body, in window pixels ----------
  const ID = { s: 1, tx: 0, ty: 0 };
  let cam = ID;
  let camAnim = null;
  const tf = (c) => { const z = pageZoom(); return `translate(${(c.tx / z).toFixed(2)}px, ${(c.ty / z).toFixed(2)}px) scale(${c.s.toFixed(4)})`; };
  function camTo(c1, dur = 1100) {
    const el = document.body;
    if (camAnim) { try { camAnim.finish(); } catch (e) { /* gone */ } }
    el.style.transformOrigin = '0 0';
    const a = el.animate([{ transform: tf(cam) }, { transform: tf(c1) }], { duration: Math.max(1, dur), easing: CAM_EASE, fill: 'forwards' });
    camAnim = a;
    cam = c1;
    return a.finished.then(() => {
      if (Math.abs(c1.s - 1) < 1e-3 && Math.abs(c1.tx) < 0.5 && Math.abs(c1.ty) < 0.5) { el.style.transform = ''; cam = ID; } else el.style.transform = tf(c1);
      a.cancel();
      if (camAnim === a) camAnim = null;
    }, () => {});
  }
  // A rect in window pixels, framed at scale s with its anchor at (sx, sy) of the window.
  function zoomRect(r, o = {}) {
    const W = innerWidth, H = innerHeight;
    const bx = (r.x + r.w * (o.ax ?? 0.5) - cam.tx) / cam.s;
    const by = (r.y + r.h * (o.ay ?? 0.5) - cam.ty) / cam.s;
    const bw = r.w / cam.s, bh = r.h / cam.s;
    const pad = o.pad ?? 80;
    let s = o.scale ?? Math.min((W - 2 * pad) / bw, (H - 2 * pad) / bh);
    s = clamp(s, o.minScale ?? 1, o.maxScale ?? 2);
    let tx = W * (o.sx ?? 0.5) - s * bx;
    let ty = H * (o.sy ?? 0.5) - s * by;
    tx = clamp(tx, W - s * W, 0); ty = clamp(ty, H - s * H, 0);
    return camTo({ s, tx, ty }, o.dur ?? 1100);
  }
  const reset = (dur = 800) => (cam === ID ? Promise.resolve() : camTo(ID, dur));

  // ---------- outline around a rect (window pixels) ----------
  function ring(r, on = true) {
    build();
    if (!on || !r) { ringEl.classList.remove('on'); return; }
    const pad = 8;
    Object.assign(ringEl.style, { left: `${r.x - pad}px`, top: `${r.y - pad}px`, width: `${r.w + 2 * pad}px`, height: `${r.h + 2 * pad}px` });
    ringEl.classList.add('on');
  }

  // ---------- captions, url pill, veil, title cards ----------
  let capSeq = 0;
  // On the site's wide layout the panel sits on the left with the tab bar under it: the caption goes over the map.
  function placeCaption() {
    const wrap = root.querySelector('#ad-capwrap');
    const sheet = document.querySelector('#sheet');
    let left = 0;
    if (sheet) {
      const r = sheet.getBoundingClientRect();
      const html = document.documentElement.getBoundingClientRect().width || innerWidth;
      const k = Math.abs(html - innerWidth) < Math.abs(html * pageZoom() - innerWidth) ? 1 : pageZoom();
      const right = r.right * k;
      if (r.width > 0 && right > 0 && right < innerWidth * 0.55) left = right;
    }
    wrap.style.left = `${Math.round(left)}px`;
  }
  function caption(text, n, ms = 4200) {
    build(); fitRoot(); placeCaption();
    const my = ++capSeq;
    capText.innerHTML = text;
    capNum.hidden = !n;
    capNum.textContent = n ? String(n) : '';
    cap.getAnimations().forEach((a) => a.cancel());
    cap.animate([{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], { duration: 450, easing: OUT_EASE, fill: 'forwards' });
    if (ms > 0) setTimeout(() => { if (my === capSeq) hideCaption(); }, ms);
  }
  function hideCaption() {
    if (!cap) return;
    const op = getComputedStyle(cap).opacity;
    cap.getAnimations().forEach((a) => a.cancel());
    cap.animate([{ opacity: op, transform: 'none' }, { opacity: 0, transform: 'translateY(8px)' }], { duration: 360, easing: 'ease-in', fill: 'forwards' });
  }
  function captions(on) { build(); root.classList.toggle('no-cap', !on); }
  function urlPill(ms = 4200) {
    build();
    urlEl.getAnimations().forEach((a) => a.cancel());
    urlEl.animate([{ opacity: 0, transform: 'translateY(-12px)' }, { opacity: 1, transform: 'none' }], { duration: 450, easing: OUT_EASE, fill: 'forwards' });
    setTimeout(() => urlEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, easing: 'ease-in', fill: 'forwards' }), ms);
  }
  function fade(to, ms = 500) {
    build();
    const from = parseFloat(getComputedStyle(veilEl).opacity) || 0;
    veilEl.getAnimations().forEach((a) => a.cancel());
    veilEl.style.opacity = String(from);
    const a = veilEl.animate([{ opacity: from }, { opacity: to }], { duration: ms, easing: 'ease-in-out', fill: 'forwards' });
    return a.finished.then(() => { veilEl.style.opacity = String(to); a.cancel(); }, () => {});
  }
  function card(o, ms = 600) {
    build();
    cardEl.innerHTML = `<div class="c">${o.tag ? `<div class="tag">${o.tag}</div>` : ''}<div class="logo">${MARK}<div class="wm"><em>ai</em>dem</div></div>${o.title ? `<div class="t">${o.title}</div>` : ''}${o.sub ? `<div class="s">${o.sub}</div>` : ''}</div>`;
    const from = parseFloat(getComputedStyle(cardEl).opacity) || 0;
    cardEl.getAnimations().forEach((a) => a.cancel());
    return cardEl.animate([{ opacity: from }, { opacity: 1 }], { duration: ms, easing: 'ease-in-out', fill: 'forwards' }).finished.catch(() => {});
  }
  function cardOff(ms = 600) {
    build();
    const from = parseFloat(getComputedStyle(cardEl).opacity) || 0;
    cardEl.getAnimations().forEach((a) => a.cancel());
    return cardEl.animate([{ opacity: from }, { opacity: 0 }], { duration: ms, easing: 'ease-in-out', fill: 'forwards' }).finished.catch(() => {});
  }
  // While the show drives the page the real pointer is hidden; on pause the presenter's own mouse comes back.
  function activate(on) { build(); document.documentElement.classList.toggle('ad-active', !!on); if (!on) { show(false); ring(null, false); } }

  window.__AD = { activate, cursorTo, press, show, setCursor, cursorPos: () => ({ x: S.x, y: S.y }), camTo, zoomRect, reset,
    caption, hideCaption, captions, urlPill, fade, card, cardOff, ring, build };
})();
