/**
 * P1 PWA update reliability — unit fixtures (not full-app evidence).
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
  shellCacheNameForBuild,
} from './pwaShellCache.mjs'
import {
  HAMSTER_PWA_BUILD_PLACEHOLDER,
  stampHamsterPwaBuild,
  deployIdFromAssetNames,
} from './pwaBuildStamp.mjs'
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

test('shell cache uses deploy-id suffix (not fixed v1)', () => {
  assert.equal(SHELL_CACHE.startsWith(SHELL_CACHE_PREFIX + '-'), true)
  assert.notEqual(SHELL_CACHE, 'hamster-pwa-shell-v1')
  assert.notEqual(shellCacheNameForBuild('aaa'), shellCacheNameForBuild('bbb'))
})

test('activate deletes prior shell caches but keeps current', () => {
  const current = shellCacheNameForBuild('deploy9')
  const del = shellCachesToDelete(
    ['hamster-pwa-shell-v1', current, 'other-cache', 'hamster-pwa-shell-v0'],
    current,
  )
  assert.deepEqual(del.sort(), ['hamster-pwa-shell-v0', 'hamster-pwa-shell-v1'].sort())
})

test('stampHamsterPwaBuild: successive deploy ids change sw bytes', () => {
  const template = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8')
  assert.ok(template.includes(HAMSTER_PWA_BUILD_PLACEHOLDER))
  const a = stampHamsterPwaBuild(template, 'aaaaaaaaaaaa')
  const b = stampHamsterPwaBuild(template, 'bbbbbbbbbbbb')
  assert.notEqual(a, b)
  assert.match(a, /HAMSTER_PWA_BUILD = 'aaaaaaaaaaaa'/)
  assert.match(b, /HAMSTER_PWA_BUILD = 'bbbbbbbbbbbb'/)
  assert.match(a, /SHELL_CACHE = 'hamster-pwa-shell-' \+ HAMSTER_PWA_BUILD/)
  assert.equal(a.includes(HAMSTER_PWA_BUILD_PLACEHOLDER), false)
  // Bundle-only deploy identity: different asset names ⇒ different stamp
  assert.notEqual(
    deployIdFromAssetNames(['index-DqKaLRWz.js', 'index.css']),
    deployIdFromAssetNames(['index-C3ESqCyk.js', 'index.css']),
  )
})

test('applyPwaUpdate awaits controllerchange before reload; preserves continuity', async () => {
  const storage = memoryStorage({
    'hamster.controlBase': 'https://example.test',
    'hamster.locale': 'zh',
    'hamster.conversation.demo': '{"id":"c"}',
  })
  const order = []
  await applyPwaUpdate({
    registration: {
      waiting: {
        postMessage() {
          order.push('message')
        },
      },
    },
    storage,
    whenControllerChanges: () =>
      new Promise((resolve) => {
        order.push('wait-armed')
        queueMicrotask(() => {
          order.push('controllerchange')
          resolve(undefined)
        })
      }),
    reload: () => {
      order.push('reload')
    },
  })
  assert.deepEqual(order, ['wait-armed', 'message', 'controllerchange', 'reload'])
  assert.equal(storage.getItem('hamster.locale'), 'zh')
  assert.equal(storage.getItem('hamster.conversation.demo'), '{"id":"c"}')
})

test('old→new cache cleanup + reload awaits controller; continuity survives', async () => {
  const out = await runOldToNewUpgradeFixture()
  assert.equal(out.deletedOldShell, true)
  assert.equal(out.oldAssetGone, true)
  assert.equal(out.hasCurrentShell, true)
  assert.equal(out.reloaded, true)
  assert.equal(out.controllerAwaited, true)
  assert.equal(out.messageBeforeReload, true)
  assert.equal(out.offeredReload, true)
  assert.equal(out.silentFirstControl, true)
  assert.equal(out.continuity['hamster.controlBase'], 'https://hamster.example')
})

test('sw.js: no install skipWaiting; SKIP_WAITING message; build placeholder; cleanup', () => {
  const sw = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8')
  assert.ok(sw.includes(HAMSTER_PWA_BUILD_PLACEHOLDER))
  assert.match(sw, /caches\.keys/)
  assert.match(sw, /caches\.delete/)
  assert.match(sw, /SKIP_WAITING/)
  assert.equal(sw.includes('hamster-pwa-shell-v1'), false)
  const installMatch = sw.match(/addEventListener\(\s*['"]install['"][\s\S]*?\n\}\);/)
  assert.ok(installMatch, 'install listener present')
  assert.equal(/\.skipWaiting\s*\(/.test(installMatch[0]), false)
  assert.match(sw, /addEventListener\(\s*['"]message['"][\s\S]*\.skipWaiting\s*\(/)
})

test('server serves sw.js with no-cache (not max-age=3600)', async () => {
  const { cacheControlForPath } = await import('../../server.mjs')
  assert.equal(cacheControlForPath('/sw.js'), 'no-cache')
  assert.equal(cacheControlForPath('/index.html'), 'no-cache')
  assert.equal(cacheControlForPath('/assets/index-C3ESqCyk.js'), 'public, max-age=3600')
})

test('shouldOfferUpdateReload: only after prior controller', () => {
  assert.equal(shouldOfferUpdateReload({ hadController: true, controllerChanged: true }), true)
  assert.equal(shouldOfferUpdateReload({ hadController: false, controllerChanged: true }), false)
})

test('snapshotContinuityStorage keeps hamster.* keys', () => {
  const snap = snapshotContinuityStorage(
    memoryStorage({
      'hamster.locale': 'en',
      noise: 'x',
    }),
  )
  assert.equal(snap['hamster.locale'], 'en')
  assert.equal(snap.noise, undefined)
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
