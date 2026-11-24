'use strict'

/**
 * afterPack:
 * - linux: install fail-closed AppRun (overwrite vendor fail-open AppRun).
 * - darwin: rewrite main + Helper Mach-O LC_UUID for Local Network privacy
 *   (TN3179 / electron#55101). Must run before any signing step.
 *
 * Desktop Exec is fixed separately via linux.executableArgs: [] in electron-builder.yml.
 */
const fs = require('node:fs')
const path = require('node:path')
const { appUuid, patchExecutable } = require('./machoUuid.cjs')

const FAIL_CLOSED = path.join(__dirname, 'appimage', 'AppRun.fail-closed.sh')
const APP_ID = 'com.hamster.p1.electron'

function archLabel(arch) {
  // electron-builder Arch enum: 0=ia32, 1=x64, 2=armv7l, 3=arm64, 4=universal
  if (arch === 3 || arch === 'arm64') return 'arm64'
  if (arch === 1 || arch === 'x64') return 'x64'
  return String(arch)
}

/**
 * Resolve MacOS + Frameworks dirs from electron-builder's darwin appOutDir.
 * electron-builder documents appOutDir as `…/AppName.app/Contents/MacOS`.
 */
function resolveDarwinLayout(appOutDir, productName) {
  const directMain = path.join(appOutDir, productName)
  if (fs.existsSync(directMain) && path.basename(appOutDir) === 'MacOS') {
    return {
      main: directMain,
      frameworks: path.join(path.dirname(appOutDir), 'Frameworks'),
    }
  }
  // Fallback: appOutDir is the .app bundle root.
  const appRoot =
    path.basename(appOutDir) === `${productName}.app`
      ? appOutDir
      : path.join(appOutDir, `${productName}.app`)
  const main = path.join(appRoot, 'Contents', 'MacOS', productName)
  const frameworks = path.join(appRoot, 'Contents', 'Frameworks')
  return { main, frameworks }
}

function patchDarwinLocalNetworkUuids(context) {
  const arch = archLabel(context.arch)
  const productName = context.packager?.appInfo?.productFilename || 'Hamster'
  const { main, frameworks } = resolveDarwinLayout(context.appOutDir, productName)
  if (!fs.existsSync(main)) {
    throw new Error(`macOS afterPack: main executable missing at ${main}`)
  }

  const patched = []
  const mainResult = patchExecutable(main, appUuid(APP_ID, arch, 'main'))
  patched.push({ role: 'main', path: main, ...mainResult })
  if (mainResult.after === mainResult.before) {
    throw new Error('macOS afterPack: main LC_UUID unchanged after patch')
  }

  const helpers = [
    { role: 'helper', name: `${productName} Helper` },
    { role: 'helper-renderer', name: `${productName} Helper (Renderer)` },
    { role: 'helper-gpu', name: `${productName} Helper (GPU)` },
    { role: 'helper-plugin', name: `${productName} Helper (Plugin)` },
  ]
  if (fs.existsSync(frameworks)) {
    for (const h of helpers) {
      const exe = path.join(frameworks, `${h.name}.app`, 'Contents', 'MacOS', h.name)
      if (!fs.existsSync(exe)) continue
      patched.push({
        role: h.role,
        path: exe,
        ...patchExecutable(exe, appUuid(APP_ID, arch, h.role)),
      })
    }
  }

  return patched
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
exports.resolveDarwinLayout = resolveDarwinLayout
exports.archLabel = archLabel
