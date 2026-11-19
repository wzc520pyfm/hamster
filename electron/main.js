/**
 * Hamster Electron main process — private preview slice.
 *
 * Scope of this main process:
 * - Quiet window (~1200x800 default, sidebar visible side-by-side; narrow => shell drawer)
 * - Minimal native menu: Hamster / Edit / View / Window (product nav stays in the shell)
 * - Preload bridge (window.hamster: container + controlBaseUrl) for the React connect gate
 * - Background approval return: notification (when permitted) + taskbar/dock badge; fail closed
 *
 * Not in scope (postponed): tray-as-sole-entry, auto-update UI, packaging polish.
 */
const { app, BrowserWindow, Menu, ipcMain, Notification } = require('electron')
const path = require('node:path')

const CLIENT_ORIGIN = process.env.HAMSTER_CONTROL_ORIGIN || 'http://localhost:3000'
const CONTROL_BASE = (process.env.HAMSTER_CONTROL_BASE_URL || CLIENT_ORIGIN).replace(/\/+$/, '')
const NOTIFICATION_ICON = path.join(__dirname, 'build', 'icon.png')

let mainWindow = null
let latestPendingApprovals = 0

function stripTrailingSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '')
}

function installMenu() {
  const template = [
    {
      label: 'Hamster',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'quit' },
      ],
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
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { role: 'close' },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function clearDockBadge() {
  setDockBadge(0)
}

function setDockBadge(count) {
  const value = Number(count) > 0 ? String(Number(count)) : ''
  // macOS: dock icon badge.
  if (app.dock) {
    try {
      app.dock.setBadge(value)
    } catch {
      // dock badge unsupported on this platform — notification path remains
    }
  }
  // Taskbar badge (Electron: app.setBadgeCount covers dock/taskbar-class badges; best effort).
  try {
    app.setBadgeCount(Number(value))
  } catch {
    // taskbar/Unity badge unsupported here — best effort, fail closed elsewhere
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
    // notification unsupported here — badge + shell entry remain the return path
  }
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
      // Preload uses contextBridge only; sandbox keeps the renderer node-free.
      // contextBridge is the supported preload surface under sandbox in current Electron.
      sandbox: true,
    },
  })
  // Preload exposes window.hamster (container + controlBaseUrl); container identity must not
  // come from executeJavaScript injection, so show on the standard lifecycle event.
  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show()
  })
  mainWindow.loadURL(CLIENT_ORIGIN)
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  mainWindow.on('focus', () => {
    clearDockBadge()
    if (latestPendingApprovals > 0) {
      // Window is back in foreground — no background notification needed.
      latestPendingApprovals = 0
    }
  })
}

app.whenReady().then(() => {
  installMenu()
  createWindow()

  ipcMain.on('hamster:approval-activity', (_event, count) => {
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
})

app.on('will-quit', () => {
  // Task is owned by the control plane; quitting never cancels or approves.
})

app.on('window-all-closed', () => {
  // Default macOS behaviour: keep running. Client must not treat close as Cancel.
  if (process.platform !== 'darwin') app.quit()
})
