// Test protocol for the hackathon task's scenarios: runs each one, checks it against written criteria, records Pass or Fail.
// Local engine on data/places.json:   node scripts/scenario-protocol.mjs
// Live site (adds the Gemini texts):  node scripts/scenario-protocol.mjs --live https://ascension-smartwalk.azamatbreach.workers.dev
// Writes docs/test-protocol.json and docs/test-protocol.md.
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { recommend } from '../src/retrieval.mjs';

const root = new URL('..', import.meta.url);
const live = process.argv.includes('--live') ? process.argv[process.argv.indexOf('--live') + 1] : null;
const places = JSON.parse(readFileSync(new URL('data/places.json', root), 'utf8'));
const commit = (() => { try { return execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim(); } catch { return 'unknown'; } })();

const START = {
  mega: ['Mega Silk Way', 51.0880152, 71.4097489], baiterek: ['Байтерек', 51.1283, 71.4304], embankment: ['Набережная Есиля', 51.161, 71.423],
  expo: ['EXPO 2017', 51.0896, 71.416], airport: ['аэропорт Нурсултан Назарбаев', 51.0269, 71.4614], khan: ['Хан Шатыр', 51.1324, 71.4036],
};
const DAY = '2026-10-22';
const RAIN = { temperatureC: 4, precipitationMm: 1.6, snowfallCm: 0, windKmh: 14, code: 63, source: 'Open-Meteo (тестовое значение)' };
const ROOFED = ['mall', 'museum', 'cafe', 'restaurant', 'culture'];
const fastFood = place => /KFC|Hardee|Burger King|McDonald|Popeyes|Domino|Papa John/i.test(place.name);

// Checks shared by every scenario: the task's answer format and its three mandatory rules.
const common = (r, input) => [
  ['Не больше трёх мест', r.recommendations.length <= 3],
  ['Время каждого варианта в пределах бюджета', r.recommendations.every(p => p.totalMinutes <= input.minutes && p.walkMinutes <= input.maxWalkMinutes)],
  ['У каждого места есть «почему», время на месте и план «что делать»', r.recommendations.every(p => p.why && p.visitMinutes > 0 && p.plan?.text)],
  ['У каждого места есть источник и уровень уверенности', r.recommendations.every(p => /^https:\/\//.test(p.sourceUrl) && ['high', 'medium', 'low'].includes(p.confidence?.level))],
  ['Идея «чем заняться» помечена как идея, факты как данные POI', r.recommendations.every(p => p.provenance?.activities?.origin === 'generated_idea' && p.provenance?.facts?.origin === 'poi_data')],
  ['Нет утверждения «открыто сейчас» и гарантий', r.recommendations.every(p => !/открыт[а-я]* сейчас|гарантир/i.test(`${p.why} ${p.plan?.text} ${p.aiWhy ?? ''} ${p.aiTodo ?? ''}`))],
  ['Ответ показывает, что учтено: старт, время, фильтры', ['location', 'time'].every(key => r.understood?.some(item => item.key === key))],
];

const SCENARIOS = [
  { id: 'S1', source: 'PDF', title: 'Возле Mega Silk Way, прогулка 30–60 минут', start: 'mega', minutes: 60, maxWalkMinutes: 20, time: '18:00',
    query: 'Я сейчас возле Mega Silk Way, хочу прогуляться 30–60 минут — что посоветуете?',
    expected: '1–3 места для прогулки (парки, скверы, достопримечательности), каждое с дорогой туда и обратно в пределах часа.',
    checks: r => [['Только места для прогулки: парки и достопримечательности', r.recommendations.length > 0 && r.recommendations.every(p => ['park', 'attraction'].includes(p.category))]] },
  { id: 'S2', source: 'PDF', title: 'Тихое место с кофе и розеткой недалеко', start: 'baiterek', minutes: 60, maxWalkMinutes: 15, time: '15:00',
    query: 'Хочу тихое место с кофе и розеткой недалеко от меня.',
    expected: 'Кафе рядом; тишина и розетка не утверждаются, а названы непроверенными.',
    checks: r => [['Только кафе («недалеко» не читается как «еда»)', r.recommendations.length > 0 && r.recommendations.every(p => p.category === 'cafe')],
      ['Розетка и тишина помечены как неподтверждённые', r.recommendations.every(p => p.warnings.some(w => w.includes('розеток не подтверждено')) && p.warnings.some(w => w.includes('шума не подтверждены')))]] },
  { id: 'S3', source: 'PDF', title: 'С ребёнком: площадки или музей с интерактивами', start: 'baiterek', minutes: 90, maxWalkMinutes: 15, time: '12:00',
    query: 'Еду с ребёнком — где рядом есть детские площадки или музей с интерактивами?',
    expected: 'Детские площадки, семейные места или музеи рядом; безопасность и интерактивность не утверждаются.',
    checks: r => [['Ребёнок понят из слов запроса', r.constraints.withChild === true && r.understood.some(i => i.key === 'child')],
      ['Музеи разрешены, остальные категории детские', r.retrieval.requestedCategories.includes('museum') && r.recommendations.length > 0 && r.recommendations.every(p => ['playground', 'museum', 'park', 'family'].includes(p.category))],
      ['Безопасность для ребёнка не утверждается', r.recommendations.every(p => p.warnings.some(w => w.includes('безопасность') && w.includes('не проверены')))]] },
  { id: 'S4', source: 'PDF', title: 'Турист, 2 часа перед вылетом (у Байтерека)', start: 'baiterek', minutes: 120, maxWalkMinutes: 30, time: '14:00',
    query: 'Я турист, у меня 2 часа перед вылетом: что можно посмотреть поблизости?',
    expected: 'Главные достопримечательности рядом, на первом месте сам Байтерек; мини-маршрут на 2 часа.',
    checks: r => [['Только то, что можно посмотреть: достопримечательности, музеи, парки', r.recommendations.length > 0 && r.recommendations.every(p => ['attraction', 'museum', 'park'].includes(p.category))],
      ['Первым идёт Бәйтерек', r.recommendations[0]?.name === 'Бәйтерек'],
      ['Есть мини-маршрут из трёх мест в пределах 2 часов', r.route?.stops.length === 3 && r.route.totalMinutes <= 120]] },
  { id: 'S4b', source: 'PDF', title: 'Турист, 2 часа перед вылетом (у аэропорта)', start: 'airport', minutes: 120, maxWalkMinutes: 30, time: '14:00',
    query: 'Я турист, у меня 2 часа перед вылетом: что можно посмотреть поблизости?',
    expected: 'То, что есть в пешей доступности от аэропорта, или честный ответ, что рядом мало мест.',
    checks: r => [['Есть хотя бы одно место или подсказка ближайшего', r.recommendations.length > 0 || Boolean(r.nearestBeyondLimits)],
      ['Только то, что можно посмотреть', r.recommendations.every(p => ['attraction', 'museum', 'park'].includes(p.category))]] },
  { id: 'S5', source: 'PDF', title: 'Необычная ночная активность, 23:30', start: 'embankment', minutes: 120, maxWalkMinutes: 20, time: '23:30',
    query: 'Ищу необычную ночную активность (последние пару часов).',
    expected: 'Бары, кино, поздние кафе, открытые на всё время визита по данным источника, или городские объекты под открытым небом; без детских площадок и букмекеров.',
    checks: r => [['Нет детских площадок и семейных мест', r.recommendations.every(p => !['playground', 'family'].includes(p.category))],
      ['Заведения под крышей только с подтверждёнными часами на время визита', r.recommendations.every(p => ['park', 'attraction'].includes(p.category) || p.hoursCheck.status === 'open')],
      ['Есть бар, клуб или кино', r.recommendations.some(p => ['nightlife', 'culture'].includes(p.category))],
      ['Нет букмекерских контор', r.recommendations.every(p => !/(^|[^\p{L}])БК(?=[^\p{L}]|$)|FairPlay|казино/iu.test(p.name))]] },
  { id: 'EX', source: 'PDF, пример ответа', title: 'У здания Экспо 2017, что-то необычное на 1–2 часа, пешком', start: 'expo', minutes: 120, maxWalkMinutes: 30, time: '17:00',
    query: 'Я у здании Экспо 2017, хочу что-то необычное на 1–2 часа, пешком.',
    expected: 'Как в примере задания: музей рядом с Экспо на первом месте, затем другие необычные места, с временем и планом.',
    checks: r => [['Первым идёт музей «Нур Алем»', /Nur Alem|Нұр Әлем|Нур Алем/i.test(r.recommendations[0]?.name ?? '')],
      ['Нет сетевого фастфуда и обычных ресторанов', r.recommendations.every(p => p.category !== 'restaurant' && !fastFood(p))]] },
  { id: 'K1', source: 'свой', title: 'Кофе, запрос по-казахски', start: 'mega', minutes: 45, maxWalkMinutes: 15, time: '15:00',
    query: 'Маған жақын жерде кофе ішкім келеді',
    expected: 'Кафе рядом; объяснение модели на казахском языке.',
    checks: r => [['Только кафе', r.recommendations.length > 0 && r.recommendations.every(p => p.category === 'cafe')]] },
  { id: 'E1', source: 'свой', title: 'Museum nearby, запрос по-английски', start: 'baiterek', minutes: 120, maxWalkMinutes: 30, time: '15:00',
    query: 'I want to see a museum nearby',
    expected: 'Музей в пешей доступности или честный пустой ответ с ближайшим музеем и нужным временем.',
    checks: r => [['Музеи или подсказка ближайшего музея', r.recommendations.length ? r.recommendations.every(p => p.category === 'museum') : r.nearestBeyondLimits?.category === 'museum']] },
  { id: 'G1', source: 'свой (стретч-цель «группа»)', title: 'Компания из четырёх, ужин', start: 'khan', minutes: 90, maxWalkMinutes: 20, time: '19:00',
    query: 'Нас четверо друзей, хотим поужинать',
    expected: 'Рестораны без фастфуда; предупреждение, что места на четверых не проверены.',
    checks: r => [['Размер компании понят', r.constraints.groupSize === 4],
      ['Нет сетевого фастфуда', r.recommendations.length > 0 && r.recommendations.every(p => !fastFood(p))],
      ['Предупреждение о местах для 4 человек', r.recommendations.every(p => p.warnings.some(w => w.includes('для 4 человек')))]] },
  { id: 'A1', source: 'свой (стретч-цель «доступность»)', title: 'Маломобильный посетитель', start: 'baiterek', minutes: 60, maxWalkMinutes: 15, time: '15:00',
    query: 'Я на коляске, нужно доступное место без ступенек',
    expected: 'Места с отметкой доступности для коляски (wheelchair=yes) впереди, wheelchair=no исключены, без доказательства безбарьерность не утверждается.',
    checks: r => [['Запрос доступности понят', r.understood.some(i => i.key === 'accessible')],
      ['Нет мест с wheelchair=no', r.recommendations.every(p => p.wheelchair !== 'no')],
      ['Первым идёт место с отметкой wheelchair=yes', r.recommendations[0]?.wheelchair === 'yes']] },
  { id: 'W1', source: 'свой (погода)', title: 'Дождь прямо сейчас, обычный запрос', start: 'mega', minutes: 60, maxWalkMinutes: 15, time: null, weather: RAIN,
    query: 'Куда сходить на час?',
    expected: 'При дожде по данным Open-Meteo только места под крышей, и ответ говорит о погоде.',
    checks: r => [['Только места под крышей', r.recommendations.length > 0 && r.recommendations.every(p => ROOFED.includes(p.category))],
      ['Погода названа в «Мы учли»', r.understood.some(i => i.key === 'weather')]] },
  { id: 'R1', source: 'свой (стретч-цель «мини-маршрут»)', title: 'Мини-маршрут из трёх мест', start: 'baiterek', minutes: 120, maxWalkMinutes: 20, time: '14:00',
    query: 'Составь маршрут по достопримечательностям на 2 часа',
    expected: 'Последовательность из трёх мест с дорогой между ними, временем на месте, временем по часам и возвращением.',
    checks: r => [['Три разных места', r.route?.stops.length === 3 && new Set(r.route.stops.map(s => s.id)).size === 3],
      ['Сумма времени сходится и укладывается в 2 часа', r.route && r.route.totalMinutes === r.route.walkMinutes + r.route.visitMinutes + r.route.reserveMinutes && r.route.totalMinutes <= 120],
      ['У каждой остановки время прихода по часам', r.route?.stops.every(s => /^\d\d:\d\d$/.test(s.arriveAt ?? ''))]] },
  { id: 'N1', source: 'свой (неполные данные)', title: 'Поздний кофе с розеткой, 23:30', start: 'baiterek', minutes: 60, maxWalkMinutes: 15, time: '23:30',
    query: 'Поздно ночью нужен кофе и розетка',
    expected: 'Только кафе с подтверждёнными часами на время визита; розетка не утверждается.',
    checks: r => [['Только заведения с подтверждёнными часами', r.recommendations.every(p => p.hoursCheck.status === 'open')],
      ['Розетка не утверждается', r.recommendations.every(p => p.warnings.some(w => w.includes('розеток не подтверждено')))]] },
  { id: 'M1', source: 'свой (смысловой поиск Gemini)', title: 'Запрос без слов из словаря', start: 'baiterek', minutes: 60, maxWalkMinutes: 15, time: '15:00',
    liveOnly: true, query: 'Хочу подышать свежим воздухом',
    expected: 'Эмбеддинги Gemini понимают, что нужен парк или открытое место; в «Мы учли» есть строка о смысле запроса.',
    checks: r => [['Подбор по смыслу через эмбеддинги Gemini', r.retrieval?.usesEmbeddings === true],
      ['Предложены парки или открытые места', r.recommendations.length > 0 && r.recommendations.every(p => ['park', 'attraction'].includes(p.category))],
      ['Смысл запроса назван в «Мы учли»', r.understood?.some(i => i.key === 'semantic')]] },
  { id: 'X1', source: 'свой (пустой ответ)', title: 'Слишком мало времени', start: 'baiterek', minutes: 10, maxWalkMinutes: 5, time: '15:00',
    query: 'музей',
    expected: 'Честный пустой ответ с причиной и подсказкой, что изменить.',
    checks: r => [['Пустой ответ', r.recommendations.length === 0],
      ['Есть объяснение, что изменить', r.warnings[0]?.includes('Увеличьте время')]] },
];

async function run(scenario) {
  const [startName, lat, lon] = START[scenario.start];
  const input = { lat, lon, minutes: scenario.minutes, maxWalkMinutes: scenario.maxWalkMinutes, query: scenario.query,
    ...(scenario.time ? { visitDate: `${DAY}T${scenario.time}:00+05:00` } : {}) };
  let result;
  if (live && !scenario.weather) {
    const response = await fetch(new URL('/api/recommend', live), { method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: new URL(live).origin }, body: JSON.stringify(input) });
    result = await response.json();
  } else {
    result = recommend(places, input, { weather: scenario.weather ?? null });
  }
  const checks = [...scenario.checks(result), ...common(result, input)].map(([name, ok]) => ({ name, pass: Boolean(ok) }));
  return { id: scenario.id, source: scenario.source, title: scenario.title, start: startName, input, expected: scenario.expected,
    ranOn: live && !scenario.weather ? live : `движок, коммит ${commit}, ${places.length} мест`,
    pass: checks.every(check => check.pass), checks,
    understood: (result.understood ?? []).map(item => item.label),
    answer: result.recommendations.map(p => ({ name: p.name, category: p.category, walkMinutes: p.walkMinutes, totalMinutes: p.totalMinutes,
      hours: p.hoursCheck?.status, confidence: p.confidence?.label, why: p.aiWhy ?? p.why, whyBy: p.aiWhy ? 'Gemini' : 'расчёт', plan: p.aiTodo ?? p.plan?.text,
      source: p.sourceUrl })),
    route: result.route?.summary ?? null, nearest: result.nearestBeyondLimits?.name ?? null,
    warnings: result.warnings.filter(w => !/^Расстояние указано по прямой|^Каждая карточка|^Актуальное открытие/.test(w)),
    generation: result.generation?.mode ?? 'не вызывалась (движок)' };
}

const results = [];
// M1 needs Gemini embeddings, so it runs only against the live site.
for (const scenario of SCENARIOS.filter(item => live || !item.liveOnly)) results.push(await run(scenario));
const passed = results.filter(r => r.pass).length;
const protocol = { product: 'Aidem (ранее SmartWalk)', team: 'Ascension', date: new Date().toISOString(), commit, mode: live ? `живой сайт ${live}` : 'движок подбора', places: places.length,
  visitDay: DAY, passed, total: results.length, results };
writeFileSync(new URL('docs/test-protocol.json', root), JSON.stringify(protocol, null, 2) + '\n');

const md = [`# Протокол тестовых сценариев Aidem (ранее SmartWalk)`, '',
  `Команда Ascension, Build with AI Hackathon 2026, задача НИЦ Smart City «ИИ-помощник по прогулкам в городе Астана».`, '',
  `Прогон: ${protocol.mode}, коммит \`${commit}\`, база ${places.length} мест, день визита ${DAY} (Астана, UTC+5), ${protocol.date.slice(0, 16).replace('T', ' ')} UTC. Итог: **${passed} из ${results.length} сценариев Pass.**`, '',
  'Pass ставится, только если выполнены все проверки сценария и общие проверки формата ответа из задания: не больше трёх мест, время в бюджете, «почему», время и план у каждого места, источник и уровень уверенности, идея помечена как идея, нет «открыто сейчас», показано, что учтено. Повторить: `node scripts/scenario-protocol.mjs` (движок) или `node scripts/scenario-protocol.mjs --live <адрес сайта>`.', '',
  ...(live ? [] : ['Сценарий M1 (смысловой поиск на эмбеддингах Gemini) идёт только на живом сайте: движку без сети модель недоступна.', '']),
  '| Сценарий | Откуда | Итог |', '|---|---|---|',
  ...results.map(r => `| ${r.id}. ${r.title} | ${r.source} | ${r.pass ? 'Pass' : 'Fail'} |`), ''];
for (const r of results) {
  md.push(`## ${r.id}. ${r.title}: ${r.pass ? 'Pass' : 'Fail'}`, '',
    `**Вход:** «${r.input.query}» · старт ${r.start} · ${r.input.minutes} мин, пешком до ${r.input.maxWalkMinutes} мин${r.input.visitDate ? ` · время ${r.input.visitDate.slice(11, 16)}` : ' · сейчас'}`, '',
    `**Ожидаемый тип ответа:** ${r.expected}`, '',
    `**Система учла:** ${r.understood.join('; ') || '—'}`, '', '**Ответ:**', '');
  if (!r.answer.length) md.push(`- пусто${r.nearest ? `; ближайшее подходящее: ${r.nearest}` : ''}`);
  r.answer.forEach((p, i) => md.push(`${i + 1}. **${p.name}** (${p.category}), ${p.walkMinutes} мин туда, ${p.totalMinutes} мин всего; часы: ${p.hours}; ${p.confidence}.`,
    `   Почему (${p.whyBy}): ${p.why}`, `   Что делать: ${p.plan}`));
  if (r.route) md.push('', `**Мини-маршрут:** ${r.route}`);
  if (r.warnings.length) md.push('', `**Предупреждения ответа:** ${r.warnings.join(' ')}`);
  md.push('', '**Проверки:**', '', ...r.checks.map(c => `- ${c.pass ? '✅' : '❌'} ${c.name}`), '');
}
writeFileSync(new URL('docs/test-protocol.md', root), md.join('\n'));
console.log(`${passed}/${results.length} Pass`);
for (const r of results) if (!r.pass) console.log('FAIL', r.id, r.checks.filter(c => !c.pass).map(c => c.name).join('; '));
