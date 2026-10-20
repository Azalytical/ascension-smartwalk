// "Time to head back" reminders through Web Push. The phone shows the notification and any paired watch or band
// mirrors it, so the reminder arrives on the wrist even with the site closed. RFC 8291 payload encryption, RFC 8292 VAPID.

const encoder = new TextEncoder();

export const base64url = {
  encode: bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  decode: text => Uint8Array.from(atob(String(text).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(text).length + 3) % 4)), c => c.charCodeAt(0))
};

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

export async function createVapidKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return { privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey), publicKey: base64url.encode(await crypto.subtle.exportKey('raw', pair.publicKey)) };
}

export async function vapidAuthorization(endpoint, keys, subject, now = Date.now()) {
  const part = value => base64url.encode(encoder.encode(JSON.stringify(value)));
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })}`;
  const key = await crypto.subtle.importKey('jwk', keys.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(unsigned));
  return `vapid t=${unsigned}.${base64url.encode(signature)}, k=${keys.publicKey}`;
}

async function hkdf(salt, secret, info, bits) {
  const key = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bits));
}

/** aes128gcm body for one push message: salt, record size, sender key, then the encrypted record. */
export async function encryptPayload(subscriptionKeys, payload, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const receiver = base64url.decode(subscriptionKeys.p256dh);
  const auth = base64url.decode(subscriptionKeys.auth);
  const sender = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const senderPublic = new Uint8Array(await crypto.subtle.exportKey('raw', sender.publicKey));
  const receiverKey = await crypto.subtle.importKey('raw', receiver, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: receiverKey }, sender.privateKey, 256));
  const ikm = await hkdf(auth, shared, concat(encoder.encode('WebPush: info\0'), receiver, senderPublic), 256);
  const contentKey = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 128);
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 96);
  const aes = await crypto.subtle.importKey('raw', contentKey, 'AES-GCM', false, ['encrypt']);
  // 0x02 marks the last (and only) record.
  const record = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(encoder.encode(payload), new Uint8Array([2]))));
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = senderPublic.length;
  return concat(header, senderPublic, record);
}

export async function sendPush(subscription, payload, keys, subject) {
  const response = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: { Authorization: await vapidAuthorization(subscription.endpoint, keys, subject), TTL: '900', Urgency: 'high',
      'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream' },
    body: await encryptPayload(subscription.keys, JSON.stringify(payload))
  });
  return response.status;
}

// Push services of Chrome/Android, Firefox, Safari/iOS and Edge. Anything else is refused, so the Worker never posts to arbitrary hosts.
const PUSH_HOSTS = /^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)$/;
const TAG = /^[a-z0-9-]{1,40}$/;

/** Returns a clean subscription and reminders, or an error message in Russian. */
export function validateReminder(body, now = Date.now()) {
  const subscription = body?.subscription;
  let endpoint;
  try { endpoint = new URL(subscription?.endpoint); } catch { return { error: 'Нет подписки на уведомления.' }; }
  if (endpoint.protocol !== 'https:' || !PUSH_HOSTS.test(endpoint.hostname) || subscription.endpoint.length > 1024) return { error: 'Этот сервис уведомлений не поддерживается.' };
  let p256dh, auth;
  try { p256dh = base64url.decode(subscription.keys?.p256dh); auth = base64url.decode(subscription.keys?.auth); } catch { return { error: 'Подписка повреждена.' }; }
  if (p256dh.length !== 65 || p256dh[0] !== 4 || auth.length !== 16) return { error: 'Подписка повреждена.' };
  const reminders = body.reminders;
  if (!Array.isArray(reminders) || !reminders.length || reminders.length > 3) return { error: 'Нужно от одного до трёх напоминаний.' };
  const clean = [];
  for (const reminder of reminders) {
    const at = Number(reminder?.at);
    if (!Number.isFinite(at) || at < now - 60000 || at > now + 6 * 3600000) return { error: 'Время напоминания вне прогулки.' };
    if (typeof reminder.title !== 'string' || !reminder.title.trim() || reminder.title.length > 80
      || typeof reminder.body !== 'string' || reminder.body.length > 240) return { error: 'Текст напоминания слишком длинный.' };
    if (reminder.tag !== undefined && !TAG.test(String(reminder.tag))) return { error: 'Некорректная метка напоминания.' };
    clean.push({ at: Math.round(at), payload: { title: reminder.title.trim(), body: reminder.body.trim(), tag: reminder.tag || 'seruen-back', url: '/watch' } });
  }
  return { subscription: { endpoint: subscription.endpoint, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth } }, reminders: clean };
}

const MAX_PENDING = 2000;

/** One Durable Object keeps the VAPID keys and pending reminders, and wakes itself with an alarm. */
export class WatchPush {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async keys() {
    let keys = await this.ctx.storage.get('vapid');
    if (!keys) { keys = await createVapidKeys(); await this.ctx.storage.put('vapid', keys); }
    return keys;
  }

  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === '/key') return Response.json({ publicKey: (await this.keys()).publicKey });
    const input = await request.json();
    let pending = (await this.ctx.storage.get('pending')) || [];
    if (pathname === '/schedule') {
      const id = crypto.randomUUID();
      pending = pending.concat(input.reminders.map(reminder => ({ ...reminder, id, subscription: input.subscription, subject: input.subject })));
      if (pending.length > MAX_PENDING) pending = pending.sort((a, b) => a.at - b.at).slice(-MAX_PENDING);
      await this.ctx.storage.put('pending', pending);
      await this.arm(pending);
      return Response.json({ id, scheduled: input.reminders.length });
    }
    if (pathname === '/cancel') {
      pending = pending.filter(reminder => reminder.id !== input.id);
      await this.ctx.storage.put('pending', pending);
      await this.arm(pending);
      return Response.json({ cancelled: true });
    }
    return new Response('Not found', { status: 404 });
  }

  async arm(pending) {
    if (!pending.length) { await this.ctx.storage.deleteAlarm(); return; }
    await this.ctx.storage.setAlarm(Math.max(Date.now() + 100, Math.min(...pending.map(reminder => reminder.at))));
  }

  async alarm() {
    const now = Date.now();
    const pending = (await this.ctx.storage.get('pending')) || [];
    const due = pending.filter(reminder => reminder.at <= now + 500);
    const rest = pending.filter(reminder => reminder.at > now + 500);
    // Saved first, so a retried alarm never sends the same reminder twice.
    await this.ctx.storage.put('pending', rest);
    if (due.length) {
      const keys = await this.keys();
      const results = await Promise.all(due.map(reminder => sendPush(reminder.subscription, reminder.payload, keys, reminder.subject).catch(() => 0)));
      console.log(JSON.stringify({ event: 'watch_push', sent: results.filter(status => status >= 200 && status < 300).length, failed: results.filter(status => !(status >= 200 && status < 300)).length }));
    }
    await this.arm(rest);
  }
}

/** In-process stand-in for `npm run dev` and tests: same class, storage in memory, the alarm on a timer. */
export function localWatchPush() {
  const data = new Map();
  let timer = null;
  const hub = new WatchPush({ storage: {
    get: async key => data.get(key),
    put: async (key, value) => { data.set(key, value); },
    setAlarm: async at => { clearTimeout(timer); timer = setTimeout(() => hub.alarm().catch(() => {}), Math.max(0, at - Date.now())); timer.unref?.(); },
    deleteAlarm: async () => { clearTimeout(timer); timer = null; }
  } }, {});
  return hub;
}
