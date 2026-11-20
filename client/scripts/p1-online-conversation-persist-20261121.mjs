#!/usr/bin/env node
/**
 * P1 evidence: REAL API + truly NEW ephemeral Postgres — natural conversation
 * create → user message persist → online browser refresh recovery.
 *
 * Not fixed fixture-seed conversation IDs. API/DB generate conversationId + message ids.
 * Model/assistant inference: out of scope for paid providers. Local fixture Eve accepts
 * chat sessions without inference; proof target is user message + metadata persistence
 * owned by API/DB, then PROD React reload renders the same IDs/content.
 *
 * Safety: start-ephemeral-pg.sh only; live SHOW data_directory + marker token match
 * before any destructive/read verification SQL. No shared :5432.
 *
 * Run: node client/scripts/p1-online-conversation-persist-20261121.mjs
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { chromium } from 'playwright'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.join(__dirname, '../..')
const CLIENT = path.join(REPO, 'client')
const EVIDENCE_REPO = path.join(REPO, 'docs/evidence/p1-online-conversation-persist-20261121')
const EVIDENCE_RAW = '/opt/cursor/artifacts/p1-online-conversation-persist-20261121'
const UNIQUE_TEXT = `P1-online-persist-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`

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

function ensureDirs() {
  fs.mkdirSync(EVIDENCE_REPO, { recursive: true })
  fs.mkdirSync(EVIDENCE_RAW, { recursive: true })
}

function startEphemeralPg() {
  // Do not inherit a prior HAMSTER_P2_PG_ROOT / marker — force a truly new cluster.
  const cleanEnv = { ...process.env }
  for (const k of Object.keys(cleanEnv)) {
    if (k.startsWith('HAMSTER_P2_') || k === 'DATABASE_URL') delete cleanEnv[k]
  }
  const r = spawnSync('bash', ['-c', 'api/scripts/start-ephemeral-pg.sh'], {
    cwd: REPO,
    encoding: 'utf8',
    env: cleanEnv,
  })
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
    throw new Error(
      `ephemeral PG exports missing (parsed keys=${Object.keys(env).join(',')}): ${r.stdout}`,
    )
  }
  // Do not clobber the agent PATH with the script's unevaluated `$PATH` export line.
  delete env.PATH
  return { env, stderr: r.stderr, evidenceJson: env.HAMSTER_P2_PG_EVIDENCE }
}

function stopEphemeralPg(env) {
  spawnSync('bash', ['api/scripts/stop-ephemeral-pg.sh'], {
    cwd: REPO,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
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
      res.end(JSON.stringify({ ok: true, fixtureLabel: 'local-eve-sendMessage-ack-no-model' }))
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
        label: 'local-fixture-eve-no-paid-inference',
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
      HAMSTER_INTERNAL_SECRET: 'p1-persist-evidence-secret',
      // Isolation broker will fail docker calls — fine; we never create isolated tasks here
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

function buildClient() {
  sh('npm run build', { cwd: CLIENT })
  return path.join(CLIENT, 'dist')
}

async function startStaticProdProxy(dist, apiPort) {
  const { shouldSpaFallback, cacheControlForPath } = await import(path.join(CLIENT, 'server.mjs'))
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
    if (urlPath.startsWith('/api/') || urlPath === '/health') {
      const u = new URL(req.url || '/', `http://127.0.0.1:${apiPort}`)
      const proxyReq = http.request(
        u,
        { method: req.method, headers: { ...req.headers, host: u.host } },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode || 502, proxyRes.headers)
          proxyRes.pipe(res)
        },
      )
      proxyReq.on('error', (e) => {
        res.writeHead(502)
        res.end(String(e))
      })
      req.pipe(proxyReq)
      return
    }
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '')
    const filePath = path.join(dist, rel)
    if (!(filePath.startsWith(dist) && fs.existsSync(filePath) && fs.statSync(filePath).isFile())) {
      if (!shouldSpaFallback(urlPath)) {
        res.writeHead(404)
        res.end('not found')
        return
      }
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': cacheControlForPath('index.html'),
      })
      fs.createReadStream(path.join(dist, 'index.html')).pipe(res)
      return
    }
    res.writeHead(200, {
      'content-type': filePath.endsWith('.js')
        ? 'text/javascript; charset=utf-8'
        : filePath.endsWith('.css')
          ? 'text/css; charset=utf-8'
          : 'text/html; charset=utf-8',
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

function pushStep(evidence, step) {
  if (typeof step.ok !== 'boolean') throw new Error(`step ${step.step} missing ok`)
  evidence.steps.push({ ...step, at: new Date().toISOString() })
  if (!step.ok) throw new Error(`step failed: ${step.step} ${JSON.stringify(step)}`)
}

async function main() {
  ensureDirs()
  const evidence = {
    at: new Date().toISOString(),
    kind: 'p1_online_conversation_persist_real_api_ephemeral_pg',
    uniqueUserText: UNIQUE_TEXT,
    modelResponseScope:
      'Paid model inference not used. Local fixture Eve acknowledges sessions/messages without generating assistant content. Proof is API/DB-owned conversationId + user message id/content persistence and online React refresh recovery.',
    productBoundaryOffline:
      'Offline empty history remains PRODUCT BOUNDARY — only hamster.locale / hamster.controlBase persist in React localStorage. Not claimed here.',
    steps: [],
    pass: false,
  }

  let pg = null
  let eve = null
  let api = null
  let staticProxy = null
  let browser = null
  let pool = null

  try {
    pg = startEphemeralPg()
    Object.assign(process.env, pg.env)
    evidence.ephemeralPgExports = {
      port: pg.env.HAMSTER_P2_PG_PORT,
      dataDir: pg.env.HAMSTER_P2_PG_DATADIR,
      databaseUrlHost: '127.0.0.1',
      tokenPrefix: String(pg.env.HAMSTER_P2_PG_INSTANCE_TOKEN).slice(0, 8),
    }
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
    const { assertEphemeralLiveConnection } = apiRequire('./src/ephemeralPgGuard.js')
    const { Pool } = apiRequire('pg')
    pool = new Pool({ connectionString: pg.env.DATABASE_URL })
    const live = await assertEphemeralLiveConnection(pool, pg.env)
    evidence.livePgGuard = live
    pushStep(evidence, {
      step: 'ephemeral_pg_live_data_directory_and_marker_match',
      live,
      ok:
        live.verified === true &&
        String(live.liveDataDirectory).includes('hamster-p2-ephemeral-pg-') &&
        live.markerToken === pg.env.HAMSTER_P2_PG_INSTANCE_TOKEN,
    })

    eve = await startFixtureEve()
    evidence.fixtureEve = { baseUrl: eve.baseUrl, label: eve.label }

    const apiPort = 18080 + Math.floor(Math.random() * 1000)
    api = startApi(pg.env, eve.baseUrl, apiPort)
    await waitApiHealth(apiPort)
    evidence.api = { port: apiPort, logFile: api.logFile }

    const dist = buildClient()
    staticProxy = await startStaticProdProxy(dist, apiPort)
    const origin = staticProxy.origin
    evidence.origin = origin

    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()
    await page.goto(origin + '/', { waitUntil: 'networkidle' })
    await page.waitForSelector('[data-testid="conversation-column"]', { timeout: 30000 })

    const convBefore = await page.evaluate(() => {
      const t = document.querySelector('[data-testid="conversation-column"]')?.innerText || ''
      const m = t.match(/conversationId:\s*(\S+)/)
      return { conversationIdVisible: m?.[1] || null, sample: t.slice(0, 300) }
    })
    pushStep(evidence, {
      step: 'api_generated_conversation_visible_not_fixed_fixture_id',
      convBefore,
      ok:
        Boolean(convBefore.conversationIdVisible) &&
        /^conv_[0-9a-f-]{36}$/i.test(convBefore.conversationIdVisible) &&
        !convBefore.conversationIdVisible.includes('fixture'),
    })

    // Real PROD React composer send
    const input = page.locator('textarea').first()
    await input.fill(UNIQUE_TEXT)
    await page.locator('button[type="submit"]').filter({ hasText: /发送|Send/i }).first().click()
    await page.waitForFunction(
      (text) => (document.body?.innerText || '').includes(text),
      UNIQUE_TEXT,
      { timeout: 20000 },
    )

    const uiAfterSend = await page.evaluate((text) => {
      const col = document.querySelector('[data-testid="conversation-column"]')?.innerText || ''
      const m = col.match(/conversationId:\s*(\S+)/)
      return {
        conversationIdVisible: m?.[1] || null,
        hasUserText: col.includes(text),
        sample: col.slice(0, 500),
      }
    }, UNIQUE_TEXT)

    // Live PG verify again before SELECT
    const live2 = await assertEphemeralLiveConnection(pool, pg.env)
    const dbConv = await pool.query(
      'SELECT id, title, created_at FROM conversations ORDER BY created_at ASC',
    )
    const dbMsgs = await pool.query(
      `SELECT id, conversation_id, role, content, meta, created_at
         FROM messages WHERE content = $1 ORDER BY id ASC`,
      [UNIQUE_TEXT],
    )
    const userRow = dbMsgs.rows[0]
    pushStep(evidence, {
      step: 'db_owns_generated_ids_user_message_persisted',
      live2: { verified: live2.verified, liveDataDirectory: live2.liveDataDirectory },
      dbConversations: dbConv.rows,
      userMessage: userRow
        ? {
            id: String(userRow.id),
            conversation_id: userRow.conversation_id,
            role: userRow.role,
            content: userRow.content,
            meta: userRow.meta,
          }
        : null,
      uiAfterSend,
      ok:
        dbConv.rows.length >= 1 &&
        userRow != null &&
        userRow.role === 'user' &&
        userRow.content === UNIQUE_TEXT &&
        userRow.conversation_id === convBefore.conversationIdVisible &&
        uiAfterSend.hasUserText === true &&
        uiAfterSend.conversationIdVisible === convBefore.conversationIdVisible,
    })

    // Online refresh recovery (not offline)
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForSelector('[data-testid="conversation-column"]', { timeout: 30000 })
    await page.waitForFunction(
      (text) => (document.body?.innerText || '').includes(text),
      UNIQUE_TEXT,
      { timeout: 20000 },
    )
    const uiAfterReload = await page.evaluate((text) => {
      const col = document.querySelector('[data-testid="conversation-column"]')?.innerText || ''
      const m = col.match(/conversationId:\s*(\S+)/)
      return {
        conversationIdVisible: m?.[1] || null,
        hasUserText: col.includes(text),
        sample: col.slice(0, 500),
      }
    }, UNIQUE_TEXT)

    const png = 'online-persist-after-refresh-20261121.png'
    await page.screenshot({ path: path.join(EVIDENCE_REPO, png), fullPage: false })
    fs.copyFileSync(path.join(EVIDENCE_REPO, png), path.join(EVIDENCE_RAW, png))

    pushStep(evidence, {
      step: 'online_refresh_renders_same_conversation_and_user_message',
      uiAfterReload,
      png,
      ok:
        uiAfterReload.conversationIdVisible === convBefore.conversationIdVisible &&
        uiAfterReload.hasUserText === true &&
        uiAfterReload.conversationIdVisible === userRow.conversation_id,
    })

    evidence.pass = evidence.steps.every((s) => s.ok === true)
    evidence.persisted = {
      conversationId: convBefore.conversationIdVisible,
      messageId: String(userRow.id),
      content: UNIQUE_TEXT,
    }
  } catch (err) {
    evidence.error = String(err?.stack || err)
    evidence.pass = false
  } finally {
    if (browser) await browser.close().catch(() => {})
    if (staticProxy?.server) staticProxy.server.close()
    if (api?.child) api.child.kill()
    if (eve?.server) eve.server.close()
    if (pool) await pool.end().catch(() => {})
    if (pg?.env) stopEphemeralPg(pg.env)
  }

  const jsonName = 'online-conversation-persist-20261121.json'
  fs.writeFileSync(path.join(EVIDENCE_REPO, jsonName), JSON.stringify(evidence, null, 2))
  fs.writeFileSync(path.join(EVIDENCE_RAW, jsonName), JSON.stringify(evidence, null, 2))

  const hashes = {}
  for (const f of fs.readdirSync(EVIDENCE_RAW)) {
    const p = path.join(EVIDENCE_RAW, f)
    if (fs.statSync(p).isFile()) {
      hashes[f] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
    }
  }
  fs.writeFileSync(
    path.join(EVIDENCE_RAW, 'SHA256SUMS.txt'),
    Object.entries(hashes)
      .map(([k, v]) => `${v}  ${k}`)
      .join('\n') + '\n',
  )
  fs.copyFileSync(path.join(EVIDENCE_RAW, 'SHA256SUMS.txt'), path.join(EVIDENCE_REPO, 'SHA256SUMS.txt'))

  const md = `# P1 online conversation persist — real API + ephemeral PG (2026-11-21)

pass=${evidence.pass}

## What

- Truly new temp PG via \`start-ephemeral-pg.sh\`
- Live \`SHOW data_directory\` + marker match before SQL
- Real API boot; PROD React UI creates/loads API-generated \`conversationId\`
- User message text persisted in DB (API-owned message id)
- Online browser refresh recovers same IDs/content

## Model response scope

${evidence.modelResponseScope}

## Offline

${evidence.productBoundaryOffline}

## Run

\`\`\`
node client/scripts/p1-online-conversation-persist-20261121.mjs
\`\`\`
`

  fs.writeFileSync(path.join(EVIDENCE_REPO, 'NOTES.md'), md)
  fs.writeFileSync(path.join(EVIDENCE_RAW, 'NOTES.md'), md)

  console.log(
    JSON.stringify(
      {
        pass: evidence.pass,
        evidenceRepo: EVIDENCE_REPO,
        evidenceRaw: EVIDENCE_RAW,
        steps: evidence.steps.map((s) => ({ step: s.step, ok: s.ok })),
        persisted: evidence.persisted || null,
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
