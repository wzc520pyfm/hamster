#!/usr/bin/env node
/**
 * P1 evidence 2026-11-21: timeout → late controller → explicit user Retry
 * on isolated VM localhost with real PROD React build + Playwright Chromium.
 *
 * Persistence boundaries (from source — not invented):
 *   React-written localStorage: hamster.locale (i18n/storage.ts), hamster.controlBase (App.tsx)
 *   Server-only (API): conversationId, title, timeline/messages — App holds conversationId in
 *     React state from GET /api/conversations/current; NO hamster.conversation.* localStorage write
 *     exists in client/src. Offline cannot prove message history without server.
 *
 * ENGINEERING INJECTION (explicitly labelled): suppress controllerchange briefly so the
 * production CONTROLLER_CHANGE_TIMEOUT_MS path times out; late activation then Retry uses
 * production PwaUpdateBanner → applyHamsterPwaUpdate → applyPwaUpdate (already_controlling).
 *
 * Fixture API supplies clearly labelled conversation JSON — distinguished from React-written
 * persistence. Offline step must NOT treat a server roundtrip as offline proof.
 *
 * Run: node client/scripts/pwa-timeout-retry-continuity-20261121.mjs
 * VM only. Not box/phone. No live origin. No Docker. No paid providers.
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
const WORK = '/tmp/hamster-pwa-timeout-retry-20261121'
const DIST_A = path.join(WORK, 'dist-a')
const DIST_B = path.join(WORK, 'dist-b')
const SERVE = path.join(WORK, 'serve')
const EVIDENCE_REPO = path.join(REPO, 'docs/evidence/p1-timeout-retry-continuity-20261121')
const EVIDENCE_RAW = '/opt/cursor/artifacts/p1-timeout-retry-continuity-20261121'

const FIXTURE_CONVERSATION = {
  conversationId: 'conv_fixture_p1_20261121',
  title: '[FIXTURE-LABELLED] P1 timeout-retry continuity conversation',
  createdAt: '2026-11-21T00:00:00.000Z',
  fixture: true,
  fixtureLabel: 'local-test-api-seed-not-react-persistence',
}

const PERSISTENCE_BOUNDARIES = {
  fromSource: [
    {
      key: 'hamster.locale',
      writer: 'client/src/i18n/storage.ts storeLocale via LocaleContext.setLocale / Shell locale buttons',
      kind: 'react_written_localStorage',
    },
    {
      key: 'hamster.controlBase',
      writer: 'client/src/App.tsx on successful api.currentConversation mount',
      kind: 'react_written_localStorage',
    },
  ],
  notWrittenByReact: [
    {
      keyPattern: 'hamster.conversation.*',
      note: 'No localStorage.setItem for conversation payloads in client/src — prior lifecycle CONTINUITY.demo keys were test seeds, not app persistence',
    },
  ],
  serverOnly: [
    'conversationId / title (GET /api/conversations/current → React state)',
    'timeline / messages (GET /api/conversations/:id/timeline)',
    'approvals list',
  ],
  offlineExpectation:
    'Shell HTML+JS may load from SW cache; conversation content requires API — expect connection error / empty timeline offline, not full history',
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
  const patched = original.replace(
    "updateAvailable: 'A new version of Hamster is available.'",
    "updateAvailable: 'A new version of Hamster is available. (retry-evidence-B)'",
  )
  if (patched === original) throw new Error('could not patch messages for deploy B')
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
  return { idA, idB }
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
          title: FIXTURE_CONVERSATION.title,
          messages: [
            {
              id: '1',
              role: 'assistant',
              content: '[FIXTURE-LABELLED] canned timeline row — server seed, not offline SW store',
              meta: { fixture: true },
              createdAt: FIXTURE_CONVERSATION.createdAt,
            },
          ],
          tasks: [],
          approvals: [],
          fixture: true,
          fixtureLabel: 'local-test-api-timeline-seed',
        }),
      )
      return
    }
    if (url.pathname === '/api/approvals') {
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
          ],
        }),
      )
      return
    }
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'fixture_route_missing', path: url.pathname }))
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({
        server,
        port,
        baseUrl: `http://127.0.0.1:${port}`,
        hits,
      })
    })
  })
}

function startStaticWithApiProxy(apiBase) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      const upstream = new URL(url.pathname + url.search, apiBase)
      const preq = http.request(
        upstream,
        { method: req.method, headers: { ...req.headers, host: upstream.host } },
        (pres) => {
          res.writeHead(pres.statusCode || 502, pres.headers)
          pres.pipe(res)
        },
      )
      preq.on('error', () => {
        if (!res.headersSent) {
          res.writeHead(502, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'api upstream unreachable', fixture: true }))
        }
      })
      req.pipe(preq)
      return
    }
    const urlPath = decodeURIComponent(url.pathname)
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

async function readUiConversation(page) {
  return page.evaluate(() => {
    const col = document.querySelector('[data-testid="conversation-column"]')
    const text = col?.innerText || document.body?.innerText || ''
    const match = text.match(/conversationId:\s*(\S+)/)
    return {
      conversationIdVisible: match?.[1] || null,
      bodySample: text.slice(0, 400),
      hasFixtureTitle: text.includes('FIXTURE-LABELLED') || text.includes('timeout-retry'),
    }
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

/** Shell duplicates locale controls (mobile header + desktop sidebar); click only the visible one. */
async function clickVisibleLocale(page, testId) {
  await page.locator(`[data-testid="${testId}"]:visible`).first().click()
}

async function main() {
  ensureDirs()
  const evidence = {
    at: new Date().toISOString(),
    kind: 'p1_timeout_late_retry_continuity',
    parentTipHint: 'run on feat/p1-deepseek-live-model-20261120 tip',
    notBoxPhone: true,
    notLiveOrigin: true,
    persistenceBoundaries: PERSISTENCE_BOUNDARIES,
    fixtureConversation: FIXTURE_CONVERSATION,
    engineeringInjection: {
      label: 'ENGINEERING_INJECTION',
      description:
        'Suppress navigator.serviceWorker controllerchange listeners for ~5.5s so production waitForControllerChange (4s) times out; production PwaUpdateBanner + applyHamsterPwaUpdate still used',
    },
    steps: [],
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
  const context = await browser.newContext()
  const page = await context.newPage()

  try {
    await page.goto(origin + '/', { waitUntil: 'networkidle' })
    await waitControlled(page)

    // Real React writes controlBase; switch locale via real Shell buttons.
    await clickVisibleLocale(page, 'locale-zh')
    await page.waitForTimeout(200)
    const storageAfterReact = await snapAllHamsterStorage(page)
    const uiConv = await readUiConversation(page)
    pushStep(evidence, {
      step: 'react_wrote_locale_and_controlBase_plus_fixture_conversation_visible',
      storageAfterReact,
      uiConv,
      ok:
        storageAfterReact['hamster.locale'] === 'zh' &&
        storageAfterReact['hamster.controlBase'] === origin &&
        uiConv.conversationIdVisible === FIXTURE_CONVERSATION.conversationId &&
        !Object.keys(storageAfterReact).some((k) => k.startsWith('hamster.conversation.')),
      note: 'No hamster.conversation.* keys — conversationId is React state from fixture API',
    })

    // Deploy B; retain page; acquire waiting worker + banner.
    syncServe(DIST_B)
    await triggerSwUpdate(page)
    await page.waitForSelector('[data-testid="pwa-update-banner"]', { timeout: 65000 })
    const bannerBefore = await page.locator('[data-testid="pwa-update-banner"]').innerText()
    pushStep(evidence, {
      step: 'update_banner_visible_prod_react',
      bannerBefore: bannerBefore.slice(0, 160),
      ok: bannerBefore.length > 0,
    })

    // EN sample while banner present
    await clickVisibleLocale(page, 'locale-en')
    await page.waitForTimeout(150)
    await page.waitForSelector('[data-testid="pwa-update-banner"]', { timeout: 10000 })
    const enText = await page.locator('[data-testid="pwa-update-banner"]').innerText()
    const enPng = 'timeout-retry-banner-en-20261121.png'
    await page.screenshot({ path: path.join(EVIDENCE_REPO, enPng), fullPage: false })
    fs.copyFileSync(path.join(EVIDENCE_REPO, enPng), path.join(EVIDENCE_RAW, enPng))
    pushStep(evidence, {
      step: 'banner_en_png',
      png: enPng,
      enText: enText.slice(0, 160),
      ok: /new version|available|Reload|Try/i.test(enText),
    })

    await clickVisibleLocale(page, 'locale-zh')
    await page.waitForTimeout(150)
    const zhText = await page.locator('[data-testid="pwa-update-banner"]').innerText()
    const zhPng = 'timeout-retry-banner-zh-20261121.png'
    await page.screenshot({ path: path.join(EVIDENCE_REPO, zhPng), fullPage: false })
    fs.copyFileSync(path.join(EVIDENCE_REPO, zhPng), path.join(EVIDENCE_RAW, zhPng))
    pushStep(evidence, {
      step: 'banner_zh_png',
      png: zhPng,
      zhText: zhText.slice(0, 160),
      ok: /新|可用|重新|加载/.test(zhText),
    })

    const storageBeforeTimeout = await snapAllHamsterStorage(page)

    // --- ENGINEERING INJECTION: suppress controllerchange so production timeout fires ---
    await page.evaluate(() => {
      const until = Date.now() + 5500
      window.__HAMSTER_EVIDENCE_INJECTION = {
        label: 'ENGINEERING_INJECTION',
        purpose: 'suppress_controllerchange_until_production_timeout',
        blockControllerChangeUntil: until,
        suppressedCount: 0,
      }
      const sw = navigator.serviceWorker
      const origAdd = sw.addEventListener.bind(sw)
      const origRemove = sw.removeEventListener.bind(sw)
      const wrapMap = new WeakMap()
      sw.addEventListener = function (type, listener, options) {
        if (type === 'controllerchange' && typeof listener === 'function') {
          const wrapped = function (...args) {
            const meta = window.__HAMSTER_EVIDENCE_INJECTION
            if (meta && Date.now() < meta.blockControllerChangeUntil) {
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

    // Production Reload click (PwaUpdateBanner → applyHamsterPwaUpdate)
    await page.click('[data-testid="pwa-update-reload"]')
    // Wait for retry copy (timeout path — page must NOT navigate away)
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="pwa-update-banner"]')
        const t = el?.innerText || ''
        return /未完成|Try Reload|再次|did not finish|Retry/i.test(t)
      },
      null,
      { timeout: 15000 },
    )
    const urlAfterTimeout = page.url()
    const retryText = await page.locator('[data-testid="pwa-update-banner"]').innerText()
    const storageAfterTimeout = await snapAllHamsterStorage(page)
    const injectionMeta = await page.evaluate(() => window.__HAMSTER_EVIDENCE_INJECTION)
    const retryPng = 'timeout-retry-state-zh-20261121.png'
    await page.screenshot({ path: path.join(EVIDENCE_REPO, retryPng), fullPage: false })
    fs.copyFileSync(path.join(EVIDENCE_REPO, retryPng), path.join(EVIDENCE_RAW, retryPng))
    pushStep(evidence, {
      step: 'timeout_no_forced_reload_retry_ui',
      urlAfterTimeout,
      originSame: urlAfterTimeout.startsWith(origin),
      retryText: retryText.slice(0, 200),
      storageAfterTimeout,
      injectionMeta,
      png: retryPng,
      ok:
        urlAfterTimeout.startsWith(origin) &&
        storageAfterTimeout['hamster.locale'] === 'zh' &&
        storageAfterTimeout['hamster.controlBase'] === origin &&
        /未完成|Try Reload|再次|did not finish/i.test(retryText) &&
        (injectionMeta?.suppressedCount ?? 0) >= 1,
    })

    // Late activation: clear injection block; ensure SKIP_WAITING / activate completes.
    await page.evaluate(async () => {
      if (window.__HAMSTER_EVIDENCE_INJECTION) {
        window.__HAMSTER_EVIDENCE_INJECTION.blockControllerChangeUntil = 0
        window.__HAMSTER_EVIDENCE_INJECTION.phase = 'late_activation_allowed'
      }
      const reg = await navigator.serviceWorker.getRegistration()
      if (reg?.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' })
      // Wait until controller matches active (late activation).
      await new Promise((resolve) => {
        const start = Date.now()
        const tick = () => {
          const c = navigator.serviceWorker.controller
          const a = reg?.active
          if (c && a && c.scriptURL === a.scriptURL && !reg.waiting) return resolve(true)
          if (Date.now() - start > 10000) return resolve(false)
          setTimeout(tick, 100)
        }
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(true), {
          once: true,
        })
        tick()
      })
    })
    await page.waitForTimeout(300)
    const swState = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration()
      return {
        hasWaiting: Boolean(reg?.waiting),
        controller: navigator.serviceWorker.controller?.scriptURL || null,
        active: reg?.active?.scriptURL || null,
        same:
          Boolean(navigator.serviceWorker.controller) &&
          navigator.serviceWorker.controller?.scriptURL === reg?.active?.scriptURL,
      }
    })
    pushStep(evidence, {
      step: 'late_activation_waiting_gone_controller_is_active',
      swState,
      ok: swState.same === true && swState.hasWaiting === false,
    })

    // Explicit user Retry (production banner button — already_controlling path)
    const navPromise = page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 })
    await page.click('[data-testid="pwa-update-reload"]')
    await navPromise
    const storageAfterRetry = await snapAllHamsterStorage(page)
    const uiAfterRetry = await readUiConversation(page)
    pushStep(evidence, {
      step: 'user_retry_reloads_preserves_react_persistence_refetches_fixture_conversation',
      storageAfterRetry,
      uiAfterRetry,
      ok:
        storageAfterRetry['hamster.locale'] === 'zh' &&
        storageAfterRetry['hamster.controlBase'] === origin &&
        uiAfterRetry.conversationIdVisible === FIXTURE_CONVERSATION.conversationId,
      note: 'conversationId after reload comes from fixture API refetch (server seed), not localStorage',
    })

    // Offline: React-written keys survive; conversation content is NOT offline-proven via server.
    const hitsBeforeOffline = fixture.hits.length
    await context.setOffline(true)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(800)
    const storageOffline = await snapAllHamsterStorage(page)
    const offlineUi = await page.evaluate(() => {
      const root = document.getElementById('root')
      return {
        rootChildren: root?.childElementCount || 0,
        bodySample: (document.body?.innerText || '').slice(0, 300),
        hasHtml: Boolean(document.documentElement),
      }
    })
    const hitsDuringOffline = fixture.hits.length - hitsBeforeOffline
    pushStep(evidence, {
      step: 'offline_shell_react_persist_keys_server_history_not_claimed',
      storageOffline,
      offlineUi,
      fixtureApiHitsDuringOffline: hitsDuringOffline,
      preciseBoundary:
        'Offline proves React localStorage keys + shell render. Full conversation/message history is server-only — not claimed as offline-persisted. Fixture API hits during Playwright offline must be 0.',
      ok:
        storageOffline['hamster.locale'] === 'zh' &&
        storageOffline['hamster.controlBase'] === origin &&
        offlineUi.rootChildren > 0 &&
        hitsDuringOffline === 0,
    })

    await context.setOffline(false)
    await page.reload({ waitUntil: 'networkidle' })
    const afterReconnect = await readUiConversation(page)
    pushStep(evidence, {
      step: 'reconnect_refetches_fixture_conversation',
      afterReconnect,
      ok: afterReconnect.conversationIdVisible === FIXTURE_CONVERSATION.conversationId,
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

  // Hashes
  const pngs = [
    'timeout-retry-banner-en-20261121.png',
    'timeout-retry-banner-zh-20261121.png',
    'timeout-retry-state-zh-20261121.png',
  ]
  const hashes = {}
  for (const name of pngs) {
    const p = path.join(EVIDENCE_RAW, name)
    if (fs.existsSync(p)) {
      hashes[name] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
    }
  }
  evidence.pngSha256 = hashes

  const jsonName = 'timeout-retry-continuity-20261121.json'
  fs.writeFileSync(path.join(EVIDENCE_REPO, jsonName), JSON.stringify(evidence, null, 2))
  fs.writeFileSync(path.join(EVIDENCE_RAW, jsonName), JSON.stringify(evidence, null, 2))
  fs.writeFileSync(
    path.join(EVIDENCE_REPO, 'persistence-boundaries-from-source.json'),
    JSON.stringify(PERSISTENCE_BOUNDARIES, null, 2),
  )
  fs.copyFileSync(
    path.join(EVIDENCE_REPO, 'persistence-boundaries-from-source.json'),
    path.join(EVIDENCE_RAW, 'persistence-boundaries-from-source.json'),
  )

  const md = `# P1 timeout → late activation → user Retry continuity (2026-11-21)

Isolated VM \`127.0.0.1\` only. Not box/phone. Not live origin. No Docker. No paid providers.

pass=${evidence.pass}

## Persistence (source-accurate)

- **React-written localStorage:** \`hamster.locale\`, \`hamster.controlBase\`
- **Not written by React:** \`hamster.conversation.*\` (no such setItem in \`client/src\`)
- **Server-only:** conversationId / timeline / messages (fixture API labelled seed)
- **Offline:** shell + React keys may persist; **full conversation history is not offline-supported**

## ENGINEERING INJECTION

${evidence.engineeringInjection.description}

## Steps

${evidence.steps.map((s) => `- \`${s.step}\`: ok=${s.ok}`).join('\n')}

## PNG SHA-256

${Object.entries(hashes)
  .map(([k, v]) => `- \`${k}\`: \`${v}\``)
  .join('\n')}

## Timeout / retry observations

See step \`timeout_no_forced_reload_retry_ui\` in JSON: ENGINEERING_INJECTION suppressedCount, retry copy, same-document URL, React localStorage keys preserved. PNG \`timeout-retry-state-zh-20261121.png\` captures the retry UI.

## Untested

- Phone / mobile viewport + install prompt path
- Full multi-turn conversation offline history (server-only; not claimed)
- Box browser / live origin SW cache
- Real Docker worker chain / IndependentDocker
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
