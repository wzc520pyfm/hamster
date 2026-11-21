'use strict'

/**
 * Persistent regressions against REAL electron/main.js IPC registrations.
 *
 * Loads actual main.js under a mock `electron` module (not a reimplementation of
 * handlers). Captures ipcMain.on / ipcMain.handle closures registered by main,
 * then invokes them. Asserts:
 *  - invalid/missing/empty/destroyed/malicious senderFrame + trusted top-level
 *    → reject with NO side effects (session file, loadURL, Notification, badge)
 *  - valid gate / pending-mount / connect / mount / route / approval paths
 *  - N-1 callsite uses main Notification({…}).show() shape (mock probe)
 *
 * Coverage limit: mock Electron + in-process handlers — not a live GUI / AppImage.
 */

const { test, before, after, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const { pathToFileURL } = require('node:url')

const ELECTRON_DIR = __dirname
const MAIN_JS = path.join(ELECTRON_DIR, 'main.js')
const GATE_HTML = path.join(ELECTRON_DIR, 'gate.html')
const GATE_FILE_URL = pathToFileURL(GATE_HTML).href
const TRUSTED = 'http://192.168.1.10:3000'

let userDataDir
let sessionFile
let handlers // { on: Map, handle: Map }
let sideEffects
let mockWindow
let mockNotification
let readyResolve
let originalLoad
let originalFetch

function resetSideEffects() {
  sideEffects = {
    loadURL: [],
    loadFile: [],
    sessionWrites: [],
    notifications: [],
    badgeCounts: [],
    focusSends: [],
    menuBuilt: 0,
  }
}

function readSession() {
  try {
    return JSON.parse(fs.readFileSync(sessionFile, 'utf8'))
  } catch {
    return null
  }
}

function sessionFingerprint() {
  if (!fs.existsSync(sessionFile)) return null
  return fs.readFileSync(sessionFile, 'utf8')
}

function makeEvent({ frameUrl, topUrl = `${TRUSTED}/approvals`, destroyed = false, missingFrame = false }) {
  const event = {
    returnValue: undefined,
    sender: {
      getURL: () => topUrl,
      send: (...args) => sideEffects.focusSends.push(args),
    },
  }
  if (missingFrame) {
    event.senderFrame = null
  } else if (frameUrl === undefined) {
    // omit senderFrame entirely
  } else {
    event.senderFrame = {
      url: frameUrl,
      isDestroyed: () => destroyed,
    }
  }
  return event
}

function installElectronMock() {
  resetSideEffects()
  handlers = { on: new Map(), handle: new Map() }

  mockNotification = function Notification(options) {
    sideEffects.notifications.push({ args: [...arguments], options })
    this.on = () => {}
    this.show = () => {
      sideEffects.notifications[sideEffects.notifications.length - 1].shown = true
    }
  }
  mockNotification.isSupported = () => true

  mockWindow = {
    _destroyed: false,
    _focused: false,
    isDestroyed: () => mockWindow._destroyed,
    isFocused: () => mockWindow._focused,
    show: () => {},
    focus: () => {},
    once: () => {},
    on: () => {},
    loadURL: async (url) => {
      sideEffects.loadURL.push(url)
    },
    loadFile: async (file) => {
      sideEffects.loadFile.push(file)
    },
    webContents: {
      on: () => {},
      off: () => {},
      setWindowOpenHandler: () => {},
      send: (...args) => sideEffects.focusSends.push(args),
    },
  }

  const app = {
    getPath: (name) => {
      if (name === 'userData') return userDataDir
      return path.join(userDataDir, name)
    },
    whenReady: () => Promise.resolve().then(() => readyResolve && readyResolve()),
    on: () => {},
    dock: null,
    setBadgeCount: (n) => {
      sideEffects.badgeCounts.push(n)
    },
    quit: () => {},
  }

  const ipcMain = {
    on: (channel, fn) => {
      handlers.on.set(channel, fn)
    },
    handle: (channel, fn) => {
      handlers.handle.set(channel, fn)
    },
  }

  const Menu = {
    buildFromTemplate: () => ({}),
    setApplicationMenu: () => {
      sideEffects.menuBuilt += 1
    },
  }

  function BrowserWindow() {
    return mockWindow
  }

  const electronMock = {
    app,
    BrowserWindow,
    Menu,
    ipcMain,
    Notification: mockNotification,
  }

  originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electronMock
    return originalLoad.apply(this, arguments)
  }
}

function uninstallElectronMock() {
  if (originalLoad) Module._load = originalLoad
  originalLoad = null
}

async function loadActualMain() {
  // Clear cache so main.js re-registers against current mock
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${path.sep}electron${path.sep}`) && key.endsWith('.js') || key.endsWith('.cjs')) {
      if (key.includes(`${path.sep}electron${path.sep}`)) delete require.cache[key]
    }
  }
  // More precise: delete main and its local deps that close over session
  for (const key of Object.keys(require.cache)) {
    if (
      key === MAIN_JS ||
      key.endsWith(`${path.sep}electron${path.sep}main.js`) ||
      key.endsWith(`${path.sep}electron${path.sep}sessionStore.cjs`) ||
      key.endsWith(`${path.sep}electron${path.sep}mainIpcAuth.cjs`) ||
      key.endsWith(`${path.sep}electron${path.sep}notifyPendingApprovals.cjs`) ||
      key.endsWith(`${path.sep}electron${path.sep}windowLoadGuard.cjs`) ||
      key.endsWith(`${path.sep}electron${path.sep}hamsterOrigin.cjs`)
    ) {
      delete require.cache[key]
    }
  }

  let readyDone
  const readyPromise = new Promise((r) => {
    readyResolve = () => {
      readyDone = true
      r()
    }
  })

  require(MAIN_JS)
  // whenReady microtask + createWindow + handler registration
  await readyPromise
  await new Promise((r) => setImmediate(r))
  assert.equal(readyDone, true)
  assert.ok(handlers.on.has('hamster:gate-state'), 'main must register gate-state')
  assert.ok(handlers.on.has('hamster:client-mounted'), 'main must register client-mounted')
  assert.ok(handlers.handle.has('hamster:request-connect'), 'main must register request-connect')
  assert.ok(handlers.on.has('hamster:approval-activity'))
  assert.ok(handlers.on.has('hamster:route-changed'))
  assert.ok(handlers.on.has('hamster:session-origin'))
}

function installFetchHamsterOk() {
  originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const u = String(url)
    if (u.includes('/api/health')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 'ok' }),
      }
    }
    if (u.includes('manifest.webmanifest')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          display: 'standalone',
          start_url: '/',
          name: 'Hamster',
          short_name: 'Hamster',
        }),
      }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }
}

before(() => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hamster-main-handlers-'))
  sessionFile = path.join(userDataDir, 'hamster-session.json')
  installElectronMock()
  installFetchHamsterOk()
})

after(() => {
  uninstallElectronMock()
  if (originalFetch) globalThis.fetch = originalFetch
})

beforeEach(async () => {
  // Fresh empty session each test
  try {
    fs.unlinkSync(sessionFile)
  } catch {
    /* none */
  }
  resetSideEffects()
  mockWindow._focused = false
  mockWindow._destroyed = false
  await loadActualMain()
})

test('registered handlers exist from actual main.js (not a copy)', () => {
  assert.equal(typeof handlers.on.get('hamster:gate-state'), 'function')
  assert.equal(typeof handlers.handle.get('hamster:request-connect'), 'function')
  // Prove we loaded the real file path
  assert.equal(fs.existsSync(MAIN_JS), true)
  const src = fs.readFileSync(MAIN_JS, 'utf8')
  assert.match(src, /ipcMain\.on\('hamster:client-mounted'/)
  assert.match(src, /notifyPendingApprovals/)
})

test('rejection: missing/empty/destroyed/malicious frame + trusted top — gate-state no leak', () => {
  const before = sessionFingerprint()
  const gate = handlers.on.get('hamster:gate-state')
  const cases = [
    makeEvent({ missingFrame: true, topUrl: GATE_FILE_URL }),
    makeEvent({ frameUrl: '', topUrl: GATE_FILE_URL }),
    makeEvent({ frameUrl: GATE_FILE_URL, destroyed: true, topUrl: GATE_FILE_URL }),
    makeEvent({ frameUrl: 'http://evil.test/', topUrl: GATE_FILE_URL }),
    makeEvent({ frameUrl: undefined, topUrl: GATE_FILE_URL }), // omitted frame
  ]
  // omitted frame: makeEvent with frameUrl undefined still sets? fix — use missing
  cases[4] = { returnValue: undefined, sender: { getURL: () => GATE_FILE_URL } }

  for (const ev of cases) {
    gate(ev)
    assert.deepEqual(ev.returnValue, { draft: '', showError: false })
  }
  assert.equal(sessionFingerprint(), before)
  assert.equal(sideEffects.loadURL.length, 0)
  assert.equal(sideEffects.notifications.length, 0)
  assert.equal(sideEffects.badgeCounts.length, 0)
})

test('valid gate-state from real gate file:// frame returns draft fields', () => {
  const gate = handlers.on.get('hamster:gate-state')
  const ev = makeEvent({ frameUrl: GATE_FILE_URL, topUrl: GATE_FILE_URL })
  gate(ev)
  assert.equal(typeof ev.returnValue.draft, 'string')
  assert.equal(typeof ev.returnValue.showError, 'boolean')
})

test('rejection: approval-activity with bad frames — no Notification, no badge mutation from handler', () => {
  const before = sessionFingerprint()
  const notifBefore = sideEffects.notifications.length
  const badgeBefore = sideEffects.badgeCounts.length
  const fn = handlers.on.get('hamster:approval-activity')
  const bad = [
    makeEvent({ missingFrame: true }),
    makeEvent({ frameUrl: '' }),
    makeEvent({ frameUrl: `${TRUSTED}/approvals`, destroyed: true }),
    makeEvent({ frameUrl: 'http://evil.test/x' }),
    { sender: { getURL: () => `${TRUSTED}/approvals` } },
  ]
  for (const ev of bad) fn(ev, 3)
  assert.equal(sideEffects.notifications.length, notifBefore)
  assert.equal(sideEffects.badgeCounts.length, badgeBefore)
  assert.equal(sessionFingerprint(), before)
})

test('rejection: route-changed / client-mounted / session-origin bad frames — no session write', () => {
  const before = sessionFingerprint()
  const route = handlers.on.get('hamster:route-changed')
  const mount = handlers.on.get('hamster:client-mounted')
  const origin = handlers.on.get('hamster:session-origin')
  const bad = makeEvent({ frameUrl: 'http://evil.test/', topUrl: `${TRUSTED}/` })
  const missing = { sender: { getURL: () => `${TRUSTED}/` } }

  route(bad, { pathname: '/approvals' })
  route(missing, { pathname: '/approvals' })
  mount(bad)
  mount(missing)
  origin(bad)
  // session-origin rejects with empty string returnValue (never leaks trusted origin)
  origin(missing)
  assert.equal(missing.returnValue, '')
  const ev = makeEvent({ missingFrame: true })
  origin(ev)
  assert.equal(ev.returnValue, '')

  assert.equal(sessionFingerprint(), before)
  assert.equal(sideEffects.loadURL.length, 0)
})
test('rejection: request-connect from untrusted/missing frame — untrusted_sender, no loadURL', async () => {
  const before = sessionFingerprint()
  const connect = handlers.handle.get('hamster:request-connect')
  const res = await connect(makeEvent({ missingFrame: true, topUrl: GATE_FILE_URL }), TRUSTED)
  assert.deepEqual(res, { ok: false, reason: 'untrusted_sender' })
  const res2 = await connect(makeEvent({ frameUrl: 'http://evil.test/' }), TRUSTED)
  assert.deepEqual(res2, { ok: false, reason: 'untrusted_sender' })
  // allow bootWindow's initial loadFile (gate) but no client loadURL from connect
  const clientLoads = sideEffects.loadURL.filter((u) => String(u).startsWith('http'))
  assert.equal(clientLoads.length, 0)
  assert.equal(sessionFingerprint(), before)
})

test('valid connect from gate frame → pending mount → client-mounted records success', async () => {
  const connect = handlers.handle.get('hamster:request-connect')
  const mount = handlers.on.get('hamster:client-mounted')
  const gateEv = makeEvent({ frameUrl: GATE_FILE_URL, topUrl: GATE_FILE_URL })
  const res = await connect(gateEv, TRUSTED)
  assert.equal(res.ok, true)
  assert.equal(res.origin, TRUSTED)

  // Allow setImmediate loadClientAndAwaitMount to set pendingMountOrigin + loadURL
  await new Promise((r) => setImmediate(r))
  await new Promise((r) => setImmediate(r))
  assert.ok(
    sideEffects.loadURL.some((u) => String(u).startsWith(TRUSTED)),
    'expected loadURL to trusted origin',
  )

  const mountEv = makeEvent({ frameUrl: `${TRUSTED}/`, topUrl: `${TRUSTED}/` })
  mount(mountEv)

  const session = readSession()
  assert.ok(session)
  assert.equal(session.lastSuccessfulOrigin, TRUSTED)
  assert.ok(session.trustedOrigins.includes(TRUSTED))
})

test('valid route-changed after trust persists path; malicious frame does not', async () => {
  // Establish trust via connect+mount
  const connect = handlers.handle.get('hamster:request-connect')
  await connect(makeEvent({ frameUrl: GATE_FILE_URL, topUrl: GATE_FILE_URL }), TRUSTED)
  await new Promise((r) => setImmediate(r))
  await new Promise((r) => setImmediate(r))
  handlers.on.get('hamster:client-mounted')(makeEvent({ frameUrl: `${TRUSTED}/` }))

  const beforeEvil = sessionFingerprint()
  handlers.on.get('hamster:route-changed')(
    makeEvent({ frameUrl: 'http://evil.test/x', topUrl: `${TRUSTED}/` }),
    { pathname: '/approvals' },
  )
  assert.equal(sessionFingerprint(), beforeEvil)

  handlers.on.get('hamster:route-changed')(
    makeEvent({ frameUrl: `${TRUSTED}/conversation` }),
    { pathname: '/approvals', search: '?id=1' },
  )
  const session = readSession()
  assert.equal(session.lastPath, '/approvals')
  assert.equal(session.lastSearch, '?id=1')
})

test('N-1 + approval path after seeded trust (reload main with trusted session)', async () => {
  fs.writeFileSync(
    sessionFile,
    JSON.stringify({
      trustedOrigins: [TRUSTED],
      lastSuccessfulOrigin: TRUSTED,
      lastOrigin: TRUSTED,
      lastPath: '/',
      lastSearch: '',
      lastHash: '',
      gateDraftOrigin: null,
      gateShowError: false,
    }),
  )
  resetSideEffects()
  mockWindow._focused = false
  await loadActualMain()

  const fn = handlers.on.get('hamster:approval-activity')
  // Bad frame: no side effects
  const beforeN = sideEffects.notifications.length
  const beforeB = sideEffects.badgeCounts.length
  fn(makeEvent({ missingFrame: true }), 2)
  assert.equal(sideEffects.notifications.length, beforeN)
  assert.equal(sideEffects.badgeCounts.length, beforeB)

  // Good frame: N-1 probe + badge
  fn(makeEvent({ frameUrl: `${TRUSTED}/approvals` }), 2)
  assert.ok(sideEffects.notifications.length > beforeN)
  const last = sideEffects.notifications[sideEffects.notifications.length - 1]
  assert.equal(last.args.length, 1)
  assert.equal(typeof last.options.title, 'string')
  assert.equal(typeof last.options.body, 'string')
  assert.equal(last.shown, true)
  assert.ok(sideEffects.badgeCounts.length > beforeB)
})

test('session-origin allows pending/trusted frame only', async () => {
  const originFn = handlers.on.get('hamster:session-origin')
  const denied = makeEvent({ missingFrame: true })
  originFn(denied)
  assert.equal(denied.returnValue, '')

  await handlers.handle.get('hamster:request-connect')(
    makeEvent({ frameUrl: GATE_FILE_URL, topUrl: GATE_FILE_URL }),
    TRUSTED,
  )
  await new Promise((r) => setImmediate(r))
  await new Promise((r) => setImmediate(r))

  const pendingEv = makeEvent({ frameUrl: `${TRUSTED}/` })
  originFn(pendingEv)
  assert.equal(pendingEv.returnValue, TRUSTED)
})
