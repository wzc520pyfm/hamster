/* Hamster PWA service worker — offline-safe app shell only.
 *
 * Caching policy (bounded, honest):
 * - Same-origin GET navigations and same-origin GET static assets are cached.
 * - Control-plane API calls (`/api/...`, `/internal/...`) are NEVER cached, so a
 *   revoked permission can never leave restricted dashboard data in the cache.
 * - No task / conversation / approval payloads are cached.
 *
 * Update policy (keep in sync with client/src/lib/pwaBuildStamp.mjs):
 * - HAMSTER_PWA_BUILD is stamped at vite build from hashed asset names so every
 *   deploy that changes the React bundle also changes sw.js (update detection).
 * - install does NOT skipWaiting when an older worker already controls pages —
 *   activation waits for the page's SKIP_WAITING message after user Reload.
 * - First install (no active worker) still activates per browser rules.
 * - activate deletes prior hamster-pwa-shell* buckets and claims clients.
 */

const HAMSTER_PWA_BUILD = '__HAMSTER_PWA_BUILD__';
const SHELL_CACHE = 'hamster-pwa-shell-' + HAMSTER_PWA_BUILD;
const SHELL_CACHE_PREFIX = 'hamster-pwa-shell';

self.addEventListener('install', (_event) => {
  // Intentionally do not activate early. With existing controlled clients, the new
  // worker stays in waiting until the user confirms Reload (message SKIP_WAITING).
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(SHELL_CACHE_PREFIX) && name !== SHELL_CACHE)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event?.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
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
