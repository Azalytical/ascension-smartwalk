import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../src/api.mjs';

const poi = { id: 'node/1', name: 'Парк', lat: 51.1283, lon: 71.4304, category: 'park', description: 'Парк', tags: { leisure: 'park' }, sourceUrl: 'https://www.openstreetmap.org/node/1', retrievedAt: '2026-10-19T10:00:00Z', openingHours: null };
const request = (body, extra = {}) => new Request('https://demo.example/api/recommend', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://demo.example', ...extra }, body: JSON.stringify(body) });
const valid = { lat: 51.1283, lon: 71.4304, minutes: 45, maxWalkMinutes: 15, query: 'Прогулка в парке' };

test('status exposes counts without credentials', async () => {
  const response = await handleApi(new Request('https://demo.example/api/status'), { OPENAI_API_KEY: 'test-secret' }, [poi]);
  const text = await response.text();
  assert.equal(response.status, 200); assert.equal(JSON.parse(text).poiCount, 1); assert.ok(!text.includes('test-secret'));
});
test('API rejects cross-origin requests before generation', async () => {
  const response = await handleApi(request(valid, { Origin: 'https://unrelated.example' }), {}, [poi]);
  assert.equal(response.status, 403);
});
test('invalid coordinates are a client error', async () => {
  const response = await handleApi(request({ ...valid, lat: 0 }), {}, [poi]);
  assert.equal(response.status, 400);
});
test('no key returns honest deterministic fallback and sourced alternatives', async () => {
  const response = await handleApi(request(valid), {}, [poi]);
  const data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.generation.mode, 'fallback');
  assert.equal(data.recommendations.length, 1); assert.equal(data.recommendations[0].sourceUrl, poi.sourceUrl);
  assert.equal(data.dataset.poiCount, 1);
});
test('long queries are rejected without calling the provider', async () => {
  const response = await handleApi(request({ ...valid, query: 'a'.repeat(801) }), {}, [poi]);
  assert.equal(response.status, 400);
});
test('method and content type are constrained', async () => {
  assert.equal((await handleApi(new Request('https://demo.example/api/recommend'), {}, [poi])).status, 405);
  const response = await handleApi(new Request('https://demo.example/api/recommend', { method: 'POST', body: '{}' }), {}, [poi]);
  assert.equal(response.status, 415);
});
test('malformed JSON is a client error', async () => {
  const response = await handleApi(new Request('https://demo.example/api/recommend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' }), {}, [poi]);
  assert.equal(response.status, 400);
});

test('model context excludes start coordinates, uses no response storage, and rejects invented venue claims', async () => {
  const original = globalThis.fetch;
  let sent;
  globalThis.fetch = async (_url, options) => {
    sent = JSON.parse(options.body);
    return new Response(JSON.stringify({ output: [{ content: [{ type: 'output_text', text: JSON.stringify({ summary: 'Парк предлагает классическое меню и стандартный ассортимент кофе.', references: [poi.id] }) }] }] }), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const response = await handleApi(request(valid), { OPENAI_API_KEY: 'test-secret', LOCAL_DEVELOPMENT: true }, [poi]);
    const data = await response.json();
    assert.equal(response.status, 200); assert.equal(data.generation.mode, 'fallback');
    assert.equal(data.generation.reason, 'unsupported_claim'); assert.equal(sent.store, false);
    const context = JSON.parse(sent.input);
    assert.equal(context.lat, undefined); assert.equal(context.lon, undefined);
    assert.equal(context.alternatives[0].lat, undefined); assert.equal(context.alternatives[0].lon, undefined);
  } finally { globalThis.fetch = original; }
});

test('missing hosted request budget preserves retrieval without charging the model', async () => {
  const response = await handleApi(request(valid), { OPENAI_API_KEY: 'test-secret' }, [poi]);
  const data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.recommendations.length, 1);
  assert.equal(data.generation.mode, 'fallback'); assert.equal(data.generation.reason, 'request_budget_unavailable');
});

test('configured rate limit rejects requests before the provider is called', async () => {
  const response = await handleApi(request(valid), { RATE_LIMITER: { limit: async () => ({ success: false }) } }, [poi]);
  assert.equal(response.status, 429);
});

const geminiReply = payload => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }), { headers: { 'Content-Type': 'application/json' } });

test('Gemini is preferred, receives no coordinates, and keeps the key out of the URL', async () => {
  const original = globalThis.fetch;
  let url, options;
  globalThis.fetch = async (u, o) => { url = String(u); options = o; return geminiReply({ summary: 'Можно выбрать Парк: примерно 20 минут вместе с возвращением и запасом.', references: [poi.id] }); };
  try {
    const response = await handleApi(request(valid), { GEMINI_API_KEY: 'g-secret', OPENAI_API_KEY: 'o-secret', LOCAL_DEVELOPMENT: true }, [poi]);
    const data = await response.json();
    assert.equal(data.generation.mode, 'llm'); assert.equal(data.generation.provider, 'gemini');
    assert.equal(data.generation.model, 'gemini-3.8-flash');
    assert.ok(url.startsWith('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent'));
    assert.ok(!url.includes('g-secret')); assert.equal(options.headers['x-goog-api-key'], 'g-secret');
    const sent = JSON.parse(options.body);
    assert.equal(sent.generationConfig.responseMimeType, 'application/json');
    const context = JSON.parse(sent.contents[0].parts[0].text);
    assert.equal(context.lat, undefined); assert.equal(context.alternatives[0].lat, undefined); assert.equal(context.alternatives[0].lon, undefined);
  } finally { globalThis.fetch = original; }
});

test('Gemini answers naming unknown places or unsupported claims fall back', async () => {
  const original = globalThis.fetch;
  try {
    for (const [payload, reason] of [[{ summary: 'Try Park, it is open now.', references: [poi.id] }, 'unsupported_claim'],
      [{ summary: 'Можно выбрать Кафе Икс.', references: ['node/999'] }, 'validation']]) {
      globalThis.fetch = async () => geminiReply(payload);
      const data = await (await handleApi(request(valid), { GEMINI_API_KEY: 'g', LOCAL_DEVELOPMENT: true }, [poi])).json();
      assert.equal(data.generation.mode, 'fallback'); assert.equal(data.generation.reason, reason);
    }
    globalThis.fetch = async () => new Response('{}', { status: 503 });
    const data = await (await handleApi(request(valid), { GEMINI_API_KEY: 'g', LOCAL_DEVELOPMENT: true }, [poi])).json();
    assert.equal(data.generation.reason, 'provider_503'); assert.equal(data.recommendations.length, 1);
  } finally { globalThis.fetch = original; }
});

test('an empty references list falls back to the known place ids the model described', async () => {
  const original = globalThis.fetch;
  let sent;
  try {
    globalThis.fetch = async (u, o) => { sent = JSON.parse(o.body); return geminiReply({ summary: 'Можно выбрать Парк: примерно 20 минут вместе с возвращением и запасом.', references: [],
      places: [{ id: poi.id, why: 'Подходит под прогулку.', todo: 'Пройтись по парку.' }, { id: 'node/999', why: 'x', todo: 'y' }] }); };
    const data = await (await handleApi(request(valid), { GEMINI_API_KEY: 'g', LOCAL_DEVELOPMENT: true }, [poi])).json();
    assert.equal(data.generation.mode, 'llm'); assert.deepEqual(data.generation.references, [poi.id]);
    assert.match(sent.systemInstruction.parts[0].text, /references/);
    globalThis.fetch = async () => geminiReply({ summary: 'Можно выбрать Парк.', references: [], places: [] });
    const none = await (await handleApi(request(valid), { GEMINI_API_KEY: 'g', LOCAL_DEVELOPMENT: true }, [poi])).json();
    assert.equal(none.generation.mode, 'fallback'); assert.equal(none.generation.reason, 'validation');
  } finally { globalThis.fetch = original; }
});

test('status reports the generation provider without the key', async () => {
  const text = await (await handleApi(new Request('https://demo.example/api/status'), { GEMINI_API_KEY: 'g-secret' }, [poi])).text();
  assert.equal(JSON.parse(text).generationProvider, 'gemini'); assert.ok(!text.includes('g-secret'));
});

test('in-memory budget: Gemini for 8 requests a minute per address, then places without it, and only a flood is refused', async () => {
  const env = { MEMORY_BUDGET: true, GEMINI_API_KEY: 'g' };
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('{}', { status: 400 }); };
  try {
    const answers = [];
    for (let i = 0; i < 61; i++) answers.push(await handleApi(request(valid, { 'X-Forwarded-For': '203.0.113.7, 10.0.0.1' }), env, [poi]));
    assert.deepEqual(answers.slice(0, 60).map(response => response.status), Array(60).fill(200));
    const ninth = await answers[8].json();
    assert.equal(ninth.recommendations.length, 1); assert.equal(ninth.generation.reason, 'request_budget_unavailable');
    assert.ok(calls <= 8 * 2, 'Gemini is asked only within the first 8 requests');
    assert.equal(answers[60].status, 429);
    assert.equal((await handleApi(request(valid, { 'X-Forwarded-For': '203.0.113.8' }), env, [poi])).status, 200);
  } finally { globalThis.fetch = original; }
});

test('a busy Gemini is retried, and client errors are not', async () => {
  const original = globalThis.fetch;
  const ok = { summary: 'Можно выбрать Парк: примерно 20 минут вместе с возвращением и запасом.', references: [poi.id] };
  const env = { GEMINI_API_KEY: 'g', LOCAL_DEVELOPMENT: true, RETRY_DELAY_MS: 1 };
  try {
    let calls = 0;
    globalThis.fetch = async () => (++calls === 1 ? new Response('{}', { status: 503 }) : geminiReply(ok));
    let data = await (await handleApi(request(valid), env, [poi])).json();
    assert.equal(data.generation.mode, 'llm');
    assert.equal(calls, 2);

    calls = 0;
    globalThis.fetch = async () => { calls++; throw new TypeError('network'); };
    data = await (await handleApi(request(valid), env, [poi])).json();
    assert.equal(data.generation.mode, 'fallback');
    assert.equal(calls, 2);
    assert.deepEqual(data.generation.diagnostics.attempts.map(item => item.error), ['network', 'network']);

    calls = 0;
    globalThis.fetch = async () => { calls++; return new Response('{}', { status: 400 }); };
    data = await (await handleApi(request(valid), env, [poi])).json();
    assert.equal(data.generation.reason, 'provider_400');
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test('the model is told which language to answer in', async () => {
  const { answerLanguage } = await import('../src/api.mjs');
  assert.equal(answerLanguage('I want coffee'), 'en');
  assert.equal(answerLanguage('кофе ішкім келеді'), 'kk');
  assert.equal(answerLanguage('кофе и прогулка'), 'ru');
  assert.equal(answerLanguage(''), 'ru');
  const original = globalThis.fetch;
  let body;
  globalThis.fetch = async (_u, o) => { body = JSON.parse(o.body); return new Response('{}', { status: 400 }); };
  try {
    await handleApi(request({ ...valid, query: 'walk in the park' }), { GEMINI_API_KEY: 'g', LOCAL_DEVELOPMENT: true }, [poi]);
    assert.equal(JSON.parse(body.contents[0].parts[0].text).answerLanguage, 'en');
  } finally { globalThis.fetch = original; }
});

test('without telling letters the interface language picks the answer language', async () => {
  const { answerLanguage } = await import('../src/api.mjs');
  assert.equal(answerLanguage('', 'en'), 'en');
  assert.equal(answerLanguage('', 'kk'), 'kk');
  assert.equal(answerLanguage('кофе', 'kk'), 'kk');
  assert.equal(answerLanguage('кофе', 'en'), 'ru');
  assert.equal(answerLanguage('I want coffee', 'ru'), 'en');
  assert.equal(answerLanguage('', 'de'), 'ru');
  const original = globalThis.fetch;
  let body;
  globalThis.fetch = async (_u, o) => { body = JSON.parse(o.body); return new Response('{}', { status: 400 }); };
  try {
    const response = await handleApi(request({ ...valid, query: '', lang: 'en' }), { GEMINI_API_KEY: 'g', LOCAL_DEVELOPMENT: true }, [poi]);
    assert.equal(response.status, 200);
    assert.equal(JSON.parse(body.contents[0].parts[0].text).answerLanguage, 'en');
  } finally { globalThis.fetch = original; }
});

test('Gemini writes «почему» and «что делать» per place; a text with an invented number or claim is dropped', async () => {
  const original = globalThis.fetch;
  const second = { ...poi, id: 'node/2', name: 'Сквер', lat: 51.1290, sourceUrl: 'https://www.openstreetmap.org/node/2' };
  let sent;
  try {
    globalThis.fetch = async (_url, options) => {
      sent = JSON.parse(JSON.parse(options.body).contents[0].parts[0].text);
      const [first, other] = sent.alternatives;
      return geminiReply({ summary: 'Можно выбрать Парк или Сквер: оба рядом и помещаются в ваше время.', references: [first.id, other.id],
        places: [{ id: first.id, why: `Ближе всего к вам: ${first.walkMinutes} мин пешком, вернётесь к ${first.backAt}.`, todo: `${first.visitMinutes} мин прогулки по парку, затем обратно.` },
          { id: other.id, why: 'Всего 3 минуты, а вход бесплатный.', todo: 'Пройтись 99 минут.' }] });
    };
    const data = await (await handleApi(request(valid), { GEMINI_API_KEY: 'g', LOCAL_DEVELOPMENT: true }, [poi, second])).json();
    assert.equal(data.generation.mode, 'llm');
    const [first, other] = data.recommendations;
    assert.ok(first.aiWhy.includes(`${first.walkMinutes} мин`));
    assert.equal(first.provenance.aiWhy.origin, 'generated');
    assert.equal(other.aiWhy, undefined, 'invented number and «вход бесплатный» are rejected');
    assert.ok(first.why && other.why, 'computed «почему» stays on every card');
    assert.ok(sent.alternatives.every(place => place.lat === undefined && place.lon === undefined));
    assert.ok(Array.isArray(sent.understood));
  } finally { globalThis.fetch = original; }
});

test('a failing Gemini hands over to OpenAI once when its key is set', async () => {
  const original = globalThis.fetch;
  const ok = { summary: 'Можно выбрать Парк: примерно 20 минут вместе с возвращением и запасом.', references: [poi.id], places: [] };
  const env = { GEMINI_API_KEY: 'g', OPENAI_API_KEY: 'o', LOCAL_DEVELOPMENT: true, RETRY_DELAY_MS: 1 };
  try {
    const hosts = [];
    globalThis.fetch = async (u) => {
      const host = new URL(String(u)).host; hosts.push(host);
      if (host.includes('googleapis')) return new Response('{}', { status: 503 });
      return new Response(JSON.stringify({ output: [{ content: [{ type: 'output_text', text: JSON.stringify(ok) }] }] }), { headers: { 'Content-Type': 'application/json' } });
    };
    const data = await (await handleApi(request(valid), env, [poi])).json();
    assert.equal(data.generation.mode, 'llm'); assert.equal(data.generation.provider, 'openai');
    assert.deepEqual(hosts, ['generativelanguage.googleapis.com', 'generativelanguage.googleapis.com', 'api.openai.com']);
  } finally { globalThis.fetch = original; }
});
