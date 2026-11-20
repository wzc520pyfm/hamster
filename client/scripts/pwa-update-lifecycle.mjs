/**
 * P1 PWA update — real artifact lifecycle on an isolated VM origin (gaps A–F).
 *
 * Old: real 140487b production build. New/new2: current tip builds (real hashed assets).
 * Every step sets ok:true|false explicitly (no ok!==false soft-pass).
 *
 * VM engineering evidence only — not box/phone. Does not claim 1233857 passed.
 *
 * Run: node client/scripts/pwa-update-lifecycle.mjs
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { shouldSpaFallback, cacheControlForPath } from '../server.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.join(__dirname, '../..')
const WORK = '/tmp/hamster-pwa-real-artifacts-20261120b'
const OLD_WT = path.join(WORK, 'wt-140487b')
const OLD_DIST = path.join(WORK, 'dist-140487b')
const NEW_DIST = path.join(WORK, 'dist-new')
const NEW2_DIST = path.join(WORK, 'dist-new2')
const SERVE = path.join(WORK, 'serve')
const ARTIFACT_REPO = path.join(REPO, 'docs/evidence/p1-pwa-timeout-evidence-20261120')
const ARTIFACT_RAW = '/opt/cursor/artifacts/p1-pwa-timeout-evidence-20261120'

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
  if (r.status !== 0) throw new Error(`${cmd}\n${r.stdout}\n${r.stderr}`)
  return r.stdout
}

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true })
}

function copyDist(src, dest) {
  rmrf(dest)
  fs.cpSync(src, dest, { recursive: true })
}

/** Derive real built hashed JS/CSS paths from a dist tree. */
function listBuiltAssets(distDir) {
  const assetsDir = path.join(distDir, 'assets')
  const names = fs.existsSync(assetsDir)
    ? fs.readdirSync(assetsDir).filter((f) => /\.(js|css)$/.test(f)).sort()
    : []
  const js = names.filter((n) => n.endsWith('.js'))
  const css = names.filter((n) => n.endsWith('.css'))
  if (js.length === 0) throw new Error(`no hashed JS in ${assetsDir}`)
  return {
    names,
    mainJs: `/assets/${js[0]}`,
    mainJsFile: js[0],
    css: css.map((c) => `/assets/${c}`),
  }
}

function readBuildId(dist) {
  return fs.readFileSync(path.join(dist, 'sw.js'), 'utf8').match(/HAMSTER_PWA_BUILD = '([a-f0-9]+)'/)?.[1]
}

function ensureOldBuild() {
  if (fs.existsSync(path.join(OLD_DIST, 'index.html')) && fs.existsSync(path.join(OLD_DIST, 'sw.js'))) {
    const sw = fs.readFileSync(path.join(OLD_DIST, 'sw.js'), 'utf8')
    if (sw.includes('hamster-pwa-shell-v1') && /\.skipWaiting\s*\(/.test(sw)) return listBuiltAssets(OLD_DIST)
  }
  rmrf(OLD_WT)
  sh(`git worktree remove --force ${OLD_WT} 2>/dev/null || true`)
  sh(`git worktree add ${OLD_WT} 140487b`)
  const oldClient = path.join(OLD_WT, 'client')
  const nm = path.join(oldClient, 'node_modules')
  if (!fs.existsSync(nm)) fs.symlinkSync(path.join(REPO, 'client/node_modules'), nm)
  sh('npx tsc -b && npx vite build', { cwd: oldClient })
  copyDist(path.join(oldClient, 'dist'), OLD_DIST)
  return listBuiltAssets(OLD_DIST)
}

function ensureNewBuilds() {
  sh('npm run build', { cwd: path.join(REPO, 'client') })
  copyDist(path.join(REPO, 'client/dist'), NEW_DIST)
  const swNew = fs.readFileSync(path.join(NEW_DIST, 'sw.js'), 'utf8')
  if (swNew.includes('__HAMSTER_PWA_BUILD__')) throw new Error('new dist sw.js unstamped')
  const installBlock = swNew.match(/addEventListener\(\s*['"]install['"][\s\S]*?\n\}\);/)?.[0] || ''
  if (!installBlock || /\.skipWaiting\s*\(/.test(installBlock)) {
    throw new Error('new sw install must not call skipWaiting')
  }

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
  const id1 = readBuildId(NEW_DIST)
  const id2 = readBuildId(NEW2_DIST)
  if (!id1 || !id2 || id1 === id2) throw new Error(`successive deploy ids must differ: ${id1} vs ${id2}`)
  return {
    id1,
    id2,
    newAssets: listBuiltAssets(NEW_DIST),
    new2Assets: listBuiltAssets(NEW2_DIST),
  }
}

function syncServe(dist) {
  rmrf(SERVE)
  fs.cpSync(dist, SERVE, { recursive: true })
}

function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '')
    const filePath = path.join(SERVE, rel)
    const exists = filePath.startsWith(SERVE) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()
    if (!exists) {
      if (!shouldSpaFallback(urlPath)) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' })
        res.end('not found')
        return
      }
      const indexPath = path.join(SERVE, 'index.html')
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': cacheControlForPath('index.html'),
      })
      fs.createReadStream(indexPath).pipe(res)
      return
    }
    res.writeHead(200, {
      'content-type': filePath.endsWith('.js')
        ? 'text/javascript; charset=utf-8'
        : filePath.endsWith('.css')
          ? 'text/css; charset=utf-8'
          : filePath.endsWith('.html')
            ? 'text/html; charset=utf-8'
            : 'application/octet-stream',
      'cache-control': cacheControlForPath(filePath),
    })
    fs.createReadStream(filePath).pipe(res)
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, origin: `http://127.0.0.1:${server.address().port}` })
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

function pushStep(evidence, step) {
  if (typeof step.ok !== 'boolean') {
    throw new Error(`step ${step.step} missing explicit boolean ok`)
  }
  evidence.steps.push(step)
  if (!step.ok) throw new Error(`step failed: ${step.step}`)
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

  const oldAssets = ensureOldBuild()
  const builds = ensureNewBuilds()

  // Gap B smoke: missing old hashed JS on new dist must 404 (not HTML).
  syncServe(NEW_DIST)
  const { server, origin } = await startServer()
  const evidence = {
    at: new Date().toISOString(),
    origin,
    note: 'VM isolated-origin only. Not box/phone. Not a pass claim for 1233857.',
    oldAssets,
    newAssets: builds.newAssets,
    new2Assets: builds.new2Assets,
    deployIds: { id1: builds.id1, id2: builds.id2 },
    steps: [],
    pass: false,
  }

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()

  try {
    // B: missing static asset
    {
      const missUrl = origin + oldAssets.mainJs
      const res = await fetch(missUrl)
      const text = await res.text()
      pushStep(evidence, {
        step: 'missing_old_asset_is_404_not_html',
        status: res.status,
        oldAsset: oldAssets.mainJs,
        ok: res.status === 404 && !text.includes('<html') && !text.includes('<!DOCTYPE'),
      })
    }

    // Serve old and install
    syncServe(OLD_DIST)
    const page = await context.newPage()
    await page.goto(origin + '/', { waitUntil: 'networkidle' })
    await waitControlled(page)
    await seedContinuity(page)
    // Warm old shell cache with real old main JS
    await page.evaluate(async (jsPath) => {
      await fetch(jsPath)
    }, oldAssets.mainJs)
    const oldState = await page.evaluate(async (jsPath) => {
      const names = await caches.keys()
      let hasOldJs = false
      for (const n of names) {
        const c = await caches.open(n)
        if (await c.match(jsPath)) hasOldJs = true
      }
      return {
        names,
        hasOldJs,
        hasBanner: !!document.querySelector('[data-testid="pwa-update-banner"]'),
      }
    }, oldAssets.mainJs)
    pushStep(evidence, {
      step: 'old_140487b_installed',
      caches: oldState.names,
      hasOldJs: oldState.hasOldJs,
      hasBanner: oldState.hasBanner,
      ok: oldState.hasOldJs === true && oldState.hasBanner === false,
    })

    // Deploy new; retained old 140487b document — must NOT magically show new React banner.
    // Boundary: reg.update() below is a TEST ACCELERATOR only (not automatic discovery proof).
    syncServe(NEW_DIST)
    await triggerSwUpdate(page).catch(() => {})
    await page.waitForTimeout(1000)
    const retainedFetch = await page.evaluate(async (jsPath) => {
      const res = await fetch(jsPath)
      const ct = res.headers.get('content-type') || ''
      const body = await res.text()
      const reg = await navigator.serviceWorker.getRegistration()
      return {
        status: res.status,
        contentType: ct,
        bodyPrefix: body.slice(0, 80),
        bodyLen: body.length,
        hasBanner: !!document.querySelector('[data-testid="pwa-update-banner"]'),
        waiting: !!reg?.waiting,
      }
    }, oldAssets.mainJs)
    pushStep(evidence, {
      step: 'retained_old_page_fetches_old_js_mime_before_reload',
      retainedFetch,
      boundary:
        'reg.update() was used as a test accelerator on the retained page; not claimed as automatic discovery timing.',
      honest:
        'Retained 140487b document cannot show the new React banner. Old JS must still fetch with JS MIME/body.',
      ok:
        retainedFetch.hasBanner === false &&
        retainedFetch.status === 200 &&
        /javascript|ecmascript/i.test(retainedFetch.contentType) &&
        retainedFetch.bodyLen > 100 &&
        !retainedFetch.bodyPrefix.includes('<!DOCTYPE') &&
        !retainedFetch.bodyPrefix.includes('<html'),
    })

    // Natural online reopen (new document) — how first-migration acquires new JS.
    const page2 = await context.newPage()
    const navStarted = Date.now()
    await page2.goto(origin + '/', { waitUntil: 'networkidle' })
    // Automatic detection path: register() + initial check() in production main/banner.
    // Do NOT call reg.update() here — measure natural offer timing.
    const bannerVisibleNatural = await page2
      .waitForSelector('[data-testid="pwa-update-banner"]', { timeout: 65000 })
      .then(() => true)
      .catch(() => false)
    const naturalMs = Date.now() - navStarted
    const reopenCont = await readContinuity(page2)
    const newJsProbe = await page2.evaluate(async (jsPath) => {
      const res = await fetch(jsPath)
      const ct = res.headers.get('content-type') || ''
      const text = await res.text()
      return { status: res.status, contentType: ct, len: text.length, hasReact: text.includes('react') || text.length > 1000 }
    }, builds.newAssets.mainJs)
    pushStep(evidence, {
      step: 'natural_online_reopen_acquires_new_js_and_banner',
      bannerVisibleNatural,
      naturalMs,
      newJsProbe,
      continuity: reopenCont,
      newMainJs: builds.newAssets.mainJs,
      boundary:
        'Banner wait uses production register/check (up to ~60s poll). No manual reg.update() on this step.',
      ok:
        continuityOk(reopenCont) === true &&
        bannerVisibleNatural === true &&
        newJsProbe.status === 200 &&
        /javascript|ecmascript/i.test(newJsProbe.contentType),
    })
    const bannerVisible = bannerVisibleNatural

    let uiPage = page2
    if (bannerVisible) {
      await uiPage.click('[data-testid="pwa-update-dismiss"]')
      await uiPage.waitForSelector('[data-testid="pwa-update-banner"]', {
        state: 'hidden',
        timeout: 5000,
      })
      const stillWaiting = await uiPage.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration()
        return !!reg?.waiting
      })
      const oldJsAfterNotNow = await uiPage.evaluate(async (jsPath) => {
        const res = await fetch(jsPath)
        const ct = res.headers.get('content-type') || ''
        const body = await res.text()
        return {
          status: res.status,
          contentType: ct,
          bodyLen: body.length,
          notHtml: !body.trimStart().startsWith('<!') && !body.includes('<html'),
        }
      }, oldAssets.mainJs)
      pushStep(evidence, {
        step: 'not_now_defers_activation_old_js_fetch_ok',
        stillWaiting,
        oldJsAfterNotNow,
        ok:
          stillWaiting === true &&
          oldJsAfterNotNow.status === 200 &&
          /javascript|ecmascript/i.test(oldJsAfterNotNow.contentType) &&
          oldJsAfterNotNow.notHtml === true &&
          oldJsAfterNotNow.bodyLen > 100,
      })

      // EN banner sample (isolated VM screenshot)
      await uiPage.evaluate(() => localStorage.setItem('hamster.locale', 'en'))
      await uiPage.reload({ waitUntil: 'networkidle' }).catch(() => {})
      // After reload of last client, waiting SW may activate — re-check banner path via successive later.
      // Prefer same-document re-offer without navigation when possible:
      // (If reload activated already, EN/ZH samples are taken on successive deploy below.)

      // Stay on document when banner still present; else continue to Reload path via successive.
      const hasBannerAfterNotNow = await uiPage
        .locator('[data-testid="pwa-update-banner"]')
        .isVisible()
        .catch(() => false)
      if (!hasBannerAfterNotNow) {
        // Re-offer without claiming auto-discovery: focus handler is production code.
        await uiPage.evaluate(() => window.dispatchEvent(new Event('focus')))
      }
      const bannerBack = await uiPage
        .waitForSelector('[data-testid="pwa-update-banner"]', { timeout: 65000 })
        .then(() => true)
        .catch(() => false)
      if (bannerBack) {
        await uiPage.screenshot({
          path: path.join(ARTIFACT_REPO, 'banner-en.png'),
          fullPage: false,
        })
        fs.copyFileSync(
          path.join(ARTIFACT_REPO, 'banner-en.png'),
          path.join(ARTIFACT_RAW, 'banner-en.png'),
        )
      }
      pushStep(evidence, {
        step: 'banner_en_sample_isolated_vm',
        bannerBack,
        ok: bannerBack === true,
      })

      await uiPage.evaluate(() => localStorage.setItem('hamster.locale', 'zh'))
      // Locale toggle may need Shell locale control — set storage + soft focus re-offer text via React remount:
      await uiPage.reload({ waitUntil: 'networkidle' }).catch(() => {})
      await uiPage.evaluate(() => window.dispatchEvent(new Event('focus')))
      const zhBanner = await uiPage
        .waitForSelector('[data-testid="pwa-update-banner"]', { timeout: 65000 })
        .then(() => true)
        .catch(() => false)
      if (zhBanner) {
        const zhText = await uiPage.locator('[data-testid="pwa-update-banner"]').innerText()
        await uiPage.screenshot({
          path: path.join(ARTIFACT_REPO, 'banner-zh.png'),
          fullPage: false,
        })
        fs.copyFileSync(
          path.join(ARTIFACT_REPO, 'banner-zh.png'),
          path.join(ARTIFACT_RAW, 'banner-zh.png'),
        )
        pushStep(evidence, {
          step: 'banner_zh_sample_isolated_vm',
          zhText: zhText.slice(0, 160),
          ok: zhText.includes('新') || zhText.includes('重新加载') || zhText.includes('可用'),
        })
      } else {
        pushStep(evidence, {
          step: 'banner_zh_sample_isolated_vm',
          ok: false,
          note: 'ZH banner not visible after locale switch/reload',
        })
      }

      const contBefore = await readContinuity(uiPage)
      pushStep(evidence, {
        step: 'continuity_before_explicit_reload',
        continuity: contBefore,
        ok: continuityOk(contBefore),
      })
      const oldJsBeforeReload = await uiPage.evaluate(async (jsPath) => {
        const res = await fetch(jsPath)
        const ct = res.headers.get('content-type') || ''
        const body = await res.text()
        return {
          status: res.status,
          contentType: ct,
          notHtml: !body.trimStart().startsWith('<!'),
          bodyLen: body.length,
        }
      }, oldAssets.mainJs)
      pushStep(evidence, {
        step: 'old_js_fetch_mime_immediately_before_reload_click',
        oldJsBeforeReload,
        ok:
          oldJsBeforeReload.status === 200 &&
          /javascript|ecmascript/i.test(oldJsBeforeReload.contentType) &&
          oldJsBeforeReload.notHtml,
      })
      await Promise.all([
        uiPage.waitForNavigation({ waitUntil: 'networkidle' }),
        uiPage.click('[data-testid="pwa-update-reload"]'),
      ])
      const afterReload = await readContinuity(uiPage)
      const cachesAfter = await uiPage.evaluate(async () => caches.keys())
      pushStep(evidence, {
        step: 'explicit_reload_after_controllerchange',
        continuity: afterReload,
        cachesAfter,
        ok: continuityOk(afterReload) && !cachesAfter.includes('hamster-pwa-shell-v1'),
      })
    } else {
      pushStep(evidence, {
        step: 'banner_skipped_already_controlling_new',
        ok: true,
        note: 'No waiting worker after reopen; continuity already checked.',
      })
    }

    await context.setOffline(true)
    await uiPage.reload({ waitUntil: 'domcontentloaded' })
    pushStep(evidence, {
      step: 'offline_launch',
      continuity: await readContinuity(uiPage),
      ok: continuityOk(await readContinuity(uiPage)),
    })
    await context.setOffline(false)
    await uiPage.reload({ waitUntil: 'networkidle' })
    pushStep(evidence, {
      step: 'reconnect',
      continuity: await readContinuity(uiPage),
      ok: continuityOk(await readContinuity(uiPage)),
    })

    // Successive deploy with real new2 assets
    syncServe(NEW2_DIST)
    await triggerSwUpdate(uiPage)
    await uiPage.waitForSelector('[data-testid="pwa-update-banner"]', { timeout: 20000 })
    const bannerText = await uiPage.locator('[data-testid="pwa-update-banner"]').innerText()
    await Promise.all([
      uiPage.waitForNavigation({ waitUntil: 'networkidle' }),
      uiPage.click('[data-testid="pwa-update-reload"]'),
    ])
    const successiveCont = await readContinuity(uiPage)
    const servedJs = builds.new2Assets.mainJs
    const jsRes = await fetch(origin + servedJs)
    pushStep(evidence, {
      step: 'successive_deploy_real_built_assets',
      bannerText: bannerText.slice(0, 120),
      continuity: successiveCont,
      new2MainJs: servedJs,
      new2JsStatus: jsRes.status,
      swId: readBuildId(SERVE),
      ok:
        continuityOk(successiveCont) &&
        bannerText.length > 0 &&
        jsRes.status === 200 &&
        readBuildId(SERVE) === builds.id2 &&
        builds.newAssets.mainJs !== builds.new2Assets.mainJs,
    })

    evidence.pass = evidence.steps.every((s) => s.ok === true)
  } catch (err) {
    evidence.error = String(err?.stack || err)
    evidence.pass = false
  } finally {
    await browser.close()
    server.close()
  }

  const jsonPath = path.join(ARTIFACT_REPO, 'lifecycle-gaps-af.json')
  const mdPath = path.join(ARTIFACT_REPO, 'NOTES.md')
  fs.writeFileSync(jsonPath, JSON.stringify(evidence, null, 2))
  fs.writeFileSync(path.join(ARTIFACT_RAW, 'lifecycle-gaps-af.json'), JSON.stringify(evidence, null, 2))
  const md = `# P1 PWA gaps A–F evidence (2026-11-20)

VM only. Not box/phone. Does not claim 1233857 passed.

## Result

pass=${evidence.pass}

${evidence.steps.map((s) => `- \`${s.step}\`: ok=${s.ok}`).join('\n')}

${evidence.error ? `## Error\\n\\n\`\`\`\\n${evidence.error}\\n\`\`\`\\n` : ''}

## Covered gaps

- A retained old hashed assets present before Reload
- B missing /assets/*.js → 404 not HTML
- C every step has explicit ok boolean
- D asset paths derived from real dist builds
- E (unit) main.tsx registers SW for ConnectGate
- F (unit) tests import production pwaUpdateCore.ts
`
  fs.writeFileSync(mdPath, md)
  fs.writeFileSync(path.join(ARTIFACT_RAW, 'NOTES.md'), md)
  console.log(
    JSON.stringify(
      {
        pass: evidence.pass,
        jsonPath,
        steps: evidence.steps.map((s) => ({ step: s.step, ok: s.ok })),
        assets: {
          old: oldAssets.mainJs,
          new: builds.newAssets.mainJs,
          new2: builds.new2Assets.mainJs,
        },
      },
      null,
      2,
    ),
  )
  if (!evidence.pass) process.exitCode = 1
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
