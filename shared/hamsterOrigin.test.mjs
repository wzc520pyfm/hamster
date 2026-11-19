import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeHamsterOrigin,
  validateHamsterClientApiOrigin,
  resolveApiBase,
  isRestorableClientPath,
  buildClientUrl,
} from './hamsterOrigin.mjs'

test('normalize rejects credentials and non-http schemes', () => {
  assert.equal(normalizeHamsterOrigin('').ok, false)
  assert.equal(normalizeHamsterOrigin('ftp://example.com').ok, false)
  assert.equal(normalizeHamsterOrigin('http://user:pass@example.com').reason, 'credentials')
  assert.deepEqual(normalizeHamsterOrigin('192.168.1.10:3000'), {
    ok: true,
    origin: 'http://192.168.1.10:3000',
  })
  assert.deepEqual(normalizeHamsterOrigin('http://192.168.1.10:3000/assets/x'), {
    ok: true,
    origin: 'http://192.168.1.10:3000',
  })
})

test('resolveApiBase prefers same-origin relative when page matches control', () => {
  assert.equal(
    resolveApiBase({
      pageOrigin: 'http://192.168.1.10:3000',
      controlBase: 'http://192.168.1.10:3000',
      viteApiBase: 'http://localhost:8080',
    }),
    '',
  )
  assert.equal(
    resolveApiBase({
      pageOrigin: 'http://127.0.0.1:3000',
      controlBase: 'http://192.168.1.10:3000',
      viteApiBase: '',
    }),
    'http://192.168.1.10:3000',
  )
})

test('restorable paths cover conversation assets approvals only', () => {
  assert.equal(isRestorableClientPath('/'), true)
  assert.equal(isRestorableClientPath('/assets'), true)
  assert.equal(isRestorableClientPath('/assets/asset_abc-1'), true)
  assert.equal(isRestorableClientPath('/approvals'), true)
  assert.equal(isRestorableClientPath('/evil'), false)
  assert.equal(isRestorableClientPath('/assets/../etc/passwd'), false)
})

test('buildClientUrl falls back unsafe paths to root', () => {
  assert.equal(
    buildClientUrl('http://192.168.1.10:3000', '/assets/asset_1'),
    'http://192.168.1.10:3000/assets/asset_1',
  )
  assert.equal(buildClientUrl('http://192.168.1.10:3000', '/nope'), 'http://192.168.1.10:3000/')
})

function mockFetch(handlers) {
  return async (input, init = {}) => {
    const url = String(input)
    const handler = handlers.find((h) => h.match(url))
    if (!handler) {
      return {
        ok: false,
        status: 404,
        json: async () => ({}),
      }
    }
    if (handler.redirect) {
      return { ok: false, status: 302, headers: { get: () => handler.redirect } }
    }
    return {
      ok: handler.status >= 200 && handler.status < 300,
      status: handler.status,
      json: async () => handler.body,
    }
  }
}

const GOOD_MANIFEST = {
  name: 'Hamster',
  short_name: 'Hamster',
  display: 'standalone',
  start_url: '/',
}

test('validate accepts Hamster client+API origin', async () => {
  const fetchImpl = mockFetch([
    { match: (u) => u.endsWith('/api/health'), status: 200, body: { status: 'ok' } },
    { match: (u) => u.endsWith('/manifest.webmanifest'), status: 200, body: GOOD_MANIFEST },
  ])
  const result = await validateHamsterClientApiOrigin('http://192.168.1.10:3000', { fetchImpl })
  assert.deepEqual(result, { ok: true, origin: 'http://192.168.1.10:3000' })
})

test('validate rejects arbitrary 200 health without Hamster manifest', async () => {
  const fetchImpl = mockFetch([
    { match: (u) => u.endsWith('/api/health'), status: 200, body: { status: 'ok' } },
    { match: (u) => u.endsWith('/manifest.webmanifest'), status: 404, body: {} },
  ])
  const result = await validateHamsterClientApiOrigin('http://example.com', { fetchImpl })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'manifest_http')
})

test('validate rejects API-only origin (health ok, non-Hamster manifest)', async () => {
  const fetchImpl = mockFetch([
    { match: (u) => u.endsWith('/api/health'), status: 200, body: { status: 'ok' } },
    {
      match: (u) => u.endsWith('/manifest.webmanifest'),
      status: 200,
      body: { name: 'Other', display: 'standalone', start_url: '/' },
    },
  ])
  const result = await validateHamsterClientApiOrigin('http://api-only.local:8080', { fetchImpl })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'manifest_not_hamster')
})

test('validate rejects health redirect off-origin', async () => {
  const fetchImpl = mockFetch([
    { match: (u) => u.endsWith('/api/health'), status: 302, redirect: 'http://evil.test/api/health' },
  ])
  const result = await validateHamsterClientApiOrigin('http://192.168.1.10:3000', { fetchImpl })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'health_redirect')
})

test('validate rejects non-ok health JSON', async () => {
  const fetchImpl = mockFetch([
    { match: (u) => u.endsWith('/api/health'), status: 200, body: { status: 'degraded' } },
  ])
  const result = await validateHamsterClientApiOrigin('http://192.168.1.10:3000', { fetchImpl })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'health_not_hamster')
})
