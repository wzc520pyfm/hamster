'use strict'

const fs = require('node:fs')
const path = require('node:path')
const {
  stripTrailingSlash,
  isRestorableClientPath,
  buildClientUrl,
  isUrlOnTrustedOrigin,
} = require('./hamsterOrigin.cjs')

function defaultSession(bootstrapOrigin) {
  const origin = stripTrailingSlash(bootstrapOrigin)
  return {
    trustedOrigins: [origin],
    lastOrigin: origin,
    lastPath: '/',
    lastSearch: '',
    lastHash: '',
  }
}

function loadSession(filePath, bootstrapOrigin) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    const fallback = defaultSession(bootstrapOrigin)
    const trusted = Array.isArray(parsed.trustedOrigins)
      ? parsed.trustedOrigins.map(stripTrailingSlash).filter(Boolean)
      : fallback.trustedOrigins
    const set = new Set(trusted)
    set.add(stripTrailingSlash(bootstrapOrigin))
    const lastOrigin = stripTrailingSlash(parsed.lastOrigin || bootstrapOrigin)
    const lastPath = isRestorableClientPath(parsed.lastPath) ? parsed.lastPath || '/' : '/'
    return {
      trustedOrigins: [...set],
      lastOrigin: set.has(lastOrigin) ? lastOrigin : stripTrailingSlash(bootstrapOrigin),
      lastPath,
      lastSearch: typeof parsed.lastSearch === 'string' ? parsed.lastSearch : '',
      lastHash: typeof parsed.lastHash === 'string' ? parsed.lastHash : '',
    }
  } catch {
    return defaultSession(bootstrapOrigin)
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
  const origin = stripTrailingSlash(url.origin)
  if (!session.trustedOrigins.includes(origin)) return session
  const next = {
    ...session,
    lastOrigin: origin,
    lastPath: isRestorableClientPath(url.pathname) ? url.pathname : '/',
    lastSearch: url.search || '',
    lastHash: url.hash || '',
  }
  return next
}

function resolveStartupUrl(session, bootstrapOrigin) {
  const trusted = new Set(session.trustedOrigins.map(stripTrailingSlash))
  trusted.add(stripTrailingSlash(bootstrapOrigin))
  const origin = trusted.has(stripTrailingSlash(session.lastOrigin))
    ? stripTrailingSlash(session.lastOrigin)
    : stripTrailingSlash(bootstrapOrigin)
  return buildClientUrl(origin, session.lastPath, session.lastSearch, session.lastHash)
}

function trustOrigin(session, origin) {
  const o = stripTrailingSlash(origin)
  if (!o) return session
  if (session.trustedOrigins.includes(o)) return session
  return { ...session, trustedOrigins: [...session.trustedOrigins, o] }
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
  defaultSession,
  loadSession,
  saveSession,
  rememberLocation,
  resolveStartupUrl,
  trustOrigin,
  senderIsTrusted,
}
