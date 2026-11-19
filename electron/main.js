/**
 * Hamster Electron main process — private preview slice.
 *
 * Scope of this main process:
 * - Quiet window (~1200x800 default, sidebar visible side-by-side; narrow => shell drawer)
 * - Minimal native menu: Hamster / Edit / View / Window (product nav stays in the shell)
 * - Preload bridge (window.hamster) only for BrowserWindows we create; navigation allowlisted
 * - Persist/restore last in-app route on trusted client origin (reload / close / reopen)
 * - Background approval return: notification (when permitted) + taskbar/dock badge; fail closed
 *
 * Not in scope (postponed): tray-as-sole-entry, auto-update UI, packaging polish.
 */
const { app, BrowserWindow, Menu, ipcMain, Notification } = require('electron')
const path = require('node:path')
const {
  stripTrailingSlash,
  normalizeHamsterOrigin,
  validateHamsterClientApiOrigin,
  isUrlOnTrustedOrigin,
} = require('./hamsterOrigin.cjs')
const {
  loadSession,
  saveSession,
  rememberLocation,
  resolveStartupUrl,
  trustOrigin,
  senderIsTrusted,
} = require('./sessionStore.cjs')

const CLIENT_ORIGIN = stripTrailingSlash(process.env.HAMSTER_CONTROL_ORIGIN || 'http://localhost:3000')
const CONTROL_BASE = stripTrailingSlash(process.env.HAMSTER_CONTROL_BASE_URL || CLIENT_ORIGIN)
const NOTIFICATION_ICON = path.join(__dirname, 'build', 'icon.png')
const SESSION_FILE = path.join(app.getPath('userData'), 'hamster-session.json')

let mainWindow = null
let latestPendingApprovals = 0
let session = loadSession(SESSION_FILE, CLIENT_ORIGIN)

function persistSession() {
  saveSession(SESSION_FILE, session)
}

function trustedSet() {
  return new Set(session.trustedOrigins.map(stripTrailingSlash))
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

function notifyPendingApprovals(count, taskTitle) {
  if (Notification.permission !== 'granted') return
  const title = 'Needs approval'
  const body = taskTitle
    ? `Hamster: task “${taskTitle}” needs your decision. Approve this action / Deny.`
    : 'Hamster needs your approval. Approve this action / Deny.'
  try {
    const notification = new Notification(title, {
      body,
      icon: NOTIFICATION_ICON,
    })
    notification.on('click', () => {
      focusToApprovals()
      mainWindow?.webContents.send('hamster:focus-approvals')
    })
    notification.show()
  } catch {
    // badge + shell entry remain
  }
}

function attachNavigationGuards(win) {
  const contents = win.webContents

  contents.setWindowOpenHandler(({ url }) => {
    // Never open untrusted windows with our preload. Deny popups; operator uses in-app navigation.
    if (isUrlOnTrustedOrigin(url, trustedSet())) {
      return { action: 'allow' }
    }
    return { action: 'deny' }
  })

  contents.on('will-navigate', (event, url) => {
    if (!isUrlOnTrustedOrigin(url, trustedSet())) {
      event.preventDefault()
    }
  })

  contents.on('will-redirect', (event, url) => {
    if (!isUrlOnTrustedOrigin(url, trustedSet())) {
      event.preventDefault()
    }
  })

  const remember = (_event, url) => {
    session = rememberLocation(session, url)
    persistSession()
  }
  contents.on('did-navigate', remember)
  contents.on('did-navigate-in-page', remember)
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

  // Restore last validated in-app route on the trusted client origin (not always bare root).
  const startupUrl = resolveStartupUrl(session, CLIENT_ORIGIN)
  mainWindow.loadURL(startupUrl)

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.on('focus', () => {
    // Clear the badge while focused, but keep the pending count so blur can restore it.
    clearDockBadge()
  })

  mainWindow.on('blur', () => {
    if (latestPendingApprovals > 0) {
      setDockBadge(latestPendingApprovals)
    }
  })
}

app.whenReady().then(() => {
  // Bootstrap origin is always trusted (LAN or localhost as configured by the operator).
  session = trustOrigin(session, CLIENT_ORIGIN)
  session = trustOrigin(session, CONTROL_BASE)
  persistSession()

  installMenu()
  createWindow()

  ipcMain.on('hamster:session-origin', (event) => {
    // Synchronous reply for preload; only meaningful for our BrowserWindow frames.
    event.returnValue = stripTrailingSlash(session.lastOrigin || CLIENT_ORIGIN)
  })

  ipcMain.handle('hamster:request-connect', async (event, rawOrigin) => {
    if (!senderIsTrusted(event, session.trustedOrigins)) {
      return { ok: false, reason: 'untrusted_sender' }
    }
    const normalized = normalizeHamsterOrigin(String(rawOrigin || ''))
    if (!normalized.ok) return { ok: false, reason: normalized.reason }
    const validated = await validateHamsterClientApiOrigin(normalized.origin)
    if (!validated.ok) return { ok: false, reason: validated.reason }

    session = trustOrigin(session, validated.origin)
    // Keep the current in-app path when reconnecting to a newly trusted origin when possible.
    const currentPath = session.lastPath || '/'
    session = {
      ...session,
      lastOrigin: validated.origin,
      lastPath: currentPath,
    }
    persistSession()

    if (mainWindow && !mainWindow.isDestroyed()) {
      const url = resolveStartupUrl(session, validated.origin)
      await mainWindow.loadURL(url)
    }
    return { ok: true, origin: validated.origin }
  })

  ipcMain.on('hamster:approval-activity', (event, count) => {
    if (!senderIsTrusted(event, session.trustedOrigins)) return
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
    if (!senderIsTrusted(event, session.trustedOrigins)) return
    const pathname = typeof payload?.pathname === 'string' ? payload.pathname : '/'
    const search = typeof payload?.search === 'string' ? payload.search : ''
    const hash = typeof payload?.hash === 'string' ? payload.hash : ''
    try {
      const origin = stripTrailingSlash(new URL(event.sender.getURL()).origin)
      if (!trustedSet().has(origin)) return
      session = rememberLocation(session, buildUrl(origin, pathname, search, hash))
      persistSession()
    } catch {
      // ignore
    }
  })
})

function buildUrl(origin, pathname, search, hash) {
  const { buildClientUrl } = require('./hamsterOrigin.cjs')
  return buildClientUrl(origin, pathname, search, hash)
}

app.on('will-quit', () => {
  // Task is owned by the control plane; quitting never cancels or approves.
  persistSession()
})

app.on('window-all-closed', () => {
  // Default macOS behaviour: keep running. Client must not treat close as Cancel.
  if (process.platform !== 'darwin') app.quit()
})
