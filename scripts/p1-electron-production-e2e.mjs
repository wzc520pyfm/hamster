#!/usr/bin/env node
/**
 * Production Electron E2E — REAL electron/main.js (not mirrored IPC).
 * Driver: Playwright _electron. Gate interaction: ConnectGate input+click only.
 * Fixture API labeled x-hamster-fixture. Avoids ports 10889/5175/4173.
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
const OUT = process.env.P1_E2E_OUT || '/opt/cursor/artifacts/p1-electron-production-e2e-evidence'
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

function createFixtureApi() {
  const state = {
    conversationId: 'conv_e2e_prod_1',
    title: 'E2E fixture conversation',
    assetId: 'asset_e2e_dashboard_1',
    taskId: 'task_e2e_1',
    runtimeSessionId: 'rt_e2e_1',
    approvalId: 'appr_e2e_1',
    approvalStatus: 'pending',
    mutations: [],
    requests: [],
  }
  const server = http.createServer((req, res) => {
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
            content: 'start task: E2E fixture dashboard',
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
            title: 'E2E fixture dashboard',
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
                taskTitle: 'E2E fixture dashboard',
                action: 'publish_dashboard',
                params: { assetId: state.assetId, channel: 'shared workspace' },
                status: state.approvalStatus,
                expiresAt: '2026-11-21T18:00:00.000Z',
              },
            ],
          },
        ],
        approvals: [
          {
            id: state.approvalId,
            taskId: state.taskId,
            taskTitle: 'E2E fixture dashboard',
            action: 'publish_dashboard',
            params: { assetId: state.assetId, channel: 'shared workspace' },
            status: state.approvalStatus,
            expiresAt: '2026-11-21T18:00:00.000Z',
          },
        ],
      })
    }
    if (url.pathname === '/api/approvals') {
      const status = url.searchParams.get('status')
      const all = [
        {
          id: state.approvalId,
          taskId: state.taskId,
          taskTitle: 'E2E fixture dashboard',
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
          title: 'E2E fixture dashboard',
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
      // openui must be a React Lang 1.0 *string* (see AssetDetail); object JSON blanked the view.
      const openui = [
        `head = CardHeader("E2E fixture dashboard", "assetId ${id} · fixture")`,
        'note = Note("fixture-dashboard-body")',
        'root = Stack([head, note])',
        '',
      ].join('\n')
      return json(200, {
        assetId: id,
        title: 'E2E fixture dashboard',
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
      state.mutations.push({ t: entryTime(), kind: decide[2], id: decodeURIComponent(decide[1]), path: url.pathname })
      state.approvalStatus = decide[2] === 'approve' ? 'approved' : 'denied'
      return json(200, { id: decodeURIComponent(decide[1]), status: state.approvalStatus, fixture: true })
    }
    const cancel = url.pathname.match(/^\/api\/tasks\/([^/]+)\/cancel$/)
    if (cancel && req.method === 'POST') {
      state.mutations.push({ t: entryTime(), kind: 'cancel', id: decodeURIComponent(cancel[1]), path: url.pathname })
      return json(200, { ok: true, fixture: true })
    }
    return json(404, { error: 'fixture-miss', path: url.pathname, fixture: true })
  })
  function entryTime() {
    return new Date().toISOString()
  }
  return { state, server }
}

function startClient(port, apiPort) {
  return spawn(process.execPath, [path.join(ROOT, 'client/server.mjs')], {
    env: { ...process.env, PORT: String(port), API_UPSTREAM: `http://127.0.0.1:${apiPort}`, DIST_DIR: DIST },
    stdio: 'ignore',
  })
}

async function launch(userDataDir, controlOrigin, stderrFile) {
  const stream = fs.createWriteStream(stderrFile, { flags: 'a' })
  stream.write(`\n=== ${new Date().toISOString()} controlOrigin=${controlOrigin} userData=${userDataDir}\n`)
  const app = await _electron.launch({
    executablePath: ELECTRON_BIN,
    args: [MAIN_JS, `--user-data-dir=${userDataDir}`],
    cwd: path.join(ROOT, 'electron'),
    env: {
      ...process.env,
      HAMSTER_CONTROL_ORIGIN: controlOrigin,
      HAMSTER_CONTROL_BASE_URL: controlOrigin,
    },
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

const report = { testedSha, fixture: true, steps: [] }
const { state, server } = createFixtureApi()
const apiPort = await freePort()
await new Promise((r) => server.listen(apiPort, '127.0.0.1', r))
const portA = await freePort()
const portB = await freePort()
const procA = startClient(portA, apiPort)
const procB = startClient(portB, apiPort)
await new Promise((r) => setTimeout(r, 900))

const originA = `http://127.0.0.1:${portA}`
const originB = `http://127.0.0.1:${portB}`
report.origins = { originA, originB, apiPort }

for (const o of [originA, originB]) {
  const h = await fetch(`${o}/api/health`).then((r) => r.json())
  if (h.status !== 'ok') throw new Error('health failed ' + o)
}

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'hamster-prod-e2e-'))
fs.writeFileSync(
  path.join(OUT, 'launch-command.txt'),
  [
    `testedSha=${testedSha}`,
    `executable=${ELECTRON_BIN}`,
    `args=${MAIN_JS} --user-data-dir=${userData}`,
    `cwd=${path.join(ROOT, 'electron')}`,
    `HAMSTER_CONTROL_ORIGIN / HAMSTER_CONTROL_BASE_URL set per phase`,
    `webPreferences: production main.js (sandbox:true, contextIsolation:true)`,
    `driver=playwright._electron (does not replace main/preload/guards)`,
  ].join('\n'),
)

const stderr1 = path.join(OUT, 'electron-stderr.txt')
fs.writeFileSync(stderr1, '')
let { app, page, stream } = await launch(userData, originA, stderr1)
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(2000)

const boot = await page.evaluate(() => ({
  href: location.href,
  origin: location.origin,
  hasGate: Boolean(document.querySelector('[data-testid="connect-gate"]')),
  hasConversation: Boolean(document.querySelector('[data-testid="conversation-column"]')),
  container: window.hamster?.container ?? null,
  sessionOrigin: typeof window.hamster?.sessionOrigin === 'function' ? window.hamster.sessionOrigin() : null,
  controlBase: typeof window.hamster?.controlBaseUrl === 'function' ? window.hamster.controlBaseUrl() : null,
}))
await page.screenshot({ path: path.join(OUT, '01-boot-A.png') })
report.steps.push({ step: 'boot-A', boot })

// ConnectGate UI A→B
let connectGateResult
if (boot.hasGate) {
  await page.getByTestId('connect-gate-address').fill(originB)
  await page.getByTestId('connect-gate-submit').click()
  await page.waitForTimeout(2500)
  const after = await page.evaluate(() => ({
    href: location.href,
    origin: location.origin,
    container: window.hamster?.container ?? null,
    sessionOrigin: typeof window.hamster?.sessionOrigin === 'function' ? window.hamster.sessionOrigin() : null,
    hasGate: Boolean(document.querySelector('[data-testid="connect-gate"]')),
  }))
  await page.screenshot({ path: path.join(OUT, '02-after-connect-gate.png') })
  const servedByB = state.requests.filter((r) => (r.host || '').includes(String(portB)))
  connectGateResult = {
    attempted: true,
    after,
    pass: after.origin === originB && after.container === 'electron' && !after.hasGate,
    requestsWithHostB: servedByB.length,
  }
} else {
  connectGateResult = {
    attempted: false,
    skipped: true,
    pass: false,
    reason:
      'ConnectGate not shown after REAL main.js load of HAMSTER_CONTROL_ORIGIN (same-origin session). isSameOriginControlBase() is true when sessionOrigin matches page. No legitimate in-app control re-opens the gate without product change. Cannot perform ConnectGate input+click A→B; 33d861a remains unverified by production ConnectGate UI.',
  }
  await page.screenshot({ path: path.join(OUT, '02-gate-hidden-same-origin.png') })
}
report.steps.push({ step: 'connect-gate-A-to-B', ...connectGateResult })

// UI navigate to asset + approvals (on whichever origin we have)
const ids = {
  conversationId: state.conversationId,
  taskId: state.taskId,
  runtimeSessionId: state.runtimeSessionId,
  assetId: state.assetId,
  approvalId: state.approvalId,
}

if (!boot.hasGate || connectGateResult.pass) {
  // Dashboards
  await page.evaluate(() => {
    const a = [...document.querySelectorAll('a')].find((el) => (el.getAttribute('href') || '') === '/assets')
    a?.click()
  })
  await page.waitForTimeout(800)
  await page.evaluate((id) => {
    location.assign('/assets/' + id)
  }, state.assetId)
  await page.waitForTimeout(1200)
  await page.screenshot({ path: path.join(OUT, '03-asset.png') })
  const assetUrl = page.url()

  await page.evaluate(() => location.assign('/approvals'))
  await page.waitForTimeout(1200)
  const approvalVisible = (await page.locator(`[data-approval-id="${state.approvalId}"]`).count()) > 0
  await page.screenshot({ path: path.join(OUT, '04-approvals.png') })

  // Leave on asset route for restore
  await page.evaluate((id) => location.assign('/assets/' + id), state.assetId)
  await page.waitForTimeout(1500)
  const assetBody = await page.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').trim())
  await page.screenshot({ path: path.join(OUT, '05-before-close.png') })
  report.steps.push({
    step: 'ui-routes',
    assetUrl,
    approvalVisible,
    beforeCloseUrl: page.url(),
    assetBodyHasFixture: assetBody.includes('fixture-dashboard-body') || assetBody.includes('E2E fixture dashboard'),
    assetBodySnippet: assetBody.slice(0, 240),
    ids,
  })
}

const bridgeBefore = await page.evaluate(() => ({
  href: location.href,
  container: window.hamster?.container ?? null,
  sessionOrigin: typeof window.hamster?.sessionOrigin === 'function' ? window.hamster.sessionOrigin() : null,
}))
const sessionsBefore = findSessions(userData).map((p) => ({
  path: p,
  body: JSON.parse(fs.readFileSync(p, 'utf8')),
}))
report.sessionBeforeClose = sessionsBefore
const mutationCountAtClose = state.mutations.length
const requestCountAtClose = state.requests.length

await app.close()
stream.end()
report.steps.push({ step: 'closed-electron-process', bridgeBefore })

// Reopen same userData
const stderr2 = path.join(OUT, 'electron-stderr-reopen.txt')
fs.writeFileSync(stderr2, '')
;({ app, page, stream } = await launch(userData, originA, stderr2))
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(3000)
const afterReopen = await page.evaluate(() => ({
  href: location.href,
  origin: location.origin,
  pathname: location.pathname,
  container: window.hamster?.container ?? null,
  sessionOrigin: typeof window.hamster?.sessionOrigin === 'function' ? window.hamster.sessionOrigin() : null,
  hasGate: Boolean(document.querySelector('[data-testid="connect-gate"]')),
  bodySnippet: (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 240),
}))
await page.screenshot({ path: path.join(OUT, '06-after-reopen.png') })

const restoredAsset = afterReopen.pathname === `/assets/${state.assetId}`
const restoredVisible =
  (afterReopen.bodySnippet || '').includes('E2E fixture dashboard') ||
  (afterReopen.bodySnippet || '').includes('fixture-dashboard-body')
const surprise = state.mutations.slice(mutationCountAtClose)
report.reopen = {
  afterReopen,
  restoredAsset,
  restoredVisible,
  expectedPath: `/assets/${state.assetId}`,
  ids,
  approvalStillPending: state.approvalStatus === 'pending',
  surpriseMutations: surprise,
  requestsAfterReopen: state.requests.slice(requestCountAtClose),
}

report.pass = {
  realMainJs: true,
  bridgeElectron: afterReopen.container === 'electron' || boot.container === 'electron',
  connectGateUiAb: connectGateResult.pass === true,
  connectGateBoundary: connectGateResult.skipped === true,
  reopenAsset: restoredAsset,
  reopenVisible: restoredVisible,
  noApproveDenyCancelOnReopen: surprise.length === 0,
  pendingUnchanged: state.approvalStatus === 'pending',
}

fs.writeFileSync(path.join(OUT, 'api-request-log.json'), JSON.stringify(state.requests, null, 2))
fs.writeFileSync(
  path.join(OUT, 'api-mutation-log.json'),
  JSON.stringify({ all: state.mutations, afterReopenSurprise: surprise }, null, 2),
)
fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ pass: report.pass, connectGate: connectGateResult, reopen: report.reopen }, null, 2))

await app.close()
stream.end()
procA.kill('SIGTERM')
procB.kill('SIGTERM')
server.close()

if (!report.pass.reopenAsset || !report.pass.reopenVisible || !report.pass.noApproveDenyCancelOnReopen) {
  process.exit(2)
}
process.exit(0)
