'use strict'

/**
 * afterPack: install fail-closed AppRun into appOutDir so legacy fuse2
 * `copyDir(appOutDir → stageDir)` overwrites vendor generateAppRunScript output
 * (which fail-opens with --no-sandbox on unshare probe failure).
 *
 * Desktop Exec is fixed separately via linux.executableArgs: [] in electron-builder.yml.
 */
const fs = require('node:fs')
const path = require('node:path')

const FAIL_CLOSED = path.join(__dirname, 'appimage', 'AppRun.fail-closed.sh')

exports.default = async function appimageAfterPack(context) {
  if (context.electronPlatformName !== 'linux') return

  const src = FAIL_CLOSED
  const dest = path.join(context.appOutDir, 'AppRun')
  if (!fs.existsSync(src)) {
    throw new Error(`fail-closed AppRun template missing: ${src}`)
  }
  fs.copyFileSync(src, dest)
  fs.chmodSync(dest, 0o755)

  // Guard: never ship the fail-open injection / pass-through patterns.
  const body = fs.readFileSync(dest, 'utf8')
  if (body.includes('NO_SANDBOX=(--no-sandbox)')) {
    throw new Error('afterPack AppRun still contains fail-open NO_SANDBOX=(--no-sandbox)')
  }
  if (body.includes('"${NO_SANDBOX[@]}"') || body.includes('${NO_SANDBOX[@]}')) {
    throw new Error('afterPack AppRun still passes NO_SANDBOX array to BIN')
  }
}
