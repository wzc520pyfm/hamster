'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  MH_MAGIC_64,
  LC_UUID,
  findUuidOffset,
  readUuid,
  appUuid,
  setUuid,
  patchExecutable,
} = require('./machoUuid.cjs')

/** Minimal thin arm64 Mach-O with one LC_UUID load command. */
function synthMachO(uuidHex = '4c4c44ce55553144a1ff5e44dfb90261') {
  const header = Buffer.alloc(32)
  header.writeUInt32LE(MH_MAGIC_64, 0)
  header.writeUInt32LE(0x0100000c, 4) // CPU_TYPE_ARM64
  header.writeUInt32LE(0, 8)
  header.writeUInt32LE(2, 12) // MH_EXECUTE
  header.writeUInt32LE(1, 16) // ncmds
  header.writeUInt32LE(24, 20) // sizeofcmds
  header.writeUInt32LE(0, 24)
  header.writeUInt32LE(0, 28)
  const lc = Buffer.alloc(24)
  lc.writeUInt32LE(LC_UUID, 0)
  lc.writeUInt32LE(24, 4)
  Buffer.from(uuidHex, 'hex').copy(lc, 8)
  return Buffer.concat([header, lc, Buffer.alloc(16, 0x90)])
}

test('appUuid is stable per appId/arch/role and differs across roles', () => {
  const a = appUuid('com.hamster.p1.electron', 'arm64', 'main')
  const b = appUuid('com.hamster.p1.electron', 'arm64', 'main')
  const c = appUuid('com.hamster.p1.electron', 'x64', 'main')
  const d = appUuid('com.hamster.p1.electron', 'arm64', 'helper')
  assert.equal(a, b)
  assert.notEqual(a, c)
  assert.notEqual(a, d)
  assert.match(a, /^[0-9A-F]{8}-[0-9A-F]{4}-5[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/)
})

test('read/setUuid only rewrites the 16 UUID bytes', () => {
  const stock = '4C4C44CE-5555-3144-A1FF-5E44DFB90261'
  const buf = synthMachO(stock.replace(/-/g, '').toLowerCase())
  const before = Buffer.from(buf)
  assert.equal(readUuid(buf), stock)
  const next = appUuid('com.hamster.p1.electron', 'arm64', 'main')
  setUuid(buf, next)
  assert.equal(readUuid(buf), next)
  const at = findUuidOffset(buf)
  for (let i = 0; i < before.length; i += 1) {
    if (i >= at && i < at + 16) continue
    assert.equal(buf[i], before[i], `byte ${i} must be unchanged`)
  }
})

test('patchExecutable rewrites file and refuses non-Mach-O', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hamster-macho-'))
  try {
    const file = path.join(dir, 'Hamster')
    fs.writeFileSync(file, synthMachO())
    const uuid = appUuid('com.hamster.p1.electron', 'arm64', 'main')
    const result = patchExecutable(file, uuid)
    assert.equal(result.after, uuid)
    assert.notEqual(result.before, result.after)
    assert.throws(() => patchExecutable(path.join(dir, 'missing'), uuid), /ENOENT|no such file/i)
    const junk = path.join(dir, 'junk')
    fs.writeFileSync(junk, Buffer.from('not macho'))
    assert.throws(() => patchExecutable(junk, uuid), /not a thin 64-bit/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('darwin afterPack rewrites main+helper UUIDs under appOutDir/*.app layout', () => {
  const { patchDarwinLocalNetworkUuids } = require('./appimageAfterPack.cjs')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hamster-darwin-pack-'))
  try {
    const app = path.join(root, 'Hamster.app')
    const main = path.join(app, 'Contents', 'MacOS', 'Hamster')
    fs.mkdirSync(path.dirname(main), { recursive: true })
    fs.writeFileSync(main, synthMachO())
    const helpers = ['Helper', 'Helper (Renderer)', 'Helper (GPU)', 'Helper (Plugin)']
    for (const suffix of helpers) {
      const name = `Hamster ${suffix}`
      const exe = path.join(app, 'Contents', 'Frameworks', `${name}.app`, 'Contents', 'MacOS', name)
      fs.mkdirSync(path.dirname(exe), { recursive: true })
      fs.writeFileSync(exe, synthMachO(`4c4c444${helpers.indexOf(suffix)}55553144a1b41777fb24dfb${helpers.indexOf(suffix)}`))
    }
    const patched = patchDarwinLocalNetworkUuids({
      appOutDir: root,
      arch: 3,
      packager: { appInfo: { productFilename: 'Hamster' } },
    })
    assert.equal(patched.length, 5)
    assert.equal(patched[0].after, appUuid('com.hamster.p1.electron', 'arm64', 'main'))
    assert.notEqual(patched[0].before, patched[0].after)
    assert.equal(readUuid(fs.readFileSync(main)), patched[0].after)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
