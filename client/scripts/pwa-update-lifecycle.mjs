/**
 * Isolated-origin Chromium lifecycle: old installed SW/cache → new deploy →
 * user-controlled reload → offline launch → reconnect.
 *
 * Does NOT touch the box live stack. Engineering evidence only (not phone acceptance).
 *
 * Run from repo: node client/scripts/pwa-update-lifecycle.mjs
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '../..')
const FIXTURE = path.join('/tmp/hamster-pwa-update-fixture', 'serve')
const ARTIFACT_REPO = path.join(ROOT, 'docs/evidence/p1-pwa-update-20261120')
const ARTIFACT_RAW = '/opt/cursor/artifacts/p1-pwa-update-20261120'

const OLD_JS = '/assets/index-DqKaLRWz.js'
const NEW_JS = '/assets/index-C3ESqCyk.js'

const OLD_SW = `/* fixture old SW — fixed v1, no activate cleanup (pre-fix) */
const SHELL_CACHE = 'hamster-pwa-shell-v1';
self.addEventListener('install', (e) => { e.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirst(event.request));
  } else {
    event.respondWith(cacheFirst(event.request));
  }
});
async function cacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}
async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}
`

const NEW_SW = fs.readFileSync(path.join(ROOT, 'client/public/sw.js'), 'utf8')

function pageHtml(marker, scriptSrc) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Hamster PWA update fixture</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body>
  <main>
    <h1 id="marker">${marker}</h1>
    <p id="bundle">${scriptSrc}</p>
    <div id="update" hidden role="status" aria-live="polite">
      <span>A new version of Hamster is available.</span>
      <button type="button" id="reload">Reload</button>
      <button type="button" id="dismiss">Not now</button>
    </div>
  </main>
  <script src="${scriptSrc}"></script>
  <script>
    // Continuity seed (conversation / locale) — update must not wipe these.
    if (!localStorage.getItem('hamster.locale')) localStorage.setItem('hamster.locale', 'zh');
    if (!localStorage.getItem('hamster.controlBase')) localStorage.setItem('hamster.controlBase', location.origin);
    if (!localStorage.getItem('hamster.conversation.demo')) {
      localStorage.setItem('hamster.conversation.demo', JSON.stringify({ id: 'conv-demo', msgs: 2 }));
    }

    let registration;
    async function boot() {
      if (!('serviceWorker' in navigator)) throw new Error('no SW');
      registration = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
      window.__hamsterReg = registration;
      const show = () => { document.getElementById('update').hidden = false; };
      if (registration.waiting && navigator.serviceWorker.controller) show();
      registration.addEventListener('updatefound', () => {
        const sw = registration.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) show();
        });
      });
      document.getElementById('reload').onclick = () => {
        const waiting = registration.waiting;
        if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' });
        // If already controlling after skipWaiting, reload; also listen once.
        let done = false;
        const go = () => { if (done) return; done = true; location.reload(); };
        navigator.serviceWorker.addEventListener('controllerchange', go);
        setTimeout(go, 500);
      };
      document.getElementById('dismiss').onclick = () => {
        document.getElementById('update').hidden = true;
      };
      window.__hamsterCheckUpdate = () => registration.update();
    }
    boot();
  </script>
</body>
</html>`
}

function writeTree(kind) {
  fs.rmSync(FIXTURE, { recursive: true, force: true })
  fs.mkdirSync(path.join(FIXTURE, 'assets'), { recursive: true })
  if (kind === 'old') {
    fs.writeFileSync(path.join(FIXTURE, 'index.html'), pageHtml('OLD_UI', OLD_JS))
    fs.writeFileSync(path.join(FIXTURE, 'sw.js'), OLD_SW)
    fs.writeFileSync(path.join(FIXTURE, OLD_JS.slice(1)), 'window.__HAMSTER_BUNDLE="old";\n')
  } else {
    fs.writeFileSync(path.join(FIXTURE, 'index.html'), pageHtml('NEW_UI', NEW_JS))
    fs.writeFileSync(path.join(FIXTURE, 'sw.js'), NEW_SW)
    fs.writeFileSync(path.join(FIXTURE, NEW_JS.slice(1)), 'window.__HAMSTER_BUNDLE="new";\n')
    // Leave old hashed file absent on purpose — new deploy replaced it.
  }
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
    const filePath = path.join(FIXTURE, rel)
    if (!filePath.startsWith(FIXTURE) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404, { 'cache-control': 'no-cache' })
      res.end('not found')
      return
    }
    res.writeHead(200, {
      'content-type':
        filePath.endsWith('.js')
          ? 'application/javascript'
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

function ensureDirs() {
  fs.mkdirSync(ARTIFACT_REPO, { recursive: true })
  fs.mkdirSync(ARTIFACT_RAW, { recursive: true })
}

async function main() {
  ensureDirs()
  writeTree('old')
  const { server, origin } = await startServer()
  const evidence = {
    at: new Date().toISOString(),
    origin,
    steps: [],
    pass: false,
  }

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  const page = await context.newPage()

  try {
    await page.goto(origin + '/', { waitUntil: 'networkidle' })
    await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, {
      timeout: 15_000,
    })
    const oldMarker = await page.locator('#marker').textContent()
    evidence.steps.push({ step: 'old_install', marker: oldMarker, ok: oldMarker === 'OLD_UI' })

    // Warm shell cache with navigation + asset (old SW cache-first path).
    await page.reload({ waitUntil: 'networkidle' })
    const cachesOld = await page.evaluate(async () => {
      const names = await caches.keys()
      const detail = {}
      for (const n of names) {
        const c = await caches.open(n)
        detail[n] = (await c.keys()).map((r) => new URL(r.url).pathname)
      }
      return detail
    })
    evidence.steps.push({ step: 'old_caches', cachesOld })

    const continuityBefore = await page.evaluate(() => ({
      locale: localStorage.getItem('hamster.locale'),
      controlBase: localStorage.getItem('hamster.controlBase'),
      conversation: localStorage.getItem('hamster.conversation.demo'),
    }))
    evidence.steps.push({ step: 'continuity_before', continuityBefore })

    // Deploy new version onto the same origin (disk swap; server keeps listening).
    writeTree('new')
    await page.evaluate(async () => {
      await window.__hamsterCheckUpdate()
    })
    await page.waitForSelector('#update:not([hidden])', { timeout: 15_000 })
    evidence.steps.push({ step: 'update_banner_visible', ok: true })

    // User opts in — no forced reload before this.
    await page.click('#reload')
    await page.waitForFunction(() => document.getElementById('marker')?.textContent === 'NEW_UI', null, {
      timeout: 15_000,
    })
    const newMarker = await page.locator('#marker').textContent()
    const bundleText = await page.locator('#bundle').textContent()
    const hamsterBundle = await page.evaluate(() => window.__HAMSTER_BUNDLE)
    evidence.steps.push({
      step: 'after_user_reload',
      marker: newMarker,
      bundleText,
      hamsterBundle,
      ok: newMarker === 'NEW_UI' && bundleText === NEW_JS && hamsterBundle === 'new',
    })

    const continuityAfter = await page.evaluate(() => ({
      locale: localStorage.getItem('hamster.locale'),
      controlBase: localStorage.getItem('hamster.controlBase'),
      conversation: localStorage.getItem('hamster.conversation.demo'),
    }))
    const continuityOk =
      continuityAfter.locale === continuityBefore.locale &&
      continuityAfter.controlBase === continuityBefore.controlBase &&
      continuityAfter.conversation === continuityBefore.conversation
    evidence.steps.push({ step: 'continuity_preserved', continuityAfter, ok: continuityOk })

    const cachesNew = await page.evaluate(async () => {
      const names = await caches.keys()
      const detail = {}
      for (const n of names) {
        const c = await caches.open(n)
        detail[n] = (await c.keys()).map((r) => new URL(r.url).pathname)
      }
      return { names, detail }
    })
    const oldShellGone = !cachesNew.names.includes('hamster-pwa-shell-v1')
    const newShellPresent = cachesNew.names.includes('hamster-pwa-shell-v2')
    evidence.steps.push({
      step: 'activate_cleanup',
      cachesNew,
      oldShellGone,
      newShellPresent,
      ok: oldShellGone && newShellPresent,
    })

    // Offline launch: shell must still render NEW_UI from cache (no network).
    await context.setOffline(true)
    await page.reload({ waitUntil: 'domcontentloaded' })
    const offlineMarker = await page.locator('#marker').textContent()
    evidence.steps.push({
      step: 'offline_launch',
      marker: offlineMarker,
      ok: offlineMarker === 'NEW_UI',
    })

    // Reconnect: network back; continuity still present; update path idle.
    await context.setOffline(false)
    await page.reload({ waitUntil: 'networkidle' })
    const reconnectMarker = await page.locator('#marker').textContent()
    const continuityReconnect = await page.evaluate(() => localStorage.getItem('hamster.conversation.demo'))
    evidence.steps.push({
      step: 'reconnect',
      marker: reconnectMarker,
      conversation: continuityReconnect,
      ok: reconnectMarker === 'NEW_UI' && continuityReconnect === continuityBefore.conversation,
    })

    evidence.pass = evidence.steps.every((s) => s.ok !== false)
  } catch (err) {
    evidence.error = String(err && err.stack ? err.stack : err)
    evidence.pass = false
  } finally {
    await browser.close()
    server.close()
  }

  const jsonPath = path.join(ARTIFACT_REPO, 'lifecycle-chromium.json')
  const mdPath = path.join(ARTIFACT_REPO, 'NOTES.md')
  const rawJson = path.join(ARTIFACT_RAW, 'lifecycle-chromium.json')
  fs.writeFileSync(jsonPath, JSON.stringify(evidence, null, 2))
  fs.writeFileSync(rawJson, JSON.stringify(evidence, null, 2))

  const md = `# P1 PWA update reliability — Chromium lifecycle evidence (2026-11-20)

**Not phone acceptance.** Isolated-origin fixture on this agent VM only.
Box live stack / desktop \`f2a2d67525a4\` was not accessed.

## What ran

\`\`\`
node client/scripts/pwa-update-lifecycle.mjs
\`\`\`

Origin: \`${evidence.origin}\` (ephemeral loopback; not the box).

## Result

**pass=${evidence.pass}**

Steps:
${evidence.steps.map((s) => `- \`${s.step}\`: ok=${s.ok !== false}`).join('\n')}

${evidence.error ? `## Error\\n\\n\`\`\`\\n${evidence.error}\\n\`\`\`\\n` : ''}

## Covered

- Old fixed \`hamster-pwa-shell-v1\` install → new \`sw.js\` (repo \`client/public/sw.js\` v2 + activate cleanup + SKIP_WAITING)
- \`updateViaCache: 'none'\` registration; user-controlled Reload (no forced reload)
- Continuity keys preserved (\`hamster.locale\`, \`hamster.controlBase\`, conversation demo)
- Offline launch after upgrade still shows NEW_UI
- Reconnect preserves conversation data

## Not covered / not claimed

- Box Chromium / installed PWA on phone
- Full React Shell \`PwaUpdateBanner\` paint (this fixture mirrors the same SW + UX contract)
- Docker stack / API / agent

## Unit tests

\`\`\`
node --test client/src/lib/pwaUpdate.test.mjs
\`\`\`

Raw copy: \`/opt/cursor/artifacts/p1-pwa-update-20261120/lifecycle-chromium.json\`
`
  fs.writeFileSync(mdPath, md)
  fs.writeFileSync(path.join(ARTIFACT_RAW, 'NOTES.md'), md)

  console.log(JSON.stringify({ pass: evidence.pass, jsonPath, mdPath, steps: evidence.steps.map((s) => s.step) }, null, 2))
  if (!evidence.pass) process.exitCode = 1
}

main()
