// «Какие данные использованы» under the walk options: the point as the server got it, how the base narrowed down to the
// cards, which words became which filters, what went to Gemini, where the cards' facts come from and what is kept.
// Built only from the request and the server's own answer, so it shows what was really used, not a general promise.
import { h, icon } from '../core/dom.js';
import { t, addStrings } from '../core/i18n.js';
import { personal } from '../core/privacy.js';
import { categoryName } from './common.js';

export const LAW_URL = 'https://github.com/Azalytical/ascension-smartwalk/blob/main/docs/ethics.md#закон-рк-о-персональных-данных';

addStrings({
  ru: {
    'du.title': 'Какие данные использованы',
    'du.base': 'мест в базе', 'du.fit': 'подошли по времени и условиям', 'du.shown': 'на экране',
    'du.rejected': 'Отсеяли: {list}',
    'du.rej.category': 'не та категория {n}', 'du.rej.walkBudget': 'дальше вашего лимита пешком {n}', 'du.rej.totalBudget': 'не успеть вернуться {n}',
    'du.rej.closedByHours': 'закрыто к приходу {n}', 'du.rej.unknownHoursAtNight': 'ночью без часов работы {n}', 'du.rej.notAccessible': 'без доступа для коляски {n}',
    'du.rej.excludedByUser': 'вы скрыли {n}', 'du.rej.restrictedAccess': 'закрытая территория {n}',
    'du.point': 'Ваша точка', 'du.point.cell': 'Клетка около 110 × 70 м: {lat}, {lon}. Точное место осталось в телефоне.',
    'du.point.preset': 'Ориентир «{name}» из списка: общая точка, а не ваша геопозиция.', 'du.point.show': 'Клетка на карте', 'du.point.shown': 'Сервер получил только эту клетку, а не точку',
    'du.query': 'Запрос → фильтры', 'du.query.none': 'Слов запроса нет: только время и выбранные условия.',
    'du.query.semantic': 'Смысл понят эмбеддингами Gemini: {cats}. Туда ушёл только текст запроса.',
    'du.ai': 'ИИ', 'du.ai.llm': 'Gemini получил текст запроса и найденные места ({n}): названия, категории, минуты, часы работы. Без координат и без данных о вас.',
    'du.ai.off': 'Gemini в этот раз не использовался: тексты собраны по данным мест.',
    'du.sources': 'Источники', 'du.sources.value': '{list}. База собрана скриптами {date}.',
    'du.store': 'Хранение', 'du.store.value': 'Сервер не сохраняет ни точку, ни запрос. История подборов только в этом браузере.',
    'du.law': 'Как это соотносится с Законом РК № 94-V «О персональных данных и их защите»',
  },
  kk: {
    'du.title': 'Қандай деректер қолданылды',
    'du.base': 'базадағы орын', 'du.fit': 'уақыт пен шартқа сай келді', 'du.shown': 'экранда',
    'du.rejected': 'Алынып тасталды: {list}',
    'du.rej.category': 'басқа санат {n}', 'du.rej.walkBudget': 'жаяу шегіңізден алыс {n}', 'du.rej.totalBudget': 'қайтып үлгермейсіз {n}',
    'du.rej.closedByHours': 'барғанда жабық {n}', 'du.rej.unknownHoursAtNight': 'түнде жұмыс уақыты белгісіз {n}', 'du.rej.notAccessible': 'арбамен кіру жоқ {n}',
    'du.rej.excludedByUser': 'өзіңіз жасырдыңыз {n}', 'du.rej.restrictedAccess': 'жабық аумақ {n}',
    'du.point': 'Сіздің нүктеңіз', 'du.point.cell': 'Шамамен 110 × 70 м ұяшық: {lat}, {lon}. Нақты орныңыз телефонда қалды.',
    'du.point.preset': 'Тізімдегі «{name}» бағдары: ортақ нүкте, сіздің геолокацияңыз емес.', 'du.point.show': 'Ұяшық картада', 'du.point.shown': 'Серверге нүкте емес, тек осы ұяшық жіберілді',
    'du.query': 'Сұрау → сүзгілер', 'du.query.none': 'Сұрау сөздері жоқ: тек уақыт пен таңдалған шарттар.',
    'du.query.semantic': 'Мағынасын Gemini эмбеддингтері анықтады: {cats}. Оған тек сұрау мәтіні жіберілді.',
    'du.ai': 'ЖИ', 'du.ai.llm': 'Gemini сұрау мәтінін және табылған орындарды ({n}) алды: атаулары, санаттары, минуттар, жұмыс уақыты. Координатсыз және сіз туралы деректерсіз.',
    'du.ai.off': 'Бұл жолы Gemini қолданылмады: мәтіндер орындар деректері бойынша құрылды.',
    'du.sources': 'Дереккөздер', 'du.sources.value': '{list}. Базаны скрипттер {date} жинады.',
    'du.store': 'Сақтау', 'du.store.value': 'Сервер нүктені де, сұрауды да сақтамайды. Іздеу тарихы тек осы браузерде.',
    'du.law': 'ҚР «Дербес деректер және оларды қорғау туралы» № 94-V Заңына қалай сай келеді',
  },
  en: {
    'du.title': 'What data we used',
    'du.base': 'places in the base', 'du.fit': 'fit your time and conditions', 'du.shown': 'on screen',
    'du.rejected': 'Left out: {list}',
    'du.rej.category': 'other category {n}', 'du.rej.walkBudget': 'beyond your walking limit {n}', 'du.rej.totalBudget': 'no time to get back {n}',
    'du.rej.closedByHours': 'closed when you arrive {n}', 'du.rej.unknownHoursAtNight': 'no opening hours at night {n}', 'du.rej.notAccessible': 'no wheelchair access {n}',
    'du.rej.excludedByUser': 'hidden by you {n}', 'du.rej.restrictedAccess': 'restricted area {n}',
    'du.point': 'Your point', 'du.point.cell': 'A cell of about 110 × 70 m: {lat}, {lon}. Your exact location stayed on the phone.',
    'du.point.preset': 'The landmark «{name}» from the list: a public point, not your location.', 'du.point.show': 'Cell on the map', 'du.point.shown': 'The server got only this cell, not the point',
    'du.query': 'Request → filters', 'du.query.none': 'No words in the request: only the time and the chosen conditions.',
    'du.query.semantic': 'Meaning found by Gemini embeddings: {cats}. Only the request text went there.',
    'du.ai': 'AI', 'du.ai.llm': 'Gemini got the request text and the places found ({n}): names, categories, minutes, opening hours. No coordinates and nothing about you.',
    'du.ai.off': 'Gemini was not used this time: the texts are built from the place data.',
    'du.sources': 'Sources', 'du.sources.value': '{list}. The base was collected by scripts on {date}.',
    'du.store': 'Storage', 'du.store.value': 'The server stores neither the point nor the request. Search history stays in this browser.',
    'du.law': 'How this fits Kazakhstan’s Law No. 94-V «On Personal Data and Their Protection»',
  },
});

// Filters that cut the base down for this request, in the server's own counts (retrieval.rejected), largest first.
const REJECTED = ['category', 'walkBudget', 'totalBudget', 'closedByHours', 'unknownHoursAtNight', 'notAccessible', 'excludedByUser', 'restrictedAccess'];

// The day in Astana as digits (20.10.2026): the same in every language, whatever month names the phone knows.
function day(value) {
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return '';
  const local = new Date(at + 5 * 3600000);
  return `${String(local.getUTCDate()).padStart(2, '0')}.${String(local.getUTCMonth() + 1).padStart(2, '0')}.${local.getUTCFullYear()}`;
}

function row(iconName, label, value, extra = null) {
  return h('li', { class: 'du-row' }, h('span', { class: 'du-icon', 'aria-hidden': 'true' }, icon(iconName, 'icon-xs')),
    h('span', { class: 'du-text' }, h('strong', { text: label }), h('span', { text: value }), extra));
}

/**
 * The panel for one answer. `request` is the body that was sent (the person's point already rounded), `start` the start
 * as the person chose it and `startLabel` its name, `shown` the cards on screen; `onShowCell` zooms the map to the cell
 * the server worked with.
 */
export function dataUsedView({ request, result, start, startLabel, shown, onShowCell }) {
  if (!request || !result || result.demo) return null;
  const retrieval = result.retrieval || {};
  const base = retrieval.validUniqueRecords ?? result.dataset?.poiCount;
  const fit = retrieval.feasibleCandidates;
  const rejected = REJECTED.map((key) => [key, Number(retrieval.rejected?.[key]) || 0]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])
    .slice(0, 3).map(([key, n]) => t(`du.rej.${key}`, { n }));

  const funnel = Number.isFinite(base) && Number.isFinite(fit)
    ? h('div', { class: 'du-funnel', role: 'img', 'aria-label': `${base} ${t('du.base')}, ${fit} ${t('du.fit')}, ${shown.length} ${t('du.shown')}` },
      [[base, 'du.base'], [fit, 'du.fit'], [shown.length, 'du.shown']].map(([n, key], index) => [
        index ? h('span', { class: 'du-arrow', 'aria-hidden': 'true', text: '→' }) : null,
        h('span', { class: 'du-step' }, h('strong', { class: 'num', text: String(n) }), h('small', { text: t(key) }))]).flat())
    : null;

  const cell = personal(start);
  const point = cell
    ? row('locate', t('du.point'), t('du.point.cell', { lat: Number(request.lat).toFixed(3), lon: Number(request.lon).toFixed(3) }),
      onShowCell ? h('button', { class: 'btn btn-quiet btn-sm du-show', type: 'button', onclick: onShowCell }, icon('map', 'icon-xs'), t('du.point.show')) : null)
    : row('pin', t('du.point'), t('du.point.preset', { name: startLabel || start?.name || '' }));

  const terms = Array.isArray(retrieval.queryTerms) ? retrieval.queryTerms : [];
  const categories = (retrieval.requestedCategories || []).map(categoryName);
  const meant = (retrieval.semantic?.categories || []).map(categoryName);
  const query = meant.length ? t('du.query.semantic', { cats: meant.join(', ') })
    : terms.length ? `${terms.map((term) => `«${term}»`).join(', ')}${categories.length ? ` → ${categories.join(', ')}` : ''}`
      : t('du.query.none');

  const llm = result.generation?.mode === 'llm';
  const ai = llm ? t('du.ai.llm', { n: (result.recommendations || []).length }) : t('du.ai.off');

  const counts = new Map();
  for (const place of shown) { const label = place.source?.label || place.provenance?.facts?.label || '—'; counts.set(label, (counts.get(label) || 0) + 1); }
  const sources = t('du.sources.value', { list: [...counts].map(([label, n]) => `${label}: ${n}`).join(', '), date: day(result.dataset?.updatedAt) });

  return h('section', { class: 'data-used', 'aria-labelledby': 'data-used-title' },
    h('p', { id: 'data-used-title', class: 'du-title' }, icon('info', 'icon-xs'), h('span', { text: t('du.title') })),
    funnel,
    rejected.length ? h('p', { class: 'du-fine', text: t('du.rejected', { list: rejected.join(', ') }) }) : null,
    h('ul', { class: 'du-list' },
      point,
      row('filter', t('du.query'), query),
      row('sparkle', t('du.ai'), ai),
      row('globe', t('du.sources'), sources),
      row('check', t('du.store'), t('du.store.value'))),
    h('a', { class: 'du-law', href: LAW_URL, target: '_blank', rel: 'noopener noreferrer' }, h('span', { text: t('du.law') }), icon('external', 'icon-xs')));
}
