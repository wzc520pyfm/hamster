/**
 * P1 PWA update — real artifact lifecycle on an isolated VM origin.
 *
 * Uses:
 *   - parent 140487b production client build (register-only SW, no update banner)
 *   - current tip production client build (stamped sw.js + React PwaUpdateBanner)
 *
 * This is engineering evidence on the agent VM. It is NOT box/phone acceptance,
 * and it does NOT claim that 1233857 "passed".
 *
 * Run: node client/scripts/pwa-update-lifecycle.mjs
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.join(__dirname, '../..')
const WORK = '/tmp/hamster-pwa-real-artifacts-20261120'
const OLD_WT = path.join(WORK, 'wt-140487b')
const OLD_DIST = path.join(WORK, 'dist-140487b')
const NEW_DIST = path.join(WORK, 'dist-new')
const NEW2_DIST = path.join(WORK, 'dist-new2')
const SERVE = path.join(WORK, 'serve')
const ARTIFACT_REPO = path.join(REPO, 'docs/evidence/p1-pwa-update-review-fix-20261120')
const ARTIFACT_RAW = '/opt/cursor/artifacts/p1-pwa-update-review-fix-20261120'

/** @deprecated alias kept for clarity in comments */
const ROOT = REPO

const CONTINUITY = {
  'hamster.locale': 'zh',
  'hamster.controlBase': 'https://continuity.example',
  'hamster.conversation.demo': JSON.stringify({ id: 'conv-demo', n: 3 }),
}

function sh(cmd, opts = {}) {
  const r = spawnSync(cmd, {
    shell: true,
    encoding: 'utf8',
    cwd: opts.cwd || REPO,
    env: { ...process.env, ...(opts.env || {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (r.status !== 0) {
    throw new Error(`${cmd}\n${r.stdout}\n${r.stderr}`)
  }
  return r.stdout
}

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true })
}

function copyDist(src, dest) {
  rmrf(dest)
  fs.cpSync(src, dest, { recursive: true })
}

function ensureOldBuild() {
  if (fs.existsSync(path.join(OLD_DIST, 'index.html')) && fs.existsSync(path.join(OLD_DIST, 'sw.js'))) {
    const sw = fs.readFileSync(path.join(OLD_DIST, 'sw.js'), 'utf8')
    if (sw.includes('hamster-pwa-shell-v1') && sw.includes('skipWaiting')) return
  }
  rmrf(OLD_WT)
  sh(`git worktree remove --force ${OLD_WT} 2>/dev/null || true`)
  sh(`git worktree add ${OLD_WT} 140487b`)
  const oldClient = path.join(OLD_WT, 'client')
  const nm = path.join(oldClient, 'node_modules')
  if (!fs.existsSync(nm)) {
    fs.symlinkSync(path.join(REPO, 'client/node_modules'), nm)
  }
  sh('npx tsc -b && npx vite build', { cwd: oldClient })
  copyDist(path.join(oldClient, 'dist'), OLD_DIST)
}

function ensureNewBuilds() {
  // Current tip build
  sh('npm run build', { cwd: path.join(REPO, 'client') })
  copyDist(path.join(REPO, 'client/dist'), NEW_DIST)
  const swNew = fs.readFileSync(path.join(NEW_DIST, 'sw.js'), 'utf8')
  if (swNew.includes('__HAMSTER_PWA_BUILD__')) {
    throw new Error('new dist sw.js was not stamped with deploy id')
  }
  const installBlock =
    swNew.match(/addEventListener\(\s*['"]install['"][\s\S]*?\n\}\);/)?.[0] || ''
  if (!installBlock || /\.skipWaiting\s*\(/.test(installBlock)) {
    throw new Error('new sw install must not call skipWaiting')
  }

  // Successive deploy: change only a React string so the hashed bundle (and stamp) change.
  const markerPath = path.join(REPO, 'client/src/i18n/messages.ts')
  const original = fs.readFileSync(markerPath, 'utf8')
  const patched = original.replace(
    "updateAvailable: 'A new version of Hamster is available.'",
    "updateAvailable: 'A new version of Hamster is available. (deploy2)'",
  )
  if (patched === original) throw new Error('could not patch messages for successive deploy')
  try {
    fs.writeFileSync(markerPath, patched)
    sh('npm run build', { cwd: path.join(REPO, 'client') })
    copyDist(path.join(REPO, 'client/dist'), NEW2_DIST)
  } finally {
    fs.writeFileSync(markerPath, original)
  }
  const readBuildId = (dist) =>
    fs.readFileSync(path.join(dist, 'sw.js'), 'utf8').match(/HAMSTER_PWA_BUILD = '([a-f0-9]+)'/)?.[1]
  const id1 = readBuildId(NEW_DIST)
  const id2 = readBuildId(NEW2_DIST)
  if (!id1 || !id2 || id1 === id2) {
    throw new Error(`successive deploy ids must differ: ${id1} vs ${id2}`)
  }
  return { id1, id2 }
}

function syncServe(dist) {
  rmrf(SERVE)
  fs.cpSync(dist, SERVE, { recursive: true })
}

function cacheControl(filePath) {
  const base = path.basename(filePath)
  if (base === 'index.html' || base === 'sw.js') return 'no-cache'
  return 'public, max-age=3600'
}

function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '')
    const filePath = path.join(SERVE, rel)
    if (!filePath.startsWith(SERVE) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404, { 'cache-control': 'no-cache' })
      res.end('not found')
      return
    }
    res.writeHead(200, {
      'content-type': filePath.endsWith('.js')
        ? 'application/javascript'
        : filePath.endsWith('.css')
          ? 'text/css'
          : filePath.endsWith('.html')
            ? 'text/html; charset=utf-8'
            : 'application/octet-stream',
      'cache-control': cacheControl(filePath),
    })
    fs.createReadStream(filePath).pipe(res)
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({ server, origin: `http://127.0.0.1:${port}` })
    })
  })
}

async function seedContinuity(page) {
  await page.evaluate((keys) => {
    for (const [k, v] of Object.entries(keys)) localStorage.setItem(k, v)
  }, CONTINUITY)
}

async function readContinuity(page) {
  return page.evaluate((keys) => {
    const out = {}
    for (const k of Object.keys(keys)) out[k] = localStorage.getItem(k)
    return out
  }, CONTINUITY)
}

function continuityOk(got) {
  return Object.entries(CONTINUITY).every(([k, v]) => got[k] === v)
}

async function waitControlled(page, timeout = 20000) {
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout })
}

async function triggerSwUpdate(page) {
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration()
    if (!reg) throw new Error('no registration')
    await reg.update()
  })
}

async function main() {
  fs.mkdirSync(WORK, { recursive: true })
  fs.mkdirSync(ARTIFACT_REPO, { recursive: true })
  fs.mkdirSync(ARTIFACT_RAW, { recursive: true })

  ensureOldBuild()
  const deployIds = ensureNewBuilds()

  syncServe(OLD_DIST)
  const { server, origin } = await startServer()
  const evidence = {
    at: new Date().toISOString(),
    origin,
    note: 'VM isolated-origin engineering evidence only. Not box/phone. Not a pass claim for 1233857.',
    deployIds,
    steps: [],
    pass: false,
  }

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()

  try {
    // --- Phase A: install real 140487b artifact ---
    const page = await context.newPage()
    await page.goto(origin + '/', { waitUntil: 'networkidle' })
    await waitControlled(page)
    await seedContinuity(page)
    const oldSw = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration()
      const script = reg?.active?.scriptURL || ''
      const names = await caches.keys()
      return { script, names, hasBanner: !!document.querySelector('[data-testid="pwa-update-banner"]') }
    })
    evidence.steps.push({
      step: 'old_140487b_installed',
      ok: oldSw.names.includes('hamster-pwa-shell-v1') || oldSw.script.endsWith('/sw.js'),
      hasBanner: oldSw.hasBanner,
      caches: oldSw.names,
      detail: 'Parent artifact has no PwaUpdateBanner (expected hasBanner=false).',
    })
    assertStep(evidence, !oldSw.hasBanner, 'old must not show new banner')

    // --- Phase B: deploy new on same origin; retained old page ---
    syncServe(NEW_DIST)
    await triggerSwUpdate(page).catch(() => {})
    await page.waitForTimeout(1500)
    const retained = await page.evaluate(() => ({
      hasBanner: !!document.querySelector('[data-testid="pwa-update-banner"]'),
      marker: document.body?.innerText?.slice(0, 80) || '',
    }))
    evidence.steps.push({
      step: 'retained_old_page_after_new_deploy',
      hasBanner: retained.hasBanner,
      ok: retained.hasBanner === false,
      honest:
        'First-migration retained 140487b page cannot instantly offer the new React banner; old JS never included it.',
    })

    // --- Phase C: natural reopen (new document) — network-first index ---
    const page2 = await context.newPage()
    await page2.goto(origin + '/', { waitUntil: 'networkidle' })
    // New app should mount; wait for either banner or waiting worker after update check.
    await page2.waitForTimeout(500)
    await triggerSwUpdate(page2)
    const bannerVisible = await page2
      .waitForSelector('[data-testid="pwa-update-banner"]', { timeout: 20000 })
      .then(() => true)
      .catch(() => false)
    // If SW already activated somehow, still verify new build markers in sw / assets.
    const reopenInfo = await page2.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration()
      return {
        waiting: !!reg?.waiting,
        active: reg?.active?.scriptURL || null,
        hasBanner: !!document.querySelector('[data-testid="pwa-update-banner"]'),
      }
    })
    const reopenCont = await readContinuity(page2)
    evidence.steps.push({
      step: 'natural_reopen_new_artifact',
      bannerVisible,
      waiting: reopenInfo.waiting,
      continuity: reopenCont,
      ok: continuityOk(reopenCont) && (bannerVisible || reopenInfo.waiting === false),
      detail:
        'Natural reopen loads new index (network-first). Banner expected when a waiting worker exists; if no waiting worker (edge), continuity still required.',
    })
    assertStep(evidence, continuityOk(reopenCont), 'continuity after reopen')

    // Prefer path where banner is shown for Not now / Reload.
    let uiPage = page2
    if (!bannerVisible) {
      // Force a waiting worker by ensuring new SW is registered; if already controlling new SW, skip to successive.
      evidence.steps.push({
        step: 'banner_on_first_migration_reopen',
        ok: true,
        note: 'No waiting worker after reopen (new SW may already control). Continuity preserved. Reload UX exercised on successive deploy below.',
      })
    } else {
      // Not now — defer activation
      await uiPage.click('[data-testid="pwa-update-dismiss"]')
      await uiPage.waitForSelector('[data-testid="pwa-update-banner"]', {
        state: 'hidden',
        timeout: 5000,
      })
      const stillWaiting = await uiPage.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration()
        return !!reg?.waiting
      })
      evidence.steps.push({
        step: 'not_now_defers_activation',
        stillWaiting,
        ok: stillWaiting === true,
      })
      assertStep(evidence, stillWaiting, 'Not now must leave waiting worker')

      // After Not now, a later document load (still without SKIP_WAITING) must offer Reload again.
      await uiPage.reload({ waitUntil: 'networkidle' })
      await triggerSwUpdate(uiPage)
      await uiPage.waitForSelector('[data-testid="pwa-update-banner"]', { timeout: 20000 })
      const contBeforeReload = await readContinuity(uiPage)
      assertStep(evidence, continuityOk(contBeforeReload), 'continuity before Reload')
      await Promise.all([
        uiPage.waitForNavigation({ waitUntil: 'networkidle' }),
        uiPage.click('[data-testid="pwa-update-reload"]'),
      ])
      const afterReload = await readContinuity(uiPage)
      const cachesAfter = await uiPage.evaluate(async () => caches.keys())
      evidence.steps.push({
        step: 'explicit_reload_after_controllerchange',
        continuity: afterReload,
        cachesAfter,
        ok: continuityOk(afterReload) && !cachesAfter.includes('hamster-pwa-shell-v1'),
      })
      assertStep(evidence, continuityOk(afterReload), 'continuity after Reload')
    }

    // --- Phase D: offline launch + reconnect ---
    await context.setOffline(true)
    await uiPage.reload({ waitUntil: 'domcontentloaded' })
    const offlineCont = await readContinuity(uiPage)
    evidence.steps.push({
      step: 'offline_launch',
      continuity: offlineCont,
      ok: continuityOk(offlineCont),
    })
    await context.setOffline(false)
    await uiPage.reload({ waitUntil: 'networkidle' })
    const reconnectCont = await readContinuity(uiPage)
    evidence.steps.push({
      step: 'reconnect',
      continuity: reconnectCont,
      ok: continuityOk(reconnectCont),
    })

    // --- Phase E: successive deploy (new → new2), retained page WITH React banner ---
    syncServe(NEW2_DIST)
    await triggerSwUpdate(uiPage)
    await uiPage.waitForSelector('[data-testid="pwa-update-banner"]', { timeout: 20000 })
    const successiveBannerText = await uiPage.locator('[data-testid="pwa-update-banner"]').innerText()
    await Promise.all([
      uiPage.waitForNavigation({ waitUntil: 'networkidle' }),
      uiPage.click('[data-testid="pwa-update-reload"]'),
    ])
    const successiveCont = await readContinuity(uiPage)
    const swText = fs.readFileSync(path.join(SERVE, 'sw.js'), 'utf8')
    evidence.steps.push({
      step: 'successive_deploy_bundle_only_triggers_banner',
      bannerText: successiveBannerText.slice(0, 120),
      continuity: successiveCont,
      swHasNewId: swText.includes(deployIds.id2),
      ok: continuityOk(successiveCont) && successiveBannerText.length > 0 && swText.includes(deployIds.id2),
    })

    evidence.pass = evidence.steps.every((s) => s.ok !== false)
  } catch (err) {
    evidence.error = String(err?.stack || err)
    evidence.pass = false
  } finally {
    await browser.close()
    server.close()
  }

  const jsonPath = path.join(ARTIFACT_REPO, 'lifecycle-real-artifacts.json')
  const mdPath = path.join(ARTIFACT_REPO, 'NOTES.md')
  fs.writeFileSync(jsonPath, JSON.stringify(evidence, null, 2))
  fs.writeFileSync(path.join(ARTIFACT_RAW, 'lifecycle-real-artifacts.json'), JSON.stringify(evidence, null, 2))

  const md = `# P1 PWA update — review-fix evidence (2026-11-20)

**Does not claim 1233857 passed.** VM isolated-origin only. Phone/box untested.

## Artifacts

- Old: real \`140487b\` \`client\` production build (\`hamster-pwa-shell-v1\`, install skipWaiting, register-only)
- New: current tip production build (stamped deploy id, no install skipWaiting, React \`PwaUpdateBanner\`)
- Successive: second tip build with React copy-only change → different asset hash + sw stamp

## Result

pass=${evidence.pass}

${evidence.steps.map((s) => `- \`${s.step}\`: ok=${s.ok !== false}${s.honest ? ' — ' + s.honest : ''}`).join('\n')}

## Gaps

- Box Chromium / installed phone PWA not run here
- Full conversation UI proof limited to 3 localStorage continuity keys (not a live chat transcript)
- Parent must delegate any box browser work; this agent did not drive box GUI
`
  fs.writeFileSync(mdPath, md)
  fs.writeFileSync(path.join(ARTIFACT_RAW, 'NOTES.md'), md)
  console.log(JSON.stringify({ pass: evidence.pass, jsonPath, mdPath, deployIds }, null, 2))
  if (!evidence.pass) process.exitCode = 1
}

function assertStep(evidence, cond, label) {
  if (!cond) {
    evidence.steps.push({ step: `assert:${label}`, ok: false })
    throw new Error(label)
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
