/**
 * Register the Hamster PWA service worker and surface a user-controlled update.
 * Pure helpers live in pwaUpdateCore.ts (single production source; node tests import it).
 */

import {
  SW_REGISTER_OPTIONS,
  shouldOfferUpdateReload,
  applyPwaUpdate,
} from './pwaUpdateCore'

export { SW_REGISTER_OPTIONS, shouldOfferUpdateReload, applyPwaUpdate }

export type PwaUpdateListener = (state: { updateReady: boolean }) => void

const listeners = new Set<PwaUpdateListener>()
let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null
let updateTimer: number | null = null
let registrationRef: ServiceWorkerRegistration | null = null

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
      // Re-offer after temporary "Not now" when the user returns focus (same document).
      window.addEventListener('focus', check)
      document.addEventListener('visibilitychange', check)
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

/** User opted in: ask waiting worker to activate, await controllerchange, then reload. */
export async function applyHamsterPwaUpdate(
  registration?: ServiceWorkerRegistration | null,
): Promise<void> {
  await applyPwaUpdate({
    registration: registration ?? undefined,
    storage: window.localStorage,
    reload: () => {
      window.location.reload()
    },
  })
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
  if (updateTimer != null) {
    window.clearInterval(updateTimer)
    updateTimer = null
  }
}
