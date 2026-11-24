/**
 * Hamster Electron main process — private preview slice.
 *
 * Scope of this main process:
 * - Quiet window (~1200x800 default; min 480x560)
 * - Local trusted bootstrap Connect gate (file://) when no successful mount
 * - Preload bridge only for BrowserWindows we create; navigation allowlisted
 * - Persist last-successful origin + same-source route (reload / close / reopen)
 * - Background approval return: notification + badge; fail closed
 *
 * Not in scope (postponed): tray-as-sole-entry, auto-update UI, packaging polish.
 */
const { app, BrowserWindow, Menu, ipcMain, Notification } = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const {
  stripTrailingSlash,
  normalizeHamsterOrigin,
  validateHamsterClientApiOriginWithRetry,
  isUrlOnTrustedOrigin,
  buildClientUrl,
} = require('./hamsterOrigin.cjs')
const {
  loadSession,
  saveSession,
  rememberLocation,
  resolveSuccessfulStartupUrl,
  recordSuccessfulMount,
} = require('./sessionStore.cjs')
const {
  createSenderIsLocalGate,
  senderMatchesPendingOrTrusted: frameMatchesPendingOrTrusted,
  canRequestConnect: frameCanRequestConnect,
  resolveAuthorizedFrameLocation,
  resolveAuthorizedRouteOrigin,
  canSendApprovalActivity,
} = require('./mainIpcAuth.cjs')
const { loadFileIfAlive } = require('./windowLoadGuard.cjs')
const { notifyPendingApprovals: showPendingApprovalNotification } = require('./notifyPendingApprovals.cjs')

/** Explicit operator env only — bare hardcoded localhost is NOT successful config. */
const EXPLICIT_CONTROL_ORIGIN = process.env.HAMSTER_CONTROL_ORIGIN
  ? stripTrailingSlash(process.env.HAMSTER_CONTROL_ORIGIN)
  : null
const EXPLICIT_CONTROL_BASE = process.env.HAMSTER_CONTROL_BASE_URL
  ? stripTrailingSlash(process.env.HAMSTER_CONTROL_BASE_URL)
  : null
const BOOTSTRAP_HINT = EXPLICIT_CONTROL_ORIGIN || EXPLICIT_CONTROL_BASE || ''

const NOTIFICATION_ICON = path.join(__dirname, 'build', 'icon.png')
const GATE_HTML = path.join(__dirname, 'gate.html')
const GATE_FILE_URL = pathToFileURL(GATE_HTML).href
const SESSION_FILE = path.join(app.getPath('userData'), 'hamster-session.json')
const MOUNT_TIMEOUT_MS = 20000

let mainWindow = null
let latestPendingApprovals = 0
let session = loadSession(SESSION_FILE)
/** Origin allowed for in-flight mount attempt (navigation + mount IPC) before success record. */
let pendingMountOrigin = null
let mountWaiters = []

function persistSession() {
  saveSession(SESSION_FILE, session)
}

function trustedSet() {
  return new Set(session.trustedOrigins.map(stripTrailingSlash))
}

function navigationAllowedOrigins() {
  const set = trustedSet()
  if (pendingMountOrigin) set.add(stripTrailingSlash(pendingMountOrigin))
  return set
}

function isLocalGateUrl(urlString) {
  try {
    const u = new URL(urlString)
    if (u.protocol !== 'file:') return false
    // Compare normalized paths (file URL encoding differences).
    const gatePath = path.normalize(GATE_HTML)
    let filePath = decodeURIComponent(u.pathname)
    if (process.platform === 'win32' && /^\/[A-Za-z]:/.test(filePath)) {
      filePath = filePath.slice(1)
    }
    return path.normalize(filePath) === gatePath
  } catch {
    return false
  }
}

/** MF-1: frame URL only — never fall back to top-level webContents.getURL(). */
const senderIsLocalGate = createSenderIsLocalGate(isLocalGateUrl)

function canRequestConnect(event) {
  return frameCanRequestConnect(event, session, isLocalGateUrl)
}

function senderMatchesPendingOrTrusted(event) {
  return frameMatchesPendingOrTrusted(event, session, pendingMountOrigin)
}

function resolveMountWaiters(ok) {
  const waiters = mountWaiters
  mountWaiters = []
  for (const w of waiters) {
    try {
      w(ok)
    } catch {
      // ignore
    }
  }
}

function waitForClientMounted(timeoutMs) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (ok) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(ok)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    mountWaiters.push(finish)
  })
}

function installMenu() {
  const template = [
    {
      label: 'Hamster',
      submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function clearDockBadge() {
  setDockBadge(0)
}

function setDockBadge(count) {
  const value = Number(count) > 0 ? String(Number(count)) : ''
  if (app.dock) {
    try {
      app.dock.setBadge(value)
    } catch {
      // unsupported
    }
  }
  try {
    app.setBadgeCount(Number(value))
  } catch {
    // unsupported
  }
}

function focusToApprovals() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  try {
    mainWindow.show()
    mainWindow.focus()
  } catch {
    // best effort
  }
}

/**
 * N-1: Electron main Notification API (options object + show), not Web Notification.
 * Unsupported / throw → fail-safe; badge path unchanged.
 */
function notifyPendingApprovals(count, taskTitle) {
  showPendingApprovalNotification({
    Notification,
    iconPath: NOTIFICATION_ICON,
    taskTitle: taskTitle || null,
    onClick: () => {
      focusToApprovals()
      mainWindow?.webContents.send('hamster:focus-approvals')
    },
  })
}

function attachNavigationGuards(win) {
  const contents = win.webContents

  contents.setWindowOpenHandler(() => {
    return { action: 'deny' }
  })

  contents.on('will-navigate', (event, url) => {
    if (isLocalGateUrl(url)) return
    if (!isUrlOnTrustedOrigin(url, navigationAllowedOrigins())) {
      event.preventDefault()
    }
  })

  contents.on('will-redirect', (event, url) => {
    if (isLocalGateUrl(url)) return
    if (!isUrlOnTrustedOrigin(url, navigationAllowedOrigins())) {
      event.preventDefault()
    }
  })

  const remember = (_event, url) => {
    if (isLocalGateUrl(url)) return
    session = rememberLocation(session, url)
    persistSession()
  }
  contents.on('did-navigate', remember)
  contents.on('did-navigate-in-page', remember)
}

function showLocalGate(opts = {}) {
  const { draft = null, showError = false } = opts
  pendingMountOrigin = null
  resolveMountWaiters(false)
  if (draft !== undefined && draft !== null) {
    session = {
      ...session,
      gateDraftOrigin: stripTrailingSlash(draft) || null,
      gateShowError: Boolean(showError),
    }
  } else if (showError) {
    session = { ...session, gateShowError: true }
  }
  persistSession()
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  // Guard lifecycle race: app.close() during bad-source rescue must not throw
  // UnhandledPromiseRejection ("Object has been destroyed"). Genuine load errors still surface.
  void loadFileIfAlive(win, GATE_HTML).then((result) => {
    if (result.ok || result.reason === 'window_destroyed') return
  }).catch((err) => {
    console.error('[hamster] showLocalGate loadFile failed:', err)
  })
}

/**
 * Load a client URL and wait for usable-mount handshake (not load/HTTP alone).
 * On success records lastSuccessfulOrigin. On failure preserves prior success.
 */
async function loadClientAndAwaitMount(url, origin) {
  const targetOrigin = stripTrailingSlash(origin)
  pendingMountOrigin = targetOrigin
  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingMountOrigin = null
    return { ok: false, reason: 'no_window' }
  }
  const contents = mainWindow.webContents
  const onFailLoad = (_event, _code, _desc, failingUrl, isMainFrame) => {
    if (!isMainFrame) return
    try {
      const failOrigin = stripTrailingSlash(new URL(failingUrl).origin)
      if (failOrigin === targetOrigin) resolveMountWaiters(false)
    } catch {
      resolveMountWaiters(false)
    }
  }
  contents.on('did-fail-load', onFailLoad)
  const mountedPromise = waitForClientMounted(MOUNT_TIMEOUT_MS)
  try {
    await mainWindow.loadURL(url)
  } catch {
    contents.off('did-fail-load', onFailLoad)
    pendingMountOrigin = null
    resolveMountWaiters(false)
    return { ok: false, reason: 'load_failed' }
  }
  const mounted = await mountedPromise
  contents.off('did-fail-load', onFailLoad)
  if (!mounted) {
    pendingMountOrigin = null
    return { ok: false, reason: 'mount_timeout' }
  }
  return { ok: true, origin: targetOrigin }
}

async function attemptStartupCandidate(url, origin) {
  const result = await loadClientAndAwaitMount(url, origin)
  if (result.ok) return true
  // Preserve lastSuccessfulOrigin; show local gate (independent of remote SPA).
  showLocalGate({
    draft: session.gateDraftOrigin || origin,
    showError: true,
  })
  return false
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'Hamster',
    width: 1200,
    height: 800,
    minWidth: 480,
    minHeight: 560,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  attachNavigationGuards(mainWindow)

  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.on('focus', () => {
    clearDockBadge()
  })

  mainWindow.on('blur', () => {
    if (latestPendingApprovals > 0) {
      setDockBadge(latestPendingApprovals)
    }
  })

  void bootWindow()
}

async function bootWindow() {
  const successUrl = resolveSuccessfulStartupUrl(session)
  if (successUrl && session.lastSuccessfulOrigin) {
    const ok = await attemptStartupCandidate(successUrl, session.lastSuccessfulOrigin)
    if (ok) return
    return
  }

  // Explicit preconfigured env may be attempted once — not bare localhost default.
  const preconfigured = EXPLICIT_CONTROL_ORIGIN || EXPLICIT_CONTROL_BASE
  if (preconfigured) {
    const normalized = normalizeHamsterOrigin(preconfigured)
    if (normalized.ok) {
      const url = buildClientUrl(normalized.origin, '/', '', '')
      const ok = await attemptStartupCandidate(url, normalized.origin)
      if (ok) return
      return
    }
  }

  // Fresh empty profile / no usable candidate → local trusted gate.
  showLocalGate({
    draft: session.gateDraftOrigin || '',
    showError: Boolean(session.gateShowError),
  })
}

app.whenReady().then(() => {
  installMenu()
  createWindow()

  ipcMain.on('hamster:gate-state', (event) => {
    if (!senderIsLocalGate(event)) {
      event.returnValue = { draft: '', showError: false }
      return
    }
    event.returnValue = {
      draft: session.gateDraftOrigin || '',
      showError: Boolean(session.gateShowError),
    }
  })

  ipcMain.on('hamster:session-origin', (event) => {
    // Allow pending mount origin so the renderer can treat the page as control plane
    // before lastSuccessfulOrigin is recorded.
    if (!senderMatchesPendingOrTrusted(event)) {
      event.returnValue = ''
      return
    }
    event.returnValue = stripTrailingSlash(
      pendingMountOrigin || session.lastSuccessfulOrigin || session.lastOrigin || '',
    )
  })

  ipcMain.on('hamster:client-mounted', (event) => {
    // MF-1: authorize + record from genuine senderFrame only (no top-level getURL).
    const located = resolveAuthorizedFrameLocation(event, session, pendingMountOrigin)
    if (!located.ok) return

    session = recordSuccessfulMount(session, located.origin)
    // Capture current path after mount from the same authorizing frame URL.
    try {
      session = rememberLocation(session, located.url)
    } catch {
      // ignore
    }
    persistSession()
    pendingMountOrigin = null
    resolveMountWaiters(true)
  })

  ipcMain.handle('hamster:request-connect', async (event, rawOrigin) => {
    if (!canRequestConnect(event)) {
      return { ok: false, reason: 'untrusted_sender' }
    }
    const raw = String(rawOrigin || '')
    const normalized = normalizeHamsterOrigin(raw)
    if (!normalized.ok) {
      // Never persist secret-bearing / non-origin input.
      if (normalized.reason !== 'credentials' && normalized.reason !== 'not_origin') {
        session = {
          ...session,
          gateDraftOrigin: null,
          gateShowError: true,
        }
        persistSession()
      } else {
        session = { ...session, gateShowError: true }
        persistSession()
      }
      return { ok: false, reason: normalized.reason }
    }

    // macOS 15+ Local Network (TN3179): the first LAN TCP that raises the
    // permission alert may be denied before the user answers. Retry briefly so
    // Allow + Connect does not require an immediate second click when possible.
    const validated = await validateHamsterClientApiOriginWithRetry(normalized.origin)
    if (!validated.ok) {
      session = {
        ...session,
        gateDraftOrigin: normalized.origin,
        gateShowError: true,
      }
      persistSession()
      return { ok: false, reason: validated.reason }
    }

    const origin = validated.origin
    const sameSource = stripTrailingSlash(session.lastSuccessfulOrigin || '') === origin
    const url = sameSource
      ? resolveSuccessfulStartupUrl(session) || buildClientUrl(origin, '/', '', '')
      : buildClientUrl(origin, '/', '', '')

    // Return invoke result BEFORE navigating (avoid renderer teardown deadlock).
    // Main completes mount handshake asynchronously; failure reloads local gate.
    setImmediate(() => {
      void (async () => {
        const result = await loadClientAndAwaitMount(url, origin)
        if (!result.ok) {
          showLocalGate({ draft: origin, showError: true })
        }
      })()
    })
    return { ok: true, origin }
  })

  ipcMain.on('hamster:approval-activity', (event, count) => {
    // MF-1: trusted senderFrame only (senderIsTrusted no longer falls back to getURL).
    if (!canSendApprovalActivity(event, session)) return
    latestPendingApprovals = Number(count) || 0
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isFocused()) {
      if (latestPendingApprovals > 0) {
        notifyPendingApprovals(latestPendingApprovals, null)
        setDockBadge(latestPendingApprovals)
      } else {
        setDockBadge(0)
      }
    }
  })

  ipcMain.on('hamster:route-changed', (event, payload) => {
    // MF-1: persist route only for authorizing frame origin (no top-level getURL).
    const routed = resolveAuthorizedRouteOrigin(event, session)
    if (!routed.ok) return
    const pathname = typeof payload?.pathname === 'string' ? payload.pathname : '/'
    const search = typeof payload?.search === 'string' ? payload.search : ''
    const hash = typeof payload?.hash === 'string' ? payload.hash : ''
    try {
      session = rememberLocation(
        session,
        buildClientUrl(routed.origin, pathname, search, hash),
      )
      persistSession()
    } catch {
      // ignore
    }
  })
})

app.on('will-quit', () => {
  persistSession()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Exported for unit-level contracts in tests (not used at runtime by Electron).
module.exports = {
  isLocalGateUrl,
  GATE_HTML,
  BOOTSTRAP_HINT,
  showLocalGate,
}
