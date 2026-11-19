const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('hamster', {
  container: 'electron',
  controlBaseUrl: () =>
    String(process.env.HAMSTER_CONTROL_BASE_URL || 'http://localhost:3000')
      .trim()
      .replace(/\/+$/, ''),
  isStandalone: () => false,
  sendApprovalActivity: (count) => ipcRenderer.send('hamster:approval-activity', count),
  onOpenApprovals: (cb) => {
    const handler = (_event, ...args) => cb(...(args || []))
    ipcRenderer.on('hamster:focus-approvals', handler)
    return () => ipcRenderer.removeListener('hamster:focus-approvals', handler)
  },
})
