/* Aidem pitch autodemo: injected into every page of the show browser before the page's own scripts.
   1. Keys and the clicker go to the show program (window.__aidemKey), wherever the focus is: the deck, the site or
      the prompter. The deck's own keys, wheel and swipes are switched off so a slide changes only one way.
   2. On the live site: Russian, light theme, no walk left over from a rehearsal, and the whole page zoomed so the
      side panel reads from the back of the hall (the map gets a matching pixel ratio and stays sharp).
   Nothing here changes the site for anyone else: it lives only in this browser profile. */
(() => {
  const CFG = window.__AIDEM || {};
  if (window.top !== window) return;
  const onSite = location.host === CFG.siteHost;
  const onDeck = location.pathname.startsWith('/deck/') && location.host === CFG.showHost;
  const onPult = location.pathname.startsWith('/pult') && location.host === CFG.showHost;

  // ---------- 2. the site ----------
  if (onSite) {
    // On every load: a walk left running by the tour or a rehearsal would open instead of the options.
    try {
      const KEY = 'seruen:v1';
      const state = JSON.parse(localStorage.getItem(KEY) || '{}');
      Object.assign(state, { lang: CFG.lang || 'ru', theme: 'light', walk: null, onboarded: true, outdoor: false });
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) { /* storage off: the site keeps its own defaults */ }
    if (CFG.zoom !== 0) {
      const real = window.devicePixelRatio || 1;
      let z = 1;
      const want = () => (typeof CFG.zoom === 'number' && CFG.zoom > 0 ? CFG.zoom : Math.max(1, Math.min(1.6, (innerWidth || 1280) / (CFG.zoomBase || 1280))));
      const apply = () => {
        const next = Math.round(want() * 100) / 100;
        if (!document.documentElement) return;
        if (next === z && document.documentElement.style.zoom) return;
        z = next;
        document.documentElement.style.zoom = String(z);
      };
      try { Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: () => real * z }); } catch (e) { /* keep the real one */ }
      if (document.documentElement) apply(); else document.addEventListener('readystatechange', apply, { once: true });
      addEventListener('resize', apply);
      window.__aidemZoom = () => z;
    }
  }

  // ---------- 1. keys ----------
  const send = (o) => { try { if (window.__aidemKey) window.__aidemKey(o); } catch (e) { /* the show is closing */ } };
  const typingIn = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  // Keys the show owns on every page. Letters come in both layouts (Russian keyboard: и = b, с = c, з = p, й = q, е = t).
  const OWN = new Set(['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', ' ', 'Enter', 'Home', 'End', 'Escape', 'F5', 'Backspace',
    'b', 'B', 'и', 'И', '.', 'c', 'C', 'с', 'С', 'p', 'P', 'з', 'З', 'a', 'A', 'ф', 'Ф', '4', 'g', 'G', 'п', 'П', 'f', 'F', 'а', 'А', 's', 'S', 'ы', 'Ы',
    'd', 'D', 'в', 'В', 'm', 'M', 'ь', 'Ь', 'v', 'V', 'м', 'М', 'h', 'H', 'р', 'Р', 'q', 'Q', 'й', 'Й', 't', 'T', 'е', 'Е', '+', '=', '-', '_', 'F1']);
  addEventListener('keydown', (e) => {
    const key = e.key;
    // Ctrl/Cmd + digit switches tabs in the browser itself; the show only hears about it so it knows where the presenter is.
    if ((e.ctrlKey || e.metaKey) && /^[1-9]$/.test(key)) { send({ key, ctrl: true, url: location.href }); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) {
      // Ctrl+R / F5 would reload the slide or the site mid-talk.
      if (/^[rRкК]$/.test(key)) { e.preventDefault(); e.stopImmediatePropagation(); }
      return;
    }
    if (!OWN.has(key)) return;
    // The show itself is typing into the site (the tour): its spaces and letters are text, not commands.
    if (window.__aidemTyping) return;
    // While the show is paused, the presenter may type into the site: only the keys that resume the show are taken.
    if ((onSite || !onPult) && window.__aidemPassKeys && typingIn(e.target) && !['Escape', 'PageDown', 'PageUp'].includes(key)) return;
    if (onSite && window.__aidemPassKeys && !['ArrowRight', 'ArrowLeft', 'PageDown', 'PageUp', ' ', 'Escape', 'Enter'].includes(key)) return;
    if (onPult && typingIn(e.target)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat && !['+', '=', '-', '_'].includes(key)) return;
    send({ key, shift: e.shiftKey, url: location.href });
  }, true);
  // The deck also turns slides on wheel and swipe: off, so a stray scroll cannot jump a slide.
  if (onDeck) {
    const stop = (e) => { e.stopImmediatePropagation(); };
    addEventListener('wheel', stop, { capture: true, passive: true });
    addEventListener('touchstart', stop, { capture: true, passive: true });
    addEventListener('touchend', stop, { capture: true, passive: true });
  }
})();
