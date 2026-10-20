// Service worker for Ulger watch reminders (scope /watch). It only shows pushed reminders; it does not cache pages.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* empty or plain-text push */ }
  event.waitUntil(self.registration.showNotification(data.title || 'Ulger', {
    body: data.body || 'Пора обратно.',
    tag: data.tag || 'seruen-back',
    renotify: true,
    icon: '/assets/watch/seruen-192.png',
    badge: '/assets/watch/seruen-badge-96.png',
    vibrate: [300, 120, 300, 120, 300],
    data: { url: data.url || '/watch' }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const open = windows.find((client) => new URL(client.url).pathname.startsWith('/watch'));
    return open ? open.focus() : self.clients.openWindow(event.notification.data?.url || '/watch');
  }));
});
