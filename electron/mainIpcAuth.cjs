'use strict'

/**
 * MF-1 main-process IPC frame authority.
 *
 * Electron semantics (docs): event.senderFrame may be null after the frame
 * navigates or is destroyed; all frames (including iframes) can send IPC.
 * Authorization MUST use the real senderFrame URL/origin synchronously and
 * MUST NOT fall back to event.sender.getURL() (top-level WebContents URL).
 *
 * See: Electron security tutorial §17 Validate the sender of all IPC messages;
 * IpcMainEvent.senderFrame may be null.
 */

const { stripTrailingSlash } = require('./hamsterOrigin.cjs')
const {
  senderFrameUrl,
  senderFrameOrigin,
  senderIsTrusted,
} = require('./sessionStore.cjs')

/**
 * @param {(url: string) => boolean} isLocalGateUrl
 * @returns {(event: object) => boolean}
 */
function createSenderIsLocalGate(isLocalGateUrl) {
  return function senderIsLocalGate(event) {
    const url = senderFrameUrl(event)
    if (!url) return false
    try {
      return Boolean(isLocalGateUrl(url))
    } catch {
      return false
    }
  }
}

/**
 * Trusted remote SPA or in-flight pending mount origin — frame URL only.
 * @param {object} event
 * @param {{ trustedOrigins: string[] }} session
 * @param {string | null} pendingMountOrigin
 */
function senderMatchesPendingOrTrusted(event, session, pendingMountOrigin) {
  const trusted = session && Array.isArray(session.trustedOrigins) ? session.trustedOrigins : []
  if (senderIsTrusted(event, trusted)) return true
  if (!pendingMountOrigin) return false
  const origin = senderFrameOrigin(event)
  if (!origin) return false
  return origin === stripTrailingSlash(pendingMountOrigin)
}

/**
 * Whether gate or trusted/pending sender may invoke request-connect.
 */
function canRequestConnect(event, session, isLocalGateUrl) {
  const senderIsLocalGate = createSenderIsLocalGate(isLocalGateUrl)
  return senderIsLocalGate(event) || senderIsTrusted(event, session.trustedOrigins || [])
}

/**
 * Resolve mount/route persistence evidence from the authorizing frame only.
 * @returns {{ ok: true, url: string, origin: string } | { ok: false, reason: string }}
 */
function resolveAuthorizedFrameLocation(event, session, pendingMountOrigin) {
  if (!senderMatchesPendingOrTrusted(event, session, pendingMountOrigin)) {
    return { ok: false, reason: 'untrusted_sender' }
  }
  const url = senderFrameUrl(event)
  const origin = senderFrameOrigin(event)
  if (!url || !origin) {
    return { ok: false, reason: 'missing_frame' }
  }
  if (pendingMountOrigin && origin !== stripTrailingSlash(pendingMountOrigin)) {
    return { ok: false, reason: 'origin_mismatch' }
  }
  if (!pendingMountOrigin) {
    const set = new Set((session.trustedOrigins || []).map(stripTrailingSlash))
    if (!set.has(origin)) {
      return { ok: false, reason: 'origin_not_trusted' }
    }
  }
  return { ok: true, url, origin }
}

/**
 * Route-changed: authorize + frame origin for persistence (pathname from payload).
 */
function resolveAuthorizedRouteOrigin(event, session) {
  if (!senderIsTrusted(event, session.trustedOrigins || [])) {
    return { ok: false, reason: 'untrusted_sender' }
  }
  const origin = senderFrameOrigin(event)
  if (!origin) return { ok: false, reason: 'missing_frame' }
  const set = new Set((session.trustedOrigins || []).map(stripTrailingSlash))
  if (!set.has(origin)) return { ok: false, reason: 'origin_not_trusted' }
  return { ok: true, origin }
}

/**
 * Approval-activity: trusted frame only (no top-level fallback).
 */
function canSendApprovalActivity(event, session) {
  return senderIsTrusted(event, session.trustedOrigins || [])
}

module.exports = {
  createSenderIsLocalGate,
  senderMatchesPendingOrTrusted,
  canRequestConnect,
  resolveAuthorizedFrameLocation,
  resolveAuthorizedRouteOrigin,
  canSendApprovalActivity,
  // re-export for main convenience
  senderFrameUrl,
  senderFrameOrigin,
  senderIsTrusted,
}
