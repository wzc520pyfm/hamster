#!/usr/bin/env node
/**
 * Bounded Electron reopen smoke (optional display).
 * Verifies session persist + loadURL restore for /assets/:id without Cancel semantics.
 * If Electron/Xvfb cannot show a window, exits with a clear limitation (non-zero) —
 * sessionStore unit tests remain the substitute evidence.
 */
'use strict'

const { spawn } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const ELECTRON = path.join(ROOT, 'electron', 'node_modules', '.bin', 'electron')
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'hamster-electron-reopen-'))
const RESULT = path.join(USER_DATA, 'result.json')

const runner = `
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')
const { loadSession, saveSession, rememberLocation, resolveStartupUrl, trustOrigin } = require(${JSON.stringify(path.join(ROOT, 'electron/sessionStore.cjs'))})

const SESSION = path.join(app.getPath('userData'), 'hamster-session.json')
const ORIGIN = process.env.SMOKE_ORIGIN
const RESULT = process.env.SMOKE_RESULT
let win

app.whenReady().then(async () => {
  let session = trustOrigin(loadSession(SESSION, ORIGIN), ORIGIN)
  win = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  const assetUrl = ORIGIN + '/assets/asset_reopen_smoke'
  await win.loadURL(ORIGIN + '/')
  session = rememberLocation(session, assetUrl)
  saveSession(SESSION, session)
  win.destroy()

  const restored = resolveStartupUrl(loadSession(SESSION, ORIGIN), ORIGIN)
  win = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  await win.loadURL(restored)
  const finalUrl = win.webContents.getURL()
  fs.writeFileSync(RESULT, JSON.stringify({
    ok: finalUrl.startsWith(ORIGIN + '/assets/asset_reopen_smoke'),
    restored,
    finalUrl,
    note: 'close/reopen load uses persisted path; no Cancel/approve IPC issued',
  }, null, 2))
  app.quit()
})

app.on('window-all-closed', () => app.quit())
setTimeout(() => { fs.writeFileSync(RESULT, JSON.stringify({ ok: false, error: 'timeout' })); app.exit(124) }, 20000)
`

function startStatic() {
  const dist = path.join(ROOT, 'client', 'dist')
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    if (url.pathname.startsWith('/assets/')) {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<!doctype html><title>Hamster</title><div id="root">asset</div>')
      return
    }
    const file = path.join(dist, url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, ''))
    try {
      const body = fs.readFileSync(file)
      res.writeHead(200).end(body)
    } catch {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(fs.readFileSync(path.join(dist, 'index.html')))
    }
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

async function main() {
  if (!fs.existsSync(ELECTRON)) {
    console.log(JSON.stringify({ ok: false, error: 'electron_not_installed' }))
    process.exit(1)
  }
  const server = await startStatic()
  const port = server.address().port
  const origin = `http://127.0.0.1:${port}`
  const scriptFile = path.join(USER_DATA, 'runner.cjs')
  fs.writeFileSync(scriptFile, runner)

  const child = spawn(ELECTRON, [scriptFile], {
    env: {
      ...process.env,
      ELECTRON_USER_DATA: USER_DATA,
      SMOKE_ORIGIN: origin,
      SMOKE_RESULT: RESULT,
      // Prefer offscreen / no GPU thrash
      ELECTRON_DISABLE_GPU: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stderr = ''
  child.stderr.on('data', (d) => {
    stderr += String(d)
  })

  const code = await new Promise((resolve) => {
    const t = setTimeout(() => {
      child.kill('SIGKILL')
      resolve(124)
    }, 25000)
    child.on('exit', (c) => {
      clearTimeout(t)
      resolve(c ?? 1)
    })
  })

  server.close()

  if (fs.existsSync(RESULT)) {
    const body = fs.readFileSync(RESULT, 'utf8')
    console.log(body)
    const parsed = JSON.parse(body)
    process.exit(parsed.ok ? 0 : 1)
  }

  console.log(
    JSON.stringify(
      {
        ok: false,
        error: 'no_result',
        exitCode: code,
        stderrTail: stderr.slice(-2000),
        limitation:
          'Electron display/runtime smoke failed; rely on electron/sessionStore.test.cjs for restore semantics',
      },
      null,
      2,
    ),
  )
  process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
