/**
 * Client-side Hamster origin helpers (mirrors shared/hamsterOrigin.mjs for Electron/tests).
 * Keep behaviour aligned with the shared module — both are covered by regression tests.
 */

export function stripTrailingSlash(value: string): string {
  return String(value || '').trim().replace(/\/+$/, '')
}

export type NormalizeResult =
  | { ok: true; origin: string }
  | { ok: false; reason: string }

export function normalizeHamsterOrigin(value: string): NormalizeResult {
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

  let url: URL
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
  const origin = stripTrailingSlash(url.origin)
  if (!origin) return { ok: false, reason: 'invalid_url' }
  return { ok: true, origin }
}

export async function validateHamsterClientApiOrigin(
  origin: string,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<NormalizeResult> {
  const fetchImpl = opts.fetchImpl || fetch
  const normalized = normalizeHamsterOrigin(origin)
  if (!normalized.ok) return normalized
  const base = normalized.origin

  let healthRes: Response
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

  let healthBody: { status?: string }
  try {
    healthBody = (await healthRes.json()) as { status?: string }
  } catch {
    return { ok: false, reason: 'health_not_json' }
  }
  if (!healthBody || healthBody.status !== 'ok') {
    return { ok: false, reason: 'health_not_hamster' }
  }

  let manifestRes: Response
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

  let manifest: { display?: string; start_url?: string; name?: string; short_name?: string }
  try {
    manifest = (await manifestRes.json()) as typeof manifest
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

export function resolveApiBase(opts: {
  pageOrigin: string
  controlBase: string
  viteApiBase?: string
}): string {
  const page = stripTrailingSlash(opts.pageOrigin || '')
  const control = stripTrailingSlash(opts.controlBase || '')
  const vite = stripTrailingSlash(opts.viteApiBase || '')
  if (control && page && control === page) return ''
  if (control && page && control !== page) return control
  if (vite) return vite
  return ''
}

export function isRestorableClientPath(pathname: string): boolean {
  const path = String(pathname || '')
  if (path === '/' || path === '') return true
  if (path === '/assets' || path === '/approvals') return true
  if (/^\/assets\/[A-Za-z0-9._:-]+$/.test(path)) return true
  return false
}
