// «Оценки пользователей Aidem»: the average from three ratings, «мало оценок» below that, and this device's own stars.
// It sits apart from the open-data notability chip, which is not a rating and stays as it is.
import { h, icon } from '../core/dom.js';
import { t, plural, locale } from '../core/i18n.js';
import * as ratings from '../core/ratings.js';
import { toast } from './toast.js';

export const formatAverage = (value) => new Intl.NumberFormat(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);
const countText = (rating) => `${rating.count} ${plural(rating.count, 'w.rating')}`;

export function ratingText(rating) {
  if (!rating?.count) return t('rating.none');
  if (rating.state !== 'enough') return t('rating.few', { n: rating.count });
  return t('rating.summary', { avg: formatAverage(rating.average), n: rating.count, word: plural(rating.count, 'w.rating') });
}

/** «★ 4,6» on a result row and the card header, only once a place has three ratings. A rating given since the walk was found wins. */
export function ratingChip(place) {
  const rating = ratings.cached(String(place.id), place.userRating).rating;
  if (rating?.state !== 'enough') return null;
  const label = t('rating.chip', { avg: formatAverage(rating.average), n: rating.count, word: plural(rating.count, 'w.rating') });
  return h('span', { class: 'user-rating-chip num', title: label, 'aria-label': label }, icon('star-fill', 'icon-xs'), formatAverage(rating.average));
}

/** The block on the place card and, with prompt, on the «Вы вернулись» screen («Как вам …?»). */
export function ratingBlock(place, { prompt = false } = {}) {
  const id = String(place.id);
  const known = ratings.cached(id, place.userRating);
  let current = known.rating;
  let own = ratings.mine(id);
  let busy = false;

  const summary = h('p', { class: `user-rating-summary${prompt ? ' fine' : ''}`, 'aria-live': 'polite' });
  // Both stars are in each button and CSS shows one: redrawing the icon under a finger would swallow the tap.
  const buttons = [1, 2, 3, 4, 5].map((n) => h('button', { class: 'star-btn', type: 'button', 'aria-label': t('rating.star', { n }), dataset: { n }, onclick: () => choose(n) },
    icon('star', 'star-off'), icon('star-fill', 'star-on')));
  const stars = h('div', { class: 'stars', role: 'group', 'aria-label': t(prompt ? 'rating.rateIt' : 'rating.yours') }, buttons);
  const remove = h('button', { class: 'user-rating-remove fine', type: 'button', text: t('rating.remove'), onclick: () => choose(null) });

  function drawSummary(unavailable = false) {
    const prefix = prompt ? `${t('rating.title')}: ` : '';
    if (unavailable) { summary.replaceChildren(prefix + t('rating.unavailable')); return; }
    if (current?.state === 'enough') {
      summary.replaceChildren(prefix, h('span', { class: 'user-rating-avg num' }, icon('star-fill', 'icon-xs'), formatAverage(current.average)), ` · ${countText(current)}`);
    } else summary.replaceChildren(prefix + ratingText(current));
  }
  function drawStars(value = own) {
    buttons.forEach((button, index) => {
      const on = value !== null && index < value;
      button.classList.toggle('is-on', on);
      button.setAttribute('aria-pressed', String(value === index + 1));
    });
    remove.hidden = own === null;
  }
  async function choose(n) {
    if (busy || (n === null && own === null)) return;
    busy = true;
    const before = own;
    drawStars(n);
    try {
      current = await ratings.rate(id, n);
      own = n;
      toast(t(n === null ? 'rating.removed' : 'rating.saved'), { iconName: n === null ? 'check' : 'star-fill' });
    } catch {
      own = before;
      toast(t('rating.error'), { iconName: 'warning' });
    } finally {
      busy = false;
      drawStars();
      drawSummary();
    }
  }
  // Hovering shows which stars a click would set.
  stars.addEventListener('pointerover', (event) => { const n = Number(event.target.closest('.star-btn')?.dataset.n); if (n) drawStars(n); });
  stars.addEventListener('pointerleave', () => drawStars());

  drawSummary();
  drawStars();
  if (!known.fresh) {
    ratings.ratingsFor([id]).then((found) => { current = found[id] ?? current; drawSummary(); })
      .catch(() => { drawSummary(true); buttons.forEach((button) => { button.disabled = true; }); });
  }

  return h('section', { class: `block user-rating${prompt ? ' is-prompt' : ''}` },
    h('h3', { class: 'block-title', text: prompt ? t('rating.how', { name: place.name }) : t('rating.title') }),
    prompt ? null : summary,
    stars,
    remove,
    prompt ? summary : h('p', { class: 'fine', text: t('rating.hint') }));
}
