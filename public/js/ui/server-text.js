// The server writes «Мы учли», its notes, «Почему подходит», «План» and the checks in Russian, and sends each one as a key
// with params too. In Kazakh and English the line is built here from i18n-server.js; in Russian, or when a key is missing
// (an older answer, a saved demo), the server's own text stays.
import { t, has, lang, plural } from '../core/i18n.js';
import { categoryName, factName } from './common.js';

const local = () => lang() !== 'ru';
const lower = (text) => String(text).charAt(0).toLocaleLowerCase() + String(text).slice(1);
const upper = (text) => String(text).charAt(0).toLocaleUpperCase() + String(text).slice(1);
// Kazakh writes decimals with a comma, as Russian does; browsers often lack kk-KZ number data.
const number = (value) => Number(value).toLocaleString(lang() === 'en' ? 'en-GB' : 'ru-RU', { maximumFractionDigits: 1 });
const weatherOf = ({ degrees, condition }) => `${degrees}, ${t(`wx.${condition || 'dry'}`)}`;
const categories = (list) => (Array.isArray(list) ? list.map((category) => lower(categoryName(category))).join(', ') : '');

// Params every template may use: the category in both cases, the weather, lists of facts.
function common(params = {}) {
  return {
    ...params,
    ...(params.category ? { category: lower(categoryName(params.category)), Category: categoryName(params.category) } : {}),
    ...(params.degrees ? { weather: weatherOf(params) } : {}),
  };
}

// Templates that need a choice or a piece built from params; the rest are `${prefix}.${key}` filled with common(params).
const SPECIAL = {
  u: {
    time: (p) => t('u.time', { ...p, back: p.returnToStart ? t('u.timeBack') : '' }),
    categories: (p) => t('u.categories', { list: categories(p.categories) }),
    semantic: (p) => t('u.semantic', { list: categories(p.categories) }),
    excluded: (p) => t('u.excluded', { list: categories(p.categories) }),
    child: (p) => t(p.fromQuery ? 'u.childFromQuery' : 'u.child'),
    night: (p) => t(p.shifted ? 'u.nightShifted' : 'u.night'),
    group: (p) => (p.size ? t('u.groupSize', p) : t('u.group')),
    weather: (p) => t('u.weather', { weather: weatherOf(p), roof: p.roof ? t('u.weatherRoof') : '' }),
    hidden: (p) => t('understood.hidden', { n: p.n, what: plural(p.n, 'understood.hiddenForms') }),
  },
  n: {
    nearestBeyond: (p) => t('n.nearestBeyond', { ...common(p), back: p.returnToStart ? t('n.back') : '',
      fix: upper([p.moreTime ? t('n.fixTime', p) : '', p.moreWalk ? t('n.fixWalk', p) : ''].filter(Boolean).join(t('n.fixAnd')) || t('n.fixNone')) }),
    missingCategory: (p) => t('n.missingCategory', { ...common(p), back: p.returnToStart ? t('n.back') : '' }),
    namedTooFar: (p) => t('n.namedTooFar', { ...p, back: p.returnToStart ? t('n.back') : '' }),
    beyondWalk: (p) => t('n.beyondWalk', { ...p, km: number(p.km) }),
  },
  unc: { groupSize: (p) => t('unc.groupSize', p) },
  w: {
    hoursOpen: (p) => t('w.hoursOpen', { until: p.closesAt ? t('w.until', p) : t('w.allDay') }),
    external: (p) => t('w.external', { source: p.source || t('w.externalSource') }),
  },
  c: {
    hoursCover: (p) => t('c.hoursCover', { until: p.closesAt ? t('c.until', p) : '' }),
    external: (p) => t('c.external', { source: p.source || t('w.externalSource') }),
  },
  why: {
    request: (p) => t('why.request', { ...common(p), child: p.child ? t('why.requestChild') : '' }),
    groupFormat: (p) => { const format = factName(p.format); return format ? t('why.groupFormat', { format, size: p.size ? t('why.groupOf', p) : '' }) : null; },
    facts: (p) => { const facts = (p.facts || []).map(factName).filter(Boolean); return facts.length ? t('why.facts', { facts: facts.join(', ') }) : null; },
    factsAlso: (p) => { const facts = (p.facts || []).map(factName).filter(Boolean); return facts.length ? t('why.factsAlso', { facts: facts.join(', ') }) : null; },
    time: (p) => t('why.time', { ...p, span: t(p.returnToStart ? 'why.spanBack' : 'why.spanOneWay') }),
    open: (p) => t(p.closesAt ? 'why.open' : 'why.openAllDay', p),
    back: (p) => t(p.returnToStart ? 'why.back' : 'why.done', p),
  },
  step: {
    visit: (p) => (has(`act.${p.category}`) ? t('step.visit', { minutes: p.minutes, activity: t(`act.${p.category}`) }) : null),
  },
};

/** One keyed text in the interface language, or null when this language has no template for it. */
function render(prefix, item) {
  if (!item || typeof item.key !== 'string') return null;
  const params = item.params && typeof item.params === 'object' ? item.params : {};
  const special = SPECIAL[prefix]?.[item.key];
  if (special) return special(params);
  const key = `${prefix}.${item.key}`;
  return has(key) ? t(key, common(params)) : null;
}

/** The server's Russian texts, each replaced by its keyed version where this language has one. */
function localList(texts, keys, prefix) {
  const list = Array.isArray(texts) ? texts : [];
  if (!local() || !Array.isArray(keys) || keys.length !== list.length) return list;
  return list.map((text, index) => render(prefix, keys[index]) ?? text);
}

/** «Мы учли»: the label of one understood item. */
export const understoodLabel = (item) => (local() ? render('u', item) ?? item.label : item.label);
/** The answer's notes above the list, the unconfirmed wishes, and one card's warnings. */
export const noteTexts = (result) => localList(result?.warnings, result?.warningKeys, 'n');
export const unconfirmedTexts = (result) => localList(result?.unconfirmed, result?.unconfirmedKeys, 'unc');
export const warningTexts = (place) => localList(place?.warnings, place?.warningKeys, 'w');
/** The card's checks: data completeness and open-data notability. */
export const confidenceReasons = (place) => localList(place?.confidence?.reasons, place?.confidence?.reasonKeys, 'c');
export const notabilityReasons = (place) => localList(place?.notability?.reasons, place?.notability?.reasonKeys, 'nb');
/** «План»: the steps with clock-free minutes. */
export const planSteps = (place) => localList(place?.plan?.steps, place?.plan?.stepKeys, 'step');

// A part made only of facts with no translation is left out of the line rather than shown in Russian.
const OPTIONAL = new Set(['groupFormat', 'facts', 'factsAlso']);

/** «Почему подходит» without Gemini: the parts joined in this language, or the server's text when a part has no template. */
export function whyText(place) {
  const parts = place?.whyKeys;
  if (!local() || !Array.isArray(parts) || !parts.length) return place?.why ?? null;
  const texts = parts.map((part) => render('why', part));
  if (texts.some((text, index) => !text && !OPTIONAL.has(parts[index]?.key))) return place.why ?? null;
  return `${upper(texts.filter(Boolean).join('; '))}.`;
}
