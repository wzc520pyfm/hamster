/**
 * Register the Hamster PWA service worker and surface a user-controlled update.
 * Pure helpers live in pwaUpdateCore.ts (single production source; node tests import it).
 */

import {
  SW_REGISTER_OPTIONS,
  shouldOfferUpdateReload,
  applyPwaUpdate,
  type ApplyPwaUpdateResult,
} from './pwaUpdateCore'

export {
  SW_REGISTER_OPTIONS,
  shouldOfferUpdateReload,
  applyPwaUpdate,
  type ApplyPwaUpdateResult,
}

export type PwaUpdateListener = (state: { updateReady: boolean }) => void

const listeners = new Set<PwaUpdateListener>()
let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null
let updateTimer: number | null = null
let registrationRef: ServiceWorkerRegistration | null = null
let focusHandler: (() => void) | null = null
let visibilityHandler: (() => void) | null = null
/** Serialize Reload attempts so timeout retries cannot race. */
let applyInFlight: Promise<ApplyPwaUpdateResult> | null = null

function emitAll(updateReady: boolean) {
  for (const listener of listeners) listener({ updateReady })
}

function offerIfWaiting(reg: ServiceWorkerRegistration) {
  if (reg.waiting && navigator.serviceWorker.controller) emitAll(true)
}

function ensureRegistrationStarted(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  if (registrationPromise) return

  registrationPromise = navigator.serviceWorker
    .register('/sw.js', SW_REGISTER_OPTIONS)
    .then((reg) => {
      registrationRef = reg
      const check = () => {
        void reg
          .update()
          .catch(() => {})
          .finally(() => {
            offerIfWaiting(reg)
          })
        offerIfWaiting(reg)
      }
      check()
      updateTimer = window.setInterval(check, 60_000)
      focusHandler = check
      visibilityHandler = check
      window.addEventListener('focus', focusHandler)
      document.addEventListener('visibilitychange', visibilityHandler)
      offerIfWaiting(reg)
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing
        if (!installing) return
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            emitAll(true)
          }
        })
      })
      return reg
    })
    .catch((err) => {
      console.warn('Hamster service worker registration failed', err)
      registrationPromise = null
      return null
    })
}

/**
 * Ensure `/sw.js` is registered (PROD callers). Safe to call from ConnectGate and Shell.
 * Optional onChange receives update-ready signals for the Reload banner.
 */
export function registerHamsterServiceWorker(onChange?: PwaUpdateListener): () => void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return () => {}
  }
  if (onChange) listeners.add(onChange)
  ensureRegistrationStarted()
  return () => {
    if (onChange) listeners.delete(onChange)
  }
}

/**
 * User opted in: SKIP_WAITING, await controllerchange, then reload.
 * On timeout: does NOT reload; returns failure for Retry UI.
 */
export async function applyHamsterPwaUpdate(
  registration?: ServiceWorkerRegistration | null,
): Promise<ApplyPwaUpdateResult> {
  if (applyInFlight) return applyInFlight
  applyInFlight = applyPwaUpdate({
    registration: registration ?? undefined,
    storage: window.localStorage,
    reload: () => {
      window.location.reload()
    },
  }).finally(() => {
    applyInFlight = null
  })
  return applyInFlight
}

export async function getHamsterServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null
  try {
    if (registrationRef) return registrationRef
    return (await navigator.serviceWorker.getRegistration()) ?? null
  } catch {
    return null
  }
}

/** Test helper: reset singleton registration state. */
export function __resetHamsterServiceWorkerRegistrationForTests(): void {
  listeners.clear()
  registrationPromise = null
  registrationRef = null
  applyInFlight = null
  if (updateTimer != null) {
    window.clearInterval(updateTimer)
    updateTimer = null
  }
  if (focusHandler) {
    window.removeEventListener('focus', focusHandler)
    focusHandler = null
  }
  if (visibilityHandler) {
    document.removeEventListener('visibilitychange', visibilityHandler)
    visibilityHandler = null
  }
}
