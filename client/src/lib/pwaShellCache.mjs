/**
 * PWA shell-cache helpers (pure). Mirrored by client/public/sw.js — keep in sync.
 * Cache bucket is hamster-pwa-shell-<deployId>; deployId is stamped at build time.
 */

import { SHELL_CACHE_PREFIX, shellCacheNameForBuild } from './pwaBuildStamp.mjs'

export { SHELL_CACHE_PREFIX, shellCacheNameForBuild }

/** Default for unit fixtures (not a production deploy id). */
export const SHELL_CACHE = shellCacheNameForBuild('dev')

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
