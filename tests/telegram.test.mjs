import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../src/api.mjs';
import { minutesFrom, resetTelegramSessions } from '../src/telegram.mjs';

const cafe = { id: 'node/7', name: 'Кофейня <Тест>', lat: 51.1283, lon: 71.4304, category: 'cafe', tags: { amenity: 'cafe' },
  sourceUrl: 'https://www.openstreetmap.org/node/7', retrievedAt: '2026-10-19T10:00:00Z', openingHours: null };
const env = { TELEGRAM_WEBHOOK_SECRET: 's3cret' };
const update = (message, secret = 's3cret') => new Request('https://demo.example/telegram/webhook', { method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret },
  body: JSON.stringify({ update_id: 1, message: { chat: { id: 42 }, ...message } }) });
const send = async (message, extra = {}) => (await handleApi(update(message), { ...env, ...extra }, [cafe])).json();

test('webhook requires the secret token', async () => {
  assert.equal((await handleApi(update({ text: '/start' }, 'wrong'), env, [cafe])).status, 403);
  assert.equal((await handleApi(update({ text: '/start' }), {}, [cafe])).status, 403);
});

test('location then request returns sourced places in the webhook reply', async () => {
  resetTelegramSessions();
  const start = await send({ text: '/start' });
  assert.equal(start.method, 'sendMessage'); assert.equal(start.chat_id, 42);
  assert.equal(start.reply_markup.keyboard[0][0].request_location, true);
  assert.match((await send({ text: 'кофе' })).text, /Сначала отправьте геолокацию/);
  assert.match((await send({ location: { latitude: 43.24, longitude: 76.9 } })).text, /вне Астаны/);
  assert.match((await send({ location: { latitude: 51.1283, longitude: 71.4304 } })).text, /Точка получена/);
  const answer = await send({ text: 'хочу кофе, есть час' });
  assert.match(answer.text, /Кофейня &lt;Тест&gt;/);
  assert.match(answer.text, /openstreetmap\.org\/node\/7/);
  assert.match(answer.text, /без языковой модели/);
  assert.equal(answer.parse_mode, 'HTML');
});

test('time phrases map to the API time limits', () => {
  assert.equal(minutesFrom('есть час'), 60);
  assert.equal(minutesFrom('с ребёнком на 2 часа'), 120);
  assert.equal(minutesFrom('1,5 ч'), 90);
  assert.equal(minutesFrom('40 минут'), 40);
  assert.equal(minutesFrom('полчаса'), 30);
  assert.equal(minutesFrom('3 часа'), 180);
  assert.equal(minutesFrom('10 часов'), 240);
  assert.equal(minutesFrom('кофе'), 60);
});
