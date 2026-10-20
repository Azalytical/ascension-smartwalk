/**
 * Who is going, when and what kind of outing a free-text request asks for, beyond place categories.
 * Lexical ru/kk/en patterns only: no model sees the request at this stage.
 */

const NEGATED = /(?:^|[^\p{L}\p{N}])(?:не|без|not|no|without)\s+[\p{L}]+/gu;

const PATTERNS = {
  child: /ребён|ребен|ребят|дет(?:ей|и|ск|ям)|малыш|сын|дочь|дочк|kid|child|toddler|бала(?:м|мен|лар)?(?:[^\p{L}]|$)|сәби/u,
  sightseeing: /турист|tourist|посмотреть|увидеть|осмотр|глянуть|sightsee|\bsights?\b|\bsee\b|достопримечат|көрікті|көру|перед вылетом|до вылета|перед рейсом|транзит|layover|stopover/u,
  night: /ночн|ночью|ночь|поздн|после полуночи|\bnight|\blate\b|түнгі|түнде|кешкі|вечером поздно/u,
  bar: /(?:^|[^\p{L}])(?:бар|бары|баре|бара|барам|паб|пабы|пабе|pub|pubs|bar|bars|клуб|клубы|nightclub|караоке|karaoke|коктейл|cocktail)(?:[^\p{L}]|$)/u,
  unusual: /необычн|unusual|уникальн|интересн|удиви|нестандарт|скрыт|hidden|secret|ерекше|қызық|таңғаларлық|что-то новое|wow/u,
  group: /(?:^|[^\p{L}])нас\s+(?:\d+|двое|трое|четверо|пятеро|шестеро)|компани|друзь|друзей|группой|группа|коллег|командой|\bgroup\b|friends|\bwe are\b|достар|топпен/u,
  accessible: /коляск|wheelchair|без ступен|ступенек|маломобил|инвалид|пандус|\bramp|accessib|step-free|арбамен|мүмкіндігі шектеулі|опорн|на костыл/u,
  quiet: /тих|спокой|quiet|calm|тыныш|поработать|work|ноутбук|laptop/u,
  route: /маршрут|route|несколько мест|по пути|по дороге|подряд|цепоч|пару мест|2-3 места|три места|бағыт/u,
};

const GROUP_WORDS = { двое: 2, трое: 3, четверо: 4, пятеро: 5, шестеро: 6 };

function groupSize(text) {
  const match = /нас\s+(\d+|двое|трое|четверо|пятеро|шестеро)|(\d+)\s*(?:человек|чел|друз|people|friends|адам)/u.exec(text);
  if (!match) return null;
  const value = match[1] ? (GROUP_WORDS[match[1]] ?? Number(match[1])) : Number(match[2]);
  return Number.isInteger(value) && value >= 2 && value <= 30 ? value : null;
}

/** Intents found in the request; negated phrases («не с ребёнком», «без баров») never count. */
export function queryIntents(query) {
  const text = String(query ?? '').toLocaleLowerCase('ru').normalize('NFKC').replace(/ё/g, 'е');
  const positive = text.replace(NEGATED, ' ');
  const found = Object.fromEntries(Object.entries(PATTERNS).map(([name, pattern]) => [name, pattern.test(positive)]));
  return { ...found, groupSize: found.group ? groupSize(positive) : null };
}

const LOCAL_OFFSET_MINUTES = 5 * 60;

/** Local wall-clock HH:MM in Astana (UTC+5 all year). */
export function localClock(date) {
  const local = new Date(date.getTime() + LOCAL_OFFSET_MINUTES * 60000);
  return `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`;
}

/**
 * A night request made in the daytime is checked against tonight, 22:00 local time, so that
 * hours filter out places that will be closed by then. Night-time requests keep the current time.
 */
export function nightReference(reference) {
  const local = new Date(reference.getTime() + LOCAL_OFFSET_MINUTES * 60000);
  const hour = local.getUTCHours();
  if (hour >= 20 || hour < 6) return null;
  local.setUTCHours(22, 0, 0, 0);
  return new Date(local.getTime() - LOCAL_OFFSET_MINUTES * 60000);
}
