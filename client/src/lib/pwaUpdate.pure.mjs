/**
 * Client-side PWA update lifecycle helpers (pure + thin wrappers).
 * No forced reload: the user opts in. Does not clear conversation/user storage.
 */

import {
  SHELL_CACHE,
  activateShellCacheCleanup,
} from './pwaShellCache.mjs'

/** Registration options so HTTP cache cannot hide a new sw.js for an hour. */
export const SW_REGISTER_OPTIONS = Object.freeze({ updateViaCache: 'none' })

/**
 * After a new worker takes control, should we offer a user-controlled reload?
 * First control (no prior controller) must not interrupt a fresh launch.
 * @param {{ hadController: boolean, controllerChanged: boolean }} state
 */
export function shouldOfferUpdateReload(state) {
  return Boolean(state?.hadController && state?.controllerChanged)
}

/**
 * Keys we treat as conversation/user continuity — never cleared by update apply.
 * @param {Storage} storage
 * @returns {Record<string, string>}
 */
export function snapshotContinuityStorage(storage) {
  const out = {}
  if (!storage || typeof storage.length !== 'number') return out
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (!key) continue
    if (
      key.startsWith('hamster.') ||
      key.startsWith('hamster-') ||
      key.includes('conversation') ||
      key.includes('locale')
    ) {
      out[key] = storage.getItem(key) ?? ''
    }
  }
  return out
}

/**
 * Apply update: optional SKIP_WAITING message, then reload. Must not wipe storage.
 * @param {{
 *   registration?: { waiting?: { postMessage: (msg: unknown) => void } | null } | null,
 *   reload?: () => void,
 *   storage?: Storage,
 * }} [opts]
 */
export function applyPwaUpdate(opts = {}) {
  const storage = opts.storage ?? globalThis.localStorage
  const before = snapshotContinuityStorage(storage)
  const waiting = opts.registration?.waiting
  if (waiting && typeof waiting.postMessage === 'function') {
    waiting.postMessage({ type: 'SKIP_WAITING' })
  }
  const after = snapshotContinuityStorage(storage)
  for (const [k, v] of Object.entries(before)) {
    if (after[k] !== v) {
      throw new Error(`applyPwaUpdate must not alter continuity key ${k}`)
    }
  }
  const reload =
    opts.reload ??
    (() => {
      if (typeof globalThis.location?.reload === 'function') globalThis.location.reload()
    })
  reload()
  return { preserved: before }
}

/**
 * Fixture: old deployed shell → new SW activate → old assets gone, continuity intact.
 */
export function runOldToNewUpgradeFixture() {
  const stores = new Map([
    [
      'hamster-pwa-shell-v1',
      new Map([
        ['https://hamster.example/', '<html>old</html>'],
        ['https://hamster.example/assets/index-DqKaLRWz.js', 'old-bundle'],
      ]),
    ],
  ])
  const data = new Map([
    ['hamster.controlBase', 'https://hamster.example'],
    ['hamster.locale', 'en'],
  ])
  const storage = {
    get length() {
      return data.size
    },
    key(i) {
      return [...data.keys()][i] ?? null
    },
    getItem(k) {
      return data.has(k) ? data.get(k) : null
    },
    setItem(k, v) {
      data.set(k, String(v))
    },
    removeItem(k) {
      data.delete(k)
    },
  }

  const result = activateShellCacheCleanup(stores, SHELL_CACHE)
  const continuity = snapshotContinuityStorage(storage)
  let reloaded = false
  applyPwaUpdate({
    registration: { waiting: { postMessage() {} } },
    storage,
    reload: () => {
      reloaded = true
    },
  })

  return {
    deletedOldShell: result.deleted.includes('hamster-pwa-shell-v1'),
    hasCurrentShell: stores.has(SHELL_CACHE),
    oldAssetGone: !stores.has('hamster-pwa-shell-v1'),
    continuity,
    reloaded,
    offeredReload: shouldOfferUpdateReload({ hadController: true, controllerChanged: true }),
    silentFirstControl: !shouldOfferUpdateReload({
      hadController: false,
      controllerChanged: true,
    }),
  }
}
