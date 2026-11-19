#!/usr/bin/env node
/**
 * Production static client + same-origin /api (and /internal) reverse proxy.
 * Replaces bare `serve` so phones on a LAN origin hit this host's /api, not localhost:8080.
 *
 * Env:
 *   PORT          (default 3000)
 *   API_UPSTREAM  (default http://127.0.0.1:8080) — Compose sets http://api:8080
 *   DIST_DIR      (default ./dist)
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(process.env.DIST_DIR || path.join(__dirname, 'dist'))
const PORT = Number(process.env.PORT || 3000)
const API_UPSTREAM = (process.env.API_UPSTREAM || 'http://127.0.0.1:8080').replace(/\/+$/, '')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

function contentType(filePath) {
  return MIME[path.extname(filePath)] || 'application/octet-stream'
}

function isProxyPath(pathname) {
  return pathname === '/api' || pathname.startsWith('/api/') || pathname === '/internal' || pathname.startsWith('/internal/')
}

async function proxyApi(req, res) {
  const upstream = new URL(req.url || '/', `${API_UPSTREAM}/`)
  const headers = { ...req.headers, host: upstream.host }
  delete headers['accept-encoding']

  const upstreamReq = http.request(
    upstream,
    { method: req.method, headers },
    async (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers)
      try {
        await pipeline(upstreamRes, res)
      } catch {
        // client aborted — ignore
      }
    },
  )
  upstreamReq.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'api upstream unreachable' }))
    } else {
      res.end()
    }
  })
  try {
    await pipeline(req, upstreamReq)
  } catch {
    upstreamReq.destroy()
  }
}

function safeJoinDist(urlPath) {
  const decoded = decodeURIComponent((urlPath || '/').split('?')[0])
  const rel = decoded.replace(/^\/+/, '')
  const candidate = path.normalize(path.join(DIST, rel || 'index.html'))
  if (!candidate.startsWith(DIST)) return null
  return candidate
}

async function serveStatic(req, res) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  let filePath = safeJoinDist(url.pathname)
  if (!filePath) {
    res.writeHead(400).end('bad path')
    return
  }

  let stat
  try {
    stat = fs.statSync(filePath)
  } catch {
    stat = null
  }
  if (!stat || !stat.isFile()) {
    // SPA fallback
    filePath = path.join(DIST, 'index.html')
    try {
      stat = fs.statSync(filePath)
    } catch {
      res.writeHead(404).end('not found')
      return
    }
  }

  res.writeHead(200, {
    'content-type': contentType(filePath),
    'cache-control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600',
  })
  await pipeline(fs.createReadStream(filePath), res)
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  if (isProxyPath(url.pathname)) {
    void proxyApi(req, res)
    return
  }
  void serveStatic(req, res).catch(() => {
    if (!res.headersSent) res.writeHead(500).end('error')
  })
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`hamster-client listening on 0.0.0.0:${PORT} (api → ${API_UPSTREAM})`)
})
