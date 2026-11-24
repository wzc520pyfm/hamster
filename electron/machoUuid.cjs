'use strict'

/**
 * Give packaged macOS Electron executables a unique LC_UUID.
 *
 * macOS Local Network privacy (TN3179) identifies an app by the main
 * executable's Mach-O LC_UUID. Electron's prebuilt binary ships the same UUID
 * for every app on the same Electron version+arch, so macOS may attribute LAN
 * traffic to another Electron app: no prompt (or a useless toggle) and
 * EHOSTUNREACH to 192.168.x.x despite NSLocalNetworkUsageDescription.
 * See electron/electron#55101.
 *
 * UUIDs are derived from appId + arch (+ helper role) so they stay stable
 * across versions and the user's Local Network grant survives updates.
 * Must run in afterPack before any signing step.
 */

const crypto = require('node:crypto')
const fs = require('node:fs')

const MH_MAGIC_64 = 0xfeedfacf
const LC_UUID = 0x1b

function findUuidOffset(buf) {
  if (buf.length < 32 || buf.readUInt32LE(0) !== MH_MAGIC_64) {
    throw new Error('not a thin 64-bit little-endian Mach-O executable')
  }
  const ncmds = buf.readUInt32LE(16)
  const sizeofcmds = buf.readUInt32LE(20)
  const end = 32 + sizeofcmds
  if (end > buf.length) throw new Error('Mach-O load commands run past the file')
  let off = 32
  for (let i = 0; i < ncmds; i += 1) {
    if (off + 8 > end) throw new Error('truncated Mach-O load command')
    const cmd = buf.readUInt32LE(off)
    const cmdsize = buf.readUInt32LE(off + 4)
    if (cmdsize < 8 || off + cmdsize > end) throw new Error('bad Mach-O load command size')
    if (cmd === LC_UUID) {
      if (cmdsize !== 24) throw new Error('bad LC_UUID size')
      return off + 8
    }
    off += cmdsize
  }
  throw new Error('Mach-O executable has no LC_UUID')
}

function formatUuid(bytes) {
  const h = Buffer.from(bytes).toString('hex').toUpperCase()
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

function readUuid(buf) {
  const at = findUuidOffset(buf)
  return formatUuid(buf.subarray(at, at + 16))
}

/** Stable name-based UUID (version-5 layout) for one app / arch / role. */
function appUuid(appId, arch, role = 'main') {
  const digest = crypto
    .createHash('sha256')
    .update(`hamster-lc-uuid:${appId}:${arch}:${role}`)
    .digest()
    .subarray(0, 16)
  digest[6] = (digest[6] & 0x0f) | 0x50
  digest[8] = (digest[8] & 0x3f) | 0x80
  return formatUuid(digest)
}

function setUuid(buf, uuid) {
  const bytes = Buffer.from(String(uuid).replace(/-/g, ''), 'hex')
  if (bytes.length !== 16) throw new Error(`bad UUID ${uuid}`)
  const at = findUuidOffset(buf)
  bytes.copy(buf, at)
  return buf
}

function patchExecutable(file, uuid) {
  const buf = fs.readFileSync(file)
  const before = readUuid(buf)
  setUuid(buf, uuid)
  fs.writeFileSync(file, buf)
  return { before, after: readUuid(fs.readFileSync(file)) }
}

module.exports = {
  MH_MAGIC_64,
  LC_UUID,
  findUuidOffset,
  readUuid,
  appUuid,
  setUuid,
  patchExecutable,
}
