/// <reference types="vite/client" />

interface HamsterBridge {
  /** Container the renderer believes it is running in. */
  container: 'electron' | 'pwa' | 'browser'
  /** Bootstrap control-plane base from the Electron main process env. */
  controlBaseUrl: () => string
  /** Last trusted client origin from main-process session (for LAN restore). */
  sessionOrigin?: () => string
  /** True when running as installed standalone PWA. */
  isStandalone: () => boolean
  /** Renderer → main: pending-approval count for badge/notification when unfocused. */
  sendApprovalActivity: (count: number) => void
  /** Renderer → main: validate + trust + navigate to a Hamster client+API origin. */
  requestConnect?: (origin: string) => Promise<{ ok: boolean; origin?: string; reason?: string }>
  /** Renderer → main: report in-app route for close/reopen restore. */
  reportRoute?: (payload: { pathname: string; search?: string; hash?: string }) => void
  /** Main → renderer: focus / return-to-ticket channel. */
  onOpenApprovals: (cb: () => void) => () => void
}

declare global {
  interface Window {
    hamster?: HamsterBridge
  }
}

export {}
