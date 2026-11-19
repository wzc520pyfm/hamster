#!/usr/bin/env node
/**
 * Acceptance helper: production client build + same-origin /api proxy via NON-localhost address.
 * Does not claim Electron visual, physical mobile, or live-model verification.
 *
 * Spins:
 *  - stub API on 127.0.0.1:18080 (Hamster /api/health)
 *  - client/server.mjs on 0.0.0.0:13000 proxying to the stub
 * Proves fetch via LAN/container IP (not localhost) reaches API through the client origin.
 */
import http from 'node:http'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import { validateHamsterClientApiOrigin } from '../shared/hamsterOrigin.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DIST = path.join(ROOT, 'client', 'dist')
const CLIENT_PORT = Number(process.env.P1_CLIENT_PORT || 13000)
const API_PORT = Number(process.env.P1_API_PORT || 18080)

function lanHost() {
  const nets = os.networkInterfaces()
  for (const entries of Object.values(nets)) {
    for (const net of entries || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address
    }
  }
  return '127.0.0.1'
}

function startStubApi() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    if (url.pathname === '/api/health') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok' }))
      return
    }
    if (url.pathname === '/api/conversations/current') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          conversationId: 'conv_p1_proxy_verify',
          title: 'Main conversation',
          createdAt: '2026-11-19T00:00:00.000Z',
        }),
      )
      return
    }
    res.writeHead(404).end('nope')
  })
  return new Promise((resolve) => {
    server.listen(API_PORT, '127.0.0.1', () => resolve(server))
  })
}

function startClientProxy() {
  const child = spawn(process.execPath, [path.join(ROOT, 'client', 'server.mjs')], {
    env: {
      ...process.env,
      PORT: String(CLIENT_PORT),
      API_UPSTREAM: `http://127.0.0.1:${API_PORT}`,
      DIST_DIR: DIST,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return child
}

async function waitFor(url, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { redirect: 'manual' })
      if (res.ok || res.status === 200) return
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error(`timeout waiting for ${url}`)
}

async function main() {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    throw new Error('client/dist missing — run: cd client && npm run build')
  }
  if (!fs.existsSync(path.join(DIST, 'manifest.webmanifest'))) {
    throw new Error('client/dist/manifest.webmanifest missing from production build')
  }

  const api = await startStubApi()
  const client = startClientProxy()
  const host = lanHost()
  const origin = `http://${host}:${CLIENT_PORT}`

  const results = { host, origin, checks: [] }

  try {
    await waitFor(`http://127.0.0.1:${CLIENT_PORT}/`)
    await waitFor(`http://127.0.0.1:${CLIENT_PORT}/api/health`)

    // Non-localhost address must reach API through the client proxy (not phone loopback).
    const health = await fetch(`${origin}/api/health`)
    const healthBody = await health.json()
    results.checks.push({
      name: 'non_localhost_api_health_via_client_proxy',
      ok: health.ok && healthBody.status === 'ok',
      status: health.status,
      body: healthBody,
    })

    const conv = await fetch(`${origin}/api/conversations/current`)
    const convBody = await conv.json()
    results.checks.push({
      name: 'non_localhost_conversation_same_origin',
      ok: conv.ok && convBody.conversationId === 'conv_p1_proxy_verify',
      conversationId: convBody.conversationId,
    })

    const validated = await validateHamsterClientApiOrigin(origin)
    results.checks.push({
      name: 'validate_hamster_client_api_origin',
      ok: validated.ok === true,
      validated,
    })

    // Invalid: API-only upstream without client shell
    const apiOnly = await validateHamsterClientApiOrigin(`http://127.0.0.1:${API_PORT}`)
    results.checks.push({
      name: 'reject_api_only_origin',
      ok: apiOnly.ok === false,
      reason: apiOnly.reason,
    })

    // Invalid: arbitrary 200 site (use client root HTML as fake health by hitting a non-hamster path)
    const bogus = await validateHamsterClientApiOrigin('http://example.com')
    results.checks.push({
      name: 'reject_arbitrary_public_site',
      ok: bogus.ok === false,
      reason: bogus.reason,
    })

    const failed = results.checks.filter((c) => !c.ok)
    results.ok = failed.length === 0
    console.log(JSON.stringify(results, null, 2))
    if (!results.ok) process.exitCode = 1
  } finally {
    client.kill('SIGTERM')
    api.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
