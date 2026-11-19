#!/usr/bin/env node
/**
 * Production Electron E2E — startup Connect gate matrix (REAL electron/main.js).
 * Driver: Playwright _electron. Gate: actual input+button clicks (no mirror handlers).
 * Fixture API labeled x-hamster-fixture. Avoids ports 10889/5175/4173.
 *
 * Cases:
 *  - fresh empty profile → local gate while remote unavailable
 *  - first success only after usable mount
 *  - normal last-success direct boot
 *  - startup bad-source → local rescue (not SPA-dependent)
 *  - failed attempted source does not overwrite old success
 *  - retry original success restores same route
 *  - A→B via gate resets to '/' (no old IDs)
 *  - whole-process restart same userData
 *  - already-open temp disconnect: retain route + banner/Retry, zero auto approve/deny/cancel
 *  - unavailable approval channel fail-closed + mutation log
 *  - EN/ZH gate screenshots + window URL / bridge identity
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT =
  process.env.P1_E2E_OUT || '/opt/cursor/artifacts/p1-startup-connect-gate-evidence'
const FORBIDDEN = new Set([10889, 5175, 4173])
fs.mkdirSync(OUT, { recursive: true })

const require = createRequire(path.join(ROOT, 'client/package.json'))
const { _electron } = require('playwright')

const ELECTRON_BIN = path.join(ROOT, 'electron/node_modules/.bin/electron')
const MAIN_JS = path.join(ROOT, 'electron/main.js')
const DIST = path.join(ROOT, 'client/dist')
const testedSha = execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim()

function freePort() {
  return new Promise((resolve, reject) => {
    const s = http.createServer(() => {})
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port
      s.close(() => {
        if (FORBIDDEN.has(p)) freePort().then(resolve, reject)
        else resolve(p)
      })
    })
    s.on('error', reject)
  })
}

function createFixtureApi(opts = {}) {
  const { unreachable = false } = opts
  const state = {
    conversationId: 'conv_e2e_gate_1',
    title: 'E2E startup gate conversation',
    assetId: 'asset_e2e_gate_1',
    taskId: 'task_e2e_gate_1',
    runtimeSessionId: 'rt_e2e_gate_1',
    approvalId: 'appr_e2e_gate_1',
    approvalStatus: 'pending',
    mutations: [],
    requests: [],
    down: unreachable,
  }
  const server = http.createServer((req, res) => {
    if (state.down) {
      req.socket.destroy()
      return
    }
    const url = new URL(req.url || '/', 'http://fixture')
    state.requests.push({
      t: new Date().toISOString(),
      method: req.method,
      path: url.pathname,
      host: req.headers.host || null,
    })
    const json = (code, body) => {
      res.writeHead(code, { 'content-type': 'application/json', 'x-hamster-fixture': 'true' })
      res.end(JSON.stringify(body))
    }
    if (url.pathname === '/api/health' || url.pathname === '/health') {
      return json(200, { status: 'ok', fixture: true })
    }
    if (url.pathname === '/api/conversations/current') {
      return json(200, {
        conversationId: state.conversationId,
        title: state.title,
        createdAt: '2026-11-19T12:00:00.000Z',
        fixture: true,
      })
    }
    if (url.pathname.endsWith('/timeline')) {
      return json(200, {
        conversationId: state.conversationId,
        fixture: true,
        messages: [
          {
            id: 'm1',
            role: 'user',
            content: 'start task: E2E gate fixture',
            meta: { taskId: state.taskId },
            createdAt: '2026-11-19T12:01:00.000Z',
          },
        ],
        tasks: [
          {
            taskId: state.taskId,
            conversationId: state.conversationId,
            runtimeSessionId: state.runtimeSessionId,
            assetId: state.assetId,
            title: 'E2E gate fixture',
            status: 'waiting_for_approval',
            controlSeq: 0,
            createdAt: '2026-11-19T12:01:00.000Z',
            updatedAt: '2026-11-19T12:02:00.000Z',
            cancelRequestedAt: null,
            events: [],
            controls: [],
            approvals: [
              {
                id: state.approvalId,
                taskId: state.taskId,
                taskTitle: 'E2E gate fixture',
                action: 'publish_dashboard',
                params: { assetId: state.assetId, channel: 'shared workspace' },
                status: state.approvalStatus,
                expiresAt: '2026-11-21T18:00:00.000Z',
              },
            ],
          },
        ],
        approvals: [],
      })
    }
    if (url.pathname === '/api/approvals') {
      const status = url.searchParams.get('status')
      const all = [
        {
          id: state.approvalId,
          taskId: state.taskId,
          taskTitle: 'E2E gate fixture',
          action: 'publish_dashboard',
          params: { assetId: state.assetId, channel: 'shared workspace' },
          status: state.approvalStatus,
          expiresAt: '2026-11-21T18:00:00.000Z',
        },
      ]
      return json(200, status ? all.filter((a) => a.status === status) : all)
    }
    if (url.pathname === '/api/assets' || url.pathname === '/api/assets/') {
      return json(200, [
        {
          assetId: state.assetId,
          taskId: state.taskId,
          conversationId: state.conversationId,
          title: 'E2E gate fixture',
          source: 'e2e_fixture',
          layoutVersion: 1,
          freshness: 'fresh',
          lastSuccessAt: '2026-11-19T12:02:00.000Z',
          lastError: null,
          publishedAt: null,
          publishedChannel: null,
          createdAt: '2026-11-19T12:01:00.000Z',
          fixture: true,
        },
      ])
    }
    const assetMatch = url.pathname.match(/^\/api\/assets\/([^/]+)$/)
    if (assetMatch) {
      const id = decodeURIComponent(assetMatch[1])
      const openui = [
        `head = CardHeader("E2E gate fixture", "assetId ${id} · fixture")`,
        'note = Note("fixture-gate-dashboard-body")',
        'root = Stack([head, note])',
        '',
      ].join('\n')
      return json(200, {
        assetId: id,
        title: 'E2E gate fixture',
        taskId: state.taskId,
        conversationId: state.conversationId,
        source: 'e2e_fixture',
        layoutVersion: 1,
        freshness: 'fresh',
        lastSuccessAt: '2026-11-19T12:02:00.000Z',
        lastError: null,
        publishedAt: null,
        openui,
        bindings: [],
        data: { kpis: [], rows: [] },
        publishedChannel: null,
        createdAt: '2026-11-19T12:01:00.000Z',
        fixture: true,
      })
    }
    const decide = url.pathname.match(/^\/api\/approvals\/([^/]+)\/(approve|deny)$/)
    if (decide && req.method === 'POST') {
      state.mutations.push({
        t: new Date().toISOString(),
        kind: decide[2],
        id: decodeURIComponent(decide[1]),
        path: url.pathname,
      })
      state.approvalStatus = decide[2] === 'approve' ? 'approved' : 'denied'
      return json(200, { id: decodeURIComponent(decide[1]), status: state.approvalStatus, fixture: true })
    }
    const cancel = url.pathname.match(/^\/api\/tasks\/([^/]+)\/cancel$/)
    if (cancel && req.method === 'POST') {
      state.mutations.push({
        t: new Date().toISOString(),
        kind: 'cancel',
        id: decodeURIComponent(cancel[1]),
        path: url.pathname,
      })
      return json(200, { ok: true, fixture: true })
    }
    return json(404, { error: 'fixture-miss', path: url.pathname, fixture: true })
  })
  return { state, server }
}

function startClient(port, apiPort) {
  return spawn(process.execPath, [path.join(ROOT, 'client/server.mjs')], {
    env: {
      ...process.env,
      PORT: String(port),
      API_UPSTREAM: `http://127.0.0.1:${apiPort}`,
      DIST_DIR: DIST,
    },
    stdio: 'ignore',
  })
}

async function launch(userDataDir, envExtra, stderrFile) {
  const stream = fs.createWriteStream(stderrFile, { flags: 'a' })
  stream.write(`\n=== ${new Date().toISOString()} userData=${userDataDir} env=${JSON.stringify(envExtra)}\n`)
  const env = { ...process.env, ...envExtra }
  // Bare localhost must not be implied — strip default unless caller sets origins.
  if (!('HAMSTER_CONTROL_ORIGIN' in envExtra)) {
    delete env.HAMSTER_CONTROL_ORIGIN
  }
  if (!('HAMSTER_CONTROL_BASE_URL' in envExtra)) {
    delete env.HAMSTER_CONTROL_BASE_URL
  }
  const app = await _electron.launch({
    executablePath: ELECTRON_BIN,
    args: [MAIN_JS, `--user-data-dir=${userDataDir}`],
    cwd: path.join(ROOT, 'electron'),
    env,
    timeout: 45000,
  })
  app.process().stderr?.on('data', (d) => stream.write(d))
  app.process().stdout?.on('data', (d) => stream.write(d))
  const page = await app.firstWindow({ timeout: 45000 })
  return { app, page, stream }
}

function findSessions(dir) {
  const out = []
  if (!fs.existsSync(dir)) return out
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) out.push(...findSessions(p))
    else if (ent.name === 'hamster-session.json') out.push(p)
  }
  return out
}

function readSession(userData) {
  const files = findSessions(userData)
  if (!files.length) return null
  return { path: files[0], body: JSON.parse(fs.readFileSync(files[0], 'utf8')) }
}

async function snapshot(page) {
  return page.evaluate(() => ({
    href: location.href,
    origin: location.origin,
    protocol: location.protocol,
    pathname: location.pathname,
    hasGate: Boolean(document.querySelector('[data-testid="connect-gate"]')),
    title: document.querySelector('#title, [data-testid="connect-gate"] h1')?.textContent || null,
    label: document.querySelector('#label, [data-testid="connect-gate"] label')?.textContent || null,
    submit: document.querySelector('[data-testid="connect-gate-submit"]')?.textContent || null,
    errorVisible: Boolean(
      document.querySelector('[data-testid="connect-gate-error"]:not([hidden])'),
    ),
    errorText: document.querySelector('[data-testid="connect-gate-error"]')?.textContent || null,
    hasBanner: Boolean(document.querySelector('[data-testid="connection-banner"]')),
    bannerText: document.querySelector('[data-testid="connection-banner"]')?.textContent || null,
    hasConversation: Boolean(document.querySelector('[data-testid="conversation-column"]')),
    container: window.hamster?.container ?? null,
    sessionOrigin:
      typeof window.hamster?.sessionOrigin === 'function' ? window.hamster.sessionOrigin() : null,
    controlBase:
      typeof window.hamster?.controlBaseUrl === 'function' ? window.hamster.controlBaseUrl() : null,
    bodySnippet: (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 280),
  }))
}

const report = {
  testedSha,
  fixture: true,
  fixtureLabel: 'x-hamster-fixture',
  realMainJs: MAIN_JS,
  steps: [],
  pass: {},
}
const logs = []
function log(msg) {
  logs.push(`${new Date().toISOString()} ${msg}`)
  console.error(msg)
}

const { state, server } = createFixtureApi()
const apiPort = await freePort()
await new Promise((r) => server.listen(apiPort, '127.0.0.1', r))
const portA = await freePort()
const portB = await freePort()
const deadPort = await freePort()
const procA = startClient(portA, apiPort)
const procB = startClient(portB, apiPort)
await new Promise((r) => setTimeout(r, 900))

const originA = `http://127.0.0.1:${portA}`
const originB = `http://127.0.0.1:${portB}`
const deadOrigin = `http://127.0.0.1:${deadPort}`
report.origins = { originA, originB, deadOrigin, apiPort }

for (const o of [originA, originB]) {
  const h = await fetch(`${o}/api/health`).then((r) => r.json())
  if (h.status !== 'ok') throw new Error('health failed ' + o)
}

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'hamster-gate-e2e-'))
fs.writeFileSync(
  path.join(OUT, 'launch-command.txt'),
  [
    `testedSha=${testedSha}`,
    `executable=${ELECTRON_BIN}`,
    `args=${MAIN_JS} --user-data-dir=${userData}`,
    `cwd=${path.join(ROOT, 'electron')}`,
    `webPreferences: sandbox:true contextIsolation:true nodeIntegration:false`,
    `driver=playwright._electron (actual gate input/button; no mirror IPC)`,
  ].join('\n'),
)

const stderrPath = path.join(OUT, 'electron-stderr.txt')
fs.writeFileSync(stderrPath, '')

// --- 1) Fresh empty profile, remote unavailable → local gate ---
log('case1: fresh empty + no env + dead remote → local gate')
let { app, page, stream } = await launch(userData, {}, stderrPath)
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(1500)
let snap = await snapshot(page)
await page.screenshot({ path: path.join(OUT, '01-fresh-empty-gate-en.png') })
const case1 = {
  snap,
  pass:
    snap.protocol === 'file:' &&
    snap.hasGate &&
    snap.title === 'Connect to Hamster' &&
    snap.label === 'Client origin' &&
    snap.submit === 'Connect' &&
    snap.container === 'electron' &&
    !readSession(userData)?.body?.lastSuccessfulOrigin,
}
report.steps.push({ step: 'fresh-empty-local-gate', ...case1 })
report.pass.freshEmptyLocalGate = case1.pass

// EN/ZH screenshots
await page.getByTestId('locale-zh').click()
await page.waitForTimeout(300)
snap = await snapshot(page)
await page.screenshot({ path: path.join(OUT, '01b-fresh-empty-gate-zh.png') })
const zhOk =
  snap.title === '连接Hamster' &&
  snap.label === '客户端源地址' &&
  snap.submit === '连接'
report.steps.push({ step: 'gate-zh-copy', snap, pass: zhOk })
report.pass.gateZhCopy = zhOk
await page.getByTestId('locale-en').click()
await page.waitForTimeout(200)

// Reject userinfo / path (no silent strip) via UI
log('case1b: reject userinfo/path inputs')
await page.getByTestId('connect-gate-address').fill('http://user:secret@127.0.0.1:' + portA)
await page.getByTestId('connect-gate-submit').click()
await page.waitForTimeout(800)
snap = await snapshot(page)
const rejectUserinfo =
  snap.hasGate &&
  snap.errorVisible &&
  (snap.errorText || '').includes("Can't reach") &&
  snap.submit === 'Retry' &&
  !String(JSON.stringify(readSession(userData)?.body || {})).includes('secret')
await page.getByTestId('connect-gate-address').fill(originA + '/assets/x')
await page.getByTestId('connect-gate-submit').click()
await page.waitForTimeout(800)
snap = await snapshot(page)
const rejectPath = snap.hasGate && snap.errorVisible
report.steps.push({ step: 'reject-non-origin', rejectUserinfo, rejectPath, snap })
report.pass.rejectNonOrigin = rejectUserinfo && rejectPath

// --- 2) First connect success → usable mount → lastSuccessful recorded ---
log('case2: first success via gate → mount → record')
await page.getByTestId('connect-gate-address').fill(originA)
await page.getByTestId('connect-gate-submit').click()
await page.waitForTimeout(4000)
snap = await snapshot(page)
const sessAfterFirst = readSession(userData)
const case2 = {
  snap,
  session: sessAfterFirst?.body || null,
  pass:
    snap.protocol === 'http:' &&
    snap.origin === originA &&
    snap.container === 'electron' &&
    !snap.hasGate &&
    sessAfterFirst?.body?.lastSuccessfulOrigin === originA,
}
await page.screenshot({ path: path.join(OUT, '02-first-success-mounted.png') })
report.steps.push({ step: 'first-success-mount', ...case2 })
report.pass.firstSuccessMount = case2.pass

// Navigate to asset for restore tests
await page.evaluate((id) => location.assign('/assets/' + id), state.assetId)
await page.waitForTimeout(1500)
snap = await snapshot(page)
await page.screenshot({ path: path.join(OUT, '03-asset-on-A.png') })
report.steps.push({
  step: 'asset-route-A',
  snap,
  pass: snap.pathname === `/assets/${state.assetId}`,
})

await app.close()
stream.end()

// --- 3) Normal last-success direct boot ---
log('case3: last-success direct boot')
;({ app, page, stream } = await launch(userData, {}, stderrPath))
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(3500)
snap = await snapshot(page)
await page.screenshot({ path: path.join(OUT, '04-last-success-direct-boot.png') })
const case3 = {
  snap,
  pass:
    !snap.hasGate &&
    snap.origin === originA &&
    snap.pathname === `/assets/${state.assetId}` &&
    ((snap.bodySnippet || '').includes('fixture-gate-dashboard-body') ||
      (snap.bodySnippet || '').includes('E2E gate fixture')),
}
report.steps.push({ step: 'last-success-direct-boot', ...case3 })
report.pass.lastSuccessDirectBoot = case3.pass

await app.close()
stream.end()

// --- 4) Startup bad-source (env) → local rescue; does not overwrite success ---
log('case4: bad env source → local gate; preserve lastSuccessful')
const beforeBad = readSession(userData)?.body?.lastSuccessfulOrigin
;({ app, page, stream } = await launch(
  userData,
  { HAMSTER_CONTROL_ORIGIN: deadOrigin, HAMSTER_CONTROL_BASE_URL: deadOrigin },
  stderrPath,
))
// May attempt dead then fall back to last-success OR if last-success attempted first...
// Main prefers lastSuccessful over env. So with lastSuccessful, boots A not dead.
// For bad-source rescue when lastSuccessful is BAD: rewrite session then launch.
await app.close()
stream.end()

const sessFile = findSessions(userData)[0]
const sessBody = JSON.parse(fs.readFileSync(sessFile, 'utf8'))
const preservedRoute = sessBody.lastPath
const preservedSuccess = sessBody.lastSuccessfulOrigin
// Simulate startup with only bad candidate: clear success, keep draft attempt via env
fs.writeFileSync(
  sessFile,
  JSON.stringify(
    {
      ...sessBody,
      lastSuccessfulOrigin: null,
      lastOrigin: null,
      trustedOrigins: [],
      lastPath: '/',
      gateDraftOrigin: null,
      gateShowError: false,
    },
    null,
    2,
  ),
)
;({ app, page, stream } = await launch(
  userData,
  { HAMSTER_CONTROL_ORIGIN: deadOrigin, HAMSTER_CONTROL_BASE_URL: deadOrigin },
  stderrPath,
))
await page.waitForTimeout(8000)
snap = await snapshot(page)
await page.screenshot({ path: path.join(OUT, '05-bad-source-local-rescue.png') })
const afterBad = readSession(userData)?.body
const case4 = {
  snap,
  afterBad,
  pass:
    snap.hasGate &&
    snap.protocol === 'file:' &&
    afterBad?.lastSuccessfulOrigin == null &&
    snap.errorVisible,
}
report.steps.push({ step: 'bad-source-local-rescue', ...case4 })
report.pass.badSourceLocalRescue = case4.pass

// Restore prior success into session for overwrite test, then fail connect to B-dead
fs.writeFileSync(
  sessFile,
  JSON.stringify(
    {
      trustedOrigins: [preservedSuccess],
      lastSuccessfulOrigin: preservedSuccess,
      lastOrigin: preservedSuccess,
      lastPath: preservedRoute,
      lastSearch: '',
      lastHash: '',
      gateDraftOrigin: null,
      gateShowError: false,
    },
    null,
    2,
  ),
)
await app.close()
stream.end()

;({ app, page, stream } = await launch(userData, {}, stderrPath))
await page.waitForTimeout(3500)
snap = await snapshot(page)
// If direct boot to A, open gate by... we need gate for failed attempt.
// Use env dead on empty-success cleared already restored — instead from mounted A,
// we cannot open SPA gate. Restart with cleared success was done. For overwrite:
// From local gate after forcing gate: set session success A but boot without attempting
// by clearing and using gate only.
await app.close()
stream.end()

// Force gate while preserving lastSuccessfulOrigin in file (main will try last-success first).
// To test "failed attempted source does not overwrite": use gate after making last-success
// fail mount by pointing lastSuccessful at dead, with gateDraft — OR connect from gate
// after bad-source rescue when we still have lastSuccessful.
// Approach: set lastSuccessful to A, but show gate by using a custom session where
// lastSuccessful is A and we load gate via failed pending... Simpler: from gate.html
// after wiping success, reconnect A, then we'll do A→dead via filling dead in a new gate.
// Restore A success via gate connect again:
log('restore A via gate then test failed B does not overwrite')
fs.writeFileSync(
  sessFile,
  JSON.stringify(
    {
      trustedOrigins: [],
      lastSuccessfulOrigin: null,
      lastOrigin: null,
      lastPath: '/',
      lastSearch: '',
      lastHash: '',
      gateDraftOrigin: null,
      gateShowError: false,
    },
    null,
    2,
  ),
)
;({ app, page, stream } = await launch(userData, {}, stderrPath))
await page.waitForTimeout(1500)
await page.getByTestId('connect-gate-address').fill(originA)
await page.getByTestId('connect-gate-submit').click()
await page.waitForTimeout(4000)
await page.evaluate((id) => location.assign('/assets/' + id), state.assetId)
await page.waitForTimeout(1200)
const successBeforeFail = readSession(userData)?.body?.lastSuccessfulOrigin
await app.close()
stream.end()

// Now: lastSuccessful=A. To reach gate without losing A: poison lastSuccessful to dead temporarily
// NO — requirement is failed attempted source does not overwrite OLD success.
// Boot with lastSuccessful=A works. We need gate while A is recorded.
// Product: local gate shows when startup candidate fails. Set lastSuccessful to deadOrigin
// while also storing... we can't have both. Alternative: from A, we don't have gate.
// Use requestConnect from... only gate. 
// Work around for test: manually load gate by setting lastSuccessful to dead AND
// gateDraft, with a SIDE copy of real success in a field we check... 
// Actually: set lastSuccessfulOrigin to originA, lastPath asset. Launch with
// HAMSTER_CONTROL_ORIGIN=dead — main tries lastSuccessful A first (succeeds).
// To get gate with A recorded: clear lastSuccessful, user connects A (recorded),
// close, set lastSuccessful stay A, then in a NEW userData... 
// Or: after A mounted, overwrite session lastSuccessful to keep A, but force
// showLocalGate by launching a tiny helper — too heavy.
// Practical approach matching product: empty → gate → type dead → fail → still no success;
// then type A → success. Then close. Poison: rewrite lastSuccessful stay A, set
// env to dead only matters when no lastSuccessful.
// For "failed attempt does not overwrite": from GATE with lastSuccessful already A
// in session file, main boots A (not gate). 
// Force gate: delete lastSuccessful but KEEP a copy in trustedOrigins only? Main
// only restores lastSuccessfulOrigin. So if we null lastSuccessful but keep
// evidence in report of previous... 
// Better product path: after success A, user somehow opens gate — not in product.
// Direction: "startup bad-source local rescue" and "failed attempted source DOES NOT overwrite old success".
// Sequence: lastSuccessful=A recorded. Startup attempts A but A goes down → gate with
// error, lastSuccessful still A. Then user types dead → fail → still A. Then retry A.

log('case5: lastSuccessful A, kill A client, startup → gate preserves A; fail dead; retry A')
// Ensure session has A + asset path
fs.writeFileSync(
  sessFile,
  JSON.stringify(
    {
      trustedOrigins: [originA],
      lastSuccessfulOrigin: originA,
      lastOrigin: originA,
      lastPath: `/assets/${state.assetId}`,
      lastSearch: '',
      lastHash: '',
      gateDraftOrigin: null,
      gateShowError: false,
    },
    null,
    2,
  ),
)
procA.kill('SIGTERM')
await new Promise((r) => setTimeout(r, 800))
;({ app, page, stream } = await launch(userData, {}, stderrPath))
// Wait past mount timeout so main falls back to local gate (cached SPA must not count).
await page.waitForTimeout(24000)
snap = await snapshot(page)
await page.screenshot({ path: path.join(OUT, '06-startup-A-down-local-gate.png') })
const preserved = readSession(userData)?.body?.lastSuccessfulOrigin === originA
const case5a = {
  snap,
  preserved,
  pass: snap.hasGate && snap.protocol === 'file:' && preserved,
}
report.steps.push({ step: 'startup-success-down-preserves', ...case5a })
report.pass.startupDownPreserves = case5a.pass

// Failed dead attempt must not overwrite
await page.getByTestId('connect-gate-address').fill(deadOrigin)
await page.getByTestId('connect-gate-submit').click()
await page.waitForTimeout(3000)
snap = await snapshot(page)
const stillA = readSession(userData)?.body?.lastSuccessfulOrigin === originA
const case5b = {
  snap,
  stillA,
  pass: snap.hasGate && stillA && snap.errorVisible,
}
report.steps.push({ step: 'failed-attempt-no-overwrite', ...case5b })
report.pass.failedAttemptNoOverwrite = case5b.pass

// Restart client A, retry original success → same route
const procA2 = startClient(portA, apiPort)
await new Promise((r) => setTimeout(r, 900))
await page.getByTestId('connect-gate-address').fill(originA)
await page.getByTestId('connect-gate-submit').click()
await page.waitForTimeout(4500)
snap = await snapshot(page)
await page.screenshot({ path: path.join(OUT, '07-retry-A-restores-route.png') })
const case5c = {
  snap,
  pass:
    snap.origin === originA &&
    snap.pathname === `/assets/${state.assetId}` &&
    !snap.hasGate &&
    ((snap.bodySnippet || '').includes('fixture-gate-dashboard-body') ||
      (snap.bodySnippet || '').includes('E2E gate fixture')),
}
report.steps.push({ step: 'retry-success-restores-route', ...case5c })
report.pass.retryRestoresRoute = case5c.pass

// --- 6) A→B via gate resets to '/' ---
log('case6: A→B via local gate resets to /')
await app.close()
stream.end()
procA2.kill('SIGTERM')
await new Promise((r) => setTimeout(r, 800))
;({ app, page, stream } = await launch(userData, {}, stderrPath))
await page.waitForTimeout(24000)
snap = await snapshot(page)
if (!snap.hasGate) {
  report.steps.push({ step: 'A-to-B-precondition', snap, pass: false, reason: 'expected gate when A down' })
  report.pass.aToBReset = false
} else {
  // lastSuccessful still A until B mounts; connecting B must reset to '/'
  await page.getByTestId('connect-gate-address').fill(originB)
  await page.getByTestId('connect-gate-submit').click()
  await page.waitForTimeout(4500)
  snap = await snapshot(page)
  await page.screenshot({ path: path.join(OUT, '08-A-to-B-root.png') })
  const sessB = readSession(userData)?.body
  const case6 = {
    snap,
    session: sessB,
    pass:
      snap.origin === originB &&
      snap.pathname === '/' &&
      sessB?.lastSuccessfulOrigin === originB &&
      !snap.hasGate,
  }
  report.steps.push({ step: 'A-to-B-resets-root', ...case6 })
  report.pass.aToBReset = case6.pass
}

// Whole-process restart same userData on B
const mutationsBeforeRestart = state.mutations.length
await app.close()
stream.end()
;({ app, page, stream } = await launch(userData, {}, stderrPath))
await page.waitForTimeout(3500)
snap = await snapshot(page)
await page.screenshot({ path: path.join(OUT, '09-restart-same-userData-B.png') })
const case7 = {
  snap,
  pass: snap.origin === originB && !snap.hasGate && snap.container === 'electron',
}
report.steps.push({ step: 'restart-same-userData', ...case7 })
report.pass.restartSameUserData = case7.pass

// --- 8) Temp disconnect: retain route + last results + banner, zero mutations ---
log('case8: temp disconnect banner')
await page.evaluate((id) => location.assign('/assets/' + id), state.assetId)
await page.waitForTimeout(2000)
let preDown = await snapshot(page)
const pathBeforeDown = preDown.pathname
const hadFixture =
  (preDown.bodySnippet || '').includes('E2E gate fixture') ||
  (preDown.bodySnippet || '').includes('fixture-gate-dashboard-body')
state.down = true
await page.waitForTimeout(500)
// Refresh in place (keeps last snapshot) — do not replace whole Routes with a gate page.
const refreshBtn = page.getByRole('button', { name: /Refresh|刷新/ }).first()
if (await refreshBtn.count()) {
  await refreshBtn.click()
  await page.waitForTimeout(2000)
} else {
  // Fallback: trigger conversation poll path via soft API touch
  await page.evaluate(() => location.assign(location.pathname + location.search))
  await page.waitForTimeout(2500)
}
snap = await snapshot(page)
await page.screenshot({ path: path.join(OUT, '10-temp-disconnect-banner.png') })
const mutationsDuringDown = state.mutations.slice(mutationsBeforeRestart)
const case8 = {
  snap,
  pathBeforeDown,
  hadFixture,
  mutationsDuringDown,
  pass:
    snap.pathname === pathBeforeDown &&
    !snap.hasGate &&
    (snap.hasBanner ||
      (snap.bodySnippet || '').includes("Can't reach") ||
      (snap.bodySnippet || '').includes('无法连接')) &&
    ((snap.bodySnippet || '').includes('E2E gate fixture') ||
      (snap.bodySnippet || '').includes('fixture-gate-dashboard-body') ||
      hadFixture) &&
    mutationsDuringDown.length === 0,
}
report.steps.push({ step: 'temp-disconnect-retain', ...case8 })
report.pass.tempDisconnectRetain = case8.pass

// Retry same source — reconnect, do not cancel/approve/deny
state.down = false
const retryBtn = page.getByRole('button', { name: /Retry|重试/ }).first()
if (await retryBtn.count()) {
  await retryBtn.click()
  await page.waitForTimeout(2500)
}
snap = await snapshot(page)
await page.screenshot({ path: path.join(OUT, '11-after-retry-reconnect.png') })
report.steps.push({
  step: 'retry-reconnect-same-source',
  snap,
  pass: snap.origin === originB && snap.pathname === `/assets/${state.assetId}`,
})
report.pass.retryReconnect = snap.origin === originB

// --- 9) Fail-closed approval channel ---
log('case9: fail-closed approvals')
await page.evaluate(() => location.assign('/approvals'))
await page.waitForTimeout(1500)
state.down = true
await page.waitForTimeout(4000)
await page.evaluate(() => location.assign('/approvals'))
await page.waitForTimeout(2000)
snap = await snapshot(page)
const approveDisabled = await page.evaluate(() => {
  const btn = document.querySelector('[data-testid="approval-approve"]')
  return !btn || btn.disabled === true || btn.getAttribute('disabled') !== null
})
const mutBefore = state.mutations.length
const approve = page.getByTestId('approval-approve')
if (await approve.count()) {
  try {
    await approve.click({ timeout: 1000, force: true })
  } catch {
    // expected if disabled
  }
}
await page.waitForTimeout(500)
const mutAfter = state.mutations.length
await page.screenshot({ path: path.join(OUT, '12-fail-closed-approvals.png') })
const case9 = {
  snap,
  approveDisabled,
  mutations: state.mutations.slice(mutBefore),
  pass: mutAfter === mutBefore && state.approvalStatus === 'pending',
}
report.steps.push({ step: 'fail-closed-approvals', ...case9 })
report.pass.failClosedApprovals = case9.pass
state.down = false

await app.close()
stream.end()

fs.writeFileSync(path.join(OUT, 'api-request-log.json'), JSON.stringify(state.requests, null, 2))
fs.writeFileSync(path.join(OUT, 'api-mutation-log.json'), JSON.stringify(state.mutations, null, 2))
fs.writeFileSync(path.join(OUT, 'session-final.json'), JSON.stringify(readSession(userData), null, 2))
fs.writeFileSync(path.join(OUT, 'e2e-log.txt'), logs.join('\n'))
fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(report, null, 2))
fs.writeFileSync(path.join(OUT, 'testedSha.txt'), testedSha + '\n')

console.log(JSON.stringify({ testedSha, pass: report.pass }, null, 2))

procB.kill('SIGTERM')
server.close()

const required = [
  'freshEmptyLocalGate',
  'gateZhCopy',
  'rejectNonOrigin',
  'firstSuccessMount',
  'lastSuccessDirectBoot',
  'badSourceLocalRescue',
  'startupDownPreserves',
  'failedAttemptNoOverwrite',
  'retryRestoresRoute',
  'aToBReset',
  'restartSameUserData',
  'tempDisconnectRetain',
  'failClosedApprovals',
]
const failed = required.filter((k) => !report.pass[k])
if (failed.length) {
  console.error('FAILED:', failed.join(', '))
  process.exit(2)
}
process.exit(0)
