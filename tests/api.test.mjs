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
  for (const body of [null, [], true, 'text']) assert.equal((await handleApi(request(body), {}, [poi])).status, 400);
});

test('model context excludes start coordinates, uses no response storage, and rejects invented venue claims', async () => {
  const original = globalThis.fetch;
  let sent;
  globalThis.fetch = async (_url, options) => {
    sent = JSON.parse(options.body);
    return new Response(JSON.stringify({ output: [{ content: [{ type: 'output_text', text: JSON.stringify({ preferredId: poi.id, summary: 'Парк предлагает классическое меню и стандартный ассортимент кофе.', references: [poi.id] }) }] }] }), { headers: { 'Content-Type': 'application/json' } });
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
  globalThis.fetch = async (u, o) => { url = String(u); options = o; return geminiReply({ preferredId: poi.id, summary: 'Можно выбрать Парк: примерно 20 минут вместе с возвращением и запасом.', references: [poi.id] }); };
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
    for (const [payload, reason] of [[{ preferredId: poi.id, summary: 'Try Park, it is open now.', references: [poi.id] }, 'unsupported_claim'],
      [{ preferredId: poi.id, summary: 'Можно выбрать Кафе Икс.', references: ['node/999'] }, 'validation']]) {
      globalThis.fetch = async () => geminiReply(payload);
      const data = await (await handleApi(request(valid), { GEMINI_API_KEY: 'g', LOCAL_DEVELOPMENT: true }, [poi])).json();
      assert.equal(data.generation.mode, 'fallback'); assert.equal(data.generation.reason, reason);
    }
    globalThis.fetch = async () => new Response('{}', { status: 503 });
    const data = await (await handleApi(request(valid), { GEMINI_API_KEY: 'g', LOCAL_DEVELOPMENT: true }, [poi])).json();
    assert.equal(data.generation.reason, 'provider_503'); assert.equal(data.recommendations.length, 1);
  } finally { globalThis.fetch = original; }
});

test('status reports the generation provider without the key', async () => {
  const text = await (await handleApi(new Request('https://demo.example/api/status'), { GEMINI_API_KEY: 'g-secret' }, [poi])).text();
  assert.equal(JSON.parse(text).generationProvider, 'gemini'); assert.ok(!text.includes('g-secret'));
});

test('in-memory budget limits one address to 8 requests a minute', async () => {
  const env = { MEMORY_BUDGET: true };
  const statuses = [];
  for (let i = 0; i < 9; i++) statuses.push((await handleApi(request(valid, { 'X-Forwarded-For': '203.0.113.7, 10.0.0.1' }), env, [poi])).status);
  assert.deepEqual(statuses.slice(0, 8), Array(8).fill(200)); assert.equal(statuses[8], 429);
  assert.equal((await handleApi(request(valid, { 'X-Forwarded-For': '203.0.113.8' }), env, [poi])).status, 200);
});

test('a busy Gemini is retried, and client errors are not', async () => {
  const original = globalThis.fetch;
  const ok = { preferredId: poi.id, summary: 'Можно выбрать Парк: примерно 20 минут вместе с возвращением и запасом.', references: [poi.id] };
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
    assert.equal(calls, 3);

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

test('location endpoint searches sourced aliases, supports mobile-sized lists and validates input', async () => {
  const dataset = [poi, { ...poi, id: 'expo', name: 'Выставочный центр', aliases: ['EXPO 2017'], sourceUrl: 'https://www.openstreetmap.org/node/2' }];
  const response = await handleApi(new Request('https://demo.example/api/locations?q=expo&limit=30'), {}, dataset);
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.total, 1);
  assert.equal(data.locations[0].id, 'expo');
  assert.equal(data.source, 'OpenStreetMap');
  assert.deepEqual(Object.keys(data.locations[0]).sort(), ['category', 'id', 'lat', 'lon', 'name']);
  for (const suffix of ['?limit=51', '?limit=0', '?q=' + 'a'.repeat(101)]) assert.equal((await handleApi(new Request('https://demo.example/api/locations' + suffix), {}, dataset)).status, 400);
  assert.equal((await handleApi(new Request('https://demo.example/api/locations', { method: 'POST' }), {}, dataset)).status, 405);
});

test('API accepts 10 and 180 minute boundaries and rejects invalid preferences and budgets', async () => {
  for (const minutes of [10, 180]) {
    const response = await handleApi(request({ lat: valid.lat, lon: valid.lon, minutes }), {}, [poi]);
    assert.equal(response.status, 200);
    assert.ok((await response.json()).recommendations[0].totalMinutes <= minutes);
  }
  for (const body of [{ minutes: 9 }, { minutes: 181 }, { preferences: 'a'.repeat(501) }, { preferences: [] }, { budget: -1 }, { budget: 1000001 }]) {
    assert.equal((await handleApi(request({ ...valid, ...body }), {}, [poi])).status, 400);
  }
});

test('provider really selects a validated alternate and cannot insert invented text into its card', async () => {
  const second = { ...poi, id: 'second', name: 'Другой парк', sourceUrl: 'https://www.openstreetmap.org/node/2' };
  const original = globalThis.fetch;
  let sent;
  globalThis.fetch = async (_url, options) => {
    sent = JSON.parse(options.body);
    return geminiReply({ preferredId: second.id, summary: 'Вымышленный музей: 3000 тенге и рейтинг 5.0.', references: [second.id] });
  };
  try {
    const data = await (await handleApi(request({ ...valid, preferences: 'Желательно тихо', budget: 5000 }), { GEMINI_API_KEY: 'g', LOCAL_DEVELOPMENT: true }, [poi, second])).json();
    assert.equal(data.generation.mode, 'llm');
    assert.equal(data.preferredId, second.id);
    assert.equal(data.generation.preferredId, second.id);
    assert.equal(data.recommendations[0].id, second.id);
    assert.ok(data.generation.summary.includes(second.name));
    assert.ok(!data.generation.summary.includes('Вымышленный'));
    assert.equal(data.generation.summaryGrounding, 'source_template');
    const context = JSON.parse(sent.contents[0].parts[0].text);
    assert.equal(context.preferences, 'Желательно тихо');
    assert.equal(context.constraints.budget, 5000);
    assert.equal(context.constraints.lat, undefined);
    assert.ok(sent.generationConfig.responseSchema.required.includes('preferredId'));
  } finally { globalThis.fetch = original; }
});

test('hallucinated selection id and missing selection fall back to the first sourced result', async () => {
  const original = globalThis.fetch;
  try {
    for (const preferredId of ['invented', undefined]) {
      globalThis.fetch = async () => geminiReply({ preferredId, summary: 'Можно выбрать парк.', references: [poi.id] });
      const data = await (await handleApi(request(valid), { GEMINI_API_KEY: 'g', LOCAL_DEVELOPMENT: true }, [poi])).json();
      assert.equal(data.generation.mode, 'fallback');
      assert.equal(data.generation.reason, 'validation');
      assert.equal(data.preferredId, poi.id);
      assert.equal(data.recommendations[0].id, poi.id);
    }
  } finally { globalThis.fetch = original; }
});

test('OpenAI schema requires a grounded selected id and receives preferences without coordinates', async () => {
  const original = globalThis.fetch;
  let sent;
  globalThis.fetch = async (_url, options) => {
    sent = JSON.parse(options.body);
    return new Response(JSON.stringify({ output: [{ content: [{ type: 'output_text', text: JSON.stringify({ preferredId: poi.id, summary: 'Выберите парк, примерно 20 минут.', references: [poi.id] }) }] }] }));
  };
  try {
    const data = await (await handleApi(request({ ...valid, preferences: 'Желательно тихо' }), { OPENAI_API_KEY: 'g', LOCAL_DEVELOPMENT: true }, [poi])).json();
    assert.equal(data.generation.mode, 'llm');
    assert.equal(data.generation.provider, 'openai');
    assert.equal(sent.store, false);
    assert.ok(sent.text.format.schema.required.includes('preferredId'));
    assert.equal(JSON.parse(sent.input).lat, undefined);
    assert.equal(JSON.parse(sent.input).preferences, 'Желательно тихо');
  } finally { globalThis.fetch = original; }
});

test('mixed sourced corpus exposes source attribution without claiming one dataset license', async () => {
  const dataset = [{ ...poi, provenance: { source: 'OpenStreetMap', license: 'ODbL-1.0' } },
    { ...poi, id: 'venue', name: 'Заведение', sourceUrl: 'https://venue.example/place', provenance: { source: 'Eventura' } }];
  const status = await (await handleApi(new Request('https://demo.example/api/status'), {}, dataset)).json();
  assert.deepEqual(status.sources, ['OpenStreetMap', 'Eventura']);
  const data = await (await handleApi(request(valid), {}, dataset)).json();
  assert.equal(data.dataset.source, 'OpenStreetMap · Eventura');
  assert.equal(data.dataset.license, null);
  assert.equal(data.recommendations.find(row => row.id === 'venue').source, 'Eventura');
});

test('sources include enrichment provenance when all primary records are OSM', async () => {
  const source = { source: 'Eventura', sourceUrl: 'https://venue.example/123', retrievedAt: '2026-09-01T10:00:00Z' };
  const dataset = [{ ...poi, rating: 4.8, additionalSources: [source], fieldSources: { rating: source }, license: 'ODbL-1.0' }];
  const data = await (await handleApi(request(valid), {}, dataset)).json();
  assert.deepEqual(data.dataset.sources, ['OpenStreetMap', 'Eventura']);
  assert.equal(data.dataset.license, null);
  assert.equal(data.recommendations[0].evidence.find(item => item.field === 'rating').sourceUrl, source.sourceUrl);
  const status = await (await handleApi(new Request('https://demo.example/api/status'), {}, dataset)).json();
  assert.ok(status.sources.includes('Eventura'));
});
