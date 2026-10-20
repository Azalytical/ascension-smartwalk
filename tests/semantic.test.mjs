import test from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES, pickCategories, resetSemanticCache, semanticCategories } from '../src/semantic.mjs';
import { recommend, meaningWanted } from '../src/retrieval.mjs';
import { handleApi } from '../src/api.mjs';

// Fake embeddings: every example points along its category's axis; a test query points along the axis it means.
const AXES = Object.keys(EXAMPLES);
const MEANS = { 'хочу подышать свежим воздухом': 'park', 'куда бы мне деться': 'none', 'выпить пива после работы': 'nightlife' };
const categoryOf = text => MEANS[text] ?? AXES.find(axis => EXAMPLES[axis].includes(text)) ?? 'none';
const vectorFor = text => AXES.map(axis => (axis === categoryOf(text) ? 1 : 0) + 0.3);
const embeddings = body => new Response(JSON.stringify({ embeddings: body.requests.map(item => ({ values: vectorFor(item.content.parts[0].text) })) }),
  { headers: { 'Content-Type': 'application/json' } });

function recorder() {
  const calls = [];
  const fetcher = async (url, options) => { const body = JSON.parse(options.body); calls.push({ url: String(url), options, body }); return embeddings(body); };
  return { calls, fetcher };
}

test('pickCategories needs a lead over generic requests and over the median category', () => {
  const ranking = (scores) => Object.entries(scores).map(([category, score]) => ({ category, score })).sort((a, b) => b.score - a.score);
  assert.deepEqual(pickCategories(ranking({ park: 0.8, cafe: 0.6, museum: 0.58, mall: 0.57, none: 0.62 })), ['park']);
  assert.deepEqual(pickCategories(ranking({ park: 0.8, cafe: 0.79, museum: 0.6, mall: 0.57, none: 0.6 })), ['park', 'cafe']);
  assert.deepEqual(pickCategories(ranking({ park: 0.7, cafe: 0.6, museum: 0.58, none: 0.71 })), [], 'generic requests are closer');
  assert.deepEqual(pickCategories(ranking({ park: 0.61, cafe: 0.6, museum: 0.6, mall: 0.6, none: 0.5 })), [], 'nothing stands out');
});

test('semantic categories come from one batch call with the query text only, then the examples are cached', async () => {
  resetSemanticCache();
  const { calls, fetcher } = recorder();
  const first = await semanticCategories('хочу подышать свежим воздухом', { GEMINI_API_KEY: 'g-secret' }, { fetcher });
  assert.deepEqual(first.categories, ['park']);
  assert.equal(first.model, 'gemini-embedding-001');
  assert.equal(first.ranking[0].category, 'park');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents');
  assert.equal(calls[0].options.headers['x-goog-api-key'], 'g-secret');
  assert.ok(!calls[0].url.includes('g-secret'));
  const exampleCount = Object.values(EXAMPLES).flat().length;
  assert.equal(calls[0].body.requests.length, exampleCount + 1);
  assert.equal(calls[0].body.requests.at(-1).content.parts[0].text, 'хочу подышать свежим воздухом');
  assert.ok(calls[0].body.requests.every(item => item.taskType === 'SEMANTIC_SIMILARITY' && item.outputDimensionality === 768));

  const second = await semanticCategories('куда бы мне деться', { GEMINI_API_KEY: 'g-secret' }, { fetcher });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.requests.length, 1, 'examples are embedded once per isolate');
  assert.deepEqual(second.categories, [], 'a generic request means no category');
});

test('no key, an error or a timeout means "not understood" and never throws', async () => {
  resetSemanticCache();
  let fetched = 0;
  assert.equal(await semanticCategories('хочу подышать свежим воздухом', {}, { fetcher: async () => { fetched++; } }), null);
  assert.equal(fetched, 0);

  const failing = async () => { fetched++; return new Response('{}', { status: 500 }); };
  assert.equal(await semanticCategories('хочу подышать свежим воздухом', { GEMINI_API_KEY: 'g' }, { fetcher: failing, now: 1000 }), null);
  assert.equal(await semanticCategories('хочу подышать свежим воздухом', { GEMINI_API_KEY: 'g' }, { fetcher: failing, now: 2000 }), null);
  assert.equal(fetched, 1, 'a failed first call is not retried for a minute');

  resetSemanticCache();
  const hanging = (_url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  const started = Date.now();
  assert.equal(await semanticCategories('хочу подышать свежим воздухом', { GEMINI_API_KEY: 'g' }, { fetcher: hanging, timeoutMs: 20 }), null);
  assert.ok(Date.now() - started < 1000);

  resetSemanticCache();
  const malformed = async () => new Response(JSON.stringify({ embeddings: [{ values: [] }] }), { headers: { 'Content-Type': 'application/json' } });
  assert.equal(await semanticCategories('хочу подышать свежим воздухом', { GEMINI_API_KEY: 'g' }, { fetcher: malformed }), null);
  resetSemanticCache();
});

const place = (id, name, category, lat, extra = {}) => ({ id, name, lat, lon: 71.42, category, tags: {}, sourceUrl: `https://www.openstreetmap.org/${id}`,
  retrievedAt: '2026-10-20T09:00:00Z', openingHours: null, ...extra });
const places = [place('node/1', 'Кофейня у дома', 'cafe', 51.1201), place('node/2', 'Сквер у реки', 'park', 51.1235)];
const walk = { lat: 51.12, lon: 71.42, minutes: 60, maxWalkMinutes: 20, query: 'хочу подышать свежим воздухом' };

test('recommend uses embedding categories only when the dictionary found none', () => {
  const lexical = recommend(places, walk);
  assert.equal(lexical.recommendations[0].category, 'cafe', 'without embeddings the nearest place leads');
  assert.equal(meaningWanted(lexical), true);
  assert.equal(lexical.retrieval.usesEmbeddings, false);

  const semantic = { model: 'gemini-embedding-001', categories: ['park'], ranking: [{ category: 'park', score: 0.81 }] };
  const meant = recommend(places, walk, { semantic });
  assert.deepEqual(meant.recommendations.map(rec => rec.category), ['park']);
  assert.equal(meant.retrieval.usesEmbeddings, true);
  assert.deepEqual(meant.retrieval.semantic.categories, ['park']);
  assert.ok(meant.understood.some(item => item.key === 'semantic' && item.label.includes('парк')));
  assert.match(meant.recommendations[0].why, /под ваш запрос/);

  const coffee = recommend(places, { ...walk, query: 'хочу кофе' }, { semantic });
  assert.equal(meaningWanted(coffee), false);
  assert.deepEqual(coffee.recommendations.map(rec => rec.category), ['cafe'], 'dictionary words win over embeddings');
  assert.equal(coffee.retrieval.usesEmbeddings, false);

  const child = recommend(places, { ...walk, withChild: true }, { semantic: { categories: ['nightlife'] } });
  assert.equal(child.retrieval.usesEmbeddings, false, 'a bar is never meant for a walk with a child');
  const accessible = recommend(places, { ...walk, query: 'я на коляске, нужно место без ступенек' }, { semantic });
  assert.equal(meaningWanted(accessible), false, 'an understood intent keeps the dictionary answer');
  assert.equal(accessible.retrieval.usesEmbeddings, false);
  const excluded = recommend(places, { ...walk, query: 'хочу подышать свежим воздухом, не парк' }, { semantic });
  assert.ok(!excluded.recommendations.some(rec => rec.category === 'park'));
});

test('/api/recommend asks Gemini embeddings for an unknown request and never sends coordinates', async () => {
  resetSemanticCache();
  const original = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    sent.push({ url: String(url), text: options.body });
    if (String(url).includes(':batchEmbedContents')) return embeddings(body);
    return new Response('{}', { status: 503 });
  };
  try {
    const request = new Request('https://demo.example/api/recommend', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://demo.example' }, body: JSON.stringify(walk) });
    const data = await (await handleApi(request, { GEMINI_API_KEY: 'g', LOCAL_DEVELOPMENT: true }, places)).json();
    assert.deepEqual(data.recommendations.map(rec => rec.category), ['park']);
    assert.equal(data.retrieval.usesEmbeddings, true);
    const embedding = sent.find(call => call.url.includes(':batchEmbedContents'));
    assert.ok(embedding);
    assert.ok(!embedding.text.includes('51.12') && !embedding.text.includes('71.42'));

    sent.length = 0;
    const known = new Request('https://demo.example/api/recommend', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://demo.example' }, body: JSON.stringify({ ...walk, query: 'парк' }) });
    await handleApi(known, { GEMINI_API_KEY: 'g', LOCAL_DEVELOPMENT: true }, places);
    assert.ok(!sent.some(call => call.url.includes(':batchEmbedContents')), 'a request the dictionary understands needs no embedding');
  } finally { globalThis.fetch = original; resetSemanticCache(); }
});
