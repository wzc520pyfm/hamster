'use strict'

/**
 * afterPack:
 * - linux: install fail-closed AppRun (overwrite vendor fail-open AppRun).
 * - darwin: rewrite main executable Mach-O LC_UUID for Local Network privacy
 *   (TN3179 / electron#55101), then ad-hoc re-sign the rewritten binary on
 *   Apple Silicon. Editing LC_UUID invalidates Electron's linker signature;
 *   with mac.identity null, nothing re-signs and arm64 kills the app at launch
 *   ("Hamster quit unexpectedly"). Helpers keep stock UUIDs — macOS attributes
 *   their traffic to the responsible app once the main UUID is unique.
 *
 * Desktop Exec is fixed separately via linux.executableArgs: [] in electron-builder.yml.
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { appUuid, patchExecutable, readUuid } = require('./machoUuid.cjs')

const FAIL_CLOSED = path.join(__dirname, 'appimage', 'AppRun.fail-closed.sh')
const APP_ID = 'com.hamster.p1.electron'

function archLabel(arch) {
  // electron-builder Arch enum: 0=ia32, 1=x64, 2=armv7l, 3=arm64, 4=universal
  if (arch === 3 || arch === 'arm64') return 'arm64'
  if (arch === 1 || arch === 'x64') return 'x64'
  return String(arch)
}

/**
 * Resolve main executable from electron-builder darwin appOutDir
 * (`…/mac(-arm64)/Hamster.app/Contents/MacOS/Hamster` under `…/Hamster.app`).
 */
function resolveDarwinMain(appOutDir, productName) {
  const directMain = path.join(appOutDir, productName)
  if (fs.existsSync(directMain) && path.basename(appOutDir) === 'MacOS') {
    return directMain
  }
  const appRoot =
    path.basename(appOutDir) === `${productName}.app`
      ? appOutDir
      : path.join(appOutDir, `${productName}.app`)
  return path.join(appRoot, 'Contents', 'MacOS', productName)
}

/**
 * Ad-hoc re-sign a single Mach-O as a standalone file (not the .app bundle).
 * Signing Contents/MacOS/X in place makes codesign treat it as the whole bundle
 * and fail on not-yet-signed siblings during afterPack.
 */
function adHocSignExecutable(filePath) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hamster-adhoc-'))
  const tmp = path.join(dir, path.basename(filePath))
  try {
    fs.copyFileSync(filePath, tmp)
    const result = spawnSync('codesign', ['--sign', '-', '--force', '--timestamp=none', tmp], {
      encoding: 'utf8',
    })
    if (result.status !== 0) {
      throw new Error(
        `codesign --sign - failed for ${filePath}: ${result.stderr || result.stdout || result.error}`,
      )
    }
    fs.copyFileSync(tmp, filePath)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function patchDarwinLocalNetworkUuids(context) {
  const arch = archLabel(context.arch)
  const productName = context.packager?.appInfo?.productFilename || 'Hamster'
  const main = resolveDarwinMain(context.appOutDir, productName)
  if (!fs.existsSync(main)) {
    throw new Error(`macOS afterPack: main executable missing at ${main}`)
  }

  const before = readUuid(fs.readFileSync(main))
  const expected = appUuid(APP_ID, arch, 'main')
  const mainResult = patchExecutable(main, expected)
  if (mainResult.after === mainResult.before) {
    throw new Error('macOS afterPack: main LC_UUID unchanged after patch')
  }
  if (mainResult.after !== expected) {
    throw new Error(`macOS afterPack: expected UUID ${expected}, got ${mainResult.after}`)
  }

  // Apple Silicon rejects binaries whose linker ad-hoc signature was invalidated.
  // Electron x64 builds often ship unsigned; codesign --sign - can fail there — skip.
  if (arch === 'arm64') {
    adHocSignExecutable(main)
    // UUID must survive the re-sign.
    const afterSign = readUuid(fs.readFileSync(main))
    if (afterSign !== expected) {
      throw new Error(`macOS afterPack: UUID lost after ad-hoc sign (${afterSign})`)
    }
  }

  return [{ role: 'main', path: main, before, after: mainResult.after, arch }]
}

function installFailClosedAppRun(context) {
  const src = FAIL_CLOSED
  const dest = path.join(context.appOutDir, 'AppRun')
  if (!fs.existsSync(src)) {
    throw new Error(`fail-closed AppRun template missing: ${src}`)
  }
  fs.copyFileSync(src, dest)
  fs.chmodSync(dest, 0o755)

  const body = fs.readFileSync(dest, 'utf8')
  if (body.includes('NO_SANDBOX=(--no-sandbox)')) {
    throw new Error('afterPack AppRun still contains fail-open NO_SANDBOX=(--no-sandbox)')
  }
  if (body.includes('"${NO_SANDBOX[@]}"') || body.includes('${NO_SANDBOX[@]}')) {
    throw new Error('afterPack AppRun still passes NO_SANDBOX array to BIN')
  }
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName === 'linux') {
    installFailClosedAppRun(context)
    return
  }
  if (context.electronPlatformName === 'darwin') {
    patchDarwinLocalNetworkUuids(context)
  }
}

exports.patchDarwinLocalNetworkUuids = patchDarwinLocalNetworkUuids
exports.resolveDarwinMain = resolveDarwinMain
exports.adHocSignExecutable = adHocSignExecutable
exports.archLabel = archLabel
