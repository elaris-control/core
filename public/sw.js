// ELARIS — Service Worker
// Strategy: Network-first for API/dynamic, Cache-first for static assets

const CACHE = 'elaris-v1';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/login.html',
  '/styles.css',
  '/app.js',
  '/csrf.js',
  '/theme.js',
  '/i18n.js',
  '/role-ui.js',
  '/site-context.js',
  '/logo.png',
  '/favicon.ico',
  '/manifest.json',
  '/offline.html',
];

// ── Install: cache static shell ───────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

// ── Activate: clean old caches ────────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: network-first for API/WS, cache-first for static ──────────────────
self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // API calls: network only (never cache live data)
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) return;

  // Static assets: cache-first, fallback network
  if (isStaticAsset(url.pathname)) {
    e.respondWith(cacheFirst(request));
    return;
  }

  // HTML pages: network-first, fallback cache, fallback offline
  if (request.headers.get('accept')?.includes('text/html')) {
    e.respondWith(networkFirstHtml(request));
    return;
  }

  // Everything else: network-first
  e.respondWith(networkFirst(request));
});

function isStaticAsset(pathname) {
  return pathname.match(/\.(css|js|png|jpg|jpeg|svg|ico|woff2?|ttf)(\?.*)?$/) !== null;
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Asset not available offline', { status: 503 });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('Offline', { status: 503 });
  }
}

async function networkFirstHtml(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    const offline = await caches.match('/offline.html');
    return offline || new Response('<h1>ELARIS — Offline</h1><p>Cannot reach the Pi. Check your network.</p>', {
      status: 503,
      headers: { 'Content-Type': 'text/html' },
    });
  }
}
