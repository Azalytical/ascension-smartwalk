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
  // The budget counts from the request, so the time before the model call is taken from it.
  assert.ok(Number.isFinite(diagnostics.totalMs) && diagnostics.budgetMs <= 12000 && diagnostics.budgetMs > 11000);
  assert.ok(diagnostics.startedAfterMs >= 0 && diagnostics.budgetMs + diagnostics.startedAfterMs === 12000);
  const shown = JSON.stringify(diagnostics);
  assert.ok(!shown.includes('g-secret-key') && !shown.includes('Прогулка') && !shown.includes('Ты городской'), 'no key, query or prompt in the diagnostics');
});

test('a model that refuses the thinking level is asked again at once one level up, then without it; other 400s are not', async () => {
  resetGenerationState();
  const levels = [];
  const refuse = () => new Response(JSON.stringify({ error: { code: 400, message: 'Thinking level is not supported for this model.' } }), { status: 400 });
  let data = await withFetch(async (url, init) => {
    const level = JSON.parse(init.body).generationConfig.thinkingConfig?.thinkingLevel ?? 'off';
    levels.push(level);
    return level === 'off' ? geminiReply(ok) : refuse();
  }, async () => (await handleApi(request(valid), env, [poi])).json());
  assert.equal(data.generation.mode, 'llm');
  assert.deepEqual(levels, ['minimal', 'low', 'off']);
  assert.equal(data.generation.diagnostics.attempts[0].thinking, 'off');
  // Remembered for the isolate: the next request starts at the accepted level.
  levels.length = 0;
  await withFetch(async (url, init) => { levels.push(JSON.parse(init.body).generationConfig.thinkingConfig?.thinkingLevel ?? 'off'); return geminiReply(ok); },
    () => handleApi(request(valid), env, [poi]));
  assert.deepEqual(levels, ['off']);

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

test('a busy or out-of-quota model hands the walk text to the spare one within the budget, and still goes first next time', async () => {
  for (const status of [503, 429]) {
    resetGenerationState();
    const models = [];
    const modelOf = url => String(url).match(/models\/([^:]+)/)[1];
    const busyPrimary = async url => { const model = modelOf(url); models.push(model); return model === 'gemini-3.5-flash-lite' ? new Response('{}', { status }) : geminiReply(ok); };
    const live = { ...env, GEMINI_MODEL: 'gemini-3.5-flash-lite' };
    let data = await withFetch(busyPrimary, async () => (await handleApi(request(valid), live, [poi])).json());
    assert.equal(data.generation.mode, 'llm', `status ${status}`);
    assert.equal(data.generation.model, 'gemini-3.1-flash-lite');
    assert.deepEqual(models, ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);
    assert.deepEqual(data.generation.diagnostics.attempts.map(item => [item.model, item.status]), [['gemini-3.5-flash-lite', status], ['gemini-3.1-flash-lite', 200]]);
    // The next request asks the main model first again: one 503 or 429 does not hand the next answers to the spare.
    models.length = 0;
    data = await withFetch(busyPrimary, async () => (await handleApi(request(valid), live, [poi])).json());
    assert.deepEqual(models, ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);
  }
  // Both busy: three quick tries, then the answer from the data, well within the budget.
  resetGenerationState();
  const began = Date.now();
  let data = await withFetch(async () => new Response('{}', { status: 503 }), async () => (await handleApi(request(valid), { ...env, GEMINI_MODEL: 'gemini-3.5-flash-lite' }, [poi])).json());
  assert.equal(data.generation.reason, 'provider_503');
  assert.deepEqual(data.generation.diagnostics.attempts.map(item => item.model), ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.5-flash-lite']);
  assert.ok(Date.now() - began < 2000);

  resetGenerationState();
  data = await withFetch(async () => geminiReply(ok, 'MAX_TOKENS'), async () => (await handleApi(request(valid), { ...env, GEMINI_MODEL: 'm' }, [poi])).json());
  assert.equal(data.generation.reason, 'provider_truncated');
  assert.deepEqual(data.generation.diagnostics.attempts.map(item => [item.finishReason, item.error]), [['MAX_TOKENS', 'max_tokens']]);

  data = await withFetch(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"summary": "обрыв' }] }, finishReason: 'STOP' }] })),
    async () => (await handleApi(request(valid), { ...env, GEMINI_MODEL: 'm' }, [poi])).json());
  assert.equal(data.generation.reason, 'invalid_json');
});

test('the main model gets all the time left; a call cut short still shows its thinking level', async () => {
  resetGenerationState();
  const hang = (url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  const data = await withFetch(hang, async () => (await handleApi(request(valid), { ...env, GENERATION_MS: 2200 }, [poi])).json());
  assert.equal(data.generation.reason, 'provider_timeout');
  const [attempt] = data.generation.diagnostics.attempts;
  assert.equal(attempt.thinking, 'minimal');
  // Cut only when the budget runs out (less the margin to send the answer), not at a fixed share of it.
  assert.ok(attempt.ms >= 1700 && attempt.ms < 2200, `cut at ${attempt.ms} ms`);
});

test('on the live order 3.1 goes first every time, and a busy 3.1 hands over to 3.5 with its thinking level', async () => {
  resetGenerationState();
  const live = { ...env, GEMINI_MODEL: 'gemini-3.1-flash-lite' };
  const modelOf = url => String(url).match(/models\/([^:]+)/)[1];
  const calls = [];
  let busy = true;
  const handler = async (url, init) => {
    const model = modelOf(url);
    calls.push([model, JSON.parse(init.body).generationConfig.thinkingConfig?.thinkingLevel ?? 'off']);
    return model === 'gemini-3.1-flash-lite' && busy ? new Response('{}', { status: 503 }) : geminiReply(ok);
  };
  let data = await withFetch(handler, async () => (await handleApi(request(valid), live, [poi])).json());
  assert.equal(data.generation.model, 'gemini-3.5-flash-lite');
  assert.deepEqual(calls, [['gemini-3.1-flash-lite', 'minimal'], ['gemini-3.5-flash-lite', 'minimal']]);
  busy = false; calls.length = 0;
  data = await withFetch(handler, async () => (await handleApi(request(valid), live, [poi])).json());
  assert.equal(data.generation.model, 'gemini-3.1-flash-lite');
  assert.deepEqual(calls, [['gemini-3.1-flash-lite', 'minimal']]);
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

test('speech and photo answers ask both fast models with minimal thinking; speech synthesis is left as it is', async () => {
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
  assert.deepEqual(configs.slice(0, 2), [['gemini-3.5-flash-lite', 'minimal'], ['gemini-3.1-flash-lite', 'minimal']]);
  assert.ok(configs.slice(2).length && configs.slice(2).every(([, level]) => level === 'off'), 'the voice model gets no thinking setting');
});
