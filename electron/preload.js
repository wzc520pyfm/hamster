const { contextBridge, ipcRenderer } = require('electron')

/**
 * Preload bridge for trusted Hamster client pages only.
 * Main process navigation guards keep this bridge off untrusted origins.
 * Container identity is fixed here — page scripts cannot spoof Electron via injected globals
 * for ConnectGate / IPC privilege (renderer helpers still ignore unsafe fallbacks for isElectron).
 */
contextBridge.exposeInMainWorld('hamster', {
  container: 'electron',
  controlBaseUrl: () =>
    String(process.env.HAMSTER_CONTROL_BASE_URL || process.env.HAMSTER_CONTROL_ORIGIN || 'http://localhost:3000')
      .trim()
      .replace(/\/+$/, ''),
  /** Last trusted client origin from main-process session (LAN restore safe). */
  sessionOrigin: () => ipcRenderer.sendSync('hamster:session-origin'),
  isStandalone: () => false,
  sendApprovalActivity: (count) => ipcRenderer.send('hamster:approval-activity', count),
  requestConnect: (origin) => ipcRenderer.invoke('hamster:request-connect', origin),
  reportRoute: (payload) => ipcRenderer.send('hamster:route-changed', payload),
  onOpenApprovals: (cb) => {
    const handler = (_event, ...args) => cb(...(args || []))
    ipcRenderer.on('hamster:focus-approvals', handler)
    return () => ipcRenderer.removeListener('hamster:focus-approvals', handler)
  },
})
