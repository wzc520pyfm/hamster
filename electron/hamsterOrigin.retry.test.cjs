'use strict'

/**
 * Local-network retry around validateHamsterClientApiOrigin (macOS 15+ TN3179).
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  validateHamsterClientApiOriginWithRetry,
} = require('./hamsterOrigin.cjs')

const GOOD_MANIFEST = {
  name: 'Hamster',
  short_name: 'Hamster',
  display: 'standalone',
  start_url: '/',
}

function okHealth() {
  return { ok: true, status: 200, json: async () => ({ status: 'ok' }) }
}

function okManifest() {
  return { ok: true, status: 200, json: async () => GOOD_MANIFEST }
}

test('retry recovers after transient health_unreachable (LAN permission race)', async () => {
  let healthCalls = 0
  const sleeps = []
  const fetchImpl = async (url) => {
    const u = String(url)
    if (u.includes('/api/health')) {
      healthCalls += 1
      if (healthCalls < 2) throw new Error('EHOSTUNREACH')
      return okHealth()
    }
    if (u.includes('manifest.webmanifest')) return okManifest()
    return { ok: false, status: 404, json: async () => ({}) }
  }

  const result = await validateHamsterClientApiOriginWithRetry('http://192.168.1.10:3000', {
    fetchImpl,
    attempts: 3,
    delayMs: 5,
    sleep: async (ms) => {
      sleeps.push(ms)
    },
  })
  assert.deepEqual(result, { ok: true, origin: 'http://192.168.1.10:3000' })
  assert.equal(healthCalls, 2)
  assert.deepEqual(sleeps, [5])
})

test('retry does not loop on non-transient validation failures', async () => {
  let healthCalls = 0
  const fetchImpl = async (url) => {
    const u = String(url)
    if (u.includes('/api/health')) {
      healthCalls += 1
      return { ok: true, status: 200, json: async () => ({ status: 'degraded' }) }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }

  const result = await validateHamsterClientApiOriginWithRetry('http://192.168.1.10:3000', {
    fetchImpl,
    attempts: 5,
    delayMs: 5,
    sleep: async () => {
      assert.fail('must not sleep on health_not_hamster')
    },
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'health_not_hamster')
  assert.equal(healthCalls, 1)
})

test('retry exhaustion keeps health_unreachable after default attempts', async () => {
  let healthCalls = 0
  const sleeps = []
  const fetchImpl = async (url) => {
    const u = String(url)
    if (u.includes('/api/health')) {
      healthCalls += 1
      throw new Error('EHOSTUNREACH')
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }

  const result = await validateHamsterClientApiOriginWithRetry('http://192.168.1.10:3000', {
    fetchImpl,
    delayMs: 5,
    sleep: async (ms) => {
      sleeps.push(ms)
    },
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'health_unreachable')
  assert.equal(healthCalls, 3)
  assert.deepEqual(sleeps, [5, 5])
})

test('retry recovers after transient manifest_unreachable', async () => {
  let healthCalls = 0
  let manifestCalls = 0
  const fetchImpl = async (url) => {
    const u = String(url)
    if (u.includes('/api/health')) {
      healthCalls += 1
      return okHealth()
    }
    if (u.includes('manifest.webmanifest')) {
      manifestCalls += 1
      if (manifestCalls < 2) throw new Error('EHOSTUNREACH')
      return okManifest()
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }

  const result = await validateHamsterClientApiOriginWithRetry('http://192.168.1.10:3000', {
    fetchImpl,
    attempts: 3,
    delayMs: 5,
    sleep: async () => {},
  })
  assert.deepEqual(result, { ok: true, origin: 'http://192.168.1.10:3000' })
  assert.equal(healthCalls, 2)
  assert.equal(manifestCalls, 2)
})
