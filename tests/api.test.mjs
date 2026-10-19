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
