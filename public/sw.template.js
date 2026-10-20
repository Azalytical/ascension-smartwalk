// Seruen service worker. Build __BUILD_ID__.
// The app shell is network-first (a fresh deploy always wins) with the cache as the offline fallback;
// vendored libraries and fonts are cache-first, icons and map tiles stale-while-revalidate; the API is never cached.
const VERSION = '__BUILD_ID__';
const SHELL = `seruen-shell-${VERSION}`;
const STATIC = 'seruen-static-v1';
const TILES = 'seruen-tiles-v1';
const PRECACHE = ['/', '/css/tokens.css', '/css/components.css', '/css/app.css', '/js/main.js', '/manifest.webmanifest',
  '/assets/icons/seruen.svg', '/assets/brand/seruen/mark.svg', '/data/places.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('seruen-shell-') && key !== SHELL).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(key);
}

async function networkFirst(request) {
  const cache = await caches.open(SHELL);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
    if (cached) return cached;
    if (request.mode === 'navigate') return cache.match('/');
    throw new Error('offline');
  }
}

async function staleWhileRevalidate(request, cacheName, max) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request).then((response) => {
    if (response.ok || response.type === 'opaque') { cache.put(request, response.clone()); if (max) trim(cacheName, max); }
    return response;
  });
  if (cached) { network.catch(() => {}); return cached; }
  return network;
}

async function cacheFirst(request, cacheName, max) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') {
    cache.put(request, response.clone());
    if (max) trim(cacheName, max);
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === location.origin) {
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/telegram/')) return;
    if (url.pathname.startsWith('/vendor/')) { event.respondWith(cacheFirst(request, STATIC)); return; }
    if (url.pathname.startsWith('/assets/')) { event.respondWith(staleWhileRevalidate(request, STATIC)); return; }
    event.respondWith(networkFirst(request));
    return;
  }
  if (/(tiles\.openfreemap\.org|basemaps\.cartocdn\.com|tile\.openstreetmap\.org)$/.test(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request, TILES, 800).catch(() => fetch(request)));
  }
});
