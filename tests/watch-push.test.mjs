import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../src/api.mjs';
import { base64url, encryptPayload, createVapidKeys, vapidAuthorization, validateReminder, localWatchPush } from '../src/watch-push.mjs';

async function hkdf(salt, secret, info, bits) {
  const key = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bits));
}
const text = value => new TextEncoder().encode(value);
const join = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

// The browser's side of RFC 8291, written independently of the sender.
async function browser() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    keys: { p256dh: base64url.encode(publicRaw), auth: base64url.encode(auth) },
    async decrypt(body) {
      const salt = body.slice(0, 16);
      const idLength = body[20];
      const senderRaw = body.slice(21, 21 + idLength);
      const sender = await crypto.subtle.importKey('raw', senderRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
      const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: sender }, pair.privateKey, 256));
      const ikm = await hkdf(auth, shared, join(text('WebPush: info\0'), publicRaw, senderRaw), 256);
      const key = await crypto.subtle.importKey('raw', await hkdf(salt, ikm, text('Content-Encoding: aes128gcm\0'), 128), 'AES-GCM', false, ['decrypt']);
      const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: await hkdf(salt, ikm, text('Content-Encoding: nonce\0'), 96) }, key, body.slice(21 + idLength)));
      assert.equal(plain.at(-1), 2);
      assert.equal(new DataView(body.buffer, body.byteOffset).getUint32(16), 4096);
      return new TextDecoder().decode(plain.slice(0, -1));
    }
  };
}

test('push payload decrypts on the browser side', async () => {
  const device = await browser();
  const payload = JSON.stringify({ title: 'Пора обратно', body: 'До старта примерно 4 мин пешком.' });
  assert.equal(await device.decrypt(await encryptPayload(device.keys, payload)), payload);
});

test('VAPID header is a valid ES256 token for the push service origin', async () => {
  const keys = await createVapidKeys();
  const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', keys, 'https://seruen.example', 1_800_000_000_000);
  const [, token, publicKey] = header.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(publicKey, keys.publicKey);
  const [head, claims, signature] = token.split('.');
  const verifier = await crypto.subtle.importKey('raw', base64url.decode(publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifier, base64url.decode(signature), text(`${head}.${claims}`)));
  assert.deepEqual(JSON.parse(new TextDecoder().decode(base64url.decode(claims))), { aud: 'https://fcm.googleapis.com', exp: 1_800_000_000 + 43200, sub: 'https://seruen.example' });
});

test('reminders accept only known push services, sane times and short texts', async () => {
  const device = await browser();
  const now = Date.now();
  const good = { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: device.keys }, reminders: [{ at: now + 60000, title: 'Пора обратно', body: 'Успеете к 15:42.' }] };
  assert.equal(validateReminder(good, now).reminders[0].payload.url, '/watch');
  assert.ok(validateReminder({ ...good, subscription: { ...good.subscription, endpoint: 'https://evil.example/push' } }, now).error);
  assert.ok(validateReminder({ ...good, subscription: { ...good.subscription, keys: { p256dh: 'AAAA', auth: device.keys.auth } } }, now).error);
  assert.ok(validateReminder({ ...good, reminders: [{ ...good.reminders[0], at: now + 7 * 3600000 }] }, now).error);
  assert.ok(validateReminder({ ...good, reminders: Array(4).fill(good.reminders[0]) }, now).error);
  assert.ok(validateReminder({ ...good, reminders: [{ ...good.reminders[0], body: 'x'.repeat(241) }] }, now).error);
});

test('scheduled reminder is pushed on time, encrypted and signed', async (t) => {
  const device = await browser();
  const hub = localWatchPush();
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push({ url, init }); return new Response(null, { status: 201 }); };
  t.after(() => { globalThis.fetch = realFetch; });
  const env = { WATCH_PUSH_LOCAL: hub };
  const call = (path, body, headers = {}) => handleApi(new Request(`https://seruen.example${path}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://seruen.example', ...headers }, body: JSON.stringify(body) } : {}), env, []);

  const key = await (await call('/api/watch/push/key')).json();
  assert.equal(base64url.decode(key.publicKey).length, 65);
  const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/device-1', keys: device.keys };
  assert.equal((await call('/api/watch/push/remind', { subscription, reminders: [{ at: Date.now(), title: 'x', body: 'y' }] }, { Origin: 'https://other.example' })).status, 403);

  const later = await (await call('/api/watch/push/remind', { subscription, reminders: [{ at: Date.now() + 3600000, title: 'Позже', body: 'не придёт' }] })).json();
  assert.equal((await (await call('/api/watch/push/cancel', { id: later.id })).json()).cancelled, true);
  const now = await call('/api/watch/push/remind', { subscription, reminders: [{ at: Date.now(), title: 'Пора обратно', body: 'Успеете к 15:42.', tag: 'seruen-back' }] });
  assert.equal(now.status, 200);
  await new Promise(resolve => setTimeout(resolve, 400));

  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, subscription.endpoint);
  assert.equal(sent[0].init.headers['Content-Encoding'], 'aes128gcm');
  assert.match(sent[0].init.headers.Authorization, new RegExp(`^vapid t=.+, k=${key.publicKey}$`));
  assert.deepEqual(JSON.parse(await device.decrypt(sent[0].init.body)), { title: 'Пора обратно', body: 'Успеете к 15:42.', tag: 'seruen-back', url: '/watch' });
});

test('without the reminder store the API says so', async () => {
  const response = await handleApi(new Request('https://seruen.example/api/watch/push/key'), {}, []);
  assert.equal(response.status, 503);
});
