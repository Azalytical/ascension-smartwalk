// «Только туда» and walks of two hours and more. A one-way walk ends at the place: its time is the way there, the visit
// and the reserve, and every «вернётесь к» becomes «закончите к». The planner, the card, «Перед выходом» and the walk
// screen share these strings; the server already counts such a walk (returnToStart: false).
import { t, lang, addStrings } from '../core/i18n.js';

addStrings({
  ru: {
    'plan.hoursUnit': 'ч', 'plan.hours': '{n} ч', 'plan.longLabel': 'Больше двух часов',
    'plan.trip': 'Обратная дорога', 'plan.round': 'Туда и обратно', 'plan.oneWay': 'Только туда',
    'plan.doneBy': 'Закончить до {time}',
    'results.oneWayBy': 'Только туда, закончить до {time}', 'results.routeMetaOne': '{n} мин с дорогой, закончите к {time}',
    'results.empty.textOne': 'Не нашлось места, куда получится дойти и побыть там за выбранное время.',
    'results.nearestValueOne': '{walk} мин пешком, нужно около {n} мин без обратной дороги',
    'place.doneNow': 'Закончите примерно к {time}',
    'voice.placeOne': '{walk} мин пешком, закончите к {time}. Скажите «поехали», и я начну прогулку.',
    'voice.goOne': 'Поехали! {name}, закончите к {time}.', 'voice.answerOne': 'Вариантов: {n}. Первый — {name}: {walk} мин пешком, закончите к {time}.',
    'ready.done': 'Закончите к {time}', 'ready.oneWayText': 'Туда {walk} мин, на месте {visit} и ещё {reserve} мин запаса; обратная дорога не считается',
    'live.toEnd': 'до конца', 'live.doneBy': 'Закончите к {time}', 'live.endWalk': 'Закончить прогулку',
    'live.timeUp': 'Время на месте вышло: по плану заканчиваете к {time}',
    'live.finished.titleOne': 'Прогулка закончилась вовремя', 'live.finished.lateOne': 'Прогулка закончилась на {n} мин позже плана',
  },
  kk: {
    'plan.hoursUnit': 'сағ', 'plan.hours': '{n} сағ', 'plan.longLabel': 'Екі сағаттан көп',
    'plan.trip': 'Қайту жолы', 'plan.round': 'Барып-қайту', 'plan.oneWay': 'Тек бару',
    'plan.doneBy': '{time} дейін аяқтау',
    'results.oneWayBy': 'Тек бару, {time} дейін аяқтау', 'results.routeMetaOne': 'жолымен {n} мин, {time} шамасында аяқтайсыз',
    'results.empty.textOne': 'Таңдалған уақыт ішінде барып, біраз болуға болатын орын табылмады.',
    'results.nearestValueOne': '{walk} мин жаяу, қайту жолынсыз шамамен {n} мин керек',
    'place.doneNow': 'Сағат {time} шамасында аяқтайсыз',
    'voice.placeOne': 'Жаяу {walk} мин, {time} шамасында аяқтайсыз. «Кеттік» десеңіз, серуенді бастаймын.',
    'voice.goOne': 'Кеттік! {name}, {time} шамасында аяқтайсыз.', 'voice.answerOne': 'Нұсқалар: {n}. Біріншісі — {name}: жаяу {walk} мин, {time} аяқтайсыз.',
    'ready.done': 'Сағат {time} шамасында аяқтайсыз', 'ready.oneWayText': 'Барар жол {walk} мин, орында {visit} және {reserve} мин қор; қайту жолы есептелмейді',
    'live.toEnd': 'соңына дейін', 'live.doneBy': 'Аяқталу уақыты: {time}', 'live.endWalk': 'Серуенді аяқтау',
    'live.timeUp': 'Орында болу уақыты бітті: жоспар бойынша сағат {time} аяқтайсыз',
    'live.finished.titleOne': 'Серуен уақытында аяқталды', 'live.finished.lateOne': 'Серуен жоспардан {n} мин кеш аяқталды',
  },
  en: {
    'plan.hoursUnit': 'h', 'plan.hours': '{n} h', 'plan.longLabel': 'More than two hours',
    'plan.trip': 'The way back', 'plan.round': 'There and back', 'plan.oneWay': 'One way',
    'plan.doneBy': 'Done by {time}',
    'results.oneWayBy': 'One way, done by {time}', 'results.routeMetaOne': '{n} min with walking, done by {time}',
    'results.empty.textOne': 'No place you can reach and spend some time at within the chosen time.',
    'results.nearestValueOne': '{walk} min walk, about {n} min without the way back',
    'place.doneNow': 'Done around {time}',
    'voice.placeOne': '{walk} min on foot, done by {time}. Say “let’s go” and I will start the walk.',
    'voice.goOne': 'Let’s go! {name}, done by {time}.', 'voice.answerOne': 'Options: {n}. First: {name}, {walk} min on foot, done by {time}.',
    'ready.done': 'Done by {time}', 'ready.oneWayText': '{walk} min there, {visit} on site, plus {reserve} min spare; the way back is not counted',
    'live.toEnd': 'until the end', 'live.doneBy': 'Done by {time}', 'live.endWalk': 'Finish the walk',
    'live.timeUp': 'Your time on site is up: the plan ends at {time}',
    'live.finished.titleOne': 'The walk ended on time', 'live.finished.lateOne': 'The walk ended {n} min later than planned',
  },
});

/** «2,5 ч», «3 ч»: whole and half hours, with the decimal comma in Russian and Kazakh. */
export const hoursLabel = (minutes) => t('plan.hours', { n: String(minutes / 60).replace('.', lang() === 'en' ? '.' : ',') });
