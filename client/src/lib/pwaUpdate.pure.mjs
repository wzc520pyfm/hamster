/**
 * Client-side PWA update lifecycle helpers (pure + thin wrappers).
 * No forced reload: the user opts in. Does not clear conversation/user storage.
 * Reload awaits controllerchange after SKIP_WAITING (no postMessage→immediate reload race).
 */

import {
  SHELL_CACHE,
  activateShellCacheCleanup,
} from './pwaShellCache.mjs'
import { shellCacheNameForBuild } from './pwaBuildStamp.mjs'

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

function defaultWhenControllerChanges(timeoutMs = 4000) {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) {
      resolve('no_sw')
      return
    }
    let done = false
    const finish = (why) => {
      if (done) return
      done = true
      navigator.serviceWorker.removeEventListener('controllerchange', onChange)
      resolve(why)
    }
    const onChange = () => finish('controllerchange')
    navigator.serviceWorker.addEventListener('controllerchange', onChange)
    setTimeout(() => finish('timeout'), timeoutMs)
  })
}

/**
 * Apply update: SKIP_WAITING, await controller switch, then reload.
 * Must not wipe storage. Never forces activation without the waiting worker message.
 * @param {{
 *   registration?: { waiting?: { postMessage: (msg: unknown) => void } | null } | null,
 *   reload?: () => void,
 *   storage?: Storage,
 *   whenControllerChanges?: () => Promise<unknown>,
 *   controllerChangeTimeoutMs?: number,
 * }} [opts]
 */
export async function applyPwaUpdate(opts = {}) {
  const storage = opts.storage ?? globalThis.localStorage
  const before = snapshotContinuityStorage(storage)
  const waiting = opts.registration?.waiting
  const whenControllerChanges =
    opts.whenControllerChanges ??
    (() => defaultWhenControllerChanges(opts.controllerChangeTimeoutMs ?? 4000))

  let controllerWait = null
  if (waiting && typeof waiting.postMessage === 'function') {
    controllerWait = whenControllerChanges()
    waiting.postMessage({ type: 'SKIP_WAITING' })
    await controllerWait
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
 * Fixture: old shell cache → activate cleanup for a new deploy id; continuity intact;
 * Reload awaits controllerchange before reload.
 */
export async function runOldToNewUpgradeFixture() {
  const nextCache = shellCacheNameForBuild('deploy2')
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
    ['hamster.conversation.demo', '{"id":"c1"}'],
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

  const result = activateShellCacheCleanup(stores, nextCache)
  const continuity = snapshotContinuityStorage(storage)
  let reloaded = false
  let controllerAwaited = false
  let messageBeforeReload = false
  await applyPwaUpdate({
    registration: {
      waiting: {
        postMessage() {
          messageBeforeReload = !reloaded
        },
      },
    },
    storage,
    whenControllerChanges: async () => {
      controllerAwaited = true
    },
    reload: () => {
      reloaded = true
    },
  })

  return {
    deletedOldShell: result.deleted.includes('hamster-pwa-shell-v1'),
    hasCurrentShell: stores.has(nextCache),
    oldAssetGone: !stores.has('hamster-pwa-shell-v1'),
    continuity,
    reloaded,
    controllerAwaited,
    messageBeforeReload,
    offeredReload: shouldOfferUpdateReload({ hadController: true, controllerChanged: true }),
    silentFirstControl: !shouldOfferUpdateReload({
      hadController: false,
      controllerChanged: true,
    }),
    nextCache,
    defaultDevCache: SHELL_CACHE,
  }
}
