/**
 * RECON ERP — Progressive Web App Service Worker
 */

const CACHE_NAME = 'recon-erp-v8';

const STATIC_ASSETS = [
  '/',
  '/login',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/api.js',
  '/js/gas-shim.js',
  '/js/i18n.js'
];

// Install: Cache core application shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[SW] Pre-caching warning:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate: Clean up older caches immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Strategy depending on request type
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Ignore non-http(s) requests (e.g. chrome-extension://, moz-extension://)
  if (!req.url.startsWith('http://') && !req.url.startsWith('https://')) {
    return;
  }

  // Only GET requests are cacheable
  if (req.method !== 'GET') {
    return;
  }

  const url = new URL(req.url);

  // 1. API Calls: Network-only with offline JSON fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(req).catch(() => {
        return new Response(
          JSON.stringify({
            status: 'error',
            message: 'Network offline. Please check your internet connection.',
            offline: true
          }),
          {
            headers: { 'Content-Type': 'application/json' },
            status: 503
          }
        );
      })
    );
    return;
  }

  // 2. Navigation requests: Normalize URL to avoid Cloudflare 307 redirects
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          let cleanUrl = req.url;
          if (url.pathname.endsWith('/index.html') || url.pathname === '/index') {
            cleanUrl = new URL('/', url.origin).href;
          } else if (url.pathname.endsWith('.html')) {
            cleanUrl = new URL(url.pathname.replace(/\.html$/, ''), url.origin).href;
          }

          const networkResponse = await fetch(cleanUrl);
          if (networkResponse && networkResponse.status === 200) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(req, networkResponse.clone()).catch(() => {});
          }
          return networkResponse;
        } catch (err) {
          const cached = await caches.match(req) || await caches.match('/') || await caches.match('/login');
          if (cached) return cached;
          throw err;
        }
      })()
    );
    return;
  }

  // 3. Third-Party CDNs (Bootstrap, Bootstrap Icons, Fonts): Stale-While-Revalidate
  if (url.origin.includes('jsdelivr.net') || url.origin.includes('fonts.googleapis.com')) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.match(req).then((cachedResponse) => {
          const fetchPromise = fetch(req)
            .then((networkResponse) => {
              if (networkResponse && networkResponse.status === 200) {
                cache.put(req, networkResponse.clone()).catch(() => {});
              }
              return networkResponse;
            })
            .catch(() => cachedResponse);
          return cachedResponse || fetchPromise;
        });
      })
    );
    return;
  }

  // 4. App scripts (.js) & styles (.css): Network-First with Cache Fallback
  // Always fetch the freshest application code when online; fall back to cache when offline
  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css') || url.pathname.startsWith('/js/')) {
    event.respondWith(
      fetch(req)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const toCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(req, toCache).catch(() => {});
            });
          }
          return networkResponse;
        })
        .catch(() => {
          return caches.match(req);
        })
    );
    return;
  }

  // 5. Other static assets (images, fonts): Cache-First with Network Fallback
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(req, responseToCache).catch(() => {});
        });
        return response;
      });
    })
  );
});

// Handle update prompts
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
