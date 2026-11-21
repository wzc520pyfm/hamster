'use strict'

/**
 * MF-1 handler-level regressions for main-process IPC frame authority.
 * Does not load Electron; exercises the same helpers main.js must use.
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const {
  createSenderIsLocalGate,
  senderMatchesPendingOrTrusted,
  canRequestConnect,
  resolveAuthorizedFrameLocation,
  resolveAuthorizedRouteOrigin,
  canSendApprovalActivity,
} = require('./mainIpcAuth.cjs')
const { emptySession, recordSuccessfulMount, senderFrameUrl } = require('./sessionStore.cjs')

const GATE_HTML = path.join(__dirname, 'gate.html')
const GATE_FILE_URL = pathToFileURL(GATE_HTML).href

function isLocalGateUrl(urlString) {
  try {
    const u = new URL(urlString)
    if (u.protocol !== 'file:') return false
    const gatePath = path.normalize(GATE_HTML)
    let filePath = decodeURIComponent(u.pathname)
    if (process.platform === 'win32' && /^\/[A-Za-z]:/.test(filePath)) {
      filePath = filePath.slice(1)
    }
    return path.normalize(filePath) === gatePath
  } catch {
    return false
  }
}

const senderIsLocalGate = createSenderIsLocalGate(isLocalGateUrl)
const TRUSTED = 'http://192.168.1.10:3000'
const topTrusted = { getURL: () => `${TRUSTED}/approvals` }

function trustedSession() {
  return recordSuccessfulMount(emptySession(), TRUSTED)
}

test('MF-1 main: senderIsLocalGate allows real gate file:// frame URL', () => {
  assert.equal(senderIsLocalGate({ senderFrame: { url: GATE_FILE_URL } }), true)
})

test('MF-1 main: senderIsLocalGate denies missing/empty/destroyed frame even if top-level is gate', () => {
  const topGate = { getURL: () => GATE_FILE_URL }
  assert.equal(senderIsLocalGate({ sender: topGate }), false)
  assert.equal(senderIsLocalGate({ senderFrame: null, sender: topGate }), false)
  assert.equal(senderIsLocalGate({ senderFrame: { url: '' }, sender: topGate }), false)
  assert.equal(
    senderIsLocalGate({
      senderFrame: { url: GATE_FILE_URL, isDestroyed: () => true },
      sender: topGate,
    }),
    false,
  )
})

test('MF-1 main: senderIsLocalGate denies foreign file:// and http frames', () => {
  assert.equal(senderIsLocalGate({ senderFrame: { url: 'file:///tmp/evil-gate.html' } }), false)
  assert.equal(senderIsLocalGate({ senderFrame: { url: `${TRUSTED}/` } }), false)
})

test('MF-1 main: senderMatchesPendingOrTrusted denies missing frame with trusted top-level', () => {
  const session = trustedSession()
  assert.equal(
    senderMatchesPendingOrTrusted({ sender: topTrusted }, session, null),
    false,
  )
  assert.equal(
    senderMatchesPendingOrTrusted({ senderFrame: { url: '' }, sender: topTrusted }, session, TRUSTED),
    false,
  )
})

test('MF-1 main: senderMatchesPendingOrTrusted denies malicious child frame during pending mount', () => {
  const session = emptySession()
  assert.equal(
    senderMatchesPendingOrTrusted(
      {
        senderFrame: { url: 'http://evil.test/frame' },
        sender: { getURL: () => `${TRUSTED}/` },
      },
      session,
      TRUSTED,
    ),
    false,
  )
})

test('MF-1 main: senderMatchesPendingOrTrusted allows legitimate pending-mount frame', () => {
  const session = emptySession()
  assert.equal(
    senderMatchesPendingOrTrusted(
      { senderFrame: { url: `${TRUSTED}/` } },
      session,
      TRUSTED,
    ),
    true,
  )
})

test('MF-1 main: canRequestConnect allows gate frame; denies missing frame with trusted top-level', () => {
  const session = trustedSession()
  assert.equal(
    canRequestConnect({ senderFrame: { url: GATE_FILE_URL } }, session, isLocalGateUrl),
    true,
  )
  assert.equal(
    canRequestConnect({ sender: topTrusted }, session, isLocalGateUrl),
    false,
  )
  assert.equal(
    canRequestConnect(
      { senderFrame: { url: `${TRUSTED}/` } },
      session,
      isLocalGateUrl,
    ),
    true,
  )
})

test('MF-1 main: resolveAuthorizedFrameLocation (mount) uses frame origin; no top-level mutation path', () => {
  const session = emptySession()
  const pending = TRUSTED
  // Missing frame → deny (would have trusted top-level under old bug)
  const denied = resolveAuthorizedFrameLocation({ sender: topTrusted }, session, pending)
  assert.equal(denied.ok, false)
  assert.equal(denied.reason, 'untrusted_sender')

  // Malicious frame + trusted top-level → deny
  const evil = resolveAuthorizedFrameLocation(
    {
      senderFrame: { url: 'http://evil.test/' },
      sender: topTrusted,
    },
    session,
    pending,
  )
  assert.equal(evil.ok, false)

  // Legitimate pending frame → ok with frame origin
  const ok = resolveAuthorizedFrameLocation(
    { senderFrame: { url: `${TRUSTED}/approvals` } },
    session,
    pending,
  )
  assert.equal(ok.ok, true)
  assert.equal(ok.origin, TRUSTED)
  assert.equal(ok.url, `${TRUSTED}/approvals`)
})

test('MF-1 main: resolveAuthorizedFrameLocation after trust still requires frame (no getURL)', () => {
  const session = trustedSession()
  const denied = resolveAuthorizedFrameLocation(
    { senderFrame: null, sender: topTrusted },
    session,
    null,
  )
  assert.equal(denied.ok, false)

  const ok = resolveAuthorizedFrameLocation(
    { senderFrame: { url: `${TRUSTED}/assets/a` } },
    session,
    null,
  )
  assert.equal(ok.ok, true)
  assert.equal(ok.origin, TRUSTED)
})

test('MF-1 main: resolveAuthorizedRouteOrigin denies missing/malicious frame; allows legitimate', () => {
  const session = trustedSession()
  assert.equal(resolveAuthorizedRouteOrigin({ sender: topTrusted }, session).ok, false)
  assert.equal(
    resolveAuthorizedRouteOrigin(
      { senderFrame: { url: 'http://evil.test/x' }, sender: topTrusted },
      session,
    ).ok,
    false,
  )
  const ok = resolveAuthorizedRouteOrigin(
    { senderFrame: { url: `${TRUSTED}/approvals?id=1` } },
    session,
  )
  assert.equal(ok.ok, true)
  assert.equal(ok.origin, TRUSTED)
})

test('MF-1 main: canSendApprovalActivity denies missing frame even when top-level trusted', () => {
  const session = trustedSession()
  assert.equal(canSendApprovalActivity({ sender: topTrusted }, session), false)
  assert.equal(
    canSendApprovalActivity({ senderFrame: { url: `${TRUSTED}/approvals` } }, session),
    true,
  )
})

test('MF-1 main: unparseable frame URL yields no frame evidence (fail closed)', () => {
  assert.equal(senderFrameUrl({ senderFrame: { url: 'not a url' } }), null)
  const session = trustedSession()
  assert.equal(
    senderMatchesPendingOrTrusted(
      { senderFrame: { url: 'http://[bad' }, sender: topTrusted },
      session,
      null,
    ),
    false,
  )
})

test('MF-1 main: destroyed frame with trusted URL string still fail-closed for mount resolve', () => {
  const session = trustedSession()
  const r = resolveAuthorizedFrameLocation(
    {
      senderFrame: { url: `${TRUSTED}/`, isDestroyed: () => true },
      sender: topTrusted,
    },
    session,
    null,
  )
  assert.equal(r.ok, false)
})
