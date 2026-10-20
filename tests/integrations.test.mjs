import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleApi } from '../src/api.mjs';
import { mapLinks, calendarLink } from '../src/links.mjs';
import { runTool } from '../src/tools.mjs';
import { astanaWeather, weatherAdvice } from '../src/weather.mjs';
import { modelView } from '../src/agent.mjs';

const pois = [
  { id: 'node/1', name: 'Кофейня у Байтерека', lat: 51.1290, lon: 71.4310, category: 'cafe', tags: { amenity: 'cafe', internet_access: 'wlan', 'addr:street': 'Нуржол', 'addr:housenumber': '14' }, sourceUrl: 'https://www.openstreetmap.org/node/1', retrievedAt: '2026-10-19T10:00:00Z', openingHours: '24/7' },
  { id: 'node/2', name: 'Сквер', lat: 51.1300, lon: 71.4330, category: 'park', tags: { leisure: 'park' }, sourceUrl: 'https://www.openstreetmap.org/node/2', retrievedAt: '2026-10-19T10:00:00Z', openingHours: null },
  { id: 'node/3', name: 'Музей у воды', lat: 51.1270, lon: 71.4350, category: 'museum', tags: { tourism: 'museum' }, sourceUrl: 'https://www.openstreetmap.org/node/3', retrievedAt: '2026-10-19T10:00:00Z', openingHours: '24/7' }
];
const START = { lat: 51.1283, lon: 71.4304 };
const env = { LOCAL_DEVELOPMENT: true };

function mcp(body, init = {}) {
  return handleApi(new Request('https://demo.example/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body), ...init }), env, pois);
}

function withFetch(handler, fn) {
  return async () => {
    const original = globalThis.fetch;
    globalThis.fetch = handler;
    try { await fn(); } finally { globalThis.fetch = original; }
  };
}
const jsonResponse = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const weatherBody = { current: { time: '2026-10-20T15:00', temperature_2m: -4, apparent_temperature: -11, wind_speed_10m: 12, wind_gusts_10m: 17, precipitation: 0, weather_code: 3, is_day: 1 },
  daily: { sunrise: ['2026-10-20T07:40'], sunset: ['2026-10-20T17:50'] } };

test('map links never carry the visitor position and calendar links span the walk', () => {
  const links = mapLinks({ lat: 51.129, lon: 71.431 });
  assert.equal(links.googleMapsWalk, 'https://www.google.com/maps/dir/?api=1&destination=51.129000%2C71.431000&travelmode=walking');
  assert.equal(links.twoGis, 'https://2gis.kz/astana/directions/points/%7C71.431000%2C51.129000');
  assert.ok(!links.googleMapsWalk.includes('origin'));
  const url = new URL(calendarLink({ name: 'Сквер', lat: 51.13, lon: 71.433, walkMinutes: 4, visitMinutes: 15, returnMinutes: 4, totalMinutes: 28, sourceUrl: 'https://www.openstreetmap.org/node/2' },
    { start: new Date('2026-10-20T10:02:00Z') }));
  assert.equal(url.hostname, 'calendar.google.com');
  assert.equal(url.searchParams.get('dates'), '20261020T100500Z/20261020T103300Z');
  assert.match(url.searchParams.get('details'), /Вернуться к 15:33 \(Астана\)/);
  assert.match(url.searchParams.get('details'), /OpenStreetMap/);
});

test('recommendations come with Google Maps, 2GIS and Google Calendar links', async () => {
  const response = await handleApi(new Request('https://demo.example/api/recommend', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...START, minutes: 60, query: 'кофе' }) }), env, pois);
  const data = await response.json();
  assert.equal(response.status, 200);
  const links = data.recommendations[0].links;
  for (const key of ['googleMaps', 'googleMapsWalk', 'twoGis', 'googleCalendar']) assert.match(links[key], /^https:\/\//);
});

test('MCP: initialize, list tools, call a tool', async () => {
  const init = await (await mcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } })).json();
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.equal(init.result.serverInfo.name, 'ulger');
  assert.ok(init.result.capabilities.tools);
  const unknownVersion = await (await mcp({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } })).json();
  assert.equal(unknownVersion.result.protocolVersion, '2025-11-25');
  assert.equal((await mcp({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
  const list = await (await mcp({ jsonrpc: '2.0', id: 3, method: 'tools/list' })).json();
  assert.deepEqual(list.result.tools.map(tool => tool.name), ['plan_walk', 'search_places', 'place_details', 'build_route', 'get_weather']);
  assert.ok(list.result.tools.every(tool => tool.annotations.readOnlyHint && tool.inputSchema.type === 'object'));
  const call = await (await mcp({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'plan_walk', arguments: { ...START, minutes: 60, query: 'кофе' } } })).json();
  assert.equal(call.result.isError, false);
  assert.equal(call.result.structuredContent.places[0].name, 'Кофейня у Байтерека');
  assert.deepEqual(JSON.parse(call.result.content[0].text), call.result.structuredContent);
});

test('MCP: bad arguments are tool errors, unknown methods are protocol errors', async () => {
  const bad = await (await mcp({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'plan_walk', arguments: { lat: 43.2, lon: 76.9 } } })).json();
  assert.equal(bad.result.isError, true);
  assert.match(bad.result.content[0].text, /lat/);
  const unknown = await (await mcp({ jsonrpc: '2.0', id: 6, method: 'sampling/createMessage' })).json();
  assert.equal(unknown.error.code, -32601);
  const tool = await (await mcp({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'drop_tables' } })).json();
  assert.equal(tool.error.code, -32602);
  const batch = await (await mcp([{ jsonrpc: '2.0', id: 8, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }])).json();
  assert.deepEqual(batch, [{ jsonrpc: '2.0', id: 8, result: {} }]);
  const parse = await handleApi(new Request('https://demo.example/mcp', { method: 'POST', body: '{nope' }), env, pois);
  assert.equal((await parse.json()).error.code, -32700);
  const get = await handleApi(new Request('https://demo.example/mcp'), env, pois);
  assert.equal(get.status, 405);
  assert.equal(get.headers.get('Allow'), 'POST, OPTIONS');
  const preflight = await handleApi(new Request('https://demo.example/mcp', { method: 'OPTIONS' }), env, pois);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), '*');
});

test('tools: search, details and the shortest micro-route', async () => {
  const found = await runTool('search_places', { query: 'байтерек', ...START }, { dataset: pois });
  assert.equal(found.places[0].name, 'Кофейня у Байтерека');
  assert.equal(found.places[0].hoursNow.status, 'open');
  const details = await runTool('place_details', { id: 'node/1' }, { dataset: pois });
  assert.equal(details.facts.address, 'Нуржол, 14');
  assert.equal(details.facts.internetAccess, 'wlan');
  const route = await runTool('build_route', { ...START, place_ids: ['node/3', 'node/1', 'node/2'], minutes: 120 }, { dataset: pois, now: new Date('2026-10-20T10:00:00Z') });
  assert.equal(route.stops.length, 3);
  assert.equal(route.totalMinutes, route.walkMinutes + route.visitMinutes + 5);
  assert.equal(route.fits, true);
  assert.match(route.googleMapsRoute, /waypoints=/);
  assert.deepEqual(route.stops.map(stop => stop.id).sort(), ['node/1', 'node/2', 'node/3']);
  // The given order (museum, cafe, park) zigzags; the chosen loop walks no more than it.
  const given = await runTool('build_route', { ...START, place_ids: ['node/1', 'node/3'], minutes: 120 }, { dataset: pois });
  assert.ok(route.walkMinutes <= given.walkMinutes + 4);
  await assert.rejects(runTool('build_route', { ...START, place_ids: ['node/1'] }, { dataset: pois }), /от 2 до 3/);
});

test('weather: Open-Meteo is read with rounded coordinates and turned into advice', async () => {
  let asked;
  const value = await astanaWeather({ lat: 51.12834, lon: 71.43041 }, { now: new Date('2026-10-20T12:30:00Z'), fetchImpl: async url => { asked = url; return jsonResponse(weatherBody); } });
  assert.match(asked, /latitude=51\.15&longitude=71\.45/);
  assert.equal(value.available, true);
  assert.equal(value.advice.preferIndoor, true);
  assert.match(value.advice.text, /ветер 12 м\/с/);
  assert.match(value.advice.darkSoon, /17:50/);
  const failed = await astanaWeather({ lat: 51.2, lon: 71.5 }, { fetchImpl: async () => new Response('', { status: 503 }) });
  assert.equal(failed.available, false);
  assert.equal(weatherAdvice({ feelsLike: 5, windSpeed: 3, windGusts: 5, precipitation: 0, weatherCode: 1 }).preferIndoor, false);
});

test('agent: Gemini calls tools, sees no coordinates, and answers with places from the tools', withFetch(async (url, init) => {
  if (String(url).includes('open-meteo')) return jsonResponse(weatherBody);
  const body = JSON.parse(init.body);
  globalThis.__requests.push(body);
  const turn = body.contents.filter(content => content.role === 'model').length;
  if (turn === 0) {
    return jsonResponse({ candidates: [{ content: { role: 'model', parts: [
      { functionCall: { name: 'get_weather', args: {} }, thoughtSignature: 'sig-1' },
      { functionCall: { name: 'plan_walk', args: { minutes: 60, query: 'кофе под крышей' } } }] } }] });
  }
  return jsonResponse({ candidates: [{ content: { role: 'model', parts: [
    { functionCall: { name: 'give_answer', args: { summary: 'Ветрено, поэтому лучше Кофейня у Байтерека: примерно 2 минуты туда.', place_ids: ['node/1'] } }, thoughtSignature: 'sig-2' }] } }] });
}, async () => {
  globalThis.__requests = [];
  const response = await handleApi(new Request('https://demo.example/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'Хочу кофе, у меня час', ...START, minutes: 60 }) }), { ...env, GEMINI_API_KEY: 'test' }, pois);
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.mode, 'agent');
  assert.equal(data.places[0].name, 'Кофейня у Байтерека');
  assert.match(data.places[0].links.googleCalendar, /calendar\.google\.com/);
  assert.deepEqual(data.steps.map(step => step.tool), ['get_weather', 'plan_walk', 'give_answer']);
  assert.match(data.steps[0].summary, /ветер 12 м\/с/);
  const sent = JSON.stringify(globalThis.__requests);
  assert.ok(!sent.includes('51.1283') && !sent.includes('71.4304'), 'the start point must not reach Gemini');
  assert.ok(!sent.includes('51.129') && !sent.includes('openstreetmap.org'), 'tool results reach Gemini without coordinates and links');
  assert.equal(globalThis.__requests[1].contents[1].parts[0].thoughtSignature, 'sig-1');
  assert.equal(globalThis.__requests[1].contents[2].parts[1].functionResponse.name, 'plan_walk');
  assert.equal(globalThis.__requests[0].toolConfig.functionCallingConfig.mode, 'ANY');
}));

test('agent: an answer naming an unknown place falls back to the deterministic plan', withFetch(async (url, init) => {
  if (String(url).includes('open-meteo')) return jsonResponse(weatherBody);
  const turn = JSON.parse(init.body).contents.filter(content => content.role === 'model').length;
  if (turn === 0) return jsonResponse({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'plan_walk', args: { query: 'парк' } }, thoughtSignature: 's' }] } }] });
  return jsonResponse({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'give_answer', args: { summary: 'Идите в Сказочный дворец.', place_ids: ['node/999'] } } }] } }] });
}, async () => {
  const response = await handleApi(new Request('https://demo.example/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'парк', ...START }) }), { ...env, GEMINI_API_KEY: 'test' }, pois);
  const data = await response.json();
  assert.equal(data.mode, 'fallback');
  assert.equal(data.reason, 'validation');
  assert.ok(data.places.length >= 1);
  assert.ok(data.places.every(place => pois.some(poi => poi.id === place.id)));
}));

test('agent without a key still answers with the same tools', withFetch(async () => jsonResponse(weatherBody), async () => {
  const response = await handleApi(new Request('https://demo.example/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'музей', ...START, minutes: 90 }) }), env, pois);
  const data = await response.json();
  assert.equal(data.mode, 'fallback');
  assert.equal(data.reason, 'no_gemini_key');
  assert.deepEqual(data.steps.map(step => step.tool), ['get_weather', 'plan_walk']);
  const outside = await handleApi(new Request('https://demo.example/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'музей', lat: 43.2, lon: 76.9 }) }), env, pois);
  assert.equal(outside.status, 400);
}));

test('model view drops coordinates, links and sources', () => {
  assert.deepEqual(modelView({ places: [{ id: 'a', lat: 1, lon: 2, links: {}, sourceUrl: 'x', name: 'A' }], area: { lat: 1 } }), { places: [{ id: 'a', name: 'A' }] });
});

const PHOTO = 'data:image/jpeg;base64,' + 'A'.repeat(400);
test('vision: Gemini picks a nearby place from the photo, without the visitor coordinates', withFetch(async (url, init) => {
  globalThis.__vision = JSON.parse(init.body);
  return jsonResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify({ placeId: 'node/3', confidence: 'high', seen: 'Здание музея у воды.', facts: ['Факт один.', 'Факт два.', 'Лишний факт.'] }) }] } }] });
}, async () => {
  const response = await handleApi(new Request('https://demo.example/api/vision', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: PHOTO, ...START, heading: 90 }) }), { ...env, GEMINI_API_KEY: 'test' }, pois);
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.place.name, 'Музей у воды');
  assert.equal(data.facts.length, 2);
  assert.equal(data.factsSource, 'generated');
  assert.match(data.place.links.googleMapsWalk, /destination=51\.127/);
  const sent = JSON.stringify(globalThis.__vision);
  assert.equal(globalThis.__vision.contents[0].parts[0].inlineData.mimeType, 'image/jpeg');
  assert.ok(!sent.includes('51.1283') && !sent.includes('71.4304'));
  assert.match(sent, /справа|впереди/);
}));

test('vision: unknown or low-confidence matches give no place and no facts; bad photos are refused', withFetch(async () =>
  jsonResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify({ placeId: 'node/42', confidence: 'high', seen: 'Улица.', facts: ['Выдумка.'] }) }] } }] }), async () => {
  const response = await handleApi(new Request('https://demo.example/api/vision', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: PHOTO, ...START }) }), { ...env, GEMINI_API_KEY: 'test' }, pois);
  const data = await response.json();
  assert.equal(data.place, null);
  assert.deepEqual(data.facts, []);
  assert.ok(data.nearby.length > 0);
  const bad = await handleApi(new Request('https://demo.example/api/vision', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: 'data:text/html;base64,AAAA', ...START }) }), { ...env, GEMINI_API_KEY: 'test' }, pois);
  assert.equal(bad.status, 400);
}));

test('speak: Gemini TTS audio is passed to the browser and cached', withFetch(async (url, init) => {
  globalThis.__tts = (globalThis.__tts || 0) + 1;
  const body = JSON.parse(init.body);
  assert.deepEqual(body.generationConfig.responseModalities, ['AUDIO']);
  return jsonResponse({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: 'AAAA' } }] } }] });
}, async () => {
  globalThis.__tts = 0;
  const ask = () => handleApi(new Request('https://demo.example/api/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Сәлем! Байтерекке дейін төрт минут.' }) }), { ...env, GEMINI_API_KEY: 'test' }, pois);
  const first = await (await ask()).json();
  assert.equal(first.sampleRate, 24000);
  assert.equal(first.data, 'AAAA');
  const second = await (await ask()).json();
  assert.equal(second.cached, true);
  assert.equal(globalThis.__tts, 1);
  const empty = await handleApi(new Request('https://demo.example/api/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '' }) }), { ...env, GEMINI_API_KEY: 'test' }, pois);
  assert.equal(empty.status, 400);
}));

test('the full place base works through MCP within the Workers CPU budget', async () => {
  const data = JSON.parse(readFileSync(new URL('../data/places.json', import.meta.url), 'utf8'));
  const call = async (name, args) => (await (await handleApi(new Request('https://demo.example/mcp', { method: 'POST',
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }), env, data)).json()).result;
  await call('search_places', { query: 'кофе' });
  const began = performance.now();
  const khan = await call('search_places', { query: 'Хан Шатыр' });
  assert.equal(khan.structuredContent.places[0].name, 'Хан Шатыр');
  const plan = await call('plan_walk', { lat: khan.structuredContent.places[0].lat, lon: khan.structuredContent.places[0].lon, minutes: 90, query: 'музей или кофе' });
  assert.ok(plan.structuredContent.places.length > 0);
  assert.ok(performance.now() - began < 50, 'search and plan stay fast on the full dataset');
});

test('agent: a rejected answer goes back to Gemini once with the reason, and the rewrite is accepted', withFetch(async (url, init) => {
  if (String(url).includes('open-meteo')) return jsonResponse(weatherBody);
  const body = JSON.parse(init.body);
  globalThis.__requests.push(body);
  const turn = body.contents.filter(content => content.role === 'model').length;
  if (turn === 0) return jsonResponse({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'plan_walk', args: { query: 'кофе' } }, thoughtSignature: 's' }] } }] });
  const summary = turn === 1 ? 'Кофейня у Байтерека расположена рядом и предлагает завтраки.' : 'Кофейня у Байтерека: примерно 2 минуты пешком, часы позволяют зайти.';
  return jsonResponse({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'give_answer', args: { summary, place_ids: ['node/1'] } } }] } }] });
}, async () => {
  globalThis.__requests = [];
  const response = await handleApi(new Request('https://demo.example/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'кофе', ...START, minutes: 60 }) }), { ...env, GEMINI_API_KEY: 'test' }, pois);
  const data = await response.json();
  assert.equal(data.mode, 'agent');
  assert.match(data.summary, /2 минуты/);
  assert.deepEqual(data.steps.map(step => step.tool), ['plan_walk', 'check', 'give_answer']);
  assert.match(data.steps[1].summary, /расположен/);
  const retry = globalThis.__requests[2];
  assert.deepEqual(retry.toolConfig.functionCallingConfig.allowedFunctionNames, ['give_answer']);
  assert.match(retry.contents.at(-1).parts[0].functionResponse.response.error, /отклонён проверкой/);
}));

test('agent: a second rejected answer falls back to the deterministic plan', withFetch(async (url, init) => {
  const turn = JSON.parse(init.body).contents.filter(content => content.role === 'model').length;
  if (turn === 0) return jsonResponse({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'plan_walk', args: { query: 'кофе' } }, thoughtSignature: 's' }] } }] });
  return jsonResponse({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'give_answer', args: { summary: 'Кофейня у Байтерека открыта сейчас.', place_ids: ['node/1'] } } }] } }] });
}, async () => {
  const response = await handleApi(new Request('https://demo.example/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'кофе', ...START }) }), { ...env, GEMINI_API_KEY: 'test' }, pois);
  const data = await response.json();
  assert.equal(data.mode, 'fallback');
  assert.equal(data.reason, 'unsupported_claim');
  assert.equal(data.steps.filter(step => step.tool === 'check').length, 1);
}));

test('speak: a refused or unknown voice model hands over to the next one', withFetch(async url => {
  globalThis.__ttsModels.push(String(url).match(/models\/([^:]+)/)[1]);
  if (globalThis.__ttsModels.length === 1) return new Response('{"error":{"code":404}}', { status: 404 });
  return jsonResponse({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: 'BBBB' } }] } }] });
}, async () => {
  globalThis.__ttsModels = [];
  const response = await handleApi(new Request('https://demo.example/api/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Another voice, please.' }) }), { ...env, GEMINI_API_KEY: 'test' }, pois);
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(globalThis.__ttsModels, ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts']);
  assert.equal(data.model, 'gemini-3.8-flash-tts');
  assert.equal(data.data, 'BBBB');
}));

test('weather: one Open-Meteo 503 is retried', async () => {
  let calls = 0;
  const value = await astanaWeather({ lat: 51.09, lon: 71.41 }, { fetchImpl: async () => (++calls === 1 ? new Response('', { status: 503 }) : jsonResponse(weatherBody)) });
  assert.equal(calls, 2);
  assert.equal(value.available, true);
});
