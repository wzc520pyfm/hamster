'use strict'

const fs = require('node:fs')
const path = require('node:path')
const {
  stripTrailingSlash,
  isRestorableClientPath,
  buildClientUrl,
  isUrlOnTrustedOrigin,
} = require('./hamsterOrigin.cjs')

/** Empty profile — no successful origin, no implied localhost success. */
function emptySession() {
  return {
    trustedOrigins: [],
    lastSuccessfulOrigin: null,
    lastOrigin: null,
    lastPath: '/',
    lastSearch: '',
    lastHash: '',
    gateDraftOrigin: null,
    gateShowError: false,
  }
}

function loadSession(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    const trusted = Array.isArray(parsed.trustedOrigins)
      ? parsed.trustedOrigins.map(stripTrailingSlash).filter(Boolean)
      : []
    const set = new Set(trusted)
    const lastSuccessfulOrigin = stripTrailingSlash(parsed.lastSuccessfulOrigin || '') || null
    if (lastSuccessfulOrigin) set.add(lastSuccessfulOrigin)
    const lastOriginRaw = stripTrailingSlash(parsed.lastOrigin || '') || null
    const lastOrigin =
      lastOriginRaw && set.has(lastOriginRaw) ? lastOriginRaw : lastSuccessfulOrigin
    const lastPath = isRestorableClientPath(parsed.lastPath) ? parsed.lastPath || '/' : '/'
    return {
      trustedOrigins: [...set],
      lastSuccessfulOrigin,
      lastOrigin,
      lastPath,
      lastSearch: typeof parsed.lastSearch === 'string' ? parsed.lastSearch : '',
      lastHash: typeof parsed.lastHash === 'string' ? parsed.lastHash : '',
      gateDraftOrigin:
        typeof parsed.gateDraftOrigin === 'string' ? stripTrailingSlash(parsed.gateDraftOrigin) || null : null,
      gateShowError: Boolean(parsed.gateShowError),
    }
  } catch {
    return emptySession()
  }
}

function saveSession(filePath, session) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2))
  } catch {
    // best effort
  }
}

function rememberLocation(session, urlString) {
  let url
  try {
    url = new URL(urlString)
  } catch {
    return session
  }
  if (url.protocol === 'file:') return session
  const origin = stripTrailingSlash(url.origin)
  if (!session.trustedOrigins.includes(origin)) return session
  return {
    ...session,
    lastOrigin: origin,
    lastPath: isRestorableClientPath(url.pathname) ? url.pathname : '/',
    lastSearch: url.search || '',
    lastHash: url.hash || '',
  }
}

/** Restore URL only for a recorded successful origin (same-source route restore). */
function resolveSuccessfulStartupUrl(session) {
  const origin = stripTrailingSlash(session.lastSuccessfulOrigin || '')
  if (!origin) return null
  const pathName =
    session.lastOrigin === origin && isRestorableClientPath(session.lastPath)
      ? session.lastPath || '/'
      : '/'
  const search = session.lastOrigin === origin ? session.lastSearch || '' : ''
  const hash = session.lastOrigin === origin ? session.lastHash || '' : ''
  return buildClientUrl(origin, pathName, search, hash)
}

function trustOrigin(session, origin) {
  const o = stripTrailingSlash(origin)
  if (!o) return session
  if (session.trustedOrigins.includes(o)) return session
  return { ...session, trustedOrigins: [...session.trustedOrigins, o] }
}

function recordSuccessfulMount(session, origin) {
  const o = stripTrailingSlash(origin)
  if (!o) return session
  let next = trustOrigin(session, o)
  const originChanged = stripTrailingSlash(next.lastSuccessfulOrigin || '') !== o
  next = {
    ...next,
    lastSuccessfulOrigin: o,
    lastOrigin: o,
    // Origin change must not transfer prior route IDs — start at '/'.
    lastPath: originChanged ? '/' : next.lastPath || '/',
    lastSearch: originChanged ? '' : next.lastSearch || '',
    lastHash: originChanged ? '' : next.lastHash || '',
    gateDraftOrigin: null,
    gateShowError: false,
  }
  return next
}

function senderIsTrusted(event, trustedOrigins) {
  try {
    const frame = event.senderFrame || event.sender
    const url = frame?.url || event.sender?.getURL?.() || ''
    return isUrlOnTrustedOrigin(url, new Set(trustedOrigins.map(stripTrailingSlash)))
  } catch {
    return false
  }
}

module.exports = {
  emptySession,
  defaultSession: emptySession,
  loadSession,
  saveSession,
  rememberLocation,
  resolveSuccessfulStartupUrl,
  resolveStartupUrl: resolveSuccessfulStartupUrl,
  trustOrigin,
  recordSuccessfulMount,
  senderIsTrusted,
}
