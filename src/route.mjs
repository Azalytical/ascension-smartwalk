/**
 * A micro-route: three of the feasible places visited one after another, with walking legs,
 * clock times and the walk back, all inside the visitor's time budget. Pure computation over
 * records the retrieval step already validated; nothing here is generated.
 */
import { checkVisit } from './hours.mjs';
import { localClock } from './intent.mjs';

const POOL = 10;
// Places to eat and drink, as in retrieval: two of them in one short route read as «two cafes in a row».
const FOOD = ['cafe', 'restaurant', 'nightlife'];
const MAX_HOURS_CHECKS = 60;

/**
 * candidates: feasible picks from recommend() ({ poi, name, walkMinutes, visitMinutes, score }); name is the normalized name.
 * walk(a, b): estimated walking minutes between two { lat, lon } points.
 * Returns null when no three distinct places fit the budget and recorded hours.
 */
export function microRoute(candidates, constraints, reference, walk) {
  if (constraints.minutes < 45 || candidates.length < 3) return null;
  // Top places by score with distinct names. Every filter below only gets stricter as the pool grows, so one pass
  // in score order (ties: nearer first, then input order) picks the same pool as rescanning all candidates per slot.
  const pool = [];
  const names = new Set();
  let food = 0;
  const ranked = candidates.map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => b.candidate.score - a.candidate.score || a.candidate.walkMinutes - b.candidate.walkMinutes || a.index - b.index);
  for (const { candidate } of ranked) {
    if (pool.length >= POOL) break;
    // A stop needs a name to walk to, and a second record of the same kind a few steps away is usually the same place.
    if (candidate.poi.nameIsGenerated || names.has(candidate.name)
      || pool.some(other => other.poi.category === candidate.poi.category && walk(other.poi, candidate.poi) <= 2)
      // Cafes score high for most requests; capping them leaves room in the pool for a park or a sight to walk to.
      || (!constraints.foodFocus && FOOD.includes(candidate.poi.category) && food >= 3)) continue;
    names.add(candidate.name);
    if (FOOD.includes(candidate.poi.category)) food++;
    pool.push(candidate);
  }
  if (pool.length < 3) return null;
  const start = { lat: constraints.lat, lon: constraints.lon };
  const between = pool.map(a => pool.map(b => (a === b ? 0 : walk(a.poi, b.poi))));
  const back = pool.map(c => (constraints.returnToStart ? walk(c.poi, start) : 0));
  const options = [];
  for (let i = 0; i < pool.length; i++) {
    for (let j = 0; j < pool.length; j++) {
      if (j === i) continue;
      for (let k = 0; k < pool.length; k++) {
        if (k === i || k === j) continue;
        const [a, b, c] = [pool[i], pool[j], pool[k]];
        const legs = [a.walkMinutes, between[i][j], between[j][k], back[k]];
        if (legs.slice(1, 3).some(leg => leg > constraints.maxWalkMinutes)) continue;
        const walking = legs.reduce((sum, leg) => sum + leg, 0);
        const total = walking + a.visitMinutes + b.visitMinutes + c.visitMinutes + constraints.safetyReserveMinutes;
        if (total > constraints.minutes) continue;
        // Variety is a bonus, not a rule: a request for sights may well be three sights.
        const variety = 6 * (new Set([a.poi.category, b.poi.category, c.poi.category]).size - 1);
        // One stop to eat is part of a walk; a second one only when food is what the visitor asked for, a third only on an explicit route request.
        const food = [a, b, c].filter(stop => FOOD.includes(stop.poi.category)).length;
        if (food > (constraints.foodFocus ? (constraints.routeAsked ? 3 : 2) : 1)) continue;
        options.push({ stops: [a, b, c], legs, walking, total, value: a.score + b.score + c.score + variety - 0.8 * walking });
      }
    }
  }
  options.sort((x, y) => y.value - x.value || x.total - y.total);
  for (const option of options.slice(0, MAX_HOURS_CHECKS)) {
    const route = schedule(option, constraints, reference);
    if (route) return route;
  }
  return null;
}

function schedule({ stops, legs, walking, total }, constraints, reference) {
  let clock = reference ? reference.getTime() : null;
  const planned = [];
  for (const [index, stop] of stops.entries()) {
    const { poi } = stop;
    if (clock !== null) clock += legs[index] * 60000;
    const arrival = clock !== null ? new Date(clock) : null;
    const hours = arrival && poi.openingHours ? checkVisit(poi.openingHours, arrival, stop.visitMinutes) : null;
    if (hours && ['closed', 'closes_early'].includes(hours.status)) return null;
    if (clock !== null) clock += stop.visitMinutes * 60000;
    planned.push({ id: poi.id, name: poi.name, category: poi.category, lat: poi.lat, lon: poi.lon, sourceUrl: poi.sourceUrl,
      walkFromPreviousMinutes: legs[index], visitMinutes: stop.visitMinutes,
      arriveAt: arrival ? localClock(arrival) : null, leaveAt: clock !== null ? localClock(new Date(clock)) : null,
      hoursStatus: hours?.status ?? (poi.openingHours ? 'not_checked' : 'no_data') });
  }
  const returnMinutes = legs[3];
  const backBy = clock !== null ? localClock(new Date(clock + returnMinutes * 60000)) : null;
  const path = planned.map(stop => `${stop.name} (${stop.walkFromPreviousMinutes} мин пешком, ${stop.visitMinutes} мин на месте)`).join(' → ');
  return {
    label: 'Мини-маршрут из трёх мест',
    stops: planned, walkMinutes: walking, visitMinutes: planned.reduce((sum, stop) => sum + stop.visitMinutes, 0),
    returnMinutes, reserveMinutes: constraints.safetyReserveMinutes, totalMinutes: total, returnToStart: constraints.returnToStart,
    backBy, isEstimate: true,
    summary: `${path}${constraints.returnToStart ? ` → обратно ${returnMinutes} мин` : ''}. Всего около ${total} из ${constraints.minutes} мин`
      + `${backBy ? `, ${constraints.returnToStart ? 'вернётесь' : 'закончите'} примерно к ${backBy}` : ''}.`,
    warnings: ['Маршрут построен по прямой между точками с коэффициентом обхода; переходы и входы не проверены.',
      'Порядок мест выбран по времени и соответствию запросу; на месте его можно поменять.'],
  };
}
