// «Что-то пошло не так?» on the walk screen: the place is closed, it is raining or cold, or the person is running late.
// The new plan keeps the promised «вернётесь к» (core/replan.js); it is worked out on the phone and nothing is sent.
import { h, icon, clear } from '../core/dom.js';
import { t, time, addStrings } from '../core/i18n.js';
import { places } from '../core/api.js';
import { checkVisit } from '../lib/hours.mjs';
import { alternatives, switchTo, turnBack, runLate, whereNow } from '../core/replan.js';
import { categoryArt, hoursChip, hoursStatus } from './common.js';

addStrings({
  ru: {
    'replan.title': 'Что-то пошло не так?', 'replan.closed': 'Место закрыто', 'replan.rain': 'Дождь или холодно', 'replan.late': 'Задерживаюсь на 15 мин',
    'replan.loading': 'Ищем, что вы успеете…', 'replan.forClosed': 'Вместо «{name}», с возвращением к {time}:', 'replan.forRain': 'Под крышей, с возвращением к {time}:',
    'replan.row': '{there} мин отсюда · {visit} мин на месте · {back} мин обратно', 'replan.go': 'Идём сюда',
    'replan.none': 'Рядом нет места, которое помещается до {time}.', 'replan.turnBack': 'Повернуть обратно сейчас',
    'replan.backNow': 'Если повернуть сейчас, вернётесь примерно к {time}.', 'replan.backLate': 'Если повернуть сейчас, вернётесь примерно к {time}, на {n} мин позже обещанного.',
    'replan.switched': 'Новый план: «{name}», вернётесь к {time}', 'replan.turned': 'Идёте обратно, вернётесь примерно к {time}',
    'replan.kept': 'Вернётесь всё так же к {time}: на месте будет {n} мин вместо {m}.',
    'replan.later': 'Вернётесь к {time}, на {n} мин позже; запас ещё покрывает.', 'replan.over': 'Вернётесь к {time}: это на {n} мин позже запаса. Можно повернуть обратно сейчас.',
    'replan.private': 'Считается на телефоне по списку мест: ваша точка никуда не отправляется.', 'replan.failed': 'Не удалось загрузить список мест.',
    'replan.forClosedOne': 'Вместо «{name}», успеете до {time}:', 'replan.forRainOne': 'Под крышей, успеете до {time}:', 'replan.rowOne': '{there} мин отсюда · {visit} мин на месте',
    'replan.switchedOne': 'Новый план: «{name}», закончите к {time}', 'replan.keptOne': 'Закончите всё так же к {time}: на месте будет {n} мин вместо {m}.',
    'replan.laterOne': 'Закончите к {time}, на {n} мин позже; запас ещё покрывает.', 'replan.overOne': 'Закончите к {time}: это на {n} мин позже запаса.',
  },
  kk: {
    'replan.title': 'Жоспар өзгерді ме?', 'replan.closed': 'Орын жабық', 'replan.rain': 'Жаңбыр не суық', 'replan.late': '15 минутқа кешігіп жатырмын',
    'replan.loading': 'Үлгеретін орынды іздеп жатырмыз…', 'replan.forClosed': '«{name}» орнына, сағат {time} оралумен:', 'replan.forRain': 'Шатыр астында, сағат {time} оралумен:',
    'replan.row': 'осы жерден {there} мин · орнында {visit} мин · қайтуға {back} мин', 'replan.go': 'Осында барамыз',
    'replan.none': 'Жақын маңда сағат {time} дейін сыятын орын жоқ.', 'replan.turnBack': 'Қазір кері қайту',
    'replan.backNow': 'Қазір кері қайтсаңыз, шамамен сағат {time} ораласыз.', 'replan.backLate': 'Қазір кері қайтсаңыз, шамамен сағат {time} ораласыз, уәде етілгеннен {n} мин кеш.',
    'replan.switched': 'Жаңа жоспар: «{name}», сағат {time} ораласыз', 'replan.turned': 'Кері қайтып келесіз, шамамен сағат {time} ораласыз',
    'replan.kept': 'Бұрынғыдай сағат {time} ораласыз: орнында {m} мин орнына {n} мин боласыз.',
    'replan.later': 'Сағат {time} ораласыз, {n} мин кешірек; қор әлі жетеді.', 'replan.over': 'Сағат {time} ораласыз: бұл қордан {n} мин кеш. Қазір кері қайтуға болады.',
    'replan.private': 'Орындар тізімі бойынша телефонда есептеледі: сіздің нүктеңіз ешқайда жіберілмейді.', 'replan.failed': 'Орындар тізімін жүктеу мүмкін болмады.',
    'replan.forClosedOne': '«{name}» орнына, сағат {time} дейін үлгересіз:', 'replan.forRainOne': 'Шатыр астында, сағат {time} дейін үлгересіз:', 'replan.rowOne': 'осы жерден {there} мин · орнында {visit} мин',
    'replan.switchedOne': 'Жаңа жоспар: «{name}», сағат {time} аяқтайсыз', 'replan.keptOne': 'Бұрынғыдай сағат {time} аяқтайсыз: орнында {m} мин орнына {n} мин боласыз.',
    'replan.laterOne': 'Сағат {time} аяқтайсыз, {n} мин кешірек; қор әлі жетеді.', 'replan.overOne': 'Сағат {time} аяқтайсыз: бұл қордан {n} мин кеш.',
  },
  en: {
    'replan.title': 'Something went wrong?', 'replan.closed': 'Place is closed', 'replan.rain': 'Rain or cold', 'replan.late': 'Running 15 min late',
    'replan.loading': 'Looking for what still fits…', 'replan.forClosed': 'Instead of «{name}», back by {time}:', 'replan.forRain': 'Under a roof, back by {time}:',
    'replan.row': '{there} min from here · {visit} min on site · {back} min back', 'replan.go': 'Go here',
    'replan.none': 'Nothing nearby fits before {time}.', 'replan.turnBack': 'Turn back now',
    'replan.backNow': 'Turning back now, you are back at about {time}.', 'replan.backLate': 'Turning back now, you are back at about {time}, {n} min later than promised.',
    'replan.switched': 'New plan: «{name}», back by {time}', 'replan.turned': 'Heading back, back at about {time}',
    'replan.kept': 'Still back by {time}: {n} min on site instead of {m}.',
    'replan.later': 'Back by {time}, {n} min later; the reserve still covers it.', 'replan.over': 'Back by {time}: {n} min past the reserve. You can turn back now.',
    'replan.private': 'Worked out on your phone from the place list: your location is not sent anywhere.', 'replan.failed': 'Could not load the place list.',
    'replan.forClosedOne': 'Instead of «{name}», done by {time}:', 'replan.forRainOne': 'Under a roof, done by {time}:', 'replan.rowOne': '{there} min from here · {visit} min on site',
    'replan.switchedOne': 'New plan: «{name}», done by {time}', 'replan.keptOne': 'Still done by {time}: {n} min on site instead of {m}.',
    'replan.laterOne': 'Done by {time}, {n} min later; the reserve still covers it.', 'replan.overOne': 'Done by {time}: {n} min past the reserve.',
  },
});

const hoursAt = (openingHours, arrival, visit) => checkVisit(openingHours, arrival, visit);
const backClock = (walk) => time(walk.startedAt + (walk.plan.there + walk.plan.visit + walk.plan.back) * 60000);
// One way there is no way back: «закончите к» instead of «вернётесь к», and no «Повернуть обратно».
const say = (walk, key, params) => t(walk.oneWay ? `${key}One` : key, params);

/**
 * The block under the walk's steps. `getWalk()` is the current walk, `getFix()` the latest GPS fix (kept on the phone),
 * `apply(walk, message)` saves a changed walk and redraws the screen.
 */
export function replanBlock({ getWalk, getFix, apply }) {
  const result = h('div', { class: 'replan-result', 'aria-live': 'polite' });
  const here = () => whereNow(getWalk(), Date.now(), getFix());

  const backButton = () => h('button', { class: 'btn btn-quiet btn-block', type: 'button', onclick: () => {
    const walk = turnBack(getWalk(), { here: here(), now: Date.now() });
    clear(result);
    apply(walk, t('replan.turned', { time: backClock(walk) }));
  } }, icon('return'), t('replan.turnBack'));

  async function look(reason) {
    clear(result, h('p', { class: 'meta', text: t('replan.loading') }));
    let data;
    try { data = await places(); } catch { clear(result, h('p', { class: 'banner is-bad' }, icon('warning'), t('replan.failed')), backButton()); return; }
    const walk = getWalk();
    const now = Date.now();
    const point = here();
    const found = alternatives(walk, data.items, { reason, here: point, now, hoursAt });
    const promised = backClock(walk);
    const back = time(now + found.backNow * 60000);
    const turnNote = walk.oneWay ? null : h('p', { class: 'fine', text: found.lateBy ? t('replan.backLate', { time: back, n: found.lateBy }) : t('replan.backNow', { time: back }) });
    const turn = walk.oneWay ? null : backButton();
    if (!found.options.length) {
      clear(result, h('p', { class: 'lead', text: t('replan.none', { time: promised }) }), turnNote, turn);
      return;
    }
    clear(result,
      h('p', { class: 'meta', text: say(walk, reason === 'rain' ? 'replan.forRain' : 'replan.forClosed', { name: walk.place.name, time: promised }) }),
      h('div', { class: 'list' }, found.options.map((option) => h('button', { class: 'list-row place-row', type: 'button',
        'aria-label': `${t('replan.go')}: ${option.place.name}`,
        onclick: () => {
          const next = switchTo(getWalk(), option, { here: point, now: Date.now() });
          clear(result);
          apply(next, say(next, 'replan.switched', { name: option.place.name, time: backClock(next) }));
        } },
      categoryArt(option.place.category, 36, 'art'),
      h('span', { class: 'row-text' }, h('strong', { text: option.place.name }),
        h('small', { text: say(walk, 'replan.row', option) }),
        hoursChip(hoursStatus(option.place, option.there, option.visit))),
      icon('chevron', 'row-chevron')))),
      turnNote, turn, h('p', { class: 'fine', text: t('replan.private') }));
  }

  function late() {
    const change = runLate(getWalk(), 15);
    const at = backClock(change.walk);
    const message = change.kept ? say(change.walk, 'replan.kept', { time: at, n: change.visitAfter, m: change.visitBefore })
      : change.over ? say(change.walk, 'replan.over', { time: at, n: change.over }) : say(change.walk, 'replan.later', { time: at, n: change.later });
    clear(result, h('p', { class: change.over ? 'banner is-bad' : 'meta', text: message }), change.over && !change.walk.oneWay ? backButton() : null);
    apply(change.walk, message);
  }

  const chip = (label, iconName, onclick) => h('button', { class: 'chip', type: 'button', onclick }, icon(iconName, 'icon-xs'), label);
  const block = h('section', { class: 'block replan', 'aria-labelledby': 'replan-title' },
    h('h3', { id: 'replan-title', class: 'block-title', text: t('replan.title') }),
    h('div', { class: 'chip-row no-drag replan-chips' },
      chip(t('replan.closed'), 'warning', () => look('closed')), chip(t('replan.rain'), 'rain', () => look('rain')), chip(t('replan.late'), 'clock', late)),
    result);
  return { element: block, reset: () => clear(result) };
}
