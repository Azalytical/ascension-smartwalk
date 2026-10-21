import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleApi } from '../src/api.mjs';
import { plural, spokenPlan } from '../src/watch.mjs';

const pois = [
  { id: 'node/1', name: 'Кофейня у Байтерека', lat: 51.1290, lon: 71.4310, category: 'cafe', tags: { amenity: 'cafe' }, sourceUrl: 'https://www.openstreetmap.org/node/1', retrievedAt: '2026-10-19T10:00:00Z', openingHours: null },
  { id: 'node/2', name: 'Сквер', lat: 51.1300, lon: 71.4330, category: 'park', tags: { leisure: 'park' }, sourceUrl: 'https://www.openstreetmap.org/node/2', retrievedAt: '2026-10-19T10:00:00Z', openingHours: null }
];
const plan = (query, init) => handleApi(new Request(`https://demo.example/api/watch/plan?${query}`, init), {}, pois);

test('watch plan is compact and sourced', async () => {
  const response = await plan('lat=51.1283&lon=71.4304&minutes=45&mood=coffee');
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.places[0].name, 'Кофейня у Байтерека');
  assert.equal(data.places[0].sourceUrl, 'https://www.openstreetmap.org/node/1');
  for (const key of ['walkMinutes', 'visitMinutes', 'returnMinutes', 'totalMinutes', 'lat', 'lon']) assert.equal(typeof data.places[0][key], 'number');
  assert.equal(data.places[0].evidence, undefined);
  assert.ok(data.places.length <= 3);
  assert.match(data.query, /кофе/);
});

test('watch plan cites the dataset of each place and its confidence', async () => {
  const overture = { ...pois[0], id: 'overture/1', sourceUrl: 'https://overturemaps.org/', source: { id: 'overture', label: 'Overture Maps · Meta', license: 'CDLA-Permissive-2.0', attribution: 'Overture Maps Foundation' } };
  const response = await handleApi(new Request('https://demo.example/api/watch/plan?lat=51.1283&lon=71.4304&minutes=45&mood=coffee'), {}, [overture, pois[1]]);
  const data = await response.json();
  assert.equal(data.places[0].source.label, 'Overture Maps · Meta');
  assert.equal(data.places[0].source.license, 'CDLA-Permissive-2.0');
  assert.match(data.places[0].confidence.label, /уверенность/);
  assert.ok(['high', 'medium', 'low'].includes(data.places[0].confidence.level));
  assert.equal(data.attribution, '© OpenStreetMap contributors, Overture Maps Foundation');
  assert.equal(data.license, undefined);
  const html = readFileSync(new URL('../public/watch.html', import.meta.url), 'utf8');
  assert.match(html, /© OpenStreetMap contributors, Overture Maps Foundation/);
});

test('voice format answers in plain Russian and accepts comma decimals', async () => {
  const response = await plan('lat=51,1283&lon=71,4304&mood=coffee&format=text');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Type'), /text\/plain/);
  const text = await response.text();
  assert.match(text, /^Кофейня у Байтерека, кафе\. Идти примерно \d+ минут/);
  assert.match(text, /займёт примерно \d+ минут[уы]?, вернётесь к \d\d:\d\d\./);
});

test('outside Astana is explained, readable aloud in voice format', async () => {
  const json = await plan('lat=43.2&lon=76.9&mood=coffee');
  assert.equal(json.status, 400);
  assert.match((await json.json()).error, /только в Астане/);
  const voice = await plan('lat=43.2&lon=76.9&mood=coffee&format=text');
  assert.equal(voice.status, 200);
  assert.match(await voice.text(), /только в Астане/);
});

test('unknown moods, methods and paths are rejected', async () => {
  assert.equal((await plan('lat=51.1283&lon=71.4304&mood=party')).status, 400);
  assert.equal((await plan('lat=51.1283&lon=71.4304', { method: 'POST' })).status, 405);
  assert.equal((await handleApi(new Request('https://demo.example/api/watch/other'), {}, pois)).status, 404);
});

test('Siri can ask the assistant a free question and hears a text answer', async () => {
  const ask = (query, init) => handleApi(new Request(`https://demo.example/api/watch/ask?${query}`, init), {}, pois);
  // Without a Gemini key the agent falls back to the same tools, read like a plan.
  const text = await (await ask(`format=text&lat=51,1283&lon=71,4304&minutes=45&q=${encodeURIComponent('где выпить кофе?')}`)).text();
  assert.match(text, /^Кофейня у Байтерека, кафе\. Идти примерно \d+ минут/);
  const json = await (await ask('lat=51.1283&lon=71.4304&q=coffee')).json();
  assert.equal(json.mode, 'fallback');
  assert.ok(json.places.length >= 1);
  const outside = await ask(`format=text&lat=43.2&lon=76.9&q=${encodeURIComponent('кофе')}`);
  assert.equal(outside.status, 200);
  assert.match(await outside.text(), /только в Астане/);
  assert.equal((await ask('lat=51.1283&lon=71.4304', { method: 'POST' })).status, 405);
});

test('an English question gets an English spoken answer', async () => {
  const text = await (await plan('format=text&lat=51.1283&lon=71.4304&mood=coffee&q=coffee%20nearby')).text();
  assert.match(text, /^Кофейня у Байтерека, a cafe\. About \d+ minutes? on foot; the whole walk there and back takes about \d+ minutes?, so you are back by \d\d:\d\d\./);
  assert.match(await (await plan('format=text&lat=51.1283&lon=71.4304&mood=coffee&lang=en')).text(), /on foot/);
  assert.match(await (await plan('format=text&lat=43.2&lon=76.9&mood=coffee&q=coffee')).text(), /only in Astana/);
  const ask = await handleApi(new Request('https://demo.example/api/watch/ask?format=text&lat=51.1283&lon=71.4304&q=where%20can%20I%20get%20coffee%3F'), {}, pois);
  assert.match(await ask.text(), /^Кофейня у Байтерека, a cafe\. About/);
  // Opened in a browser, the Siri link reads as text, not raw JSON; format=json still gives JSON.
  const browser = { headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' } };
  const opened = await handleApi(new Request('https://demo.example/api/watch/ask?lat=51.1283&lon=71.4304&q=coffee', browser), {}, pois);
  assert.match(opened.headers.get('Content-Type'), /^text\/plain/);
  assert.match(await opened.text(), /^Кофейня у Байтерека, a cafe\./);
  const forced = await handleApi(new Request('https://demo.example/api/watch/ask?format=json&lat=51.1283&lon=71.4304&q=coffee', browser), {}, pois);
  assert.equal((await forced.json()).mode, 'fallback');
  assert.match(spokenPlan({ places: [] }, new Date(), 'en'), /^Nothing nearby/);
  // A Russian question stays Russian.
  assert.match(await (await plan('format=text&lat=51.1283&lon=71.4304&mood=coffee&q=кофе')).text(), /Идти примерно/);
});

test('a Kazakh question gets a Kazakh spoken answer without Gemini', async () => {
  const question = encodeURIComponent('жақын жерде кофе қайда?');
  const ask = await handleApi(new Request(`https://demo.example/api/watch/ask?format=text&lat=51.1283&lon=71.4304&q=${question}`), {}, pois);
  const text = await ask.text();
  assert.match(text, /^Кофейня у Байтерека, кафе\. Жаяу шамамен \d+ минут, барып-қайтқанда бүкіл серуен шамамен \d+ минут алады, сағат \d\d:\d\d шамасында ораласыз\./);
  assert.doesNotMatch(text, /Идти|пешком|вернётесь/);
  assert.match(await (await plan(`format=text&lat=51.1283&lon=71.4304&mood=coffee&q=${question}`)).text(), /Жаяу шамамен/);
  assert.match(await (await plan('format=text&lat=51.1283&lon=71.4304&mood=coffee&lang=kk')).text(), /Жаяу шамамен/);
  assert.match(await (await plan(`format=text&lat=43.2&lon=76.9&mood=coffee&q=${question}`)).text(), /тек Астанада/);
  assert.match(spokenPlan({ places: [] }, new Date(), 'kk'), /табылмады/);
});

test('nothing in reach is said honestly', () => {
  assert.match(spokenPlan({ places: [] }), /не нашлось/);
});

test('Russian plurals', () => {
  assert.deepEqual([1, 2, 5, 11, 21, 24, 112].map(n => plural(n, 'минуту', 'минуты', 'минут')),
    ['минуту', 'минуты', 'минут', 'минут', 'минуту', 'минуты', 'минут']);
});

test('every element the watch script looks up exists on the page', () => {
  const html = readFileSync(new URL('../public/watch.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../public/watch.js', import.meta.url), 'utf8');
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  const used = new Set([...script.matchAll(/\$\('([^']+)'\)/g)].map(match => match[1]));
  assert.ok(used.size > 40);
  assert.deepEqual([...used].filter(id => !ids.has(id)), []);
  // The pairing keypad: ten digits, erase and back.
  assert.equal([...html.matchAll(/data-key="([^"]+)"/g)].map(match => match[1]).sort().join(','), '0,1,2,3,4,5,6,7,8,9,back,del');
});

test('the park mood offers parks, not monuments', async () => {
  const monument = { id: 'node/3', name: 'Монумент у Байтерека', lat: 51.1285, lon: 71.4306, category: 'attraction', tags: { historic: 'monument' }, sourceUrl: 'https://www.openstreetmap.org/node/3', retrievedAt: '2026-10-19T10:00:00Z', openingHours: null };
  const response = await handleApi(new Request('https://demo.example/api/watch/plan?lat=51.1283&lon=71.4304&minutes=45&mood=park'), {}, [...pois, monument]);
  const data = await response.json();
  assert.ok(data.places.length);
  assert.deepEqual([...new Set(data.places.map(place => place.category))], ['park']);
});

test('the watch page has every text in Russian, Kazakh and English', () => {
  const sandbox = {};
  new Function('window', readFileSync(new URL('../public/watch-text.js', import.meta.url), 'utf8'))(sandbox);
  const text = sandbox.AidemWatchText;
  const keys = Object.keys(text.ru);
  for (const lang of ['kk', 'en']) {
    assert.deepEqual(Object.keys(text[lang]).sort(), [...keys].sort(), lang);
    for (const key of keys) {
      assert.equal(typeof text[lang][key], typeof text.ru[key], `${lang} ${key}`);
      if (Array.isArray(text.ru[key])) assert.equal(text[lang][key].length, text.ru[key].length, `${lang} ${key}`);
      // Only values the page fills in (Kazakh needs no plural word, so it may use fewer).
      const names = (value) => [...String(value).matchAll(/\{(\w+)\}/g)].map(match => match[1]);
      assert.deepEqual(names(text[lang][key]).filter(name => !names(text.ru[key]).includes(name)), [], `${lang} ${key}`);
    }
  }
  const html = readFileSync(new URL('../public/watch.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../public/watch.js', import.meta.url), 'utf8');
  const used = [...html.matchAll(/data-t(?:-placeholder|-aria|-content)?="([^"]+)"/g), ...script.matchAll(/\bt\('([^']+)'/g)].map(match => match[1]);
  assert.ok(used.length > 100);
  assert.deepEqual([...new Set(used)].filter(key => !(key in text.ru)), []);
});

test('the watch draws its icons from its own sprite, not from symbol fonts or WebP', () => {
  const html = readFileSync(new URL('../public/watch.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../public/watch.js', import.meta.url), 'utf8');
  const texts = readFileSync(new URL('../public/watch-text.js', import.meta.url), 'utf8');
  const symbols = new Set([...html.matchAll(/<symbol id="i-([\w-]+)"/g)].map(match => match[1]));
  const glyphs = Object.fromEntries([...script.match(/const GLYPHS = \{([^}]+)\}/)[1].matchAll(/'([^']+)': '([\w-]+)'/g)].map(match => [match[1], match[2]]));
  const categories = [...script.match(/const CATEGORIES = \{([^}]+)\}/)[1].matchAll(/: '([\w-]+)'/g)].map(match => match[1]);
  const used = [...html.matchAll(/href="#i-([\w-]+)"/g)].map(match => match[1]);
  assert.ok(used.length >= 15);
  assert.deepEqual([...used, ...Object.values(glyphs), ...categories, 'landmark'].filter(name => !symbols.has(name)), []);
  // Apple Watch fonts lack symbols such as ✦ ✓ ★ ⌫, which showed as empty boxes. Outside the sprite only the markers that
  // setText turns into icons may appear; «←» is on the laptop caption only.
  const page = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<svg class="sprite"[\s\S]*?<\/svg>/, '');
  const odd = (source) => [...new Set([...source].filter(char => char.codePointAt(0) >= 0x2190 && !(char in glyphs) && char !== '←' && char !== '️'))];
  assert.deepEqual(odd(page), []);
  assert.deepEqual(odd(texts), []);
  assert.doesNotMatch(html + script, /\.webp/);
});
