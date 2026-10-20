// Saved answers for the key scenarios, shown by the app when there is no internet (labelled «Демо-ответ, сохранён …»).
// The local engine on data/places.json, the same as scripts/scenario-protocol.mjs; prepare-public.mjs writes the result
// to public/data/demo-answers.json on every build, and the service worker keeps it for offline use.
import { recommend } from '../src/retrieval.mjs';

const DAY = '2026-10-22';
const START = {
  mega: { id: 'mega', names: { ru: 'Mega Silk Way', kk: 'Mega Silk Way', en: 'Mega Silk Way' }, lat: 51.0880152, lon: 71.4097489 },
  baiterek: { id: 'baiterek', names: { ru: 'Байтерек', kk: 'Бәйтерек', en: 'Baiterek' }, lat: 51.1283, lon: 71.4304 },
  embankment: { id: 'embankment', names: { ru: 'Набережная Есиля', kk: 'Есіл жағалауы', en: 'Yesil embankment' }, lat: 51.161, lon: 71.423 },
};
// The first one is the default; the others are picked when the typed request matches `match`.
const SCENARIOS = [
  { id: 'walk', start: 'mega', minutes: 60, maxWalkMinutes: 20, time: '18:00', query: 'Я возле Mega Silk Way, хочу прогуляться 30–60 минут',
    title: { ru: 'Возле Mega Silk Way, прогулка на час', kk: 'Mega Silk Way маңында, бір сағаттық серуен', en: 'Near Mega Silk Way, a one-hour walk' } },
  { id: 'coffee', start: 'baiterek', minutes: 60, maxWalkMinutes: 15, time: '15:00', query: 'Хочу тихое место с кофе и розеткой недалеко',
    match: 'кофе|кафе|розетк|тих|coffee|cafe|socket|quiet', title: { ru: 'Тихий кофе с розеткой, час', kk: 'Розеткасы бар тыныш кофе, бір сағат', en: 'Quiet coffee with a socket, one hour' } },
  { id: 'kids', start: 'baiterek', minutes: 90, maxWalkMinutes: 15, time: '12:00', query: 'С ребёнком: площадка или музей с интерактивами',
    match: 'ребён|ребен|дет|child|kid|бала|семь|family', title: { ru: 'С ребёнком, полтора часа', kk: 'Баламен, бір жарым сағат', en: 'With a child, an hour and a half' } },
  { id: 'tourist', start: 'baiterek', minutes: 120, maxWalkMinutes: 30, time: '14:00', query: 'Я турист, у меня 2 часа до вылета, что посмотреть рядом',
    match: 'турист|вылет|аэропорт|достопримеч|tourist|sight|flight|landmark|көрікті|музе|museum', title: { ru: 'Турист, 2 часа у Байтерека', kk: 'Турист, Бәйтерек маңында 2 сағат', en: 'Tourist, 2 hours by Baiterek' } },
  { id: 'night', start: 'embankment', minutes: 120, maxWalkMinutes: 20, time: '23:30', query: 'Хочу что-то необычное ночью',
    match: 'ноч|night|түн|необычн|unusual|ерекше', title: { ru: 'Необычное ночью, 23:30', kk: 'Түнде ерекше бір нәрсе, 23:30', en: 'Something unusual at night, 23:30' } },
];
// What the results screen and the place card read; the rest of the engine's answer stays out of the file.
const KEEP = ['recommendations', 'warnings', 'warningKeys', 'unconfirmed', 'unconfirmedKeys', 'understood', 'route', 'nearestBeyondLimits', 'generation'];

export function demoAnswers(places) {
  const scenarios = SCENARIOS.map(({ id, title, match, start, minutes, maxWalkMinutes, time, query }) => {
    const point = START[start];
    const result = recommend(places, { lat: point.lat, lon: point.lon, minutes, maxWalkMinutes, query, returnToStart: true, visitDate: `${DAY}T${time}:00+05:00` });
    const kept = Object.fromEntries(KEEP.filter((key) => result[key] !== undefined).map((key) => [key, result[key]]));
    kept.recommendations = kept.recommendations.map(({ tags, evidence, score, scoreBreakdown, matchedTerms, ...place }) => place);
    return { id, title, ...(match ? { match } : {}), start: point, minutes, time, query, result: kept };
  });
  return { savedAt: new Date().toISOString(), engine: 'local', scenarios };
}
