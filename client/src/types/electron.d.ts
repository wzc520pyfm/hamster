/// <reference types="vite/client" />

interface HamsterBridge {
  /** Container the renderer believes it is running in. */
  container: 'electron' | 'pwa' | 'browser'
  /** Control-plane base injected by the Electron main process. */
  controlBaseUrl: () => string
  /** True when running as installed standalone PWA. */
  isStandalone: () => boolean
  /** Main → renderer: an approval activity snapshot was pushed (count of pending approvals). */
  sendApprovalActivity: (count: number) => void
  /** Renderer → main: focus / return-to-ticket channel (main focuses window + opens approvals). */
  onOpenApprovals: (cb: () => void) => () => void
}

declare global {
  interface Window {
    hamster?: HamsterBridge
  }
}

export {}
