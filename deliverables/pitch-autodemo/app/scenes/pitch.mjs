// The live part of the pitch, step by step, in the order of the stage directions [в скобках] of speech-10min.md.
// One → on the clicker plays one step. Each step brings its own tab to the front and gets there from wherever the
// page is, so a step works even after a pause, a skipped step or a manual click.
// A step that cannot run (no internet, a feature not on the site yet) throws, and the show falls back to the deck.

// The demo links of the speech (its section «Ссылки для демо»); the speech file wins if it has them.
export const LINKS = {
  coffee: '/?lat=51.0880152&lon=71.4097489&t=45&w=15&q=' + encodeURIComponent('Хочу выпить кофе и немного отдохнуть. Нужно вернуться к началу') + '&go=1',
  tourist: '/?from=baiterek&t=120&w=30&q=' + encodeURIComponent('Я турист, у меня 2 часа перед вылетом: что можно посмотреть поблизости?') + '&go=1',
  agent: '/agent',
};

// Which stage direction plays which step: per slide, in order; a direction that matches nothing only moves the text on.
export const CUES = {
  3: [
    { beat: 'coffee', match: /Ctrl\+2|кофе/i },
    { beat: 'coffeeCard', match: /карточк/i },
    { beat: 'tourist', match: /турист|Ctrl\+3/i },
    { beat: 'touristScroll', match: /прокрут|вниз/i },
    { beat: 'h3', match: /Рядом|H3|сот|столбик|3D/i },
    { beat: 'deckNext', match: /колод|Ctrl\+1/i },
  ],
  8: [
    { beat: 'dataPanel', match: /данные|Клетка|Ctrl\+2/i },
    { beat: 'deck', match: /колод|Ctrl\+1/i },
  ],
  bonus7: [
    { beat: 'agent', match: /agent|агент|Ctrl\+4/i },
    { beat: 'deckNext', match: /колод|Ctrl\+1/i },
  ],
};

const blockTitled = (page, re) => page.locator('.place-view .block', { has: page.locator('.block-title', { hasText: re }) }).first();

// Back to the list of options if a place card is open.
async function toResults(d) {
  const page = d.page;
  if (await d.exists('.results-view')) return;
  const back = page.locator('.place-view .back-btn, .view-bar .back-btn').first();
  if (await back.count()) { await d.tap(back, { after: 700 }); }
  if (!(await d.exists('.results-view', 4000))) throw new Error('список вариантов не открылся');
}

export const BEATS = {
  coffee: {
    label: 'Кофе у Mega Silk Way: три кафе на 45 минут',
    async run(c) {
      await c.sleep(1100); // the deck's slide 03 shows for a moment, then the site fades in
      const { d } = await c.front('coffee', { results: true });
      await toResults(d);
      await d.scrollTop();
      await d.url(5200);
      await d.cap('Живой сайт · <i>«Хочу выпить кофе и немного отдохнуть»</i> · 45 минут', 0, 5600);
      await d.glance('#results-title', { fx: 0.25, dur: 700 });
      await d.sleep(800);
      // With Gemini on, its tip sits above the list: the panel scrolls so the three cafés are in view.
      await d.scrollTo('.result-row', { at: 0.12, dur: 900 });
      const rows = d.page.locator('.result-row');
      const n = Math.min(3, await rows.count());
      for (let i = 0; i < n; i++) { await d.glance(rows.nth(i), { fx: 0.86, fy: 0.42, dur: 650 }); await d.sleep(650); }
    },
  },
  coffeeCard: {
    label: 'Карточка первого кафе: время по частям, «почему», часы и источник',
    async run(c) {
      const { d } = await c.front('coffee', { results: true });
      await toResults(d);
      const row = d.page.locator('.result-row').first();
      await d.tap(row, { fx: 0.35, after: 900 });
      if (!(await d.exists('.place-view', 3000))) {
        // A second try on the name itself; then the row's own click, so a missed aim never costs the card.
        if (await d.exists('.result-row')) await d.tap(row.locator('.result-name'), { after: 900 }).catch(() => {});
        if (!(await d.exists('.place-view', 2500)) && await d.exists('.result-row')) await row.click({ timeout: 2000 }).catch(() => {});
      }
      if (!(await d.exists('.place-view', 4000))) throw new Error('карточка не открылась');
      await d.ring('.place-view .time-card');
      await d.cap('Туда, на месте, обратно, запас и <i>во сколько вы вернётесь</i>', 0, 4800);
      await d.sleep(3200);
      await d.ring(null, false);
      const why = blockTitled(d.page, /Почему подходит/);
      if (await why.count()) {
        await d.scrollTo(why, { at: 0.08 });
        await d.ring(why);
        await d.cap('«Почему подходит» и «Чем заняться»: <i>конкретное действие на месте</i>', 0, 4800);
        await d.sleep(3400);
        await d.ring(null, false);
      }
      const info = blockTitled(d.page, /Сведения/);
      if (await info.count()) {
        await d.scrollTo(info, { at: 0.12 });
        await d.ring(info);
        await d.cap('Часы работы проверены на весь визит, <i>источник и уверенность</i> видны сразу', 0, 4800);
        await d.sleep(2600);
        await d.ring(null, false);
      }
    },
  },
  tourist: {
    label: 'Назад к вариантам, затем турист у Байтерека, 2 часа',
    async run(c) {
      if (c.isLoaded('coffee')) {
        const { d } = await c.front('coffee');
        if (!(await d.exists('.results-view'))) await toResults(d).catch(() => {});
        await d.sleep(500);
      }
      const { d } = await c.front('tourist', { results: true });
      await toResults(d);
      await d.scrollTop();
      await d.cap('Запрос из задания: <i>«Я турист, у меня два часа перед вылетом»</i>', 0, 5200);
      await d.glance('#results-title', { fx: 0.25, dur: 700 });
      await d.sleep(600);
      const first = d.page.locator('.result-row').first();
      await d.reveal(first, 300);
      await d.glance(first, { fx: 0.5, fy: 0.3 });
      await d.ring(first);
      await d.sleep(2600);
      await d.ring(null, false);
    },
  },
  touristScroll: {
    label: 'Вниз: «Мы учли» и мини-маршрут из трёх мест',
    async run(c) {
      const { d } = await c.front('tourist', { results: true });
      await toResults(d);
      if (await d.exists('.understood')) {
        await d.scrollTo('.understood', { at: 0.18, dur: 1400 });
        await d.ring('.understood');
        await d.cap('<i>«Мы учли»</i>: что Айдём понял из запроса', 0, 4200);
        await d.sleep(2800);
        await d.ring(null, false);
      }
      if (await d.exists('.route-card:not(.events-card)')) {
        await d.scrollTo('.route-card:not(.events-card)', { at: 0.2, dur: 1200 });
        await d.ring('.route-card:not(.events-card)');
        await d.cap('<i>Мини-маршрут</i>: три места подряд и время возвращения', 0, 4800);
        await d.sleep(2400);
        const show = d.page.locator('.route-card:not(.events-card) button').first();
        if (await show.count()) await d.tap(show, { after: 1200 });
        await d.ring(null, false);
      } else c.note('Мини-маршрута в этом ответе нет: говори про «Мы учли» и три места.');
    },
  },
  h3: {
    label: 'Вкладка «Рядом»: соты H3, 3D, самый высокий столбик',
    async run(c) {
      const { d } = await c.front('tourist');
      await d.tap('#tab-explore', { after: 900 });
      if (!(await d.exists('.chip-h3', 5000))) { c.note('Кнопки «Соты H3» на сайте нет: пропусти фразу про соты.'); return; }
      await d.cap('Все 2058 мест на сетке <i>Uber H3</i>', 0, 4200);
      await d.reveal('.chip-h3');
      if ((await d.page.locator('.chip-h3').getAttribute('aria-pressed').catch(() => null)) !== 'true') await d.tap('.chip-h3', { after: 900 });
      await hexesDrawn(d.page);
      await d.sleep(700);
      if ((await d.page.locator('#fab-tilt').getAttribute('aria-pressed').catch(() => null)) !== 'true') await d.tap('#fab-tilt', { after: 1600 });
      await d.cap('<i>3D</i>: высота столбика — число мест в соте', 0, 4200);
      await d.sleep(900);
      const target = await tallestCell(d.page);
      if (!target) { c.note('Столбики не нарисовались: скажи про соты по экрану.'); return; }
      await d.tapXY(target.x, target.y, { after: 1200 });
      if (await d.exists('.h3-cell', 3000)) {
        await d.scrollTo('.h3-cell', { at: 0.2 });
        await d.ring('.h3-cell');
        await d.cap('У скольких мест в соте <i>есть часы работы</i>: честно', 0, 4800);
        await d.sleep(2600);
        await d.ring(null, false);
      }
    },
  },
  dataPanel: {
    label: 'Кофе: панель «Какие данные использованы» и «Клетка на карте»',
    async run(c) {
      const { d } = await c.front('coffee', { results: true });
      await toResults(d);
      if (!(await d.exists('.data-used', 2000))) throw new Error('панели «Какие данные использованы» нет на сайте');
      await d.scrollTo('.data-used', { at: 0.06, dur: 1500 });
      await d.ring('.data-used .du-funnel');
      await d.cap('<i>Какие данные использованы</i>: сколько мест в базе, сколько подошли, три на экране', 0, 5200);
      await d.sleep(3200);
      await d.ring(null, false);
      const cell = d.page.locator('.data-used .du-show').first();
      if (await cell.count()) {
        await d.tap(cell, { after: 1600 });
        await d.cap('Сервер получил только <i>клетку около 110 × 70 м</i>, а не точку', 0, 5200);
        await d.sleep(2600);
      }
    },
  },
  agent: {
    label: 'Агент Gemini вживую: первый пример, шаги на экране',
    async run(c) {
      const { d } = await c.front('agent');
      if (await d.exists('#steps .step:not(.pending)')) await d.page.reload({ waitUntil: 'domcontentloaded' }).then(() => d.sleep(900)).catch(() => {});
      await d.scrollTop('html');
      await d.cap('Режим агента: <i>Gemini сам выбирает инструменты</i>', 0, 4800);
      await d.tap('#examples .chip', { after: 700 });
      await d.reveal('#go', 700);
      await d.tap('#go', { after: 400 });
      // The page scrolls to «Как думал агент» by itself; the free Gemini key may be busy, the speech says not to wait past ~10 s.
      if (!(await d.exists('#steps .step:not(.pending)', 11000))) throw new Error('агент не ответил за 11 с');
      await d.sleep(1200);
      await d.scrollTo('#steps', { at: 0.12 });
      await d.ring('#steps');
      await d.cap('Каждый шаг виден строкой: <i>инструмент, что сделал, что получил</i>', 0, 5200);
      await d.sleep(3000);
      await d.ring(null, false);
      if (await d.exists('#answer', 6000)) {
        await d.scrollTo('#answer', { at: 0.15 });
        await d.cap('Координаты в Gemini не уходят: <i>сервер подставляет точку сам</i>', 0, 4800);
        await d.sleep(1500);
      }
    },
  },
  deck: {
    label: 'Назад на колоду',
    async run(c) { await c.toDeck(); },
  },
  deckNext: {
    label: 'Назад на колоду, следующий слайд',
    async run(c) { await c.toDeck(); await c.nextSlide(); },
  },
};

// Waits until the site has drawn the honeycomb (the cells come from the server on the first press).
export async function hexesDrawn(page, ms = 6000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const ok = await page.evaluate(async () => {
      const map = (await import('/js/map/map.js')).getMap?.();
      return !!map && ['h3-fill-8', 'h3-fill-9', 'h3-col-8', 'h3-col-9'].some((id) => map.getLayer(id));
    }).catch(() => false);
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

// The tallest H3 column on screen, in window pixels, from the site's own map (the same ES module the page runs).
export async function tallestCell(page) {
  return page.evaluate(async () => {
    const mod = await import('/js/map/map.js');
    const map = mod.getMap && mod.getMap();
    if (!map) return null;
    const layers = ['h3-col-9', 'h3-col-8', 'h3-fill-9', 'h3-fill-8'].filter((id) => map.getLayer(id));
    if (!layers.length) return null;
    const features = map.queryRenderedFeatures({ layers });
    const box = map.getContainer().getBoundingClientRect();
    const k = box.width / (map.getContainer().clientWidth || box.width);
    let best = null;
    for (const f of features) {
      const ring = f.geometry?.coordinates?.[0];
      if (!ring?.length) continue;
      const lon = ring.reduce((s, p) => s + p[0], 0) / ring.length, lat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
      const p = map.project([lon, lat]);
      const x = box.left + p.x * k, y = box.top + p.y * k;
      // Only cells well inside the map, away from the side panel and the buttons on the right.
      if (x < box.left + box.width * 0.42 || x > box.right - 140 || y < box.top + 90 || y > box.bottom - 90) continue;
      const count = Number(f.properties?.count) || 0;
      if (!best || count > best.count) best = { x, y: y - 6, count };
    }
    return best;
  }).catch(() => null);
}
