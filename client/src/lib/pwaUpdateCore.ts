/**
 * Production PWA update pure helpers — single source for pwaUpdate.ts and node tests.
 * Tests import this file via Node --experimental-strip-types (no duplicate .mjs).
 */

/** Registration options so HTTP cache cannot hide a new sw.js for an hour. */
export const SW_REGISTER_OPTIONS = Object.freeze({ updateViaCache: 'none' as const })

export const CONTROLLER_CHANGE_TIMEOUT_MS = 4000

export type ControllerChangeWaitResult =
  | { ok: true; reason: 'controllerchange' }
  | { ok: false; reason: 'timeout' | 'no_sw' }

export type ApplyPwaUpdateResult = {
  preserved: Record<string, string>
  /** True only when controller switched (or already controlling) and reload was invoked. */
  reloaded: boolean
  /** Why apply stopped without reloading (timeout / no SW / no waiting worker). */
  failure?: 'timeout' | 'no_sw' | 'no_waiting'
  waitReason?: string
}

type SwLike = { scriptURL?: string } | null | undefined

/** True when the active controller is already the registration's active worker (late activation). */
export function isAlreadyControllingExpected(opts: {
  controller?: SwLike
  active?: SwLike
}): boolean {
  const controller = opts.controller
  const active = opts.active
  if (!controller || !active) return false
  if (controller === active) return true
  const a = typeof controller.scriptURL === 'string' ? controller.scriptURL : ''
  const b = typeof active.scriptURL === 'string' ? active.scriptURL : ''
  return Boolean(a && b && a === b)
}

export function shouldOfferUpdateReload(state: {
  hadController: boolean
  controllerChanged: boolean
}): boolean {
  return Boolean(state?.hadController && state?.controllerChanged)
}

export function snapshotContinuityStorage(storage: Storage): Record<string, string> {
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
 * Wait for controllerchange. On timeout: resolve ok:false and remove the listener
 * — never treat timeout as success. Caller must NOT reload on failure.
 */
export function waitForControllerChange(
  timeoutMs = CONTROLLER_CHANGE_TIMEOUT_MS,
  opts: {
    addEventListener?: (type: string, fn: () => void) => void
    removeEventListener?: (type: string, fn: () => void) => void
    setTimeout?: (fn: () => void, ms: number) => unknown
    clearTimeout?: (id: unknown) => void
    hasServiceWorker?: boolean
  } = {},
): Promise<ControllerChangeWaitResult> {
  const hasSw =
    opts.hasServiceWorker ??
    (typeof navigator !== 'undefined' && Boolean(navigator.serviceWorker))
  if (!hasSw) {
    return Promise.resolve({ ok: false, reason: 'no_sw' })
  }

  const add =
    opts.addEventListener ??
    ((type, fn) => navigator.serviceWorker.addEventListener(type, fn as EventListener))
  const remove =
    opts.removeEventListener ??
    ((type, fn) => navigator.serviceWorker.removeEventListener(type, fn as EventListener))
  const schedule = opts.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
  const clear = opts.clearTimeout ?? ((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>))

  return new Promise((resolve) => {
    let done = false
    let timer: unknown
    const finish = (result: ControllerChangeWaitResult) => {
      if (done) return
      done = true
      remove('controllerchange', onChange)
      if (timer != null) clear(timer)
      resolve(result)
    }
    const onChange = () => finish({ ok: true, reason: 'controllerchange' })
    add('controllerchange', onChange)
    timer = schedule(() => finish({ ok: false, reason: 'timeout' }), timeoutMs)
  })
}

/**
 * SKIP_WAITING, await controller switch, then reload ONLY on success.
 * Timeout preserves the current page (no reload) so the UI can offer Retry.
 *
 * Late-activation recovery: after timeout the waiting worker may already have
 * activated (waiting gone). Retry must recognize the expected active controller
 * and reload — without reinserting a waiting worker or forcing a blind reload.
 */
export async function applyPwaUpdate(opts: {
  registration?: {
    waiting?: { postMessage: (msg: unknown) => void } | null
    active?: SwLike
  } | null
  reload?: () => void
  storage?: Storage
  whenControllerChanges?: () => Promise<ControllerChangeWaitResult | { ok: boolean; reason?: string }>
  controllerChangeTimeoutMs?: number
  /** Injected for tests; defaults to navigator.serviceWorker.controller. */
  getController?: () => SwLike
} = {}): Promise<ApplyPwaUpdateResult> {
  const storage = opts.storage ?? globalThis.localStorage
  const before = snapshotContinuityStorage(storage)
  const waiting = opts.registration?.waiting
  const reload =
    opts.reload ??
    (() => {
      if (typeof globalThis.location?.reload === 'function') globalThis.location.reload()
    })

  if (!waiting || typeof waiting.postMessage !== 'function') {
    const controller =
      opts.getController?.() ??
      (typeof navigator !== 'undefined' ? navigator.serviceWorker?.controller : null)
    const active = opts.registration?.active
    if (isAlreadyControllingExpected({ controller, active })) {
      const after = snapshotContinuityStorage(storage)
      assertContinuity(before, after)
      reload()
      return {
        preserved: before,
        reloaded: true,
        waitReason: 'already_controlling',
      }
    }
    const after = snapshotContinuityStorage(storage)
    assertContinuity(before, after)
    return { preserved: before, reloaded: false, failure: 'no_waiting' }
  }

  const whenControllerChanges =
    opts.whenControllerChanges ??
    (() => waitForControllerChange(opts.controllerChangeTimeoutMs ?? CONTROLLER_CHANGE_TIMEOUT_MS))

  const waitPromise = whenControllerChanges()
  waiting.postMessage({ type: 'SKIP_WAITING' })
  const waitResult = await waitPromise
  const ok = waitResult && (waitResult as { ok?: boolean }).ok === true

  const after = snapshotContinuityStorage(storage)
  assertContinuity(before, after)

  if (!ok) {
    const reason =
      (waitResult as { reason?: string })?.reason === 'no_sw'
        ? 'no_sw'
        : 'timeout'
    return {
      preserved: before,
      reloaded: false,
      failure: reason,
      waitReason: String((waitResult as { reason?: string })?.reason ?? 'timeout'),
    }
  }

  reload()
  return {
    preserved: before,
    reloaded: true,
    waitReason: 'controllerchange',
  }
}

function assertContinuity(before: Record<string, string>, after: Record<string, string>) {
  for (const [k, v] of Object.entries(before)) {
    if (after[k] !== v) {
      throw new Error(`applyPwaUpdate must not alter continuity key ${k}`)
    }
  }
}

type Headerish = { get?: (name: string) => string | null }
type Responseish = { ok?: boolean; headers?: Headerish }
type Requestish = { url: string; mode?: string }

/** Rejects HTML (SPA-fallback poison) for JS/CSS/asset URLs even when status is 200. */
export function isCacheableShellAssetResponse(
  request: Requestish,
  response: Responseish | null | undefined,
): boolean {
  if (!response || !response.ok) return false
  const path = new URL(request.url).pathname
  const ct = String(response.headers?.get?.('content-type') || '').toLowerCase()
  const looksAsset =
    path.startsWith('/assets/') ||
    /\.(js|css|mjs|map|woff2|png|svg|ico|webmanifest)$/i.test(path)
  if (!looksAsset) {
    return !ct.includes('text/html') || request.mode === 'navigate'
  }
  if (ct.includes('text/html')) return false
  if (/\.js$/i.test(path) && ct && !ct.includes('javascript') && !ct.includes('ecmascript')) {
    return false
  }
  return true
}
