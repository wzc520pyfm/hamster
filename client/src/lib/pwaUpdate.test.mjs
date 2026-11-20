/**
 * P1 PWA update reliability — old deployed SW/cache → new version fixture.
 * Run: node --test client/src/lib/pwaUpdate.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  SHELL_CACHE,
  SHELL_CACHE_PREFIX,
  shellCachesToDelete,
  activateShellCacheCleanup,
} from './pwaShellCache.mjs'
import {
  SW_REGISTER_OPTIONS,
  shouldOfferUpdateReload,
  snapshotContinuityStorage,
  applyPwaUpdate,
  runOldToNewUpgradeFixture,
} from './pwaUpdate.pure.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..')

test('register options bypass HTTP cache for sw.js updates', () => {
  assert.equal(SW_REGISTER_OPTIONS.updateViaCache, 'none')
})

test('shell cache version left fixed v1 (regression guard is v2+)', () => {
  assert.equal(SHELL_CACHE.startsWith(SHELL_CACHE_PREFIX), true)
  assert.notEqual(SHELL_CACHE, 'hamster-pwa-shell-v1')
})

test('activate deletes prior shell caches but keeps current', () => {
  const del = shellCachesToDelete(
    ['hamster-pwa-shell-v1', SHELL_CACHE, 'other-cache', 'hamster-pwa-shell-v0'],
    SHELL_CACHE,
  )
  assert.deepEqual(del.sort(), ['hamster-pwa-shell-v0', 'hamster-pwa-shell-v1'].sort())
})

test('old→new fixture: old hashed assets drop; continuity keys survive; reload is user-driven', () => {
  const stores = new Map([
    [
      'hamster-pwa-shell-v1',
      new Map([
        ['https://example.test/', 'old-html'],
        ['https://example.test/assets/index-DqKaLRWz.js', 'old-js'],
      ]),
    ],
  ])
  const cleanup = activateShellCacheCleanup(stores, SHELL_CACHE)
  assert.ok(cleanup.deleted.includes('hamster-pwa-shell-v1'))
  assert.equal(stores.has('hamster-pwa-shell-v1'), false)
  assert.equal(stores.has(SHELL_CACHE), true)

  const storage = memoryStorage({
    'hamster.controlBase': 'https://example.test',
    'hamster.locale': 'zh',
  })
  const snap = snapshotContinuityStorage(storage)
  assert.equal(snap['hamster.controlBase'], 'https://example.test')
  assert.equal(snap['hamster.locale'], 'zh')

  let reloads = 0
  applyPwaUpdate({
    registration: { waiting: { postMessage() {} } },
    storage,
    reload: () => {
      reloads += 1
    },
  })
  assert.equal(reloads, 1)
  assert.equal(storage.getItem('hamster.controlBase'), 'https://example.test')
  assert.equal(storage.getItem('hamster.locale'), 'zh')

  assert.equal(shouldOfferUpdateReload({ hadController: true, controllerChanged: true }), true)
  assert.equal(shouldOfferUpdateReload({ hadController: false, controllerChanged: true }), false)
})

test('integrated old→new upgrade fixture models meaningful lifecycle', () => {
  const out = runOldToNewUpgradeFixture()
  assert.equal(out.deletedOldShell, true)
  assert.equal(out.oldAssetGone, true)
  assert.equal(out.hasCurrentShell, true)
  assert.equal(out.reloaded, true)
  assert.equal(out.offeredReload, true)
  assert.equal(out.silentFirstControl, true)
  assert.equal(out.continuity['hamster.controlBase'], 'https://hamster.example')
})

test('sw.js mirrors shell cache version and activate cleanup', () => {
  const sw = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8')
  assert.match(sw, new RegExp(SHELL_CACHE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(sw, /caches\.keys/)
  assert.match(sw, /caches\.delete/)
  assert.match(sw, /SKIP_WAITING/)
  assert.equal(sw.includes('hamster-pwa-shell-v1'), false)
})

test('server serves sw.js with no-cache (not max-age=3600)', async () => {
  const { cacheControlForPath } = await import('../../server.mjs')
  assert.equal(cacheControlForPath('/sw.js'), 'no-cache')
  assert.equal(cacheControlForPath('/index.html'), 'no-cache')
  assert.equal(cacheControlForPath('/assets/index-C3ESqCyk.js'), 'public, max-age=3600')
})

function memoryStorage(seed = {}) {
  const data = new Map(Object.entries(seed))
  return {
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
}
