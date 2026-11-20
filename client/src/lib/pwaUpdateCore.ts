/**
 * Production PWA update pure helpers — single source for pwaUpdate.ts and node tests.
 * Tests import this file via Node --experimental-strip-types (no duplicate .mjs).
 */

/** Registration options so HTTP cache cannot hide a new sw.js for an hour. */
export const SW_REGISTER_OPTIONS = Object.freeze({ updateViaCache: 'none' as const })

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

function defaultWhenControllerChanges(timeoutMs = 4000): Promise<string> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) {
      resolve('no_sw')
      return
    }
    let done = false
    const finish = (why: string) => {
      if (done) return
      done = true
      navigator.serviceWorker.removeEventListener('controllerchange', onChange)
      resolve(why)
    }
    const onChange = () => finish('controllerchange')
    navigator.serviceWorker.addEventListener('controllerchange', onChange)
    setTimeout(() => finish('timeout'), timeoutMs)
  })
}

export async function applyPwaUpdate(opts: {
  registration?: { waiting?: { postMessage: (msg: unknown) => void } | null } | null
  reload?: () => void
  storage?: Storage
  whenControllerChanges?: () => Promise<unknown>
  controllerChangeTimeoutMs?: number
} = {}): Promise<{ preserved: Record<string, string> }> {
  const storage = opts.storage ?? globalThis.localStorage
  const before = snapshotContinuityStorage(storage)
  const waiting = opts.registration?.waiting
  const whenControllerChanges =
    opts.whenControllerChanges ??
    (() => defaultWhenControllerChanges(opts.controllerChangeTimeoutMs ?? 4000))

  if (waiting && typeof waiting.postMessage === 'function') {
    const controllerWait = whenControllerChanges()
    waiting.postMessage({ type: 'SKIP_WAITING' })
    await controllerWait
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
      if (typeof globalThis.location?.reload === 'function') globalThis.location.reload()
    })
  reload()
  return { preserved: before }
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
