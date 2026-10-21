// «Город 15 минут» on the «Рядом» map: what is not within 15 minutes on foot of each H3 cell with places
// (cells.reach from scripts/h3-cells.mjs). Only places and areas from open data are counted; nothing about people.
import { h } from '../core/dom.js';
import { t, number, addStrings } from '../core/i18n.js';

addStrings({
  ru: {
    'gaps.toggle': 'Город 15 минут', 'gaps.places': 'Места в сотах', 'gaps.title': 'Город 15 минут по открытым данным',
    'gaps.no.playground': 'Нет детской площадки', 'gaps.no.food': 'Нет кафе или ресторана', 'gaps.no.park': 'Нет парка или сквера',
    'gaps.count': '{label}: {n} из {total} сот', 'gaps.all': 'Всё в 15 минутах: {n} из {total} сот',
    'gaps.legend': 'Зелёная сота: всё в 15 минутах пешком. Жёлтая: нет одного. Красная: нет двух или трёх. Нажмите на соту.',
    'gaps.about': 'От центра каждой соты H3 с местами, по той же модели ходьбы, что и прогулка. Пробел может быть в городе или в открытых данных OpenStreetMap и Overture: проверить можно только на месте. Учтены места из базы Aidem ({places}) и парки, скверы и площадки из слоя землепользования ({areas}); данные о людях не нужны.',
    'gaps.cell': 'Сота: что в 15 минутах пешком', 'gaps.cellAll': 'Детская площадка, кафе и парк есть в 15 минутах пешком.',
    'gaps.near': 'Ближе всего: «{name}», {n} мин пешком.', 'gaps.nearNameless': 'Ближе всего: без названия, {n} мин пешком.',
  },
  kk: {
    'gaps.toggle': '15 минуттық қала', 'gaps.places': 'Соталардағы орындар', 'gaps.title': 'Ашық деректер бойынша 15 минуттық қала',
    'gaps.no.playground': 'Балалар алаңы жоқ', 'gaps.no.food': 'Кафе не мейрамхана жоқ', 'gaps.no.park': 'Саябақ не гүлзар жоқ',
    'gaps.count': '{label}: {total} сотаның {n}', 'gaps.all': 'Бәрі 15 минутта: {total} сотаның {n}',
    'gaps.legend': 'Жасыл сота: бәрі жаяу 15 минутта. Сары: біреуі жоқ. Қызыл: екеуі не үшеуі жоқ. Сотаны басыңыз.',
    'gaps.about': 'Орындары бар әр H3 сотасының ортасынан, серуендегідей жаяу жүру есебімен. Олқылық қалада да, OpenStreetMap пен Overture ашық деректерінде де болуы мүмкін: тек орнында тексеруге болады. {places} орын және {areas} саябақ, гүлзар мен алаң ескерілді; адамдар туралы дерек керек емес.',
    'gaps.cell': 'Сота: жаяу 15 минутта не бар', 'gaps.cellAll': 'Балалар алаңы, кафе және саябақ жаяу 15 минутта бар.',
    'gaps.near': 'Ең жақыны: «{name}», жаяу {n} мин.', 'gaps.nearNameless': 'Ең жақыны: атаусыз, жаяу {n} мин.',
  },
  en: {
    'gaps.toggle': '15-minute city', 'gaps.places': 'Places per cell', 'gaps.title': '15-minute city by open data',
    'gaps.no.playground': 'No playground', 'gaps.no.food': 'No café or restaurant', 'gaps.no.park': 'No park or square',
    'gaps.count': '{label}: {n} of {total} cells', 'gaps.all': 'Everything within 15 minutes: {n} of {total} cells',
    'gaps.legend': 'Green cell: everything within 15 minutes on foot. Amber: one missing. Red: two or three missing. Tap a cell.',
    'gaps.about': 'From the centre of each H3 cell with places, by the same walking model as the walk. A gap may be in the city or in the open data of OpenStreetMap and Overture: only a visit can tell. Counted from {places} places and {areas} parks, squares and playgrounds; no data about people.',
    'gaps.cell': 'This cell: what is within 15 minutes on foot', 'gaps.cellAll': 'A playground, a café and a park are all within 15 minutes on foot.',
    'gaps.near': 'Nearest: «{name}», {n} min on foot.', 'gaps.nearNameless': 'Nearest: unnamed, {n} min on foot.',
  },
});

/** How many cells miss each need, and how many have everything near. */
export function gapCounts(cells) {
  const total = Object.keys(cells.cells).length;
  const gaps = Object.values(cells.reach?.gaps || {});
  const needs = Object.fromEntries(Object.keys(cells.reach?.needs || {}).map((need) => [need, gaps.filter((gap) => need in gap).length]));
  return { total, needs, all: total - gaps.length };
}

/** The card over the list when no cell is tapped: the city's counts, the legend and where the numbers come from. */
export function gapsSummary(cells) {
  const { total, needs, all } = gapCounts(cells);
  const order = Object.entries(needs).sort((a, b) => b[1] - a[1]);
  return h('section', { class: 'block h3-cell gaps-card', 'aria-live': 'polite' },
    h('strong', { text: t('gaps.title') }),
    ...order.map(([need, n]) => h('p', { text: t('gaps.count', { label: t(`gaps.no.${need}`), n: number(n), total: number(total) }) })),
    h('p', { text: t('gaps.all', { n: number(all), total: number(total) }) }),
    h('p', { class: 'meta', text: t('gaps.legend') }),
    h('p', { class: 'fine', text: t('gaps.about', { places: number(cells.reach.evidence.places), areas: number(cells.reach.evidence.areas) }) }));
}

/** A tapped cell: each missing need with the nearest one beyond 15 minutes, or that everything is near. */
export function gapCell(cells, id, clearButton) {
  const gap = cells.reach?.gaps?.[id] || {};
  const lines = Object.entries(gap).map(([need, nearest]) => h('p', {},
    h('strong', { text: `${t(`gaps.no.${need}`)}. ` }),
    nearest ? (nearest.name ? t('gaps.near', { name: nearest.name, n: nearest.minutes }) : t('gaps.nearNameless', { n: nearest.minutes })) : null));
  return h('section', { class: 'block h3-cell gaps-card', 'aria-live': 'polite' },
    h('div', { class: 'h3-cell-head' }, h('strong', { text: t('gaps.cell') }), clearButton),
    ...(lines.length ? lines : [h('p', { text: t('gaps.cellAll') })]));
}
