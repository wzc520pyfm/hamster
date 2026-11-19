/**
 * Container-aware connection helpers for the Electron main client + installable PWA.
 *
 * The same React client runs in three containers:
 * - `electron` : the Electron main-computer window (bridge injected by electron/preload + main)
 * - `pwa`      : installed standalone PWA (display-mode: standalone)
 * - `browser`  : ordinary browser tab / dev server
 *
 * These helpers are intentionally tiny; they do not add a second visual language.
 */

export type HamsterContainer = 'electron' | 'pwa' | 'browser'

export interface HamsterEnv {
  container: HamsterContainer
  controlBase: string
  standalone: boolean
}

function readContainer(): HamsterContainer {
  const raw = (window as Window & { __HAMSTER_CONTAINER__?: string }).__HAMSTER_CONTAINER__
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

export function getHamsterEnv(): HamsterEnv {
  const injected = readControlBaseInjected()
  const fromEnv =
    (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') || ''
  const controlBase = injected || fromEnv || window.location.origin
  return {
    container: readContainer(),
    controlBase,
    standalone: isStandaloneDisplay(),
  }
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
