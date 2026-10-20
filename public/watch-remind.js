// Ulger reminders on the wrist: Web Push to this phone or computer; a paired watch or band mirrors the notification.
// Usage from any Ulger page (the global keeps its original name): SeruenRemind.schedule([{ at, title, body, tag }]) from a tap, then SeruenRemind.cancel(id).
(() => {
  'use strict';

  const decode = (text) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4)), (c) => c.charCodeAt(0));
  const encode = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  let registration = null;

  function supported() {
    return window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  async function activeRegistration() {
    registration = registration || await navigator.serviceWorker.register('/watch-sw.js', { scope: '/watch' });
    const worker = registration.installing || registration.waiting;
    if (!registration.active && worker) {
      await new Promise((resolve) => worker.addEventListener('statechange', () => { if (worker.state === 'activated') resolve(); }));
    }
    return registration;
  }

  async function subscription() {
    const [ready, response] = await Promise.all([activeRegistration(), fetch('/api/watch/push/key')]);
    if (!response.ok) throw new Error('push_unavailable');
    const { publicKey } = await response.json();
    let current = await ready.pushManager.getSubscription();
    // A subscription made for an older server key cannot receive our pushes.
    if (current && current.options.applicationServerKey && encode(current.options.applicationServerKey) !== publicKey) {
      await current.unsubscribe();
      current = null;
    }
    return current || ready.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decode(publicKey) });
  }

  // Browsers show the permission prompt only from a tap, so call this directly in a click handler.
  function permission() {
    if (!supported()) return Promise.resolve('unsupported');
    return Notification.permission === 'default' ? Notification.requestPermission() : Promise.resolve(Notification.permission);
  }

  async function schedule(reminders) {
    const answer = await permission();
    if (answer !== 'granted') return { ok: false, reason: answer };
    try {
      const target = await subscription();
      const response = await fetch('/api/watch/push/remind', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: target.toJSON(), reminders }) });
      const data = await response.json();
      return response.ok ? { ok: true, id: data.id } : { ok: false, reason: data.error || 'failed' };
    } catch {
      return { ok: false, reason: 'failed' };
    }
  }

  function cancel(id) {
    if (!id) return;
    fetch('/api/watch/push/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }), keepalive: true }).catch(() => {});
  }

  window.SeruenRemind = { supported, permission, schedule, cancel };
})();
