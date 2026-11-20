import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { safeJoinDistForTest } from './server.mjs'

test('safeJoinDist rejects prefix and traversal escapes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hamster-dist-'))
  fs.writeFileSync(path.join(root, 'index.html'), 'ok')
  fs.mkdirSync(path.join(root, 'assets'))
  fs.writeFileSync(path.join(root, 'assets', 'app.js'), 'js')

  assert.ok(safeJoinDistForTest(root, '/index.html')?.endsWith('index.html'))
  assert.ok(safeJoinDistForTest(root, '/assets/app.js')?.includes(`${path.sep}assets${path.sep}app.js`))

  // Classic traversal
  assert.equal(safeJoinDistForTest(root, '/../../etc/passwd'), null)

  // Prefix bypass: /app/dist vs /app/distevil
  const sibling = root + 'evil'
  fs.mkdirSync(sibling, { recursive: true })
  fs.writeFileSync(path.join(sibling, 'secret.txt'), 'nope')
  // If implementation used startsWith(root) alone, joining "evil/secret" after normalize could escape.
  // Our resolve(root, rel) with root+sep check must deny anything outside.
  assert.equal(safeJoinDistForTest(root, '../' + path.basename(sibling) + '/secret.txt'), null)
})
