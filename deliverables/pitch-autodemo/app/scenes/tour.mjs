// The full tour: every feature of the live site, one after another, by itself, with captions on the projector and
// talking points in the prompter. For the time before and after the pitch, the jury walking round, or a stand.
// → skips to the next part, Esc stops the tour. Nothing here writes to the site: no ratings, no friends, no invites.
import { hexesDrawn, tallestCell } from './pitch.mjs';

const pause = (d, ms) => d.sleep(ms);

async function open(c, path, wait = '.view, #examples') {
  const { page, d } = c;
  await d.fade(1, 300).catch(() => {});
  await page.goto(c.site + path, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForSelector(wait, { timeout: 20000 });
  await page.waitForTimeout(700);
  await c.front();
  await d.activate(true);
  await d.fade(0, 450);
}

export const TOUR = [
  {
    title: 'Начало: прогулка ровно на ваше время',
    say: 'Айдём подбирает место в Астане под свободное время: дорога туда, время на месте, дорога обратно и запас.',
    async run(c) {
      const { d } = c;
      await open(c, '/?tab=walk', '.view');
      await d.card({ tag: 'Полный тур · живой сайт', title: 'Прогулка по Астане, ровно на ваше время', sub: 'Сейчас Айдём сам покажет все функции сайта' }, 10);
      await pause(d, 3200);
      await d.cardOff(700);
      await d.url(4500);
      await pause(d, 1500);
    },
  },
  {
    title: 'Запрос своими словами и старт словами',
    say: 'Время, запрос обычными словами и старт: можно сказать «час у меги» и Айдём поймёт и время, и точку.',
    async run(c) {
      const { d, page } = c;
      await d.cap('Сколько у вас времени и <i>что хочется</i>', 1, 4200);
      const chip = page.locator('button.seg', { hasText: /^1 ч|60/ }).first();
      if (await chip.count()) await d.tap(chip, { after: 500 });
      const field = page.locator('input[type=search], .search-field input, textarea').first();
      await d.tap(field, { fx: 0.3 });
      await field.fill('').catch(() => {});
      await d.type('час у меги, кофе и немного пройтись');
      await pause(d, 600);
      await d.cap('Старт словами: <i>«час у меги»</i> — это и время, и точка', 2, 4200);
      await pause(d, 1600);
      const go = page.locator('.cta, button.btn-primary', { hasText: /Подобрать|Найти|Поехали|варианты/i }).first();
      await d.tap(go.or(page.locator('.cta')).first(), { after: 600 });
      await page.waitForSelector('.result-row, .state-view', { timeout: 25000 });
      await pause(d, 900);
    },
  },
  {
    title: 'Три варианта, совет Gemini и «Почему это, а не другое»',
    say: 'Три места, у каждого кольцо времени. Совет Gemini объясняет выбор, а время и часы работы считает сервер.',
    async run(c) {
      const { d, page } = c;
      if (!(await d.exists('.result-row', 2000))) { await open(c, c.links.coffee, '.result-row, .state-view'); }
      await d.cap('Три места. <i>Каждое с дорогой обратно</i>', 3, 4500);
      const rows = page.locator('.result-row');
      for (let i = 0; i < Math.min(3, await rows.count()); i++) { await d.glance(rows.nth(i), { fx: 0.86, fy: 0.42, dur: 600 }); await pause(d, 700); }
      if (await d.exists('.ai-card:not(.is-quiet)')) {
        await d.scrollTo('.ai-card', { at: 0.15 });
        await d.ring('.ai-card');
        await d.cap('<i>Gemini</i> объясняет выбор. Факты и время считает код', 4, 4800);
        await pause(d, 3000);
        await d.ring(null, false);
      }
    },
  },
  {
    title: 'Мы учли, мини-маршрут, «Сегодня в городе»',
    say: '«Мы учли» показывает, что понято из запроса. Мини-маршрут собирает несколько мест подряд. «Сегодня в городе» — афиша дня рядом.',
    async run(c) {
      const { d } = c;
      for (const [sel, text] of [['.understood', '<i>«Мы учли»</i>: что Айдём понял из запроса'], ['.route-card:not(.events-card)', '<i>Мини-маршрут</i>: несколько мест подряд'],
        ['.events-card', '<i>Сегодня в городе</i>: события дня рядом, из открытой афиши'], ['details.unchecked', '<i>Что мы не проверяли</i>: честно']]) {
        if (!(await d.exists(sel))) continue;
        await d.scrollTo(sel, { at: 0.2 });
        await d.ring(sel);
        await d.cap(text, 0, 3800);
        await pause(d, 2600);
        await d.ring(null, false);
      }
    },
  },
  {
    title: 'Какие данные использованы и клетка на карте',
    say: 'Под каждым подбором видно, какие данные ушли на сервер: только клетка около 110 × 70 метров, а не точка. Gemini координат не получает.',
    async run(c) {
      const { d, page } = c;
      if (!(await d.exists('.data-used'))) await open(c, c.links.coffee, '.result-row, .state-view');
      if (!(await d.exists('.data-used', 3000))) return;
      await d.scrollTo('.data-used', { at: 0.06 });
      await d.ring('.data-used');
      await d.cap('<i>Какие данные использованы</i>: база → подошли → на экране', 5, 4800);
      await pause(d, 3000);
      await d.ring(null, false);
      const cell = page.locator('.data-used .du-show').first();
      if (await cell.count()) { await d.tap(cell, { after: 1200 }); await d.cap('Сервер получил только <i>клетку</i>, а не точку', 0, 4200); await pause(d, 2400); }
    },
  },
  {
    title: 'Карточка места: план, «что сделать на месте», источник',
    say: 'Карточка: время по частям и во сколько вернётесь, «почему подходит», что сделать на месте, часы работы и источник данных.',
    async run(c) {
      const { d, page } = c;
      if (!(await d.exists('.result-row'))) await open(c, c.links.coffee, '.result-row');
      await d.scrollTo('.result-row', { at: 0.2 });
      await d.tap(page.locator('.result-row').first(), { fx: 0.35, after: 900 });
      await d.ring('.place-view .time-card');
      await d.cap('Туда, на месте, обратно, запас — <i>во сколько вернётесь</i>', 6, 4500);
      await pause(d, 2800);
      await d.ring(null, false);
      for (const title of [/Почему подходит/, /План|Чем заняться/, /Сведения/]) {
        const block = page.locator('.place-view .block', { has: page.locator('.block-title', { hasText: title }) }).first();
        if (!(await block.count())) continue;
        await d.scrollTo(block, { at: 0.12 });
        await d.ring(block);
        await pause(d, 2400);
        await d.ring(null, false);
      }
      const source = page.locator('.place-view details summary', { hasText: /Откуда эти данные/ }).first();
      if (await source.count()) {
        await d.scrollTo(source, { at: 0.3 });
        await d.tap(source, { after: 700 });
        await d.cap('<i>Откуда эти данные</i>: источник и лицензия у каждого места', 0, 4200);
        await pause(d, 2400);
      }
    },
  },
  {
    title: 'Прогулка: кольцо времени и «план поменялся»',
    say: 'На прогулке кольцо показывает, сколько осталось до возвращения. Если место закрыто, пошёл дождь или вы задерживаетесь, Айдём перестроит план с тем же временем возвращения.',
    async run(c) {
      const { d, page } = c;
      const start = page.locator('.place-view button', { hasText: /Начать прогулку|Идём|Поехали/ }).first();
      if (!(await start.count())) return;
      await d.reveal(start);
      await d.tap(start, { after: 1200 });
      // «Перед выходом»: weather and opening hours before the walk, then «Поехали».
      const go = page.locator('button', { hasText: /^\s*Поехали\s*$/ }).first();
      if (await d.exists(go, 3000)) {
        await d.cap('<i>Перед выходом</i>: погода и часы работы', 0, 3800);
        await pause(d, 2600);
        await d.reveal(go);
        await d.tap(go, { after: 1400 });
      }
      if (!(await d.exists('.live-view', 4000))) return;
      await d.ring('.live-hero');
      await d.cap('<i>Кольцо времени</i> и «пора обратно» вовремя', 7, 4500);
      await pause(d, 3000);
      await d.ring(null, false);
      if (await d.exists('.replan')) {
        await d.scrollTo('.replan', { at: 0.25 });
        await d.ring('.replan');
        await d.cap('План поменялся: <i>место закрыто, дождь или задерживаюсь</i>', 0, 4800);
        const rain = page.locator('.replan .chip', { hasText: /Дождь/ }).first();
        if (await rain.count()) { await d.tap(rain, { after: 2600 }); }
        await pause(d, 2200);
        await d.ring(null, false);
      }
      // The walk ends without a rating: the tour writes nothing to the site.
      const finish = page.locator('.live-view .view-bar button', { hasText: /Закончить|Завершить/ }).first();
      if (await finish.count()) await d.tap(finish, { after: 900 });
    },
  },
  {
    title: 'Рядом: категории, соты H3 в 3D, «Город 15 минут»',
    say: 'Вкладка «Рядом»: все 2058 мест и категории. Соты Uber H3 в 3D показывают, где мест больше и у скольких известны часы работы. «Город 15 минут» показывает, где у дома нет парка, площадки или кафе в пятнадцати минутах пешком.',
    async run(c) {
      const { d, page } = c;
      await open(c, '/?tab=explore&from=baiterek', '.view, .chip-h3');
      await d.cap('<i>Рядом</i>: все места вокруг, по категориям', 8, 4200);
      const chips = page.locator('.view .chip-row .chip');
      if (await chips.count() > 2) { await d.tap(chips.nth(1), { after: 1200 }); await d.tap(chips.nth(0), { after: 900 }); }
      if (!(await d.exists('.chip-h3'))) return;
      const pressed = async (sel) => (await page.locator(sel).first().getAttribute('aria-pressed').catch(() => null)) === 'true';
      await d.reveal('.chip-h3');
      if (!(await pressed('.chip-h3'))) await d.tap('.chip-h3', { after: 900 });
      await hexesDrawn(page);
      if (!(await pressed('#fab-tilt'))) await d.tap('#fab-tilt', { after: 1800 });
      await d.cap('<i>Соты Uber H3 в 3D</i>: высота столбика — число мест', 0, 4200);
      await pause(d, 2600);
      const target = await tallestCell(page);
      if (target) {
        await d.tapXY(target.x, target.y, { after: 1200 });
        if (await d.exists('.h3-cell', 3000)) {
          await d.scrollTo('.h3-cell', { at: 0.2 });
          await d.ring('.h3-cell');
          await d.cap('У скольких мест в соте <i>есть часы работы</i>', 0, 4200);
          await pause(d, 2600);
          await d.ring(null, false);
        }
      }
      if (await pressed('#fab-tilt')) await d.tap('#fab-tilt', { after: 1200 });
      // «Город 15 минут»: what is missing within a 15-minute walk of each cell (on the site since 21.10).
      const gaps = page.locator('.h3-lens .chip', { hasText: /Город 15 минут/ }).first();
      if (await gaps.count()) {
        await d.reveal(gaps, 400);
        await d.tap(gaps, { after: 1600 });
        if (await d.exists('.gaps-card', 3000)) {
          await d.scrollTo('.gaps-card', { at: 0.15 });
          await d.ring('.gaps-card');
          await d.cap('<i>Город 15 минут</i>: где у дома нет парка, площадки или кафе', 0, 5200);
          await pause(d, 3600);
          await d.ring(null, false);
        }
      }
      if (await pressed('.chip-h3')) { await d.reveal('.chip-h3', 400); await d.tap('.chip-h3', { after: 700 }); }
    },
  },
  {
    title: 'Три языка и тёмная тема',
    say: 'Интерфейс и ответы на русском, казахском и английском. Есть тёмная тема.',
    async run(c) {
      const { d, page } = c;
      await d.tap('#tab-me', { after: 900 });
      for (const label of [/ҚАЗ|KAZ|Қаз/i, /EN/i, /РУС|RU/i]) {
        const b = page.locator('.me-view .seg', { hasText: label }).first();
        if (await b.count()) { await d.scrollTo(b, { at: 0.35 }); await d.tap(b, { after: 1500 }); }
      }
      await d.cap('<i>Русский, казахский, английский</i>', 9, 3800);
      const dark = page.locator('.me-view .seg', { hasText: /Тёмная|Dark/i }).first();
      if (await dark.count()) {
        await d.scrollTo(dark, { at: 0.35 });
        await d.tap(dark, { after: 1800 });
        const light = page.locator('.me-view .seg', { hasText: /Светлая|Light/i }).first();
        if (await light.count()) await d.tap(light, { after: 800 });
      }
    },
  },
  {
    title: 'Агент Gemini: сам выбирает инструменты',
    say: 'В режиме агента Gemini сам решает, что проверить: погоду, места, мини-маршрут, и каждый шаг виден на экране.',
    async run(c) {
      const { d, page } = c;
      await open(c, '/agent', '#examples');
      await d.cap('<i>Агент Gemini</i>: function calling, шаги видны', 10, 4800);
      await d.tap(page.locator('#examples .chip').first(), { after: 700 });
      await d.reveal('#go', 700);
      await d.tap('#go', { after: 400 });
      if (await d.exists('#steps .step:not(.pending)', 15000)) {
        await d.scrollTo('#steps', { at: 0.15 });
        await d.ring('#steps');
        await pause(d, 3600);
        await d.ring(null, false);
        if (await d.exists('#answer', 8000)) { await d.scrollTo('#answer', { at: 0.12 }); await pause(d, 3000); }
      } else c.note('Агент не ответил за 15 с: бесплатный ключ Gemini занят. Шаги агента есть в ролике.');
    },
  },
  {
    title: 'Часы и Siri',
    say: 'На смарт-часах открывается страница /watch: «Найти место», «Идём», стрелка и минуты. Siri спрашивает через короткую ссылку.',
    async run(c) {
      const { d } = c;
      await open(c, '/watch', 'body');
      await d.cap('<i>Смарт-часы</i>: страница /watch, Siri по ссылке', 11, 4800);
      await pause(d, 4200);
    },
  },
  {
    title: 'Финал',
    say: 'Карты отвечают «где», чат-боты «что». Айдём отвечает, куда пойти прямо сейчас, чтобы успеть вернуться.',
    async run(c) {
      const { d } = c;
      await d.card({ title: 'Куда пойти прямо сейчас, чтобы успеть вернуться', sub: 'ascension-smartwalk.azamatbreach.workers.dev · Aidem by Ascension · Build with AI 2026' }, 800);
      await pause(d, 5000);
      await d.cardOff(600);
    },
  },
];
