const { contextBridge, ipcRenderer } = require('electron')

/**
 * Preload bridge for trusted Hamster client pages and the local file:// Connect gate.
 * Main process navigation guards keep this bridge off untrusted remote origins.
 * Container identity is fixed here — page scripts cannot spoof Electron via injected globals.
 */
contextBridge.exposeInMainWorld('hamster', {
  container: 'electron',
  controlBaseUrl: () =>
    String(process.env.HAMSTER_CONTROL_BASE_URL || process.env.HAMSTER_CONTROL_ORIGIN || '')
      .trim()
      .replace(/\/+$/, ''),
  /** Last successful client origin from main-process session (empty when none). */
  sessionOrigin: () => ipcRenderer.sendSync('hamster:session-origin'),
  /** Local gate draft/error state (file:// gate only). */
  gateState: () => ipcRenderer.sendSync('hamster:gate-state'),
  isStandalone: () => false,
  sendApprovalActivity: (count) => ipcRenderer.send('hamster:approval-activity', count),
  requestConnect: (origin) => ipcRenderer.invoke('hamster:request-connect', origin),
  /** Usable interactive client mounted — success handshake (not load/HTTP alone). */
  reportClientMounted: () => ipcRenderer.send('hamster:client-mounted'),
  reportRoute: (payload) => ipcRenderer.send('hamster:route-changed', payload),
  onOpenApprovals: (cb) => {
    const handler = (_event, ...args) => cb(...(args || []))
    ipcRenderer.on('hamster:focus-approvals', handler)
    return () => ipcRenderer.removeListener('hamster:focus-approvals', handler)
  },
})
