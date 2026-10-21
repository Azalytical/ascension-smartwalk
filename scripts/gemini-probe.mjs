// How often the live site answers through Gemini: the demo questions on the walk text, the agent and Siri, one line each.
//   node scripts/gemini-probe.mjs https://ascension-smartwalk.azamatbreach.workers.dev [--pause 8]
// Prints mode, model, time and each model call from generation.diagnostics / diagnostics; no key is needed or shown.
// A pause between questions keeps the run under the site's own limit (8 model answers a minute from one address).
const base = (process.argv[2] || '').replace(/\/$/, '');
if (!/^https?:\/\//.test(base)) { console.error('Usage: node scripts/gemini-probe.mjs <site url> [--pause seconds]'); process.exit(1); }
const pause = Number(process.argv[process.argv.indexOf('--pause') + 1]) || 8;

const EXPO = [51.0896, 71.416], BAITEREK = [51.1283, 71.4304], MEGA = [51.0880152, 71.4097489];
const WALKS = [
  ['coffee', EXPO, 'Хочу кофе, у меня час'], ['park', BAITEREK, 'Погулять в парке 40 минут'], ['child', MEGA, 'С ребёнком на полтора часа'],
  ['quiet', BAITEREK, 'Тихое кафе с розеткой, поработать час'], ['english', EXPO, 'Coffee and a short walk, one hour'],
  ['kazakh', BAITEREK, 'Бір сағат серуендегім келеді'],
];
const AGENT = [['agent-coffee', EXPO, 'кофе и прогулка на час'], ['agent-kids', EXPO, 'park walk with kids']];
const SIRI = [['siri-cafe', BAITEREK, 'quiet cafe with a socket'], ['siri-hungry', EXPO, 'hungry']];

const calls = list => (list || []).map(item => `${(item.model || '').replace('gemini-', '')}${item.turn ? `#${item.turn}` : ''}:${item.error || item.status || 'ok'}:${item.ms}ms`).join(' ');
const wait = seconds => new Promise(resolve => setTimeout(resolve, seconds * 1000));
const rows = [];

async function timed(name, request) {
  const began = Date.now();
  try {
    const response = await request();
    const body = await response.json();
    return { name, ms: Date.now() - began, status: response.status, body };
  } catch (error) { return { name, ms: Date.now() - began, status: 0, body: { error: String(error?.message || error) } }; }
}

for (const [name, [lat, lon], query] of WALKS) {
  const run = await timed(name, () => fetch(`${base}/api/recommend`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ lat, lon, minutes: 60, maxWalkMinutes: 20, query }) }));
  const g = run.body.generation || {};
  rows.push([run.name, run.status, g.mode ?? run.body.error, g.model || '', g.reason || '', run.ms, calls(g.diagnostics?.attempts)]);
  console.log(rows.at(-1).join(' | '));
  await wait(pause);
}
for (const [name, [lat, lon], query] of AGENT) {
  const run = await timed(name, () => fetch(`${base}/api/agent`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ lat, lon, minutes: 60, query }) }));
  rows.push([run.name, run.status, run.body.mode ?? run.body.error, run.body.model || '', run.body.reason || '', run.ms, calls(run.body.diagnostics?.attempts)]);
  console.log(rows.at(-1).join(' | '));
  await wait(pause);
}
for (const [name, [lat, lon], query] of SIRI) {
  const run = await timed(name, () => fetch(`${base}/api/watch/ask?lat=${lat}&lon=${lon}&q=${encodeURIComponent(query)}`));
  rows.push([run.name, run.status, run.body.mode ?? run.body.error, run.body.model || '', run.body.reason || '', run.ms, calls(run.body.diagnostics?.attempts)]);
  console.log(rows.at(-1).join(' | '));
  await wait(pause);
}
const gemini = rows.filter(row => row[2] === 'llm' || row[2] === 'agent').length;
console.log(`\nGemini answered ${gemini} of ${rows.length}; slowest ${Math.max(...rows.map(row => row[5]))} ms.`);
