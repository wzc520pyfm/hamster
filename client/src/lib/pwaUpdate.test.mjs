/**
 * P1 PWA update — unit fixtures against production pwaUpdateCore.ts.
 * Run: node --experimental-strip-types --test client/src/lib/pwaUpdate.test.mjs
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
  isCacheableShellAssetResponse,
} from './pwaUpdateCore.ts'
import { cacheFirstPutDecision } from './pwaSwCache.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..')

test('production module sync: pwaUpdate.ts imports pwaUpdateCore.ts (no duplicate pure.mjs)', () => {
  const ts = fs.readFileSync(path.join(root, 'src/lib/pwaUpdate.ts'), 'utf8')
  assert.match(ts, /from '\.\/pwaUpdateCore'/)
  assert.equal(fs.existsSync(path.join(root, 'src/lib/pwaUpdate.pure.mjs')), false)
  assert.equal(fs.existsSync(path.join(root, 'src/lib/pwaUpdateCore.mjs')), false)
  const core = fs.readFileSync(path.join(root, 'src/lib/pwaUpdateCore.ts'), 'utf8')
  assert.match(core, /export async function applyPwaUpdate/)
  assert.match(core, /export function isCacheableShellAssetResponse/)
})

test('main.tsx registers SW in PROD (ConnectGate path without Shell)', () => {
  const main = fs.readFileSync(path.join(root, 'src/main.tsx'), 'utf8')
  assert.match(main, /registerHamsterServiceWorker/)
  assert.match(main, /import\.meta\.env\.PROD/)
})

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

test('waiting worker does not run activate cleanup (retained assets stay until Reload)', () => {
  const stores = new Map([
    [
      'hamster-pwa-shell-v1',
      new Map([['https://example.test/assets/old.js', 'old-js']]),
    ],
  ])
  assert.equal(stores.has('hamster-pwa-shell-v1'), true)
  assert.equal(stores.get('hamster-pwa-shell-v1').get('https://example.test/assets/old.js'), 'old-js')
  activateShellCacheCleanup(stores, shellCacheNameForBuild('new'))
  assert.equal(stores.has('hamster-pwa-shell-v1'), false)
})

test('stampHamsterPwaBuild: successive deploy ids change sw bytes', () => {
  const template = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8')
  assert.ok(template.includes(HAMSTER_PWA_BUILD_PLACEHOLDER))
  const a = stampHamsterPwaBuild(template, 'aaaaaaaaaaaa')
  const b = stampHamsterPwaBuild(template, 'bbbbbbbbbbbb')
  assert.notEqual(a, b)
  assert.match(a, /HAMSTER_PWA_BUILD = 'aaaaaaaaaaaa'/)
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
})

test('sw.js: no install skipWaiting; SKIP_WAITING message; rejects HTML asset cache', () => {
  const sw = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8')
  assert.ok(sw.includes(HAMSTER_PWA_BUILD_PLACEHOLDER))
  const installMatch = sw.match(/addEventListener\(\s*['"]install['"][\s\S]*?\n\}\);/)
  assert.ok(installMatch)
  assert.equal(/\.skipWaiting\s*\(/.test(installMatch[0]), false)
  assert.match(sw, /function isCacheableShellAssetResponse/)
  assert.match(sw, /text\/html/)
})

test('isCacheableShellAssetResponse rejects HTML poison for /assets/*.js', () => {
  const req = { url: 'https://h.test/assets/index-abc.js', mode: 'cors' }
  const html = {
    ok: true,
    headers: { get: () => 'text/html; charset=utf-8' },
  }
  const js = {
    ok: true,
    headers: { get: () => 'text/javascript; charset=utf-8' },
  }
  assert.equal(isCacheableShellAssetResponse(req, html), false)
  assert.equal(isCacheableShellAssetResponse(req, js), true)
  assert.equal(
    isCacheableShellAssetResponse(req, { ok: false, headers: { get: () => 'text/javascript' } }),
    false,
  )
})

test('cacheFirstPutDecision does not store SPA-fallback HTML under JS URL', () => {
  const cache = new Map()
  const decision = cacheFirstPutDecision({
    cache,
    requestUrl: 'https://h.test/assets/missing-old.js',
    fetchResponse: {
      ok: true,
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html>spa',
    },
    isCacheable: isCacheableShellAssetResponse,
  })
  assert.equal(decision.cached, false)
  assert.equal(cache.has('https://h.test/assets/missing-old.js'), false)
})

test('server: missing /assets/*.js is 404, not SPA HTML; shouldSpaFallback', async () => {
  const { shouldSpaFallback, cacheControlForPath, resolveStaticResponse } = await import(
    '../../server.mjs'
  )
  assert.equal(shouldSpaFallback('/assets/index-missing.js'), false)
  assert.equal(shouldSpaFallback('/sw.js'), false)
  assert.equal(shouldSpaFallback('/conversation'), true)
  assert.equal(shouldSpaFallback('/'), true)
  assert.equal(cacheControlForPath('/sw.js'), 'no-cache')
  assert.equal(cacheControlForPath('/index.html'), 'no-cache')

  const os = await import('node:os')
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'hamster-spa-'))
  fs.writeFileSync(path.join(dist, 'index.html'), '<html>spa</html>')
  fs.mkdirSync(path.join(dist, 'assets'))
  const miss = resolveStaticResponse(dist, '/assets/index-H4-3Ab9F.js')
  assert.equal(miss.status, 404)
  assert.equal(miss.filePath, null)
  const doc = resolveStaticResponse(dist, '/approvals')
  assert.equal(doc.status, 200)
  assert.ok(doc.filePath?.endsWith('index.html'))
  assert.equal(doc.contentType.includes('html'), true)
})

test('shouldOfferUpdateReload + snapshotContinuityStorage', () => {
  assert.equal(shouldOfferUpdateReload({ hadController: true, controllerChanged: true }), true)
  assert.equal(shouldOfferUpdateReload({ hadController: false, controllerChanged: true }), false)
  const snap = snapshotContinuityStorage(memoryStorage({ 'hamster.locale': 'en', noise: 'x' }))
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
