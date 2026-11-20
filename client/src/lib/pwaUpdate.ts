/**
 * Register the Hamster PWA service worker and surface a user-controlled update.
 * Does not force reload and does not clear conversation / locale storage.
 *
 * Pure helpers mirrored in pwaUpdate.pure.mjs for node --test fixtures — keep in sync.
 */

/** Registration options so HTTP cache cannot hide a new sw.js for an hour. */
export const SW_REGISTER_OPTIONS = Object.freeze({ updateViaCache: 'none' as const })

/**
 * After a new worker takes control, should we offer a user-controlled reload?
 * First control (no prior controller) must not interrupt a fresh launch.
 */
export function shouldOfferUpdateReload(state: {
  hadController: boolean
  controllerChanged: boolean
}): boolean {
  return Boolean(state.hadController && state.controllerChanged)
}

function snapshotContinuityStorage(storage: Storage): Record<string, string> {
  const out: Record<string, string> = {}
  if (!storage || typeof storage.length !== 'number') return out
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (!key) continue
    if (
      key.startsWith('hamster.') ||
      key.startsWith('hamster-') ||
      key.includes('conversation') ||
      key.includes('locale')
    ) {
      out[key] = storage.getItem(key) ?? ''
    }
  }
  return out
}

/**
 * Apply update: optional SKIP_WAITING message, then reload. Must not wipe storage.
 */
export function applyPwaUpdate(opts: {
  registration?: { waiting?: { postMessage: (msg: unknown) => void } | null } | null
  reload?: () => void
  storage?: Storage
} = {}): { preserved: Record<string, string> } {
  const storage = opts.storage ?? window.localStorage
  const before = snapshotContinuityStorage(storage)
  const waiting = opts.registration?.waiting
  if (waiting && typeof waiting.postMessage === 'function') {
    waiting.postMessage({ type: 'SKIP_WAITING' })
  }
  const after = snapshotContinuityStorage(storage)
  for (const [k, v] of Object.entries(before)) {
    if (after[k] !== v) {
      throw new Error(`applyPwaUpdate must not alter continuity key ${k}`)
    }
  }
  const reload =
    opts.reload ??
    (() => {
      window.location.reload()
    })
  reload()
  return { preserved: before }
}

export type PwaUpdateListener = (state: { updateReady: boolean }) => void

let hadControllerAtStart = false

/**
 * Register `/sw.js` with updateViaCache: 'none', poll for updates, and notify when
 * a waiting worker is ready so the UI can offer Reload.
 */
export function registerHamsterServiceWorker(onChange?: PwaUpdateListener): () => void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return () => {}
  }

  hadControllerAtStart = Boolean(navigator.serviceWorker.controller)
  let cancelled = false
  let registration: ServiceWorkerRegistration | null = null

  const emit = (updateReady: boolean) => {
    if (!cancelled) onChange?.({ updateReady })
  }

  const onControllerChange = () => {
    if (
      shouldOfferUpdateReload({
        hadController: hadControllerAtStart,
        controllerChanged: true,
      })
    ) {
      emit(true)
    }
  }

  navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

  void navigator.serviceWorker
    .register('/sw.js', SW_REGISTER_OPTIONS)
    .then((reg) => {
      if (cancelled) return
      registration = reg
      const check = () => {
        void reg.update().catch(() => {})
      }
      check()
      const timer = window.setInterval(check, 60_000)
      ;(reg as ServiceWorkerRegistration & { __hamsterUpdateTimer?: number }).__hamsterUpdateTimer =
        timer

      if (reg.waiting) {
        emit(true)
      }
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing
        if (!installing) return
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            emit(true)
          }
        })
      })
    })
    .catch((err) => {
      console.warn('Hamster service worker registration failed', err)
    })

  return () => {
    cancelled = true
    navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
    const timed = registration as
      | (ServiceWorkerRegistration & { __hamsterUpdateTimer?: number })
      | null
    const timer = timed?.__hamsterUpdateTimer
    if (timer) window.clearInterval(timer)
  }
}

/** User opted in: ask waiting worker to activate (if any) and reload. */
export function applyHamsterPwaUpdate(registration?: ServiceWorkerRegistration | null): void {
  applyPwaUpdate({
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
    return (await navigator.serviceWorker.getRegistration()) ?? null
  } catch {
    return null
  }
}
