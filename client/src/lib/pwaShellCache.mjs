/**
 * PWA shell-cache helpers (pure). Mirrored by client/public/sw.js — keep in sync.
 * Old fixed name hamster-pwa-shell-v1 left stale assets after deploy; activate must
 * drop every prior hamster-pwa-shell* entry when a new SHELL_CACHE is current.
 */

/** Current shell cache bucket. Bump when SW caching policy changes. */
export const SHELL_CACHE = 'hamster-pwa-shell-v2'

export const SHELL_CACHE_PREFIX = 'hamster-pwa-shell'

/**
 * Given CacheStorage keys from an older install, decide which to delete when
 * activating a SW that uses `current`.
 * @param {string[]} cacheNames
 * @param {string} [current]
 * @returns {string[]} names to delete
 */
export function shellCachesToDelete(cacheNames, current = SHELL_CACHE) {
  const names = Array.isArray(cacheNames) ? cacheNames : []
  return names.filter(
    (name) =>
      typeof name === 'string' &&
      name.startsWith(SHELL_CACHE_PREFIX) &&
      name !== current,
  )
}

/**
 * Simulate activate cleanup against a Map-backed fake CacheStorage.
 * @param {Map<string, Map<string, string>>} stores name -> (url -> body)
 * @param {string} [current]
 */
export function activateShellCacheCleanup(stores, current = SHELL_CACHE) {
  const toDelete = shellCachesToDelete([...stores.keys()], current)
  for (const name of toDelete) stores.delete(name)
  if (!stores.has(current)) stores.set(current, new Map())
  return { deleted: toDelete, current }
}
