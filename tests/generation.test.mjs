import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi, resetGenerationState } from '../src/api.mjs';
import { resetSemanticCache } from '../src/semantic.mjs';
import { resetMediaState } from '../src/media.mjs';

const poi = { id: 'node/1', name: 'Парк', lat: 51.1283, lon: 71.4304, category: 'park', description: 'Парк', tags: { leisure: 'park' },
  sourceUrl: 'https://www.openstreetmap.org/node/1', retrievedAt: '2026-10-19T10:00:00Z', openingHours: null };
const request = body => new Request('https://demo.example/api/recommend', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://demo.example' },
  body: JSON.stringify(body) });
const valid = { lat: 51.1283, lon: 71.4304, minutes: 45, maxWalkMinutes: 15, query: 'Прогулка в парке' };
const ok = { summary: 'Можно выбрать Парк: примерно 20 минут вместе с возвращением и запасом.', references: [poi.id], places: [] };
const geminiReply = (payload, finishReason = 'STOP') => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] }, finishReason }] }),
  { headers: { 'Content-Type': 'application/json' } });
const env = { GEMINI_API_KEY: 'g-secret-key', LOCAL_DEVELOPMENT: true, RETRY_DELAY_MS: 1 };

async function withFetch(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  try { return await fn(); } finally { globalThis.fetch = original; }
}

test('the walk text asks for minimal thinking and reports each attempt without the key or the prompt', async () => {
  resetGenerationState();
  const bodies = [];
  const data = await withFetch(async (url, init) => { bodies.push(JSON.parse(init.body)); return geminiReply(ok); },
    async () => (await handleApi(request(valid), env, [poi])).json());
  assert.equal(data.generation.mode, 'llm');
  assert.deepEqual(bodies[0].generationConfig.thinkingConfig, { thinkingLevel: 'minimal' });
  const { diagnostics } = data.generation;
  assert.equal(diagnostics.attempts.length, 1);
  assert.deepEqual({ ...diagnostics.attempts[0], ms: 0 }, { provider: 'gemini', model: 'gemini-3.8-flash', thinking: 'minimal', ms: 0, status: 200, finishReason: 'STOP', error: null });
  assert.ok(Number.isFinite(diagnostics.totalMs) && diagnostics.budgetMs <= 9500);
  const shown = JSON.stringify(diagnostics);
  assert.ok(!shown.includes('g-secret-key') && !shown.includes('Прогулка') && !shown.includes('Ты городской'), 'no key, query or prompt in the diagnostics');
});

test('a model that refuses a thinking level is asked again at once with the next one; other 400s are not', async () => {
  resetGenerationState();
  const levels = [];
  const refuse = () => new Response(JSON.stringify({ error: { code: 400, message: 'Thinking level MINIMAL is not supported for this model.' } }), { status: 400 });
  let data = await withFetch(async (url, init) => {
    const level = JSON.parse(init.body).generationConfig.thinkingConfig?.thinkingLevel ?? 'off';
    levels.push(level);
    return level === 'minimal' ? refuse() : geminiReply(ok);
  }, async () => (await handleApi(request(valid), env, [poi])).json());
  assert.equal(data.generation.mode, 'llm');
  assert.deepEqual(levels, ['minimal', 'low']);
  assert.equal(data.generation.diagnostics.attempts[0].thinking, 'low');
  // Remembered for the isolate: the next request starts at the accepted level.
  levels.length = 0;
  await withFetch(async (url, init) => { levels.push(JSON.parse(init.body).generationConfig.thinkingConfig?.thinkingLevel ?? 'off'); return geminiReply(ok); },
    () => handleApi(request(valid), env, [poi]));
  assert.deepEqual(levels, ['low']);

  resetGenerationState();
  levels.length = 0;
  data = await withFetch(async (url, init) => {
    levels.push(JSON.parse(init.body).generationConfig.thinkingConfig?.thinkingLevel ?? 'off');
    return new Response(JSON.stringify({ error: { code: 400, message: 'API key not valid.' } }), { status: 400 });
  }, async () => (await handleApi(request(valid), env, [poi])).json());
  assert.deepEqual(levels, ['minimal']);
  assert.equal(data.generation.reason, 'provider_400');
  assert.deepEqual(data.generation.diagnostics.attempts.map(item => [item.status, item.error]), [[400, 'http']]);
});

test('a model call that runs out of time is not asked again, and the answer from the data comes at once', async () => {
  resetGenerationState();
  let calls = 0;
  const hang = (url, init) => { calls++; return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))); };
  const began = Date.now();
  const data = await withFetch(hang, async () => (await handleApi(request(valid), { ...env, ATTEMPT_MS: 60 }, [poi])).json());
  assert.equal(calls, 1);
  assert.equal(data.generation.mode, 'fallback');
  assert.equal(data.generation.reason, 'provider_timeout');
  assert.equal(data.generation.diagnostics.attempts[0].error, 'timeout');
  assert.ok(Date.now() - began < 2000);
  assert.equal(data.recommendations.length, 1);
});

test('out of quota, the spare model writes the text; a cut-off answer is named as such', async () => {
  resetGenerationState();
  const models = [];
  let data = await withFetch(async url => {
    const model = String(url).match(/models\/([^:]+)/)[1];
    models.push(model);
    return model === 'gemini-3.8-flash' ? new Response('{}', { status: 429 }) : geminiReply(ok);
  }, async () => (await handleApi(request(valid), env, [poi])).json());
  assert.equal(data.generation.mode, 'llm');
  assert.equal(data.generation.model, 'gemini-3.1-flash-lite');
  assert.deepEqual(models, ['gemini-3.8-flash', 'gemini-3.8-flash', 'gemini-3.1-flash-lite']);

  data = await withFetch(async () => geminiReply(ok, 'MAX_TOKENS'), async () => (await handleApi(request(valid), { ...env, GEMINI_MODEL: 'm' }, [poi])).json());
  assert.equal(data.generation.reason, 'provider_truncated');
  assert.deepEqual(data.generation.diagnostics.attempts.map(item => [item.finishReason, item.error]), [['MAX_TOKENS', 'max_tokens']]);

  data = await withFetch(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"summary": "обрыв' }] }, finishReason: 'STOP' }] })),
    async () => (await handleApi(request(valid), { ...env, GEMINI_MODEL: 'm' }, [poi])).json());
  assert.equal(data.generation.reason, 'invalid_json');
});

test('the embedding call reports what happened next to the model line', async () => {
  resetGenerationState(); resetSemanticCache();
  const query = { ...valid, query: 'хочу подышать свежим воздухом' };
  const data = await withFetch(async url => (String(url).includes('batchEmbedContents') ? new Response('{}', { status: 429 }) : geminiReply(ok)),
    async () => (await handleApi(request(query), env, [poi])).json());
  const { embeddings } = data.generation.diagnostics;
  assert.equal(embeddings.model, 'gemini-embedding-001');
  assert.equal(embeddings.cold, true);
  assert.equal(embeddings.status, 429);
  assert.equal(embeddings.error, 'http');
  assert.deepEqual(embeddings.categories, []);
  resetSemanticCache();
});

test('speech and photo answers ask for minimal thinking; speech synthesis is left as it is', async () => {
  resetMediaState();
  const configs = [];
  const data = await withFetch(async (url, init) => {
    const body = JSON.parse(init.body);
    configs.push([String(url).match(/models\/([^:]+)/)[1], body.generationConfig.thinkingConfig?.thinkingLevel ?? 'off']);
    if (body.generationConfig.responseModalities) return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;rate=24000', data: 'AAAA' } }] } }] }));
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ text: 'час, кофе и парк', lang: 'ru' }) }] } }] }));
  }, async () => {
    const heard = await (await handleApi(new Request('https://demo.example/api/listen', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio: 'UklGR'.padEnd(400, 'A'), mimeType: 'audio/wav' }) }), env, [poi])).json();
    await handleApi(new Request('https://demo.example/api/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Привет' }) }), env, [poi]);
    return heard;
  });
  assert.equal(data.text, 'час, кофе и парк');
  assert.deepEqual(configs[0][1], 'minimal');
  assert.ok(configs.slice(1).every(([, level]) => level === 'off'), 'the voice model gets no thinking setting');
});
