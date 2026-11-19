/**
 * Shared Hamster origin validation (client ConnectGate + Electron main).
 * A valid origin must serve BOTH the installable client shell and the control-plane API
 * on the same origin (production client reverse-proxies /api). Private LAN http(s) is allowed.
 */

export function stripTrailingSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '')
}

/**
 * Normalize user input into an absolute http(s) origin (no path, no credentials).
 * @returns {{ ok: true, origin: string } | { ok: false, reason: string }}
 */
export function normalizeHamsterOrigin(value) {
  const trimmed = String(value || '').trim()
  if (!trimmed) return { ok: false, reason: 'empty' }

  // Reject explicit non-http(s) schemes before the host-only `http://` defaulting.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) && !/^https?:/i.test(trimmed)) {
    return { ok: false, reason: 'scheme' }
  }

  let withScheme = trimmed
  if (!/^https?:\/\//i.test(withScheme)) {
    withScheme = `http://${withScheme}`
  }

  let url
  try {
    url = new URL(withScheme)
  } catch {
    return { ok: false, reason: 'invalid_url' }
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'scheme' }
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'credentials' }
  }
  // Origin only — drop path/query/hash so ConnectGate cannot smuggle a deep link past validation.
  const origin = stripTrailingSlash(url.origin)
  if (!origin) return { ok: false, reason: 'invalid_url' }
  return { ok: true, origin }
}

/**
 * @param {string} origin
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<{ ok: true, origin: string } | { ok: false, reason: string }>}
 */
export async function validateHamsterClientApiOrigin(origin, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch
  const normalized = normalizeHamsterOrigin(origin)
  if (!normalized.ok) return normalized
  const base = normalized.origin

  // Health: must be JSON { status: 'ok' } on this exact origin (no silent redirect to another host).
  let healthRes
  try {
    healthRes = await fetchImpl(`${base}/api/health`, {
      cache: 'no-store',
      redirect: 'manual',
      headers: { accept: 'application/json' },
    })
  } catch {
    return { ok: false, reason: 'health_unreachable' }
  }

  if (healthRes.status >= 300 && healthRes.status < 400) {
    return { ok: false, reason: 'health_redirect' }
  }
  if (!healthRes.ok) {
    return { ok: false, reason: 'health_http' }
  }

  let healthBody
  try {
    healthBody = await healthRes.json()
  } catch {
    return { ok: false, reason: 'health_not_json' }
  }
  if (!healthBody || healthBody.status !== 'ok') {
    return { ok: false, reason: 'health_not_hamster' }
  }

  // Client shell: manifest must identify the installable Hamster PWA (rejects API-only origins
  // and arbitrary sites that happen to expose a generic /api/health 200).
  let manifestRes
  try {
    manifestRes = await fetchImpl(`${base}/manifest.webmanifest`, {
      cache: 'no-store',
      redirect: 'manual',
      headers: { accept: 'application/manifest+json,application/json' },
    })
  } catch {
    return { ok: false, reason: 'manifest_unreachable' }
  }
  if (manifestRes.status >= 300 && manifestRes.status < 400) {
    return { ok: false, reason: 'manifest_redirect' }
  }
  if (!manifestRes.ok) {
    return { ok: false, reason: 'manifest_http' }
  }

  let manifest
  try {
    manifest = await manifestRes.json()
  } catch {
    return { ok: false, reason: 'manifest_not_json' }
  }
  if (
    !manifest ||
    manifest.display !== 'standalone' ||
    manifest.start_url !== '/' ||
    (manifest.name !== 'Hamster' && manifest.short_name !== 'Hamster')
  ) {
    return { ok: false, reason: 'manifest_not_hamster' }
  }

  return { ok: true, origin: base }
}

/** Resolve fetch API base for the self-hosted client. Empty => same-origin relative /api. */
export function resolveApiBase({ pageOrigin, controlBase, viteApiBase }) {
  const page = stripTrailingSlash(pageOrigin || '')
  const control = stripTrailingSlash(controlBase || '')
  const vite = stripTrailingSlash(viteApiBase || '')
  if (control && page && control === page) return ''
  if (control && page && control !== page) return control
  if (vite) return vite
  return ''
}

/** In-app paths that are safe to restore across Electron reload/close. */
export function isRestorableClientPath(pathname) {
  const path = String(pathname || '')
  if (path === '/' || path === '') return true
  if (path === '/assets' || path === '/approvals') return true
  if (/^\/assets\/[A-Za-z0-9._:-]+$/.test(path)) return true
  return false
}

export function buildClientUrl(origin, pathname = '/', search = '', hash = '') {
  const base = stripTrailingSlash(origin)
  const path = isRestorableClientPath(pathname) ? pathname || '/' : '/'
  const url = new URL(path, `${base}/`)
  if (search) url.search = search.startsWith('?') ? search : `?${search}`
  if (hash) url.hash = hash.startsWith('#') ? hash : `#${hash}`
  return url.toString()
}
