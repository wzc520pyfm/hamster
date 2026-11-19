/**
 * Container-aware connection helpers for the Electron main client + installable PWA.
 *
 * The same React client runs in three containers:
 * - `electron` : the Electron main-computer window (bridge injected by electron/preload + main:
 *   `window.hamster` with `container` + `controlBaseUrl`; string or function forms both accepted)
 * - `pwa`      : installed standalone PWA (display-mode: standalone)
 * - `browser`  : ordinary browser tab / dev server
 *
 * The `window.hamster` bridge (see electron/preload.js) is authoritative for *container identity*
 * when present. Control-plane base for API fetches prefers the current page origin once it is a
 * remembered / configured Hamster client origin (same-origin /api via reverse proxy).
 *
 * These helpers are intentionally tiny; they do not add a second visual language.
 */

import { stripTrailingSlash } from '@/lib/hamsterOrigin'

export type HamsterContainer = 'electron' | 'pwa' | 'browser'

export interface HamsterEnv {
  container: HamsterContainer
  controlBase: string
  standalone: boolean
}

export const LAST_GOOD_CONTROL_BASE_KEY = 'hamster.controlBase'

type HamsterBridge = {
  container?: string | (() => string)
  controlBaseUrl?: string | (() => string)
  sessionOrigin?: string | (() => string)
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
    const stripped = stripTrailingSlash(raw)
    if (stripped) return stripped
  }
  return ''
}

function readControlBaseBridge(): string {
  const bridge = readHamsterBridge()
  const fromBridge = resolveBridgeString(bridge.controlBaseUrl)
  if (typeof fromBridge !== 'string') return ''
  return stripTrailingSlash(fromBridge)
}

function readLastGoodControlBase(): string {
  try {
    if (typeof localStorage === 'undefined') return ''
    return stripTrailingSlash(localStorage.getItem(LAST_GOOD_CONTROL_BASE_KEY) || '')
  } catch {
    return ''
  }
}

/**
 * Control-plane origin the renderer should treat as authoritative for API + ConnectGate.
 * Prefer: current page when it matches last-good or bootstrap bridge; else last-good; else bridge;
 * else vite env; else page origin. This keeps remembered ConnectGate URLs wired after navigate
 * without leaving API stuck on a build-time localhost bake.
 */
export function getHamsterEnv(): HamsterEnv {
  const page = typeof window !== 'undefined' ? window.location.origin : ''
  const lastGood = readLastGoodControlBase()
  const bridged = readControlBaseBridge()
  const injected = readControlBaseInjected()
  const sessionOrigin = stripTrailingSlash(
    resolveBridgeString(readHamsterBridge().sessionOrigin) || '',
  )
  const fromEnv =
    (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') || ''

  let controlBase = page
  if (lastGood && lastGood === page) {
    controlBase = page
  } else if (sessionOrigin && sessionOrigin === page) {
    controlBase = page
  } else if (bridged && bridged === page) {
    controlBase = page
  } else if (injected && injected === page) {
    controlBase = page
  } else if (lastGood) {
    controlBase = lastGood
  } else if (sessionOrigin) {
    controlBase = sessionOrigin
  } else if (bridged) {
    controlBase = bridged
  } else if (injected) {
    controlBase = injected
  } else if (fromEnv) {
    controlBase = fromEnv
  } else {
    controlBase = page
  }

  return {
    container: readContainer(),
    controlBase,
    standalone: isStandaloneDisplay(),
  }
}

/**
 * True when the Electron quiet ConnectGate should stay closed.
 * Closed when the window is already on the bootstrap origin, or on a remembered validated origin.
 */
export function isSameOriginControlBase(): boolean {
  if (typeof window === 'undefined') return true
  const page = window.location.origin
  const lastGood = readLastGoodControlBase()
  if (lastGood && lastGood === page) return true
  const bridged = readControlBaseBridge()
  if (bridged && bridged === page) return true
  const injected = readControlBaseInjected()
  if (injected && injected === page) return true
  // Electron session restore may land on a trusted LAN origin while bootstrap env still
  // points at localhost — treat main-process session origin as authoritative when it matches.
  const bridge = readHamsterBridge()
  const sessionOrigin = stripTrailingSlash(resolveBridgeString(bridge.sessionOrigin) || '')
  if (sessionOrigin && sessionOrigin === page) return true
  // Browser / PWA always treat the serving origin as the control plane (same-origin /api).
  if (!isElectronContainer()) return true
  // Electron without last-good: only same as bootstrap bridge.
  return Boolean(bridged && bridged === page)
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
  // Prefer the preload bridge only — do not trust page-script __HAMSTER_CONTAINER__ for Electron
  // privilege decisions (ConnectGate / IPC). Injected global remains a non-authoritative hint for
  // display helpers via getHamsterEnv().container when bridge is absent.
  const bridge = readHamsterBridge()
  const fromBridge = resolveBridgeString(bridge.container)?.trim()
  return fromBridge === 'electron'
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
