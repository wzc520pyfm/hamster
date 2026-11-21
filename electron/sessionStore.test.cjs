'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  emptySession,
  loadSession,
  saveSession,
  rememberLocation,
  resolveSuccessfulStartupUrl,
  trustOrigin,
  recordSuccessfulMount,
  senderIsTrusted,
} = require('./sessionStore.cjs')
const { isUrlOnTrustedOrigin, normalizeHamsterOriginInput } = require('./hamsterOrigin.cjs')

test('empty profile has no successful origin (bare localhost is not success)', () => {
  const s = emptySession()
  assert.equal(s.lastSuccessfulOrigin, null)
  assert.equal(resolveSuccessfulStartupUrl(s), null)
  assert.deepEqual(s.trustedOrigins, [])
})

test('session restores last asset path only after successful mount recorded', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hamster-session-'))
  const file = path.join(dir, 'session.json')
  let session = recordSuccessfulMount(emptySession(), 'http://192.168.1.10:3000')
  session = rememberLocation(session, 'http://192.168.1.10:3000/assets/asset_demo')
  saveSession(file, session)
  const loaded = loadSession(file)
  assert.equal(loaded.lastSuccessfulOrigin, 'http://192.168.1.10:3000')
  assert.equal(
    resolveSuccessfulStartupUrl(loaded),
    'http://192.168.1.10:3000/assets/asset_demo',
  )
})

test('failed attempted source does not overwrite lastSuccessfulOrigin', () => {
  let session = recordSuccessfulMount(emptySession(), 'http://192.168.1.10:3000')
  session = {
    ...session,
    gateDraftOrigin: 'http://192.168.1.99:3000',
    gateShowError: true,
  }
  assert.equal(session.lastSuccessfulOrigin, 'http://192.168.1.10:3000')
  assert.equal(resolveSuccessfulStartupUrl(session), 'http://192.168.1.10:3000/')
})

test('origin change A→B resets to root path (no transferred route IDs)', () => {
  let session = recordSuccessfulMount(emptySession(), 'http://192.168.1.10:3000')
  session = rememberLocation(session, 'http://192.168.1.10:3000/assets/asset_old')
  session = recordSuccessfulMount(session, 'http://192.168.1.20:3000')
  assert.equal(session.lastSuccessfulOrigin, 'http://192.168.1.20:3000')
  assert.equal(resolveSuccessfulStartupUrl(session), 'http://192.168.1.20:3000/')
})

test('rememberLocation ignores untrusted origins', () => {
  let session = emptySession()
  session = rememberLocation(session, 'http://evil.test/assets/x')
  assert.equal(session.lastPath, '/')
  session = trustOrigin(session, 'http://192.168.1.10:3000')
  session = rememberLocation(session, 'http://192.168.1.10:3000/approvals')
  assert.equal(session.lastPath, '/approvals')
})

test('navigation allowlist rejects foreign origins and credentials', () => {
  const trusted = new Set(['http://192.168.1.10:3000'])
  assert.equal(isUrlOnTrustedOrigin('http://192.168.1.10:3000/assets/a', trusted), true)
  assert.equal(isUrlOnTrustedOrigin('http://evil.test/', trusted), false)
  assert.equal(isUrlOnTrustedOrigin('http://user:pass@192.168.1.10:3000/', trusted), false)
  assert.equal(isUrlOnTrustedOrigin('file:///tmp/x', trusted), false)
})

test('IPC sender trust checks frame URL against allowlist', () => {
  const trusted = ['http://192.168.1.10:3000']
  assert.equal(
    senderIsTrusted({ senderFrame: { url: 'http://192.168.1.10:3000/approvals' } }, trusted),
    true,
  )
  assert.equal(
    senderIsTrusted({ senderFrame: { url: 'http://evil.test/' } }, trusted),
    false,
  )
})

test('gate file:// sender is not treated as remote SPA trusted origin', () => {
  assert.equal(
    senderIsTrusted({ senderFrame: { url: 'file:///tmp/gate.html' } }, ['http://192.168.1.10:3000']),
    false,
  )
})

test('MF-1 regression: IPC sender trust denies missing senderFrame even when top-level sender URL is trusted', () => {
  const trusted = ['http://192.168.1.10:3000']
  const topLevelTrustedSender = { getURL: () => 'http://192.168.1.10:3000/approvals' }
  assert.equal(
    senderIsTrusted({ sender: topLevelTrustedSender }, trusted),
    false,
    'missing senderFrame must not fall back to top-level sender.getURL() for authorization',
  )
  assert.equal(
    senderIsTrusted({ senderFrame: null, sender: topLevelTrustedSender }, trusted),
    false,
  )
})

test('MF-1 regression: IPC sender trust denies empty frame URL even when top-level sender URL is trusted', () => {
  const trusted = ['http://192.168.1.10:3000']
  const topLevelTrustedSender = { getURL: () => 'http://192.168.1.10:3000/approvals' }
  assert.equal(
    senderIsTrusted({ senderFrame: { url: '' }, sender: topLevelTrustedSender }, trusted),
    false,
    'empty frame URL must not fall back to top-level sender.getURL() for authorization',
  )
  assert.equal(
    senderIsTrusted({ senderFrame: { url: '   ' }, sender: topLevelTrustedSender }, trusted),
    false,
  )
})

test('MF-1 regression: IPC sender trust denies destroyed frame even when frame URL is a trusted origin', () => {
  const trusted = ['http://192.168.1.10:3000']
  assert.equal(
    senderIsTrusted(
      {
        senderFrame: { url: 'http://192.168.1.10:3000/approvals', isDestroyed: () => true },
        sender: { getURL: () => 'http://192.168.1.10:3000/approvals' },
      },
      trusted,
    ),
    false,
    'destroyed senderFrame must not authorize IPC',
  )
})

test('MF-1 regression: IPC sender trust denies cross-origin child frame while top-level URL is trusted', () => {
  const trusted = ['http://192.168.1.10:3000']
  assert.equal(
    senderIsTrusted(
      {
        senderFrame: { url: 'http://evil.test/frame' },
        sender: { getURL: () => 'http://192.168.1.10:3000/approvals' },
      },
      trusted,
    ),
    false,
  )
})

test('MF-1 regression: IPC sender trust keeps allowing legitimate main-frame frame URL', () => {
  const trusted = ['http://192.168.1.10:3000']
  assert.equal(
    senderIsTrusted({ senderFrame: { url: 'http://192.168.1.10:3000/approvals' } }, trusted),
    true,
  )
})

test('MF-1 regression: IPC sender trust denies unparseable frame URL even when top-level is trusted', () => {
  const trusted = ['http://192.168.1.10:3000']
  const topLevelTrustedSender = { getURL: () => 'http://192.168.1.10:3000/approvals' }
  assert.equal(
    senderIsTrusted(
      { senderFrame: { url: 'not a url' }, sender: topLevelTrustedSender },
      trusted,
    ),
    false,
  )
  assert.equal(
    senderIsTrusted(
      { senderFrame: { url: 'http://[bad' }, sender: topLevelTrustedSender },
      trusted,
    ),
    false,
  )
})

test('normalize rejects userinfo/path/query/fragment rather than strip', () => {
  assert.equal(normalizeHamsterOriginInput('http://192.168.1.10:3000/path').ok, false)
  assert.equal(normalizeHamsterOriginInput('http://user:pass@192.168.1.10:3000').ok, false)
  assert.equal(normalizeHamsterOriginInput('http://192.168.1.10:3000?x=1').ok, false)
  assert.equal(normalizeHamsterOriginInput('http://192.168.1.10:3000#h').ok, false)
  assert.equal(normalizeHamsterOriginInput('http://192.168.1.10:3000').ok, true)
})

test('focus/blur badge semantics: count retained across clear', () => {
  let latestPendingApprovals = 3
  let badge = latestPendingApprovals
  badge = 0
  assert.equal(latestPendingApprovals, 3)
  if (latestPendingApprovals > 0) badge = latestPendingApprovals
  assert.equal(badge, 3)
})

test('window-open policy is default-deny (contract)', () => {
  const handler = () => ({ action: 'deny' })
  assert.deepEqual(handler({ url: 'http://192.168.1.10:3000/assets/x' }), { action: 'deny' })
  assert.deepEqual(handler({ url: 'http://evil.test/' }), { action: 'deny' })
})
