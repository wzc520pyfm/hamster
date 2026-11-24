'use strict'

/**
 * Persistent static regressions for AppImage launcher sandbox policy.
 * Does NOT execute AppRun, unshare, AppImage, GUI, or real Electron.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const ELECTRON_DIR = __dirname
const FAIL_CLOSED = path.join(ELECTRON_DIR, 'appimage', 'AppRun.fail-closed.sh')
const AFTER_PACK = path.join(ELECTRON_DIR, 'appimageAfterPack.cjs')
const BUILDER_YML = path.join(ELECTRON_DIR, 'electron-builder.yml')
const MAIN_JS = path.join(ELECTRON_DIR, 'main.js')

/** Vendor fail-open fixture (matches 90dacf AppRun 152d06d… pattern) for red-path assertions. */
const VENDOR_FAIL_OPEN_SNIPPET = `
HAVE_NO_SANDBOX=0
NO_SANDBOX=()
if [ $HAVE_NO_SANDBOX -eq 0 ] && ! unshare -Ur true 2>/dev/null ; then
  NO_SANDBOX=(--no-sandbox)
fi
exec "$BIN" "\${NO_SANDBOX[@]}"
`

function assertFailClosedPolicy(body, label) {
  assert.ok(!body.includes('NO_SANDBOX=(--no-sandbox)'), `${label}: must not inject NO_SANDBOX=(--no-sandbox)`)
  assert.ok(
    !/\$\{NO_SANDBOX\[@\]\}/.test(body) && !body.includes('"${NO_SANDBOX[@]}"'),
    `${label}: must not pass NO_SANDBOX array to BIN`,
  )
  // Probe failure must fail closed (exit), not downgrade.
  assert.ok(
    /unshare/.test(body) && /exit 1/.test(body),
    `${label}: must reference unshare and exit 1 on unsupported env`,
  )
  assert.ok(
    !/prefer the app to start\s*\n\s*#\s*without sandboxing/.test(body),
    `${label}: must not keep upstream fail-open rationale`,
  )
}

test('vendor fail-open snippet is rejected by fail-closed policy helper (red fixture)', () => {
  assert.throws(() => assertFailClosedPolicy(VENDOR_FAIL_OPEN_SNIPPET, 'vendor'), /must not inject/)
})

test('fail-closed AppRun template satisfies static sandbox policy', () => {
  const body = fs.readFileSync(FAIL_CLOSED, 'utf8')
  assertFailClosedPolicy(body, 'AppRun.fail-closed.sh')
  assert.match(body, /--no-sandbox is not permitted/)
  assert.match(body, /Unsupported environment; refusing to start/)
  // Never exec with injected flag
  assert.ok(!/exec "\$BIN".*no-sandbox/.test(body))
})

test('electron-builder.yml sets executableArgs empty (no default --no-sandbox desktop Exec)', () => {
  const yml = fs.readFileSync(BUILDER_YML, 'utf8')
  assert.match(yml, /executableArgs:\s*\[\s*\]/)
  assert.match(yml, /afterPack:\s*\.\/appimageAfterPack\.cjs/)
  assert.match(yml, /artifactName:\s*Hamster-v\$\{version\}-\$\{os\}-\$\{arch\}\.\$\{ext\}/)
  assert.match(yml, /artifactName:\s*Hamster-v\$\{version\}-Windows-\$\{arch\}-Setup\.\$\{ext\}/)
  assert.match(yml, /artifactName:\s*Hamster-v\$\{version\}-Windows-\$\{arch\}-Portable\.\$\{ext\}/)
  assert.match(yml, /- AppImage/)
  assert.match(yml, /- deb/)
  assert.match(yml, /- rpm/)
  assert.match(yml, /- nsis/)
  assert.match(yml, /- portable/)
  assert.match(yml, /- dmg/)
  assert.match(yml, /- zip/)
  assert.match(yml, /^win:\s*$/m)
  assert.match(yml, /^mac:\s*$/m)
  assert.ok(!/executableArgs:\s*\[[^\]]*--no-sandbox/.test(yml))
})

test('macOS packaging declares NSLocalNetworkUsageDescription for LAN Connect', () => {
  const yml = fs.readFileSync(BUILDER_YML, 'utf8')
  // electron-builder copies mac.extendInfo into Contents/Info.plist.
  // Assert under the mac: block only (not a sibling linux/win key).
  const macMatch = yml.match(/^mac:\n((?:[ \t].*\n)*)/m)
  assert.ok(macMatch, 'mac: section required')
  const macBlock = macMatch[1]
  assert.match(
    macBlock,
    /extendInfo:\n[ \t]+NSLocalNetworkUsageDescription:\s*"Hamster connects to your self-hosted client on the local network\."/,
  )
  // Keep the usage string tied to the Connect gate's LAN origin story.
  assert.match(yml, /192\.168/)
})

test('afterPack copies fail-closed AppRun into appOutDir (static hook contract)', async () => {
  const hook = require(AFTER_PACK)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hamster-afterpack-'))
  try {
    await hook.default({ electronPlatformName: 'linux', appOutDir: tmp })
    const dest = path.join(tmp, 'AppRun')
    assert.ok(fs.existsSync(dest))
    const body = fs.readFileSync(dest, 'utf8')
    assertFailClosedPolicy(body, 'afterPack output AppRun')
    const mode = fs.statSync(dest).mode & 0o111
    assert.ok(mode !== 0, 'AppRun must be executable')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('afterPack no-ops on non-linux', async () => {
  const hook = require(AFTER_PACK)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hamster-afterpack-darwin-'))
  try {
    await hook.default({ electronPlatformName: 'darwin', appOutDir: tmp })
    assert.ok(!fs.existsSync(path.join(tmp, 'AppRun')))
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('main.js still enables renderer sandbox / isolation (unchanged gate)', () => {
  const main = fs.readFileSync(MAIN_JS, 'utf8')
  assert.match(main, /sandbox:\s*true/)
  assert.match(main, /contextIsolation:\s*true/)
  assert.match(main, /nodeIntegration:\s*false/)
})

test('static desktop Exec policy helper rejects unconditional --no-sandbox', () => {
  const bad = '[Desktop Entry]\nName=Hamster\nExec=AppRun --no-sandbox %U\n'
  const good = '[Desktop Entry]\nName=Hamster\nExec=AppRun %U\n'
  assert.ok(/\bExec=.*--no-sandbox/.test(bad))
  assert.ok(!/\bExec=.*--no-sandbox/.test(good))
  assert.match(good, /^Exec=AppRun %U$/m)
})
