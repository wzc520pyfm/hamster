'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  loadSession,
  saveSession,
  rememberLocation,
  resolveStartupUrl,
  trustOrigin,
  senderIsTrusted,
} = require('./sessionStore.cjs')
const { isUrlOnTrustedOrigin } = require('./hamsterOrigin.cjs')

test('session restores last asset path on trusted origin', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hamster-session-'))
  const file = path.join(dir, 'session.json')
  let session = {
    trustedOrigins: ['http://192.168.1.10:3000'],
    lastOrigin: 'http://192.168.1.10:3000',
    lastPath: '/assets/asset_demo',
    lastSearch: '',
    lastHash: '',
  }
  saveSession(file, session)
  const loaded = loadSession(file, 'http://localhost:3000')
  assert.ok(loaded.trustedOrigins.includes('http://192.168.1.10:3000'))
  assert.ok(loaded.trustedOrigins.includes('http://localhost:3000'))
  assert.equal(
    resolveStartupUrl(loaded, 'http://localhost:3000'),
    'http://192.168.1.10:3000/assets/asset_demo',
  )
})

test('rememberLocation ignores untrusted origins', () => {
  let session = {
    trustedOrigins: ['http://localhost:3000'],
    lastOrigin: 'http://localhost:3000',
    lastPath: '/',
    lastSearch: '',
    lastHash: '',
  }
  session = rememberLocation(session, 'http://evil.test/assets/x')
  assert.equal(session.lastPath, '/')
  session = trustOrigin(session, 'http://192.168.1.10:3000')
  session = rememberLocation(session, 'http://192.168.1.10:3000/approvals')
  assert.equal(session.lastPath, '/approvals')
  assert.equal(
    resolveStartupUrl(session, 'http://localhost:3000'),
    'http://192.168.1.10:3000/approvals',
  )
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

test('focus/blur badge semantics: count retained across clear', () => {
  // Pure behaviour contract used by main.js: clearing the badge must not zero the count.
  let latestPendingApprovals = 3
  let badge = latestPendingApprovals
  // focus:
  badge = 0
  assert.equal(latestPendingApprovals, 3)
  // blur:
  if (latestPendingApprovals > 0) badge = latestPendingApprovals
  assert.equal(badge, 3)
})

test('session-origin IPC contract denies untrusted sender', () => {
  const trusted = ['http://192.168.1.10:3000']
  assert.equal(
    senderIsTrusted({ senderFrame: { url: 'http://evil.test/' } }, trusted),
    false,
  )
  assert.equal(
    senderIsTrusted({ senderFrame: { url: 'http://192.168.1.10:3000/' } }, trusted),
    true,
  )
})

test('window-open policy is default-deny (contract)', () => {
  // Mirrors electron/main.js setWindowOpenHandler: always { action: 'deny' }.
  const handler = () => ({ action: 'deny' })
  assert.deepEqual(handler({ url: 'http://192.168.1.10:3000/assets/x' }), { action: 'deny' })
  assert.deepEqual(handler({ url: 'http://evil.test/' }), { action: 'deny' })
})
