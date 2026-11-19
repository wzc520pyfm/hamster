/**
 * Container-aware connection helpers for the Electron main client + installable PWA.
 *
 * The same React client runs in three containers:
 * - `electron` : the Electron main-computer window (bridge injected by electron/preload + main:
 *   `window.hamster` with `container` + `controlBaseUrl`; string or function forms both accepted)
 * - `pwa`      : installed standalone PWA (display-mode: standalone)
 * - `browser`  : ordinary browser tab / dev server
 *
 * The `window.hamster` bridge (see electron/preload.js) is authoritative when present; the older
 * injected globals (`window.__HAMSTER_CONTAINER__` / `window.__HAMSTER_CONTROL_BASE__`) are still
 * accepted when the bridge is not there. Container identity must not come from page scripts.
 *
 * These helpers are intentionally tiny; they do not add a second visual language.
 */

export type HamsterContainer = 'electron' | 'pwa' | 'browser'

export interface HamsterEnv {
  container: HamsterContainer
  controlBase: string
  standalone: boolean
}

type HamsterBridge = {
  container?: string | (() => string)
  controlBaseUrl?: string | (() => string)
}

function readHamsterBridge(): HamsterBridge {
  const w = window as Window & { hamster?: HamsterBridge }
  return w.hamster ?? {}
}

function resolveBridgeString(value: string | (() => string) | undefined): string | undefined {
  if (typeof value === 'function') {
    const resolved = (value as () => string)()
    return typeof resolved === 'string' ? resolved : undefined
  }
  return value
}

function readContainer(): HamsterContainer {
  const bridge = readHamsterBridge()
  const fromBridge = resolveBridgeString(bridge.container)?.trim()
  const injected = (window as Window & { __HAMSTER_CONTAINER__?: string }).__HAMSTER_CONTAINER__
  const raw = fromBridge || injected || ''
  if (raw === 'electron' || raw === 'pwa') return raw
  return 'browser'
}

function readControlBaseInjected(): string {
  const raw = (window as Window & { __HAMSTER_CONTROL_BASE__?: string }).__HAMSTER_CONTROL_BASE__
  if (typeof raw === 'string') {
    const stripped = raw.trim().replace(/\/+$/, '')
    if (stripped) return stripped
  }
  return ''
}

function readControlBaseBridge(): string {
  const bridge = readHamsterBridge()
  const fromBridge = resolveBridgeString(bridge.controlBaseUrl)
  const raw = fromBridge || readControlBaseInjected()
  if (typeof raw !== 'string') return ''
  const stripped = raw.trim().replace(/\/+$/, '')
  return stripped || ''
}

export function getHamsterEnv(): HamsterEnv {
  const injected = readControlBaseInjected()
  const bridged = readControlBaseBridge()
  const fromEnv =
    (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') || ''
  const controlBase = bridged || injected || fromEnv || window.location.origin
  return {
    container: readContainer(),
    controlBase,
    standalone: isStandaloneDisplay(),
  }
}

/**
 * True when the current renderer already serves the control plane (same origin), i.e. when the
 * Electron quiet ConnectGate should stay closed. Derived from the `window.hamster` bridge (via
 * `controlBaseUrl()`), falling back to injected globals / env / current origin.
 */
export function isSameOriginControlBase(): boolean {
  if (typeof window === 'undefined') return true
  return window.location.origin === getHamsterEnv().controlBase
}

export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false
  const nav = window.navigator as Navigator & { standalone?: boolean }
  if (nav.standalone === true) return true
  try {
    if (typeof window.matchMedia === 'function') {
      return window.matchMedia('(display-mode: standalone)').matches
    }
  } catch {
    // matchMedia unsupported — treat as browser tab
  }
  return false
}

export function isElectronContainer(): boolean {
  return getHamsterEnv().container === 'electron'
}

/** Control-plane base the renderer uses for control-plane calls. */
export function controlBaseUrl(): string {
  return getHamsterEnv().controlBase
}

/**
 * True when a fetch-level network failure occurred (no HTTP response was received).
 * Design-table wording for that state lives in i18n (`Can't reach this Hamster` / `无法连接`).
 */
export function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError
}
