#!/usr/bin/env node
/**
 * Node entrypoint parity for client/server.mjs (NOT a Docker image build).
 *
 * Validates default production static server behavior that `serve -s dist` does NOT provide:
 *   - Cache-Control: no-cache on / (index.html) and /sw.js
 *   - Missing /assets/*.js → 404 (not SPA HTML)
 *   - SPA fallback for app routes
 *   - /api/* reverse-proxied to API_UPSTREAM
 *   - /internal NOT proxied (must not hit API upstream)
 *
 * Usage (from client/ with dist/ built):
 *   npm run test:entrypoint-parity
 * Env:
 *   CLIENT_ROOT  (default: parent of scripts/)
 *   DIST_DIR     (default: CLIENT_ROOT/dist)
 */
import http from 'node:http'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CLIENT_ROOT = path.resolve(process.env.CLIENT_ROOT || path.join(__dirname, '..'))
const DIST_DIR = path.resolve(process.env.DIST_DIR || path.join(CLIENT_ROOT, 'dist'))
const SERVER_JS = path.join(CLIENT_ROOT, 'server.mjs')

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

async function main() {
  assert(fs.existsSync(path.join(DIST_DIR, 'index.html')), `missing ${DIST_DIR}/index.html — build first`)
  assert(fs.existsSync(path.join(DIST_DIR, 'sw.js')), `missing ${DIST_DIR}/sw.js`)
  assert(fs.existsSync(SERVER_JS), `missing ${SERVER_JS}`)

  const fixtureHits = []
  const fixture = http.createServer((req, res) => {
    fixtureHits.push(req.url)
    res.setHeader('content-type', 'application/json')
    if ((req.url || '').startsWith('/api/health')) {
      res.end(JSON.stringify({ status: 'ok', fixture: true }))
      return
    }
    res.writeHead(404)
    res.end(JSON.stringify({ error: 'fixture-miss' }))
  })
  await new Promise((r) => fixture.listen(0, '127.0.0.1', r))
  const fixturePort = fixture.address().port
  const API_UPSTREAM = `http://127.0.0.1:${fixturePort}`

  const PORT = 3100 + Math.floor(Math.random() * 200)
  const child = spawn(process.execPath, [SERVER_JS], {
    cwd: CLIENT_ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      DIST_DIR,
      API_UPSTREAM,
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

  const origin = `http://127.0.0.1:${PORT}`
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(origin + '/')
      if (res.ok || res.status) break
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }

  const results = { kind: 'node_entrypoint_parity_not_docker_image', origin, API_UPSTREAM, checks: [] }

  async function check(name, fn) {
    try {
      await fn()
      results.checks.push({ name, ok: true })
    } catch (err) {
      results.checks.push({ name, ok: false, error: String(err.message || err) })
    }
  }

  await check('index_no_cache', async () => {
    const res = await fetch(origin + '/')
    assert(res.status === 200, `status ${res.status}`)
    const cc = res.headers.get('cache-control') || ''
    assert(cc.includes('no-cache'), `cache-control=${cc}`)
    const ct = res.headers.get('content-type') || ''
    assert(ct.includes('text/html'), `content-type=${ct}`)
  })

  await check('sw_js_no_cache', async () => {
    const res = await fetch(origin + '/sw.js')
    assert(res.status === 200, `status ${res.status}`)
    const cc = res.headers.get('cache-control') || ''
    assert(cc.includes('no-cache'), `cache-control=${cc}`)
    const body = await res.text()
    assert(body.includes('HAMSTER_PWA_BUILD') || body.includes('SKIP_WAITING'), 'sw body unexpected')
  })

  await check('missing_asset_404_not_spa_html', async () => {
    const res = await fetch(origin + '/assets/index-MISSING-parity.js')
    assert(res.status === 404, `expected 404 got ${res.status}`)
    const ct = res.headers.get('content-type') || ''
    assert(!ct.includes('text/html'), `must not SPA HTML poison, got ${ct}`)
  })

  await check('spa_fallback_approvals', async () => {
    const res = await fetch(origin + '/approvals')
    assert(res.status === 200, `status ${res.status}`)
    const ct = res.headers.get('content-type') || ''
    assert(ct.includes('text/html'), `content-type=${ct}`)
  })

  await check('api_proxy_health', async () => {
    const before = fixtureHits.length
    const res = await fetch(origin + '/api/health')
    assert(res.status === 200, `status ${res.status}`)
    const j = await res.json()
    assert(j.status === 'ok' && j.fixture === true, `body=${JSON.stringify(j)}`)
    assert(fixtureHits.length > before, 'fixture not hit — proxy failed')
  })

  await check('internal_not_proxied', async () => {
    const before = fixtureHits.length
    const res = await fetch(origin + '/internal/anything')
    // Guard: must NOT hit API upstream (whether SPA-falls-back or 404).
    assert(fixtureHits.length === before, `internal leaked to API upstream: ${fixtureHits.slice(before)}`)
    assert([200, 404].includes(res.status), `unexpected status ${res.status}`)
  })

  results.pass = results.checks.every((c) => c.ok)
  results.bootLogTail = boot.slice(-400)
  results.note =
    'This validates Node `server.mjs` entry only. Docker IMAGE build/CMD swap is NOT executed here (IndependentDocker unavailable).'

  child.kill()
  fixture.close()

  console.log(JSON.stringify(results, null, 2))
  if (!results.pass) process.exitCode = 1
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
