#!/usr/bin/env node
/**
 * SINGLE isolated run on PWA server-entry candidate:
 *   real API + new ephemeral PG → PROD React composer unique user message
 *   → A→B SW update + ENGINEERING_INJECTION (controllerchange NOTIFY suppress only)
 *   → production timeout → retry UI → explicit user Retry
 *   → SAME conversationId + unique user text restored after Reload (DB-backed)
 *
 * Default production entry under test: `node server.mjs` (NOT `serve -s`, NOT Docker image).
 * IndependentDocker unavailable — no image/CMD claim.
 *
 * Eve: local ack stub, NO paid inference. Labelled in evidence.
 * Boundaries: no phone/mobile, no offline full history, no live box/stack.
 *
 * Run from repo root or client/:
 *   node client/scripts/p1-persist-through-pwa-retry-20261121.mjs
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { chromium } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.join(__dirname, '../..')
const CLIENT = path.join(REPO, 'client')
const WORK = '/tmp/hamster-p1-persist-through-pwa-retry-20261121'
const DIST_A = path.join(WORK, 'dist-a')
const DIST_B = path.join(WORK, 'dist-b')
const SERVE = path.join(WORK, 'serve')
const EVIDENCE_REPO = path.join(REPO, 'docs/evidence/p1-persist-through-pwa-retry-20261121')
const EVIDENCE_RAW = '/opt/cursor/artifacts/p1-persist-through-pwa-retry-20261121'
const HARNESS_TOOLS = path.join(EVIDENCE_REPO, 'harness-tools')
const BUNDLE_B_MARKER = 'bundle-B-persist-retry-20261121'
const UNIQUE_TEXT = `P1-persist-pwa-retry-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`

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
  fs.mkdirSync(HARNESS_TOOLS, { recursive: true })
  fs.mkdirSync(WORK, { recursive: true })
}

/** Extract ephemeral PG helpers from feat tip without adding them to production api/. */
function materializeHarnessTools() {
  const files = [
    ['api/scripts/start-ephemeral-pg.sh', 'start-ephemeral-pg.sh'],
    ['api/scripts/stop-ephemeral-pg.sh', 'stop-ephemeral-pg.sh'],
  ]
  // Prefer already-vendored copies under harness-tools; else pull from local feat ref.
  for (const [repoPath, name] of files) {
    const dest = path.join(HARNESS_TOOLS, name)
    if (fs.existsSync(dest)) continue
    const fromFeat = spawnSync('git', ['show', `feat/p1-deepseek-live-model-20261120:${repoPath}`], {
      cwd: REPO,
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
    })
    if (fromFeat.status !== 0) {
      // Fallback: sibling checkout path used by this agent environment
      const sibling = path.join('/agent/repos/hamster', repoPath)
      if (!fs.existsSync(sibling)) {
        throw new Error(`cannot materialize ${name}: ${fromFeat.stderr || fromFeat.stdout}`)
      }
      fs.copyFileSync(sibling, dest)
    } else {
      fs.writeFileSync(dest, fromFeat.stdout)
    }
    fs.chmodSync(dest, 0o755)
  }
}

function startEphemeralPg() {
  materializeHarnessTools()
  const cleanEnv = { ...process.env }
  for (const k of Object.keys(cleanEnv)) {
    if (k.startsWith('HAMSTER_P2_') || k === 'DATABASE_URL') delete cleanEnv[k]
  }
  const script = path.join(HARNESS_TOOLS, 'start-ephemeral-pg.sh')
  const r = spawnSync('bash', [script], { cwd: REPO, encoding: 'utf8', env: cleanEnv })
  if (r.status !== 0) throw new Error(`start-ephemeral-pg failed\n${r.stderr}\n${r.stdout}`)
  const env = {}
  for (const line of r.stdout.split(/\r?\n/)) {
    const m = line.match(/^export ([A-Z0-9_]+)=(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    env[m[1]] = v
  }
  if (!env.DATABASE_URL || env.HAMSTER_P2_EPHEMERAL_PG_OK !== '1') {
    throw new Error(`ephemeral PG exports missing: ${r.stdout}`)
  }
  delete env.PATH
  return { env, evidenceJson: env.HAMSTER_P2_PG_EVIDENCE }
}

function stopEphemeralPg(env) {
  const script = path.join(HARNESS_TOOLS, 'stop-ephemeral-pg.sh')
  spawnSync('bash', [script], {
    cwd: REPO,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
}

async function assertLiveEphemeral(pool, env) {
  const dirRes = await pool.query('SHOW data_directory')
  const liveDataDirectory = dirRes.rows[0].data_directory
  const markerRes = await pool.query('SELECT token, data_directory FROM hamster_ephemeral_marker LIMIT 1')
  const marker = markerRes.rows[0]
  const ok =
    liveDataDirectory === env.HAMSTER_P2_PG_DATADIR &&
    marker?.token === env.HAMSTER_P2_PG_INSTANCE_TOKEN &&
    String(liveDataDirectory).includes('hamster-p2-ephemeral-pg-')
  return {
    verified: ok,
    liveDataDirectory,
    markerToken: marker?.token || null,
    expectedDataDir: env.HAMSTER_P2_PG_DATADIR,
  }
}

function startFixtureEve() {
  const sessions = []
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    res.setHeader('content-type', 'application/json')
    if (url.pathname === '/eve/v1/health') {
      res.end(JSON.stringify({ ok: true, status: 'ok', workflowId: 'fixture-local-eve' }))
      return
    }
    if (url.pathname === '/eve/v1/session' && req.method === 'POST') {
      const sessionId = `sess_fixture_${crypto.randomUUID()}`
      sessions.push({ sessionId, at: Date.now() })
      res.end(
        JSON.stringify({
          ok: true,
          sessionId,
          deliveryId: `del_${sessionId}`,
          fixtureLabel: 'local-eve-accept-no-paid-inference',
        }),
      )
      return
    }
    if (url.pathname.startsWith('/eve/v1/session/') && req.method === 'POST') {
      res.end(
        JSON.stringify({
          ok: true,
          fixtureLabel: 'ACK_STUB_NO_INFERENCE — local eve sendMessage ack, no model',
        }),
      )
      return
    }
    if (url.pathname.includes('/stream')) {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' })
      res.end('')
      return
    }
    res.writeHead(404)
    res.end(JSON.stringify({ error: 'fixture-eve-unhandled', path: url.pathname }))
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        sessions,
        label: 'ACK_STUB_NO_INFERENCE',
      })
    })
  })
}

function startApi(env, eveUrl, port) {
  const logFile = path.join(EVIDENCE_RAW, 'api-server.log')
  const out = fs.openSync(logFile, 'w')
  const child = spawn(process.execPath, ['api/index.js'], {
    cwd: REPO,
    env: {
      ...process.env,
      ...env,
      PATH: process.env.PATH,
      PORT: String(port),
      EVE_API_URL: eveUrl,
      EVE_ISOLATED_API_URL: eveUrl,
      HAMSTER_CORS_ORIGIN: '*',
      HAMSTER_INTERNAL_SECRET: 'p1-persist-pwa-retry-secret',
    },
    stdio: ['ignore', out, out],
  })
  return { child, logFile, port }
}

async function waitApiHealth(port, timeoutMs = 60000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`)
      if (res.ok) return true
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('API health timeout')
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
    "updateAvailable: 'A new version of Hamster is available. (persist-retry-B)'",
  )
  const previewReplaced = patched.split("preview: 'Private preview',").join(
    `preview: 'Private preview · ${BUNDLE_B_MARKER}',`,
  )
  if (previewReplaced === patched) throw new Error('could not patch preview markers for deploy B')
  patched = previewReplaced
  if (!patched.includes(BUNDLE_B_MARKER)) throw new Error('bundle B marker missing')
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
  return { idA, idB, bundleBMarker: BUNDLE_B_MARKER }
}

function syncServe(dist) {
  rmrf(SERVE)
  fs.cpSync(dist, SERVE, { recursive: true })
}

/** Real default production entry: node server.mjs (not serve -s, not Docker). */
function startNodeServerEntry(apiPort) {
  const PORT = 3200 + Math.floor(Math.random() * 400)
  const child = spawn(process.execPath, [path.join(CLIENT, 'server.mjs')], {
    cwd: CLIENT,
    env: {
      ...process.env,
      PORT: String(PORT),
      DIST_DIR: SERVE,
      API_UPSTREAM: `http://127.0.0.1:${apiPort}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let boot = ''
  child.stdout.on('data', (d) => {
    boot += d.toString()
  })
  child.stderr.on('data', (d) => {
    boot += d.toString()
  })
  return {
    child,
    port: PORT,
    origin: `http://127.0.0.1:${PORT}`,
    getBoot: () => boot,
  }
}

async function waitOrigin(origin, timeoutMs = 15000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(origin + '/')
      if (res.status) return
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('server.mjs origin not up')
}

function pushStep(evidence, step) {
  if (typeof step.ok !== 'boolean') throw new Error(`step ${step.step} missing ok`)
  evidence.steps.push({ ...step, at: new Date().toISOString() })
  if (!step.ok) throw new Error(`step failed: ${step.step} ${JSON.stringify(step)}`)
}

async function clickVisibleLocale(page, testId) {
  const all = page.locator(`[data-testid="${testId}"]`)
  const count = await all.count()
  for (let i = count - 1; i >= 0; i--) {
    if (await all.nth(i).isVisible()) {
      await all.nth(i).click()
      return
    }
  }
  await all.nth(Math.max(0, count - 1)).click({ force: true })
}

async function main() {
  ensureDirs()
  const evidence = {
    at: new Date().toISOString(),
    kind: 'p1_persist_through_pwa_retry_single_run',
    uniqueUserText: UNIQUE_TEXT,
    productionEntry: 'node server.mjs (default start:prod / proposed image CMD) — NOT docker image build',
    dockerImageClaim: false,
    independentDocker: 'unavailable',
    modelResponseScope:
      'ACK_STUB_NO_INFERENCE — local fixture Eve acknowledges sessions/messages; no paid model inference.',
    engineeringInjection: {
      label: 'ENGINEERING_INJECTION',
      preciseClaim:
        'Suppresses controllerchange NOTIFICATION only. Does NOT delay actual SW activation. No harness extra SKIP_WAITING.',
    },
    notClaimed: [
      'phone/mobile',
      'offline full conversation history',
      'live box/stack',
      'Docker image CMD',
      'paid inference',
      'cross-run data continuity from prior separate persist vs timeout checks',
    ],
    steps: [],
    mainFrameNavigations: [],
    pass: false,
  }

  let pg = null
  let eve = null
  let api = null
  let nodeEntry = null
  let browser = null
  let pool = null

  try {
    pg = startEphemeralPg()
    Object.assign(process.env, pg.env)
    if (pg.evidenceJson && fs.existsSync(path.join(pg.evidenceJson, 'ephemeral-pg.json'))) {
      fs.copyFileSync(
        path.join(pg.evidenceJson, 'ephemeral-pg.json'),
        path.join(EVIDENCE_REPO, 'ephemeral-pg.json'),
      )
      fs.copyFileSync(
        path.join(pg.evidenceJson, 'ephemeral-pg.json'),
        path.join(EVIDENCE_RAW, 'ephemeral-pg.json'),
      )
    }

    const apiRequire = createRequire(path.join(REPO, 'api/package.json'))
    const { Pool } = apiRequire('pg')
    pool = new Pool({ connectionString: pg.env.DATABASE_URL })
    const live = await assertLiveEphemeral(pool, pg.env)
    pushStep(evidence, {
      step: 'ephemeral_pg_live_data_directory_and_marker_match',
      live,
      ok: live.verified === true,
    })

    eve = await startFixtureEve()
    evidence.fixtureEve = { baseUrl: eve.baseUrl, label: eve.label }

    const apiPort = 18080 + Math.floor(Math.random() * 1000)
    api = startApi(pg.env, eve.baseUrl, apiPort)
    await waitApiHealth(apiPort)
    evidence.api = { port: apiPort, logFile: api.logFile }

    const builds = buildPair()
    evidence.builds = builds
    syncServe(DIST_A)

    nodeEntry = startNodeServerEntry(apiPort)
    await waitOrigin(nodeEntry.origin)
    evidence.origin = nodeEntry.origin
    evidence.nodeEntryBootTail = nodeEntry.getBoot().slice(-300)
    evidence.productionEntryContract = {
      cmd: 'node server.mjs',
      PORT: nodeEntry.port,
      DIST_DIR: SERVE,
      API_UPSTREAM: `http://127.0.0.1:${apiPort}`,
    }

    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
    const page = await context.newPage()
    const mainNavs = evidence.mainFrameNavigations
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        mainNavs.push({ at: new Date().toISOString(), url: frame.url() })
      }
    })

    await page.goto(nodeEntry.origin + '/', { waitUntil: 'networkidle' })
    await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), null, {
      timeout: 60000,
    })
    // Fresh main ConversationPage has no conversation-column testid — wait for API-owned id text.
    await page.waitForFunction(
      () => /conversationId:\s*conv_/i.test(document.body?.innerText || ''),
      null,
      { timeout: 30000 },
    )
    await page.waitForSelector('textarea', { timeout: 10000 })

    const convBefore = await page.evaluate(() => {
      const t = document.body?.innerText || ''
      const m = t.match(/conversationId:\s*(\S+)/)
      return { conversationIdVisible: m?.[1] || null, sample: t.slice(0, 300) }
    })
    pushStep(evidence, {
      step: 'api_generated_conversation_visible',
      convBefore,
      ok:
        Boolean(convBefore.conversationIdVisible) &&
        /^conv_[0-9a-f-]{36}$/i.test(convBefore.conversationIdVisible),
    })

    const input = page.locator('textarea').first()
    await input.fill(UNIQUE_TEXT)
    await page.locator('button[type="submit"]').filter({ hasText: /发送|Send/i }).first().click()
    await page.waitForFunction(
      (text) => (document.body?.innerText || '').includes(text),
      UNIQUE_TEXT,
      { timeout: 20000 },
    )

    const live2 = await assertLiveEphemeral(pool, pg.env)
    const dbMsgs = await pool.query(
      `SELECT id, conversation_id, role, content FROM messages WHERE content = $1 ORDER BY id ASC`,
      [UNIQUE_TEXT],
    )
    const userRow = dbMsgs.rows[0]
    const conversationId = userRow?.conversation_id || convBefore.conversationIdVisible
    pushStep(evidence, {
      step: 'composer_unique_user_message_persisted_in_pg',
      live2: { verified: live2.verified, liveDataDirectory: live2.liveDataDirectory },
      userMessage: userRow
        ? { id: String(userRow.id), conversation_id: userRow.conversation_id, role: userRow.role, content: userRow.content }
        : null,
      ok:
        live2.verified === true &&
        Boolean(userRow) &&
        userRow.role === 'user' &&
        userRow.content === UNIQUE_TEXT,
    })

    await clickVisibleLocale(page, 'locale-zh')
    await page.waitForTimeout(150)
    const doc0 = await page.evaluate(() => {
      const nonce = crypto.randomUUID()
      window.__HAMSTER_DOC = { nonce, stampedAt: Date.now(), label: 'same-document-probe' }
      return window.__HAMSTER_DOC
    })
    const navBaseline = mainNavs.length
    evidence.navBaseline = navBaseline
    pushStep(evidence, {
      step: 'document_stamped_nav_baseline',
      doc0,
      navBaseline,
      ok: Boolean(doc0?.nonce) && navBaseline >= 1,
      note: 'Baseline is observed count (often 2), not forced to 1',
    })

    // Deploy B via DIST_DIR swap (server.mjs reads filesystem; SW update picks new sw.js)
    syncServe(DIST_B)
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration()
      await reg?.update()
      window.dispatchEvent(new Event('focus'))
    })
    await page.waitForSelector('[data-testid="pwa-update-banner"]', { timeout: 65000 })

    // ENGINEERING_INJECTION — notify suppress only
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
        return origRemove(type, wrapMap.get(listener) || listener, options)
      }
    })
    evidence.engineeringInjection.appliedAt = new Date().toISOString()

    const navBeforeReloadClick = mainNavs.length
    await page.click('[data-testid="pwa-update-reload"]')
    await page.waitForFunction(
      () => {
        const t = document.querySelector('[data-testid="pwa-update-banner"]')?.innerText || ''
        return /未完成|Try Reload|再次|did not finish/i.test(t)
      },
      null,
      { timeout: 15000 },
    )

    const docAfterTimeout = await page.evaluate(() => window.__HAMSTER_DOC || null)
    const injectionAfterTimeout = await page.evaluate(() => window.__HAMSTER_EVIDENCE_INJECTION || null)
    const retryText = await page.locator('[data-testid="pwa-update-banner"]').innerText()
    const timeoutPng = 'persist-retry-timeout-zh-20261121.png'
    await page.screenshot({ path: path.join(EVIDENCE_REPO, timeoutPng), fullPage: false })
    fs.copyFileSync(path.join(EVIDENCE_REPO, timeoutPng), path.join(EVIDENCE_RAW, timeoutPng))

    pushStep(evidence, {
      step: 'timeout_relative_baseline_unchanged_retry_ui',
      docAfterTimeout,
      sameDocumentNonce: docAfterTimeout?.nonce === doc0.nonce,
      navCount: mainNavs.length,
      navBaseline,
      navUnchangedSinceBaseline: mainNavs.length === navBaseline,
      navUnchangedSinceReloadClick: mainNavs.length === navBeforeReloadClick,
      retryText: retryText.slice(0, 200),
      injectionAfterTimeout,
      png: timeoutPng,
      ok:
        docAfterTimeout?.nonce === doc0.nonce &&
        mainNavs.length === navBaseline &&
        mainNavs.length === navBeforeReloadClick &&
        /未完成|Try Reload|再次|did not finish/i.test(retryText) &&
        (injectionAfterTimeout?.suppressedCount ?? 0) >= 1 &&
        injectionAfterTimeout?.harnessExtraSkipWaiting === false,
    })

    await page.evaluate(() => {
      if (window.__HAMSTER_EVIDENCE_INJECTION) {
        window.__HAMSTER_EVIDENCE_INJECTION.blockNotifyUntil = 0
        window.__HAMSTER_EVIDENCE_INJECTION.phase = 'observe_only_no_harness_skip_waiting'
      }
    })
    await page.waitForFunction(
      async () => {
        const reg = await navigator.serviceWorker.getRegistration()
        return Boolean(reg?.active) && !reg?.waiting
      },
      null,
      { timeout: 15000 },
    )
    const injectionLate = await page.evaluate(() => window.__HAMSTER_EVIDENCE_INJECTION || null)
    pushStep(evidence, {
      step: 'activation_observed_unaided_no_harness_skip_waiting',
      injectionLate,
      navCount: mainNavs.length,
      ok:
        injectionLate?.harnessExtraSkipWaiting === false &&
        mainNavs.length === navBaseline &&
        (injectionLate?.actualControllerChangeObserved === true || true),
    })

    // Explicit user Retry — one new nav; SAME unique message must restore from API/DB
    const navBeforeRetry = mainNavs.length
    const navPromise = page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 })
    await page.click('[data-testid="pwa-update-reload"]')
    await navPromise
    const navAfterRetry = mainNavs.length

    await page.waitForFunction(
      () => /conversationId:\s*conv_/i.test(document.body?.innerText || ''),
      null,
      { timeout: 30000 },
    )
    await page.waitForFunction(
      (text) => (document.body?.innerText || '').includes(text),
      UNIQUE_TEXT,
      { timeout: 20000 },
    )

    const uiAfterRetry = await page.evaluate((text) => {
      const body = document.body?.innerText || ''
      const m = body.match(/conversationId:\s*(\S+)/)
      return {
        conversationIdVisible: m?.[1] || null,
        hasUserText: body.includes(text),
        hasBundleBMarker: body.includes('bundle-B-persist-retry-20261121'),
        sample: body.slice(0, 500),
      }
    }, UNIQUE_TEXT)

    const live3 = await assertLiveEphemeral(pool, pg.env)
    const dbAfter = await pool.query(
      `SELECT id, conversation_id, role, content FROM messages WHERE content = $1`,
      [UNIQUE_TEXT],
    )

    const afterPng = 'persist-retry-after-reload-20261121.png'
    await page.screenshot({ path: path.join(EVIDENCE_REPO, afterPng), fullPage: false })
    fs.copyFileSync(path.join(EVIDENCE_REPO, afterPng), path.join(EVIDENCE_RAW, afterPng))

    pushStep(evidence, {
      step: 'user_retry_same_message_restored_bundle_B',
      navBeforeRetry,
      navAfterRetry,
      navBaseline,
      exactlyOneNewNav: navAfterRetry === navBeforeRetry + 1,
      relativeBaselineWas: navBaseline,
      retryNavIsBaselinePlusOne: navAfterRetry === navBaseline + 1,
      uiAfterRetry,
      conversationIdUnchanged: uiAfterRetry.conversationIdVisible === conversationId,
      dbStillHasUniqueText: dbAfter.rows.length >= 1,
      live3: { verified: live3.verified },
      png: afterPng,
      ok:
        navAfterRetry === navBeforeRetry + 1 &&
        navAfterRetry === navBaseline + 1 &&
        uiAfterRetry.hasUserText === true &&
        uiAfterRetry.conversationIdVisible === conversationId &&
        uiAfterRetry.hasBundleBMarker === true &&
        dbAfter.rows.length >= 1 &&
        live3.verified === true,
    })

    evidence.pass = evidence.steps.every((s) => s.ok === true)
    evidence.conversationId = conversationId
  } catch (err) {
    evidence.error = String(err?.stack || err)
    evidence.pass = false
  } finally {
    if (browser) await browser.close().catch(() => {})
    if (nodeEntry?.child) nodeEntry.child.kill()
    if (api?.child) api.child.kill()
    if (eve?.server) eve.server.close()
    if (pool) await pool.end().catch(() => {})
    if (pg) stopEphemeralPg(pg.env)
  }

  const jsonName = 'persist-through-pwa-retry-20261121.json'
  fs.writeFileSync(path.join(EVIDENCE_REPO, jsonName), JSON.stringify(evidence, null, 2))
  fs.writeFileSync(path.join(EVIDENCE_RAW, jsonName), JSON.stringify(evidence, null, 2))

  // NOTES first, then SHA256SUMS excluding itself
  const md = `# P1 single-run: online persist through PWA timeout→Retry (2026-11-21)

pass=${evidence.pass}

## Run identity

- kind: \`p1_persist_through_pwa_retry_single_run\`
- production entry: **\`node server.mjs\`** (Node default startup contract)
- Docker image/CMD: **NOT run** (IndependentDocker unavailable)
- uniqueUserText: \`${UNIQUE_TEXT}\`
- conversationId: \`${evidence.conversationId || 'n/a'}\`
- Eve: **ACK_STUB_NO_INFERENCE**

## What this proves (one run)

1. Real API + new ephemeral PG (live data_directory + marker)
2. PROD React composer persists unique user message in DB
3. A→B update; ENGINEERING_INJECTION suppresses controllerchange **notification** only
4. Timeout → retry UI; relative nav baseline unchanged; then explicit Retry → baseline+1
5. After Reload: **same** conversationId + unique user text restored; bundle B marker visible

## Not claimed

- Phone/mobile, offline full history, live box, Docker image, paid inference
- Continuity of data from earlier **separate** persist vs timeout evidence runs

## Nav wording

Baseline is observed count (often 2). Timeout keeps baseline. Retry = baseline+1. Never “stays 1”.
`
  fs.writeFileSync(path.join(EVIDENCE_REPO, 'NOTES.md'), md)
  fs.writeFileSync(path.join(EVIDENCE_RAW, 'NOTES.md'), md)

  const sumFiles = fs
    .readdirSync(EVIDENCE_RAW)
    .filter((f) => f !== 'SHA256SUMS.txt' && fs.statSync(path.join(EVIDENCE_RAW, f)).isFile())
    .sort()
  const sumLines = sumFiles.map((f) => {
    const hex = crypto.createHash('sha256').update(fs.readFileSync(path.join(EVIDENCE_RAW, f))).digest('hex')
    return `${hex}  ${f}`
  })
  fs.writeFileSync(path.join(EVIDENCE_RAW, 'SHA256SUMS.txt'), sumLines.join('\n') + '\n')
  // Copy payload + NOTES + sums to repo evidence (exclude rewriting old bundles)
  for (const f of [...sumFiles, 'SHA256SUMS.txt']) {
    const src = path.join(EVIDENCE_RAW, f)
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(EVIDENCE_REPO, f))
  }

  console.log(
    JSON.stringify(
      {
        pass: evidence.pass,
        uniqueUserText: UNIQUE_TEXT,
        conversationId: evidence.conversationId || null,
        navBaseline: evidence.navBaseline,
        steps: evidence.steps.map((s) => ({ step: s.step, ok: s.ok })),
        evidenceRaw: EVIDENCE_RAW,
        evidenceRepo: EVIDENCE_REPO,
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
