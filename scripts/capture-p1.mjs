#!/usr/bin/env node
/**
 * Hamster P1 capture — Electron/PWA shell evidence on the fixture path.
 * Requires a running client (default CLIENT_BASE=http://localhost:3000, built dist).
 * - Happy-path shell shots use route-level mocks of the control plane (capture only).
 * - Disconnect shots use a real network abort (real failure → design-table copy).
 * Not a design-gate pass. No live model. No invented task results.
 */
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(path.join(process.cwd(), 'client/package.json'))
const { chromium } = require('playwright')

const CLIENT_BASE = process.env.CLIENT_BASE || 'http://localhost:3000'
const OUT_DIR = path.join(process.cwd(), 'docs/evidence/p1-electron-pwa')

const PENDING_APPROVAL = {
  id: 'appr_p1_demo_0001',
  taskId: 'task_p1_demo_0001',
  taskTitle: 'Weekly metrics dashboard',
  action: 'publish_dashboard',
  params: { assetId: 'asset_p1_demo_0001', channel: 'shared workspace' },
  status: 'pending',
  expiresAt: null,
  decidedAt: null,
  decisionNote: null,
  requestedAt: null,
}

const TIMELINE = {
  conversationId: 'conv_p1_demo_0001',
  messages: [
    {
      id: 'msg_p1_0001',
      role: 'user',
      content: 'start task: Weekly metrics dashboard',
      meta: { taskId: 'task_p1_demo_0001' },
      createdAt: '2026-11-19T10:00:00.000Z',
    },
  ],
  tasks: [
    {
      taskId: 'task_p1_demo_0001',
      conversationId: 'conv_p1_demo_0001',
      runtimeSessionId: 'rt_p1_demo_0001',
      assetId: null,
      title: 'Weekly metrics dashboard',
      status: 'waiting_for_approval',
      controlSeq: 0,
      createdAt: '2026-11-19T10:00:00.000Z',
      updatedAt: '2026-11-19T10:05:00.000Z',
      cancelRequestedAt: null,
      events: [],
      controls: [],
      approvals: [PENDING_APPROVAL],
    },
  ],
  approvals: [PENDING_APPROVAL],
}

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag)
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]
  return fallback
}

async function installChecks(page) {
  const data = await page.evaluate(async () => {
    const res = await fetch('/manifest.webmanifest')
    const manifest = res.ok ? await res.json() : null
    const icons = Array.isArray(manifest?.icons) ? manifest.icons : []
    const iconResults = await Promise.all(
      icons.map(async (icon) => {
        const iconRes = await fetch(icon.src).then((r) => r.status).catch(() => 0)
        return {
          src: icon.src,
          type: icon.type,
          status: iconRes,
          ok: iconRes === 200 && icon.type === 'image/png',
        }
      }),
    )
    const theme = document.querySelector('meta[name="theme-color"]')?.content || null
    const manifestLink = document.querySelector('link[rel="manifest"]')?.href || null
    const swReg = typeof navigator !== 'undefined' && 'serviceWorker' in navigator
      ? await navigator.serviceWorker.getRegistration('/sw.js').then((r) => (r ? 'registered' : 'missing')).catch(() => 'error')
      : 'unsupported'
    return { manifest, icons, iconResults, theme, manifestLink, swReg }
  })
  const ok =
    Boolean(data.manifest) &&
    data.manifest.display === 'standalone' &&
    data.manifest.start_url === '/' &&
    Array.isArray(data.manifest.icons) &&
    data.manifest.icons.length > 0 &&
    data.iconResults.length > 0 &&
    data.iconResults.every((icon) => icon.ok) &&
    data.swReg === 'registered'
  return { ok, ...data }
}

const browser = await chromium.launch({ headless: true })
const results = { shots: [], install: null, disconnect: {} }

async function shot(page, name, { width, height, fullPage = false, waitText = null, waitPlaceholder = null } = {}) {
  const ctx = { width, height, fullPage }
  if (waitText) {
    await page.getByText(waitText, { exact: true }).first().waitFor({ state: 'visible', timeout: 20000 })
  }
  if (waitPlaceholder) {
    await page.locator(`textarea[placeholder="${waitPlaceholder}"]`).first().waitFor({ state: 'visible', timeout: 20000 })
  }
  await page.waitForTimeout(500)
  const out = path.join(OUT_DIR, `${name}.png`)
  await page.screenshot({ path: out, fullPage })
  results.shots.push({ name, out })
}

// --- Happy path: mocked control plane → shell with pending approval + composer ---
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/health') return route.fulfill({ json: { status: 'ok' } })
    if (url.pathname === '/api/conversations/current') {
      return route.fulfill({ json: { conversationId: 'conv_p1_demo_0001', title: 'Weekly metrics', createdAt: '2026-11-19T09:00:00.000Z' } })
    }
    if (url.pathname.startsWith('/api/conversations/') && url.pathname.endsWith('/timeline')) {
      return route.fulfill({ json: TIMELINE })
    }
    if (url.pathname === '/api/approvals') {
      return route.fulfill({ json: [PENDING_APPROVAL] })
    }
    return route.fulfill({ json: {} })
  })
  await page.goto(CLIENT_BASE + '/', { waitUntil: 'networkidle' })
  await shot(page, 'p1-desktop-conversation', { width: 1280, height: 800, waitText: 'Needs approval' })
  await page.close()
}

{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/health') return route.fulfill({ json: { status: 'ok' } })
    if (url.pathname === '/api/conversations/current') {
      return route.fulfill({ json: { conversationId: 'conv_p1_demo_0001', title: 'Weekly metrics', createdAt: '2026-11-19T09:00:00.000Z' } })
    }
    if (url.pathname.startsWith('/api/conversations/') && url.pathname.endsWith('/timeline')) return route.fulfill({ json: TIMELINE })
    if (url.pathname === '/api/approvals') return route.fulfill({ json: [PENDING_APPROVAL] })
    return route.fulfill({ json: {} })
  })
  await page.goto(CLIENT_BASE + '/', { waitUntil: 'networkidle' })
  await page.getByTestId('shell-menu-toggle').waitFor({ state: 'visible', timeout: 20000 })
  await shot(page, 'p1-narrow-menu-closed-badge', { width: 390, height: 844, waitText: 'Needs approval' })
  const badge = page.getByTestId('shell-pending-badge')
  if (!(await badge.isVisible())) {
    console.error('P1 FAIL: pending badge not visible on narrow Menu toggle with menu closed')
    process.exitCode = 1
  }
  await shot(page, 'p1-narrow-conversation', { width: 390, height: 844, waitText: 'Needs approval' })
  await page.close()
}

{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/health') return route.fulfill({ json: { status: 'ok' } })
    if (url.pathname === '/api/conversations/current') {
      return route.fulfill({ json: { conversationId: 'conv_p1_demo_0001', title: 'Weekly metrics', createdAt: '2026-11-19T09:00:00.000Z' } })
    }
    if (url.pathname.startsWith('/api/conversations/') && url.pathname.endsWith('/timeline')) return route.fulfill({ json: TIMELINE })
    if (url.pathname === '/api/approvals') return route.fulfill({ json: [PENDING_APPROVAL] })
    return route.fulfill({ json: {} })
  })
  await page.goto(CLIENT_BASE + '/', { waitUntil: 'networkidle' })
  const zh = page.getByTestId('locale-zh').first()
  if (await zh.isVisible()) await zh.click()
  await page.waitForTimeout(600)
  await shot(page, 'p1-zh-narrow-conversation', { width: 390, height: 844, waitText: '需要批准' })
  for (const label of ['拒绝', '批准此次动作']) {
    const loc = page.getByText(label, { exact: true }).first()
    if (!(await loc.isVisible())) {
      console.error('P1 FAIL: zh approval button not fully visible:', label)
      process.exitCode = 1
    }
  }
  await page.close()
}

// --- Disconnect: real network abort → design-table copy + Retry ---
for (const [locale, text] of [
  ['en', "Can't reach this Hamster"],
  ['zh', '无法连接'],
]) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  if (locale === 'zh') {
    await page.addInitScript(() => {
      try { localStorage.setItem('hamster.locale', 'zh') } catch { /* noop */ }
    })
  }
  await page.route('**/api/**', (route) => route.abort())
  await page.goto(CLIENT_BASE + '/', { waitUntil: 'load' })
  const loc = locale === 'zh' ? page.getByTestId('locale-zh').first() : page.getByTestId('locale-en').first()
  if (await loc.isVisible()) await loc.click()
  await page.getByText(text, { exact: true }).first().waitFor({ state: 'visible', timeout: 20000 })
  await shot(page, `p1-disconnect-${locale}`, { width: 1280, height: 800 })
  const retry = page.getByText(locale === 'zh' ? '重试' : 'Retry', { exact: true }).first()
  if (!(await retry.isVisible())) {
    console.error('P1 FAIL: Retry not visible on first screen during disconnect (' + locale + ')')
    process.exitCode = 1
  }
  await page.close()
}

// --- PWA installability / manifest / service worker checks ---
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.goto(CLIENT_BASE + '/', { waitUntil: 'networkidle' })
  results.install = await installChecks(page)
  if (results.install.ok !== true) {
    console.error('P1 FAIL: install checks not ok', JSON.stringify(results.install))
    process.exitCode = 1
  }
  await page.close()
}

await browser.close()
console.log(JSON.stringify(results, null, 2))
if (process.exitCode) process.exit(1)
