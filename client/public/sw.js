/* Hamster PWA service worker — offline-safe app shell only.
 *
 * Caching policy (bounded, honest):
 * - Same-origin GET navigations and same-origin GET static assets are cached.
 * - Control-plane API calls (`/api/...`, `/internal/...`) are NEVER cached, so a
 *   revoked permission can never leave restricted dashboard data in the cache.
 * - No task / conversation / approval payloads are cached.
 */

const SHELL_CACHE = 'hamster-pwa-shell-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function isControlPlanePath(url) {
  return url.pathname.startsWith('/api/') || url.pathname.startsWith('/internal/');
}

self.addEventListener('fetch', (_event) => {
  const url = new URL(_event.request.url);
  const sameOrigin = url.origin === self.location.origin;
  const method = _event.request.method;
  const isControlPlane = isControlPlanePath(url);
  if (method !== 'GET' || !sameOrigin || isControlPlane) {
    return; // network only
  }
  if (_event.request.mode === 'navigate') {
    _event.respondWith(networkFirst(_event.request));
  } else {
    _event.respondWith(cacheFirst(_event.request));
  }
});

async function cacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) {
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}
