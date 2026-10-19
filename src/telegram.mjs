/**
 * Telegram bot for SmartWalk. Webhook only: Telegram posts an update, the answer goes back in the
 * webhook response body, so no outbound call is needed. Patterns (button keyboard, request_location,
 * secret token header, 30-minute in-memory session) come from the Ascension HackAlem bot.
 */
import { recommend } from './retrieval.mjs';

const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 2000;
const B = Object.freeze({ location: '📍 Отправить геолокацию', help: '❓ Как пользоваться' });
const HELP = 'Я подберу 1–3 места рядом для прогулки по Астане.\n\n'
  + '1. Нажмите «📍 Отправить геолокацию».\n'
  + '2. Напишите, что хотите и сколько у вас времени, например: «кофе, есть час», «с ребёнком на 2 часа», «идёт дождь, хочу поесть».\n\n'
  + 'Место нужно только для расчёта расстояний: я не храню его дольше 30 минут и не передаю языковой модели. '
  + 'Время пешком — оценка, часы работы взяты из OpenStreetMap и могут быть неточными.';

// chatId -> { lat, lon, expiresAt }. Only the last point; nothing is persisted.
const sessions = new Map();

function keyboard() {
  return { keyboard: [[{ text: B.location, request_location: true }], [{ text: B.help }]],
    resize_keyboard: true, is_persistent: true, input_field_placeholder: 'Например: кофе, есть час' };
}

function escape(text) {
  return String(text).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
}

function reply(chatId, text, extra = {}) {
  return new Response(JSON.stringify({ method: 'sendMessage', chat_id: chatId, text, parse_mode: 'HTML',
    disable_web_page_preview: true, reply_markup: keyboard(), ...extra }), { headers: { 'Content-Type': 'application/json' } });
}

function remember(chatId, lat, lon, now) {
  if (sessions.size >= MAX_SESSIONS) for (const [key, value] of sessions) if (value.expiresAt <= now) sessions.delete(key);
  if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
  sessions.set(chatId, { lat, lon, expiresAt: now + SESSION_TTL_MS });
}

/** "2 часа", "40 минут", "1.5 ч", "an hour" → minutes within the API limits; default one hour. */
export function minutesFrom(text) {
  const t = String(text).toLowerCase().replace(',', '.');
  const hours = t.match(/(\d+(?:\.\d+)?)\s*(?:час|ч(?!\p{L})|сағ|hour|hr|h(?!\p{L}))/u);
  const minutes = t.match(/(\d+)\s*(?:мин|min|м(?!\p{L}))/u);
  let total = (hours ? Number(hours[1]) * 60 : 0) + (minutes ? Number(minutes[1]) : 0);
  if (!total && /полчаса|half an hour/.test(t)) total = 30;
  if (!total && /(^|\s)(час|hour|an hour|бір сағат)/.test(t)) total = 60;
  return Math.min(180, Math.max(20, Math.round(total || 60)));
}

function formatResult(result, generation) {
  if (!result.recommendations.length) {
    return 'Подходящих мест под эти условия не нашлось. Попробуйте больше времени или другой запрос.';
  }
  const lines = [];
  if (generation?.mode === 'llm') lines.push(`<i>${escape(generation.summary)}</i>`, '');
  result.recommendations.forEach((place, index) => {
    lines.push(`<b>${index + 1}. ${escape(place.name)}</b>`,
      `~${place.walkMinutes} мин туда · ~${place.totalMinutes} мин всего с возвращением`,
      escape(place.why),
      `⚠️ ${escape(place.warnings[0])}`,
      `<a href="${escape(place.sourceUrl)}">Источник: OpenStreetMap</a>`, '');
  });
  lines.push(generation?.mode === 'llm'
    ? 'Первую строку написал Gemini только по данным этих карточек. Время, расстояние и часы считает сервер.'
    : 'Подбор составлен по данным мест без языковой модели.');
  return lines.join('\n');
}

/**
 * Handle one webhook update. `generate(result, query)` is injected by the API so the bot shares
 * the same model call, validation and fallback as the website.
 */
export async function handleTelegram(request, env, pois, generate, now = Date.now()) {
  if (!env.TELEGRAM_WEBHOOK_SECRET || request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response('Forbidden', { status: 403 });
  }
  let update;
  try { update = await request.json(); } catch { return new Response('Bad request', { status: 400 }); }
  const message = update?.message;
  const chatId = message?.chat?.id;
  if (!Number.isSafeInteger(chatId)) return new Response(null, { status: 204 });

  if (message.location) {
    const { latitude: lat, longitude: lon } = message.location;
    try { recommend([], { lat, lon }); }
    catch { return reply(chatId, 'Эта точка вне Астаны. Сейчас я работаю только по Астане.'); }
    remember(chatId, lat, lon, now);
    return reply(chatId, 'Точка получена. Что хотите и сколько у вас времени? Например: «кофе, есть час» или «с ребёнком на 2 часа».');
  }
  const text = typeof message.text === 'string' ? message.text.trim().slice(0, 500) : '';
  if (!text || text === '/start' || text === '/help' || text === B.help) return reply(chatId, escape(HELP));

  const session = sessions.get(chatId);
  if (!session || session.expiresAt <= now) {
    sessions.delete(chatId);
    return reply(chatId, 'Сначала отправьте геолокацию кнопкой «📍 Отправить геолокацию», потом напишите запрос.');
  }
  const minutes = minutesFrom(text);
  const withChild = /реб[её]н|дет[еяи]|бала|child|kid/i.test(text);
  const result = recommend(pois, { lat: session.lat, lon: session.lon, minutes, maxWalkMinutes: Math.min(30, Math.floor(minutes / 3)),
    query: text, withChild, returnToStart: true });
  const generation = await generate(result, text, chatId);
  return reply(chatId, formatResult(result, generation));
}

export function resetTelegramSessions() { sessions.clear(); }
