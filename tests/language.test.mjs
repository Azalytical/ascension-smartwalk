// Gemini slipping Russian into a Kazakh or English answer: the search answer, the agent and Siri get one rewrite, then the template.
import test from 'node:test';
import assert from 'node:assert/strict';
import { languageProblem } from '../src/language.mjs';
import { handleApi, limitedJson, answerLanguage, UNSUPPORTED } from '../src/api.mjs';
import { runAgent, resetAgentState } from '../src/agent.mjs';

test('languageProblem catches Russian words in English and Kazakh answers, but not place names', () => {
  const names = ['Астана Азия Парк', 'Поющие фонтаны', 'Mega Silk Way'];
  assert.equal(languageProblem('Астана Азия Парк is close: about 10 minutes on foot, back by 12:40.', 'en', names), null);
  assert.equal(languageProblem('Walk to «Водно-Зелёный бульвар» and on to the embankment.', 'en', names), null, 'quoted text is a name');
  assert.equal(languageProblem('Sit by the Поющих фонтанов for a while.', 'en', names), null, 'a declined name is still the name');
  assert.match(languageProblem('Астана Азия Парк is close, около 10 минут пешком.', 'en', names), /cyrillic/);
  assert.match(languageProblem('Ближайший парк в 10 минутах пешком.', 'en', names), /cyrillic/);
  assert.equal(languageProblem('Бәйтерекке дейін жаяу 6 минут, 12:32-ге қайтасыз.', 'kk', ['Бәйтерек']), null);
  assert.match(languageProblem('Бәйтерекке дейін жаяу 6 минут, можно зайти и посмотреть.', 'kk', ['Бәйтерек']), /russian/);
  assert.equal(languageProblem('До Mega Silk Way 16 минут пешком, вернётесь к 13:10.', 'ru', names), null);
  assert.match(languageProblem('Mega Silk Way is a short walk away, about sixteen minutes.', 'ru', names), /latin/);
});

const park = { id: 'node/2', name: 'Сквер у реки', lat: 51.1300, lon: 71.4330, category: 'park', tags: { leisure: 'park' },
  sourceUrl: 'https://www.openstreetmap.org/node/2', retrievedAt: '2026-10-19T10:00:00Z', openingHours: null };
const walk = query => new Request('https://demo.example/api/recommend', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://demo.example' },
  body: JSON.stringify({ lat: 51.1283, lon: 71.4304, minutes: 45, maxWalkMinutes: 15, query, visitDate: '2026-10-22T15:00:00+05:00' }) });
const geminiReply = payload => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }),
  { headers: { 'Content-Type': 'application/json' } });
const mixed = { summary: 'Сквер у реки is close, около 5 минут пешком.', references: [park.id] };
const clean = { summary: 'Сквер у реки is close: a short walk there and back with a reserve.', references: [park.id] };

async function withGemini(replies, run) {
  const sent = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (!String(url).includes(':generateContent')) return new Response('{}', { status: 503 });
    sent.push(JSON.parse(init.body));
    return geminiReply(replies[Math.min(sent.length, replies.length) - 1]);
  };
  try { await run(sent); } finally { globalThis.fetch = original; }
}
const recommend = async query => (await handleApi(walk(query), { GEMINI_API_KEY: 'g', LOCAL_DEVELOPMENT: true }, [park])).json();

test('/api/recommend sends a mixed-language answer back once and keeps the rewrite', () => withGemini([mixed, clean], async sent => {
  const data = await recommend('I want a walk in a park');
  assert.equal(data.generation.mode, 'llm');
  assert.equal(data.generation.summary, clean.summary);
  assert.equal(sent.length, 2);
  assert.match(JSON.parse(sent[1].contents[0].parts[0].text).rejected, /answerLanguage = en без русских слов/);
}));

test('/api/recommend gives the template in the asker\'s language when the rewrite slips again', () => withGemini([mixed], async sent => {
  const data = await recommend('I want a walk in a park');
  assert.equal(sent.length, 2, 'one rewrite, no more');
  assert.equal(data.generation.mode, 'fallback');
  assert.equal(data.generation.reason, 'language');
  assert.match(data.generation.summary, /^Below are separate walk options/);
}));

test('/api/recommend drops a «почему» that slipped into Russian and keeps the clean summary', () => withGemini([{ ...clean,
  places: [{ id: park.id, why: 'Сквер у реки рядом, можно посидеть на лавочке.', todo: 'Walk along the river and come back.' }] }], async sent => {
  const data = await recommend('I want a walk in a park');
  assert.equal(sent.length, 2);
  assert.equal(data.generation.mode, 'llm');
  assert.equal(data.recommendations[0].aiWhy, undefined, 'the card keeps its computed text');
}));

test('the template without a model speaks Kazakh and English too', async () => {
  const kk = await (await handleApi(walk('Саябақта серуендегім келеді'), { LOCAL_DEVELOPMENT: true }, [park])).json();
  assert.match(kk.generation.summary, /^Төменде серуеннің бөлек нұсқалары/);
  const en = await (await handleApi(walk('I want a walk in a park'), { LOCAL_DEVELOPMENT: true }, [park])).json();
  assert.match(en.generation.summary, /^Below are separate walk options/);
});

test('the agent (phone, /watch and Siri) sends a Kazakh answer with Russian phrases back for a rewrite', async () => {
  resetAgentState();
  const call = (name, args) => ({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name, args } }] } }] });
  const query = 'Маған жақын жерде серуендегім келеді';
  const turns = [call('plan_walk', { query }),
    call('give_answer', { summary: 'Сквер у реки жақын: можно зайти и посмотреть, туда и обратно.', place_ids: [park.id] }),
    call('give_answer', { summary: 'Сквер у реки жақын: барып-қайту қормен бірге аз уақыт алады.', place_ids: [park.id] })];
  const sent = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify(turns[sent.length - 1]), { headers: { 'Content-Type': 'application/json' } }); };
  try {
    const answer = await runAgent({ query, lat: 51.1283, lon: 71.4304, minutes: 45 },
      { env: { GEMINI_API_KEY: 'test' }, dataset: [park], limitedJson, answerLanguage, unsupported: UNSUPPORTED, fetchImpl: async () => new Response('{}', { status: 503 }) });
    assert.equal(answer.mode, 'agent');
    assert.equal(sent.length, 3);
    assert.match(JSON.stringify(sent[2].contents.at(-1)), /answerLanguage = kk без русских слов/);
    assert.equal(answer.summary, 'Сквер у реки жақын: барып-қайту қормен бірге аз уақыт алады.');
  } finally { globalThis.fetch = original; }
});
