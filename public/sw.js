// GridVision Service Worker
const CACHE_VERSION = 'v2';
const CACHE_NAME = `gridvision-${CACHE_VERSION}`;
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(PRECACHE_URLS).catch(() => undefined)
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith('gridvision-') && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Network-first documents; cache-first immutable assets. Never cache APIs.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isNavigation = request.mode === 'navigate' ||
    url.pathname === '/' || url.pathname === '/index.html';
  if (isNavigation) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const clone = response.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', clone));
          }
          return response;
        })
        .catch(() => caches.match('/index.html').then((cached) => cached || caches.match('/')))
    );
    return;
  }

  // Hashed Vite assets and public static files are safe to cache. Requests
  // outside the static asset paths are left to the browser/network.
  const isStaticAsset = url.pathname.startsWith('/assets/') ||
    /\.(?:css|js|png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|otf|json)$/.test(url.pathname);
  if (!isStaticAsset) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const clone = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});
