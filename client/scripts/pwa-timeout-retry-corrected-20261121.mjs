#!/usr/bin/env node
/**
 * P1 CORRECTED evidence 2026-11-21 (preserves prior p1-timeout-retry-continuity-20261121/).
 *
 * ENGINEERING_INJECTION — precise claim:
 *   Suppresses controllerchange *notification delivery* to listeners registered via the
 *   wrapped addEventListener (so production waitForControllerChange hits the real 4s
 *   CONTROLLER_CHANGE_TIMEOUT_MS). It does NOT delay, postpone, or block actual SW
 *   activation / SKIP_WAITING / controller replacement. Activation proceeds on the
 *   browser timeline; instrumentation records actualControllerChangeAt via origAdd.
 *
 * No harness-issued SKIP_WAITING after timeout — production Reload already posted it.
 * Late activation is observed (waiting gone), not aided by an extra helper.
 *
 * Proves: same document (nonce) through timeout+retry UI; exactly one user-triggered
 * navigation on Retry; NEW bundle B JS actually executed after that navigation.
 *
 * Run: node client/scripts/pwa-timeout-retry-corrected-20261121.mjs
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { shouldSpaFallback, cacheControlForPath } from '../server.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.join(__dirname, '../..')
const CLIENT = path.join(REPO, 'client')
const WORK = '/tmp/hamster-pwa-timeout-retry-corrected-20261121'
const DIST_A = path.join(WORK, 'dist-a')
const DIST_B = path.join(WORK, 'dist-b')
const SERVE = path.join(WORK, 'serve')
const EVIDENCE_REPO = path.join(REPO, 'docs/evidence/p1-timeout-retry-corrected-20261121')
const EVIDENCE_RAW = '/opt/cursor/artifacts/p1-timeout-retry-corrected-20261121'
const BUNDLE_B_MARKER = 'bundle-B-evidence-20261121'

const FIXTURE_CONVERSATION = {
  conversationId: 'conv_fixture_p1_corrected_20261121',
  title: '[FIXTURE-LABELLED] corrected timeout-retry (not React persistence)',
  createdAt: '2026-11-21T00:00:00.000Z',
  fixture: true,
  fixtureLabel: 'local-test-api-seed-not-react-persistence',
}

function sh(cmd, opts = {}) {
  const r = spawnSync(cmd, {
    shell: true,
    encoding: 'utf8',
    cwd: opts.cwd || REPO,
    env: { ...process.env, ...(opts.env || {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (r.status !== 0) throw new Error(`${cmd}\n${r.stdout}\n${r.stderr}`)
  return r.stdout
}

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true })
}

function ensureDirs() {
  fs.mkdirSync(EVIDENCE_REPO, { recursive: true })
  fs.mkdirSync(EVIDENCE_RAW, { recursive: true })
  fs.mkdirSync(WORK, { recursive: true })
}

function readBuildId(dist) {
  return fs
    .readFileSync(path.join(dist, 'sw.js'), 'utf8')
    .match(/HAMSTER_PWA_BUILD = '([a-f0-9]+)'/)?.[1]
}

function buildPair() {
  sh('npm run build', { cwd: CLIENT })
  rmrf(DIST_A)
  fs.cpSync(path.join(CLIENT, 'dist'), DIST_A, { recursive: true })
  const markerPath = path.join(CLIENT, 'src/i18n/messages.ts')
  const original = fs.readFileSync(markerPath, 'utf8')
  let patched = original.replace(
    "updateAvailable: 'A new version of Hamster is available.'",
    "updateAvailable: 'A new version of Hamster is available. (retry-evidence-B)'",
  )
  // Patch BOTH en+zh preview strings so visible UI proves bundle B after Retry in either locale.
  const previewReplaced = patched.split("preview: 'Private preview',").join(
    `preview: 'Private preview · ${BUNDLE_B_MARKER}',`,
  )
  if (previewReplaced === patched) throw new Error('could not patch preview markers for deploy B')
  patched = previewReplaced
  if (patched === original) throw new Error('could not patch messages for deploy B')
  if (!patched.includes(BUNDLE_B_MARKER)) throw new Error('bundle B marker missing from patch')
  if ((patched.match(new RegExp(BUNDLE_B_MARKER, 'g')) || []).length < 2) {
    throw new Error('expected bundle B marker in both en and zh preview')
  }
  try {
    fs.writeFileSync(markerPath, patched)
    sh('npm run build', { cwd: CLIENT })
    rmrf(DIST_B)
    fs.cpSync(path.join(CLIENT, 'dist'), DIST_B, { recursive: true })
  } finally {
    fs.writeFileSync(markerPath, original)
  }
  const idA = readBuildId(DIST_A)
  const idB = readBuildId(DIST_B)
  if (!idA || !idB || idA === idB) throw new Error(`build ids must differ: ${idA} vs ${idB}`)
  const bJs = fs
    .readdirSync(path.join(DIST_B, 'assets'))
    .filter((f) => f.endsWith('.js'))
    .map((f) => fs.readFileSync(path.join(DIST_B, 'assets', f), 'utf8'))
    .join('\n')
  if (!bJs.includes(BUNDLE_B_MARKER)) throw new Error('DIST_B assets missing bundle B marker string')
  return { idA, idB, bundleBMarker: BUNDLE_B_MARKER }
}

function syncServe(dist) {
  rmrf(SERVE)
  fs.cpSync(dist, SERVE, { recursive: true })
}

function startFixtureApi() {
  const hits = []
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    hits.push({ method: req.method, path: url.pathname, at: Date.now() })
    res.setHeader('content-type', 'application/json')
    if (url.pathname === '/api/health') {
      res.end(JSON.stringify({ status: 'ok', fixture: true, fixtureLabel: 'local-test-api' }))
      return
    }
    if (url.pathname === '/api/conversations/current') {
      res.end(JSON.stringify(FIXTURE_CONVERSATION))
      return
    }
    if (url.pathname.startsWith('/api/conversations/') && url.pathname.endsWith('/timeline')) {
      res.end(
        JSON.stringify({
          conversationId: FIXTURE_CONVERSATION.conversationId,
          messages: [
            {
              id: 'msg_fixture_1',
              role: 'assistant',
              content:
                '[FIXTURE-LABELLED] canned timeline row — server seed, not offline SW store',
              createdAt: FIXTURE_CONVERSATION.createdAt,
            },
          ],
          tasks: [],
          approvals: [],
        }),
      )
      return
    }
    if (url.pathname === '/api/approvals' || url.pathname.startsWith('/api/approvals')) {
      res.end(JSON.stringify([]))
      return
    }
    if (url.pathname === '/api/targets') {
      res.end(
        JSON.stringify({
          targets: [
            {
              targetId: 'target_control_plane',
              label: 'Control plane',
              isDefault: true,
              available: true,
              state: 'ok',
            },
            {
              targetId: 'target_isolated_desktop',
              label: 'Isolated desktop',
              isDefault: false,
              available: false,
              state: 'unavailable',
              unavailableReason: 'fixture-no-docker',
            },
          ],
        }),
      )
      return
    }
    if (url.pathname.startsWith('/api/')) {
      res.end(JSON.stringify({ ok: true, fixture: true }))
      return
    }
    res.writeHead(404)
    res.end('{}')
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        hits,
      })
    })
  })
}

function startStaticWithApiProxy(apiBase) {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
    if (urlPath.startsWith('/api/') || urlPath === '/health') {
      const upstream = new URL(urlPath + (req.url?.includes('?') ? '?' + req.url.split('?')[1] : ''), apiBase)
      const headers = { ...req.headers, host: upstream.host }
      const proxyReq = http.request(
        upstream,
        { method: req.method, headers },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode || 502, proxyRes.headers)
          proxyRes.pipe(res)
        },
      )
      proxyReq.on('error', (err) => {
        res.writeHead(502)
        res.end(String(err))
      })
      req.pipe(proxyReq)
      return
    }
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '')
    const filePath = path.join(SERVE, rel)
    const exists = filePath.startsWith(SERVE) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()
    if (!exists) {
      if (!shouldSpaFallback(urlPath)) {
        res.writeHead(404, { 'content-type': 'text/plain', 'cache-control': 'no-cache' })
        res.end('not found')
        return
      }
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': cacheControlForPath('index.html'),
      })
      fs.createReadStream(path.join(SERVE, 'index.html')).pipe(res)
      return
    }
    res.writeHead(200, {
      'content-type': filePath.endsWith('.js')
        ? 'text/javascript; charset=utf-8'
        : filePath.endsWith('.css')
          ? 'text/css; charset=utf-8'
          : filePath.endsWith('.html')
            ? 'text/html; charset=utf-8'
            : 'application/octet-stream',
      'cache-control': cacheControlForPath(filePath),
    })
    fs.createReadStream(filePath).pipe(res)
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, origin: `http://127.0.0.1:${server.address().port}` })
    })
  })
}

async function snapAllHamsterStorage(page) {
  return page.evaluate(() => {
    const out = {}
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k) continue
      if (k.startsWith('hamster.') || k.includes('conversation') || k.includes('locale')) {
        out[k] = localStorage.getItem(k)
      }
    }
    return out
  })
}

function pushStep(evidence, step) {
  if (typeof step.ok !== 'boolean') throw new Error(`step ${step.step} missing boolean ok`)
  evidence.steps.push({ ...step, at: new Date().toISOString() })
  if (!step.ok) throw new Error(`step failed: ${step.step} ${JSON.stringify(step)}`)
}

async function waitControlled(page) {
  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), null, {
    timeout: 60000,
  })
}

async function triggerSwUpdate(page) {
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration()
    await reg?.update()
    window.dispatchEvent(new Event('focus'))
  })
}

async function clickVisibleLocale(page, testId) {
  // Mobile header (md:hidden) + desktop sidebar (md:flex) both mount the control;
  // prefer the last match (sidebar) at desktop viewport, fall back to any visible.
  const all = page.locator(`[data-testid="${testId}"]`)
  const count = await all.count()
  for (let i = count - 1; i >= 0; i--) {
    if (await all.nth(i).isVisible()) {
      await all.nth(i).click()
      return
    }
  }
  // Last resort: force sidebar control (index 1 when both exist)
  await all.nth(Math.max(0, count - 1)).click({ force: true })
}

async function stampDocument(page) {
  return page.evaluate(() => {
    const nonce = crypto.randomUUID()
    window.__HAMSTER_DOC = {
      nonce,
      stampedAt: Date.now(),
      label: 'same-document-probe',
    }
    return window.__HAMSTER_DOC
  })
}

async function readDocumentStamp(page) {
  return page.evaluate(() => window.__HAMSTER_DOC || null)
}

async function readInjection(page) {
  return page.evaluate(() => window.__HAMSTER_EVIDENCE_INJECTION || null)
}

async function observeSw(page) {
  return page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration()
    return {
      hasWaiting: Boolean(reg?.waiting),
      hasInstalling: Boolean(reg?.installing),
      controller: navigator.serviceWorker.controller?.scriptURL || null,
      active: reg?.active?.scriptURL || null,
      same:
        Boolean(navigator.serviceWorker.controller) &&
        navigator.serviceWorker.controller?.scriptURL === reg?.active?.scriptURL,
    }
  })
}

async function assertBundleBExecuted(page, idB, marker) {
  return page.evaluate(
    async ({ idB, marker }) => {
      const body = document.body?.innerText || ''
      const previewHit = body.includes(marker)
      const swText = await fetch('/sw.js', { cache: 'no-store' }).then((r) => r.text())
      const swBuild = swText.match(/HAMSTER_PWA_BUILD = '([a-f0-9]+)'/)?.[1] || null
      const scripts = [...document.querySelectorAll('script[src]')]
        .map((s) => s.getAttribute('src'))
        .filter(Boolean)
      let assetHit = false
      let assetUrl = null
      for (const src of scripts) {
        if (!src.includes('/assets/')) continue
        const t = await fetch(src, { cache: 'no-store' }).then((r) => r.text())
        if (t.includes(marker)) {
          assetHit = true
          assetUrl = src
          break
        }
      }
      return {
        previewHit,
        swBuild,
        swBuildMatchesIdB: swBuild === idB,
        assetHit,
        assetUrl,
        controller: navigator.serviceWorker.controller?.scriptURL || null,
      }
    },
    { idB, marker },
  )
}

async function main() {
  ensureDirs()
  const evidence = {
    at: new Date().toISOString(),
    kind: 'p1_timeout_retry_corrected',
    preservesPriorEvidence: 'docs/evidence/p1-timeout-retry-continuity-20261121/',
    notBoxPhone: true,
    notLiveOrigin: true,
    engineeringInjection: {
      label: 'ENGINEERING_INJECTION',
      preciseClaim:
        'Suppresses controllerchange NOTIFICATION to wrapped addEventListener listeners only. Does NOT delay/postpone/block actual service worker activation, SKIP_WAITING handling, or controller replacement. Production Reload posts SKIP_WAITING; activation proceeds on browser timeline. Instrumentation records actualControllerChangeAt via unwrapped origAdd.',
      notClaimed: [
        'injection delayed activation',
        'harness post-timeout SKIP_WAITING aided late activation',
      ],
    },
    steps: [],
    mainFrameNavigations: [],
    pass: false,
  }

  const builds = buildPair()
  evidence.builds = builds

  const fixture = await startFixtureApi()
  syncServe(DIST_A)
  const { server, origin } = await startStaticWithApiProxy(fixture.baseUrl)
  evidence.origin = origin
  evidence.fixtureApi = fixture.baseUrl

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const page = await context.newPage()

  const mainNavs = evidence.mainFrameNavigations
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      mainNavs.push({ at: new Date().toISOString(), url: frame.url() })
    }
  })

  try {
    await page.goto(origin + '/', { waitUntil: 'networkidle' })
    await waitControlled(page)
    await clickVisibleLocale(page, 'locale-zh')
    await page.waitForTimeout(200)

    const doc0 = await stampDocument(page)
    const navAfterLoad = mainNavs.length
    // Chromium may emit >1 main-frame navigations (about:blank → origin); baseline is whatever
    // count we have after controlled load — later steps assert no further nav until Retry.
    const navBaseline = navAfterLoad
    evidence.navBaseline = navBaseline
    pushStep(evidence, {
      step: 'initial_document_stamped',
      doc0,
      navAfterLoad,
      ok: Boolean(doc0?.nonce) && navAfterLoad >= 1,
    })

    syncServe(DIST_B)
    await triggerSwUpdate(page)
    await page.waitForSelector('[data-testid="pwa-update-banner"]', { timeout: 65000 })

    await clickVisibleLocale(page, 'locale-en')
    await page.waitForTimeout(150)
    const enPng = 'corrected-banner-en-20261121.png'
    await page.screenshot({ path: path.join(EVIDENCE_REPO, enPng), fullPage: false })
    fs.copyFileSync(path.join(EVIDENCE_REPO, enPng), path.join(EVIDENCE_RAW, enPng))
    const enText = await page.locator('[data-testid="pwa-update-banner"]').innerText()
    pushStep(evidence, {
      step: 'banner_en_png',
      png: enPng,
      enText: enText.slice(0, 160),
      ok: /new version|available|Reload/i.test(enText),
    })

    await clickVisibleLocale(page, 'locale-zh')
    await page.waitForTimeout(150)
    const zhPng = 'corrected-banner-zh-20261121.png'
    await page.screenshot({ path: path.join(EVIDENCE_REPO, zhPng), fullPage: false })
    fs.copyFileSync(path.join(EVIDENCE_REPO, zhPng), path.join(EVIDENCE_RAW, zhPng))
    const zhText = await page.locator('[data-testid="pwa-update-banner"]').innerText()
    pushStep(evidence, {
      step: 'banner_zh_png',
      png: zhPng,
      zhText: zhText.slice(0, 160),
      ok: /新|可用|重新|加载/.test(zhText),
    })

    // ENGINEERING_INJECTION: notification suppress only; instrument activation via origAdd
    await page.evaluate(() => {
      const until = Date.now() + 5500
      const sw = navigator.serviceWorker
      const origAdd = sw.addEventListener.bind(sw)
      const origRemove = sw.removeEventListener.bind(sw)
      const wrapMap = new WeakMap()
      window.__HAMSTER_EVIDENCE_INJECTION = {
        label: 'ENGINEERING_INJECTION',
        purpose: 'suppress_controllerchange_NOTIFICATION_only_not_activation',
        preciseClaim:
          'Does not delay actual SW activation; only suppresses notification to wrapped listeners',
        blockNotifyUntil: until,
        suppressedCount: 0,
        actualControllerChangeAt: null,
        actualControllerChangeObserved: false,
        controllerScriptURLAtChange: null,
        harnessExtraSkipWaiting: false,
      }
      // Unwrapped instrumentation — sees real controllerchange timing
      origAdd('controllerchange', () => {
        const m = window.__HAMSTER_EVIDENCE_INJECTION
        if (!m || m.actualControllerChangeObserved) return
        m.actualControllerChangeObserved = true
        m.actualControllerChangeAt = Date.now()
        m.controllerScriptURLAtChange = navigator.serviceWorker.controller?.scriptURL || null
      })
      sw.addEventListener = function (type, listener, options) {
        if (type === 'controllerchange' && typeof listener === 'function') {
          const wrapped = function (...args) {
            const meta = window.__HAMSTER_EVIDENCE_INJECTION
            if (meta && Date.now() < meta.blockNotifyUntil) {
              meta.suppressedCount += 1
              return
            }
            return listener.apply(this, args)
          }
          wrapMap.set(listener, wrapped)
          return origAdd(type, wrapped, options)
        }
        return origAdd(type, listener, options)
      }
      sw.removeEventListener = function (type, listener, options) {
        const wrapped = wrapMap.get(listener) || listener
        return origRemove(type, wrapped, options)
      }
    })
    evidence.engineeringInjection.appliedAt = new Date().toISOString()

    const navBeforeReloadClick = mainNavs.length
    await page.click('[data-testid="pwa-update-reload"]')
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="pwa-update-banner"]')
        const t = el?.innerText || ''
        return /未完成|Try Reload|再次|did not finish/i.test(t)
      },
      null,
      { timeout: 15000 },
    )

    const docAfterTimeout = await readDocumentStamp(page)
    const injectionAfterTimeout = await readInjection(page)
    const swAfterTimeout = await observeSw(page)
    const retryText = await page.locator('[data-testid="pwa-update-banner"]').innerText()
    const retryPng = 'corrected-timeout-retry-state-zh-20261121.png'
    await page.screenshot({ path: path.join(EVIDENCE_REPO, retryPng), fullPage: false })
    fs.copyFileSync(path.join(EVIDENCE_REPO, retryPng), path.join(EVIDENCE_RAW, retryPng))

    pushStep(evidence, {
      step: 'timeout_same_document_retry_ui_activation_may_already_be_done',
      docAfterTimeout,
      sameDocumentNonce: docAfterTimeout?.nonce === doc0.nonce,
      navCount: mainNavs.length,
      navUnchangedSinceBaseline: mainNavs.length === navBaseline,
      navUnchangedSinceReloadClick: mainNavs.length === navBeforeReloadClick,
      retryText: retryText.slice(0, 200),
      injectionAfterTimeout,
      swAfterTimeout,
      png: retryPng,
      note: 'Injection only suppressed notify; actualControllerChangeAt may be <= timeout wall clock while production wait timed out',
      ok:
        docAfterTimeout?.nonce === doc0.nonce &&
        mainNavs.length === navBeforeReloadClick &&
        mainNavs.length === navBaseline &&
        /未完成|Try Reload|再次|did not finish/i.test(retryText) &&
        (injectionAfterTimeout?.suppressedCount ?? 0) >= 1 &&
        injectionAfterTimeout?.harnessExtraSkipWaiting === false,
    })

    // Observe late/already activation — NO harness SKIP_WAITING
    await page.evaluate(() => {
      if (window.__HAMSTER_EVIDENCE_INJECTION) {
        window.__HAMSTER_EVIDENCE_INJECTION.blockNotifyUntil = 0
        window.__HAMSTER_EVIDENCE_INJECTION.phase = 'observe_only_no_harness_skip_waiting'
      }
    })
    // Poll until waiting gone (production Reload already posted SKIP_WAITING)
    await page.waitForFunction(
      async () => {
        const reg = await navigator.serviceWorker.getRegistration()
        return Boolean(reg?.active) && !reg?.waiting
      },
      null,
      { timeout: 15000 },
    )
    await page.waitForTimeout(200)
    const injectionLate = await readInjection(page)
    const swLate = await observeSw(page)
    const docLate = await readDocumentStamp(page)
    pushStep(evidence, {
      step: 'activation_observed_unaided_no_harness_skip_waiting',
      swLate,
      injectionLate,
      docLate,
      sameDocumentStill: docLate?.nonce === doc0.nonce,
      navCount: mainNavs.length,
      ok:
        swLate.hasWaiting === false &&
        swLate.same === true &&
        injectionLate?.harnessExtraSkipWaiting === false &&
        docLate?.nonce === doc0.nonce &&
        mainNavs.length === navBaseline &&
        (injectionLate?.actualControllerChangeObserved === true || swLate.same === true),
      note: 'No extra reg.waiting.postMessage(SKIP_WAITING) from harness after timeout',
    })

    // Explicit user Retry — exactly one new navigation; bundle B must execute
    const navBeforeRetry = mainNavs.length
    const navPromise = page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 })
    await page.click('[data-testid="pwa-update-reload"]')
    await navPromise
    const navAfterRetry = mainNavs.length
    const docAfterRetry = await readDocumentStamp(page)
    const bundleCheck = await assertBundleBExecuted(page, builds.idB, BUNDLE_B_MARKER)
    const storageAfterRetry = await snapAllHamsterStorage(page)

    pushStep(evidence, {
      step: 'user_retry_one_navigation_new_bundle_B_executed',
      navBeforeRetry,
      navAfterRetry,
      navBaseline,
      exactlyOneNewNav: navAfterRetry === navBeforeRetry + 1,
      docAfterRetry,
      documentNonceChanged: docAfterRetry?.nonce !== doc0.nonce,
      newDocument: docAfterRetry == null || docAfterRetry.nonce !== doc0.nonce,
      bundleCheck,
      storageAfterRetry,
      ok:
        navAfterRetry === navBeforeRetry + 1 &&
        navAfterRetry === navBaseline + 1 &&
        (docAfterRetry == null || docAfterRetry.nonce !== doc0.nonce) &&
        bundleCheck.previewHit === true &&
        bundleCheck.assetHit === true &&
        bundleCheck.swBuildMatchesIdB === true &&
        storageAfterRetry['hamster.locale'] === 'zh' &&
        storageAfterRetry['hamster.controlBase'] === origin,
    })

    evidence.pass = evidence.steps.every((s) => s.ok === true)
  } catch (err) {
    evidence.error = String(err?.stack || err)
    evidence.pass = false
  } finally {
    await browser.close()
    server.close()
    fixture.server.close()
  }

  const pngs = [
    'corrected-banner-en-20261121.png',
    'corrected-banner-zh-20261121.png',
    'corrected-timeout-retry-state-zh-20261121.png',
  ]
  const hashes = {}
  for (const name of pngs) {
    const p = path.join(EVIDENCE_RAW, name)
    if (fs.existsSync(p)) {
      hashes[name] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
    }
  }
  evidence.pngSha256 = hashes

  const jsonName = 'timeout-retry-corrected-20261121.json'
  fs.writeFileSync(path.join(EVIDENCE_REPO, jsonName), JSON.stringify(evidence, null, 2))
  fs.writeFileSync(path.join(EVIDENCE_RAW, jsonName), JSON.stringify(evidence, null, 2))

  const md = `# P1 timeout→Retry CORRECTED claims (2026-11-21)

Preserves prior evidence at \`docs/evidence/p1-timeout-retry-continuity-20261121/\` (unchanged).

pass=${evidence.pass}

## ENGINEERING_INJECTION (corrected)

Suppresses \`controllerchange\` **notification** to wrapped listeners so production
\`waitForControllerChange\` (4s) times out. **Does not** delay actual SW activation.
No harness \`SKIP_WAITING\` after timeout — production Reload already posted it;
activation observed unaided. \`actualControllerChangeAt\` recorded via unwrapped \`origAdd\`.

## Navigation / bundle B

- Same document (nonce) through timeout + retry UI (nav count stays 1)
- Explicit user Retry → exactly one new main-frame navigation
- After Retry: visible \`${BUNDLE_B_MARKER}\`, asset JS contains marker, sw build = idB

## PNG SHA-256

${Object.entries(hashes)
  .map(([k, v]) => `- \`${k}\`: \`${v}\``)
  .join('\n')}

## Untested

- Phone / mobile
- Full offline conversation history (PRODUCT BOUNDARY — locale/controlBase only)
- Docker / live origin
`

  fs.writeFileSync(path.join(EVIDENCE_REPO, 'NOTES.md'), md)
  fs.writeFileSync(path.join(EVIDENCE_RAW, 'NOTES.md'), md)

  const sumLines = []
  for (const f of fs.readdirSync(EVIDENCE_RAW)) {
    const p = path.join(EVIDENCE_RAW, f)
    if (fs.statSync(p).isFile()) {
      sumLines.push(
        `${crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')}  ${f}`,
      )
    }
  }
  fs.writeFileSync(path.join(EVIDENCE_RAW, 'SHA256SUMS.txt'), sumLines.join('\n') + '\n')
  fs.copyFileSync(path.join(EVIDENCE_RAW, 'SHA256SUMS.txt'), path.join(EVIDENCE_REPO, 'SHA256SUMS.txt'))

  console.log(
    JSON.stringify(
      {
        pass: evidence.pass,
        evidenceRaw: EVIDENCE_RAW,
        evidenceRepo: EVIDENCE_REPO,
        steps: evidence.steps.map((s) => ({ step: s.step, ok: s.ok })),
        pngSha256: hashes,
        error: evidence.error || null,
      },
      null,
      2,
    ),
  )
  if (!evidence.pass) process.exitCode = 1
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
