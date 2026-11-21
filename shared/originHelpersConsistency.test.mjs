import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as shared from './hamsterOrigin.mjs'

const require = createRequire(import.meta.url)
const electron = require(path.join(path.dirname(fileURLToPath(import.meta.url)), '../electron/hamsterOrigin.cjs'))

const vectors = [
  '',
  'ftp://evil',
  'http://user:pass@192.168.1.5:3000',
  '192.168.1.5:3000',
  'http://192.168.1.5:3000/assets/x',
  'https://hamster.example',
]

test('shared ESM and electron CJS normalizeHamsterOrigin stay aligned', () => {
  for (const v of vectors) {
    assert.deepEqual(
      electron.normalizeHamsterOrigin(v),
      shared.normalizeHamsterOrigin(v),
      `normalize drift on ${JSON.stringify(v)}`,
    )
  }
})

test('shared ESM and electron CJS resolveApiBase / restorable path stay aligned', () => {
  assert.equal(
    electron.isRestorableClientPath('/assets/asset_1'),
    shared.isRestorableClientPath('/assets/asset_1'),
  )
  assert.equal(electron.isRestorableClientPath('/evil'), shared.isRestorableClientPath('/evil'))
  assert.equal(
    electron.buildClientUrl('http://192.168.1.5:3000', '/approvals'),
    shared.buildClientUrl('http://192.168.1.5:3000', '/approvals'),
  )
  assert.equal(
    shared.resolveApiBase({
      pageOrigin: 'http://192.168.1.5:3000',
      controlBase: 'http://192.168.1.5:3000',
      viteApiBase: 'http://localhost:8080',
    }),
    '',
  )
})
