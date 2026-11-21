'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { isWindowDestroyedLoadError, loadFileIfAlive } = require('./windowLoadGuard.cjs')

test('isWindowDestroyedLoadError matches Electron teardown race', () => {
  assert.equal(isWindowDestroyedLoadError(new TypeError('Object has been destroyed')), true)
  assert.equal(isWindowDestroyedLoadError({ message: 'Object has been destroyed' }), true)
})

test('isWindowDestroyedLoadError does not swallow genuine load errors', () => {
  assert.equal(isWindowDestroyedLoadError(new Error('ERR_FILE_NOT_FOUND')), false)
  assert.equal(isWindowDestroyedLoadError(new Error('net::ERR_FAILED')), false)
  assert.equal(isWindowDestroyedLoadError(null), false)
})

test('loadFileIfAlive skips destroyed window without calling loadFile', async () => {
  let called = false
  const win = {
    isDestroyed: () => true,
    loadFile: async () => {
      called = true
    },
  }
  const result = await loadFileIfAlive(win, '/tmp/gate.html')
  assert.deepEqual(result, { ok: false, reason: 'window_destroyed' })
  assert.equal(called, false)
})

test('loadFileIfAlive treats mid-load destroy as window_destroyed', async () => {
  const win = {
    isDestroyed: () => false,
    loadFile: async () => {
      throw new TypeError('Object has been destroyed')
    },
  }
  const result = await loadFileIfAlive(win, '/tmp/gate.html')
  assert.deepEqual(result, { ok: false, reason: 'window_destroyed' })
})

test('loadFileIfAlive rethrows genuine load errors', async () => {
  const win = {
    isDestroyed: () => false,
    loadFile: async () => {
      throw new Error('ERR_FILE_NOT_FOUND')
    },
  }
  await assert.rejects(() => loadFileIfAlive(win, '/missing.html'), /ERR_FILE_NOT_FOUND/)
})
