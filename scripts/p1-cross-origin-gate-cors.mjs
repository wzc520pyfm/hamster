#!/usr/bin/env node
/**
 * Reproduce ConnectGate A-origin → B-origin renderer validation against production server.mjs
 * (no CORS). Raw log intended for /opt/cursor/artifacts.
 */
import http from 'node:http'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), '../client/package.json'))
const { chromium } = require('playwright')

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'client', 'dist')
const API_PORT = 18081
const PORT_A = 13001
const PORT_B = 13002

const api = http.createServer((req, res) => {
  const u = new URL(req.url || '/', 'http://127.0.0.1')
  if (u.pathname === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok' }))
    return
  }
  res.writeHead(404).end('no')
})

function startClient(port) {
  return spawn(process.execPath, [path.join(ROOT, 'client', 'server.mjs')], {
    env: {
      ...process.env,
      PORT: String(port),
      API_UPSTREAM: `http://127.0.0.1:${API_PORT}`,
      DIST_DIR: DIST,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

await new Promise((r) => api.listen(API_PORT, '127.0.0.1', r))
const clientA = startClient(PORT_A)
const clientB = startClient(PORT_B)
await new Promise((r) => setTimeout(r, 500))

const originA = `http://127.0.0.1:${PORT_A}`
const originB = `http://127.0.0.1:${PORT_B}`

const health = await fetch(`${originB}/api/health`, {
  headers: { Origin: originA, Accept: 'application/json' },
})
const acao = health.headers.get('access-control-allow-origin')
console.log('B_/api/health status', health.status)
console.log('B_ACAO_header', acao === null ? 'null' : JSON.stringify(acao))
console.log('B_has_cors', Boolean(acao))

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
page.on('console', (msg) => console.log('PAGE_CONSOLE', msg.type(), msg.text()))
await page.goto(originA + '/', { waitUntil: 'domcontentloaded' })

const rendererResult = await page.evaluate(async (targetB) => {
  const out = { health: null, manifest: null, errors: [] }
  try {
    const h = await fetch(`${targetB}/api/health`, { cache: 'no-store', redirect: 'manual' })
    out.health = { ok: h.ok, status: h.status, type: h.type }
    try {
      out.healthBody = await h.json()
    } catch (e) {
      out.errors.push('health_json:' + String(e))
    }
  } catch (e) {
    out.errors.push('health_fetch:' + (e && e.message ? e.message : String(e)))
  }
  try {
    const m = await fetch(`${targetB}/manifest.webmanifest`, { cache: 'no-store', redirect: 'manual' })
    out.manifest = { ok: m.ok, status: m.status, type: m.type }
    try {
      out.manifestBody = await m.json()
    } catch (e) {
      out.errors.push('manifest_json:' + String(e))
    }
  } catch (e) {
    out.errors.push('manifest_fetch:' + (e && e.message ? e.message : String(e)))
  }
  return out
}, originB)

console.log('RENDERER_A_TO_B', JSON.stringify(rendererResult, null, 2))
const blocked =
  rendererResult.errors.length > 0 || !rendererResult.health?.ok || !rendererResult.manifest?.ok
console.log('GATE_RENDERER_VALIDATION_WOULD_BLOCK', blocked)
console.log(
  'CONCLUSION',
  blocked
    ? 'CONFIRMED: renderer cross-origin validate before requestConnect fails against production server without CORS'
    : 'NOT_BLOCKED_unexpected',
)

await browser.close()
clientA.kill('SIGTERM')
clientB.kill('SIGTERM')
api.close()
process.exit(blocked ? 0 : 2)
