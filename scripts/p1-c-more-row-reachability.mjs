#!/usr/bin/env node
/**
 * Narrow evidence: scenario C 390×667 — "more pending" row reachability.
 * Code-under-test tip should be recorded by the operator; this script does not
 * change production layout. Scrolls the dock scroller itself (not unrelated
 * scrollIntoView). Chromium headless — NOT Electron / NOT physical phone.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), '../client/package.json'))
const { chromium } = require('playwright')

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'client', 'dist')
const OUT = process.env.P1_EVIDENCE_DIR || '/opt/cursor/artifacts/p1-c-more-row-evidence'
const PORT = Number(process.env.P1_C_MORE_PORT || 13011)
fs.mkdirSync(OUT, { recursive: true })

const EXPIRY = '2026-11-20T18:00:00.000Z'
const APPR_A = {
  id: 'appr_p1_ticket_A',
  taskId: 'task_p1_A',
  taskTitle: 'Weekly metrics dashboard',
  action: 'publish_dashboard',
  params: {
    assetId: 'asset_p1_metrics_A',
    channel: 'shared workspace',
    apiToken: 'sk-should-redact',
  },
  status: 'pending',
  expiresAt: EXPIRY,
}
const APPR_B = {
  id: 'appr_p1_ticket_B',
  taskId: 'task_p1_B',
  taskTitle: 'Ops health board',
  action: 'publish_dashboard',
  params: { assetId: 'asset_p1_ops_B', channel: 'shared workspace' },
  status: 'pending',
  expiresAt: EXPIRY,
}

function timelineFor(approvals) {
  const tasks = approvals.map((a) => ({
    taskId: a.taskId,
    conversationId: 'conv_p1_matrix',
    runtimeSessionId: `rt_${a.taskId}`,
    assetId: a.params.assetId,
    title: a.taskTitle,
    status: 'waiting_for_approval',
    controlSeq: 0,
    createdAt: '2026-11-19T10:00:00.000Z',
    updatedAt: '2026-11-19T10:05:00.000Z',
    cancelRequestedAt: null,
    events: [],
    controls: [],
    approvals: [a],
  }))
  return {
    conversationId: 'conv_p1_matrix',
    messages: approvals.map((a, i) => ({
      id: `m_${i}`,
      role: 'user',
      content: `start task: ${a.taskTitle}`,
      meta: { taskId: a.taskId },
      createdAt: '2026-11-19T10:00:00.000Z',
    })),
    tasks,
    approvals,
  }
}

const state = { approvals: [APPR_A, APPR_B] }

const child = spawn(process.execPath, [path.join(ROOT, 'client', 'server.mjs')], {
  env: { ...process.env, PORT: String(PORT), API_UPSTREAM: 'http://127.0.0.1:9', DIST_DIR: DIST },
  stdio: ['ignore', 'pipe', 'pipe'],
})
await new Promise((r) => setTimeout(r, 500))

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 390, height: 667 } })
await page.addInitScript(() => localStorage.setItem('hamster.locale', 'en'))

await page.route('**/api/**', async (route) => {
  const url = new URL(route.request().url())
  const method = route.request().method()
  if (url.pathname === '/api/health') return route.fulfill({ json: { status: 'ok' } })
  if (url.pathname === '/api/conversations/current') {
    return route.fulfill({
      json: {
        conversationId: 'conv_p1_matrix',
        title: 'Weekly metrics',
        createdAt: '2026-11-19T09:00:00.000Z',
      },
    })
  }
  if (url.pathname.endsWith('/timeline')) return route.fulfill({ json: timelineFor(state.approvals) })
  if (url.pathname === '/api/approvals' && method === 'GET') {
    return route.fulfill({ json: state.approvals })
  }
  return route.fulfill({ status: 404, json: { error: 'mocked' } })
})

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' })
await page.getByTestId('pending-approvals-dock').waitFor({ state: 'visible', timeout: 15000 })

// Force install so C matches two-pending + install + composer density
await page.evaluate(() => {
  const evt = new Event('beforeinstallprompt', { cancelable: true })
  Object.defineProperty(evt, 'prompt', { value: async () => {} })
  window.dispatchEvent(evt)
})
await page.getByTestId('install-prompt').waitFor({ state: 'visible', timeout: 5000 })

const probeSrc = () => {
  function hitAll(el) {
    const r = el.getBoundingClientRect()
    const pts = [
      [0.5, 0.5],
      [0.2, 0.5],
      [0.8, 0.5],
      [0.5, 0.2],
      [0.5, 0.8],
      [0.5, 0.92],
    ]
    const samples = pts.map(([fx, fy]) => {
      const x = r.left + r.width * fx
      const y = r.top + r.height * fy
      const top = document.elementFromPoint(x, y)
      const hit = Boolean(top && (top === el || el.contains(top)))
      return {
        x,
        y,
        hit,
        tag: top?.tagName || null,
        testid: top?.getAttribute?.('data-testid') || null,
      }
    })
    return {
      hittable: samples.every((s) => s.hit),
      samples,
      box: { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, width: r.width },
    }
  }
  function clippedDetail(el) {
    const r = el.getBoundingClientRect()
    const offenders = []
    let node = el.parentElement
    while (node && node !== document.documentElement) {
      const style = getComputedStyle(node)
      const clips =
        ['auto', 'scroll', 'hidden'].includes(style.overflowY) ||
        ['auto', 'scroll', 'hidden'].includes(style.overflowX)
      if (clips) {
        const pr = node.getBoundingClientRect()
        const fully =
          r.top >= pr.top - 0.5 &&
          r.bottom <= pr.bottom + 0.5 &&
          r.left >= pr.left - 0.5 &&
          r.right <= pr.right + 0.5
        if (!fully) {
          offenders.push({
            testid: node.getAttribute('data-testid'),
            className: String(node.className || '').slice(0, 120),
            overflowY: style.overflowY,
            parentBox: { top: pr.top, bottom: pr.bottom, height: pr.height },
            elBox: { top: r.top, bottom: r.bottom, height: r.height },
          })
        }
      }
      node = node.parentElement
    }
    return { clipped: offenders.length > 0, offenders }
  }
  function dockMetrics() {
    const dock = document.querySelector('[data-testid="pending-approvals-dock"]')
    if (!dock) return null
    return {
      scrollTop: dock.scrollTop,
      clientHeight: dock.clientHeight,
      scrollHeight: dock.scrollHeight,
      canScroll: dock.scrollHeight > dock.clientHeight + 0.5,
    }
  }
  function probe() {
    const more = document.querySelector('[data-testid="approval-summary-more"]')
    const open = document.querySelector('[data-testid="open-pending-approvals"]')
    return {
      exists: { more: Boolean(more), open: Boolean(open) },
      dock: dockMetrics(),
      more: more
        ? { hit: hitAll(more), clip: clippedDetail(more), text: more.textContent?.replace(/\s+/g, ' ').trim() }
        : null,
      open: open
        ? { hit: hitAll(open), clip: clippedDetail(open), text: open.textContent?.replace(/\s+/g, ' ').trim() }
        : null,
    }
  }
  return { probe, dockMetrics }
}

const before = await page.evaluate(() => {
  const { probe } = (() => {
    function hitAll(el) {
      const r = el.getBoundingClientRect()
      const pts = [
        [0.5, 0.5],
        [0.2, 0.5],
        [0.8, 0.5],
        [0.5, 0.2],
        [0.5, 0.8],
        [0.5, 0.92],
      ]
      const samples = pts.map(([fx, fy]) => {
        const x = r.left + r.width * fx
        const y = r.top + r.height * fy
        const top = document.elementFromPoint(x, y)
        const hit = Boolean(top && (top === el || el.contains(top)))
        return {
          x,
          y,
          hit,
          tag: top?.tagName || null,
          testid: top?.getAttribute?.('data-testid') || null,
        }
      })
      return {
        hittable: samples.every((s) => s.hit),
        samples,
        box: {
          top: r.top,
          bottom: r.bottom,
          left: r.left,
          right: r.right,
          height: r.height,
          width: r.width,
        },
      }
    }
    function clippedDetail(el) {
      const r = el.getBoundingClientRect()
      const offenders = []
      let node = el.parentElement
      while (node && node !== document.documentElement) {
        const style = getComputedStyle(node)
        const clips =
          ['auto', 'scroll', 'hidden'].includes(style.overflowY) ||
          ['auto', 'scroll', 'hidden'].includes(style.overflowX)
        if (clips) {
          const pr = node.getBoundingClientRect()
          const fully =
            r.top >= pr.top - 0.5 &&
            r.bottom <= pr.bottom + 0.5 &&
            r.left >= pr.left - 0.5 &&
            r.right <= pr.right + 0.5
          if (!fully) {
            offenders.push({
              testid: node.getAttribute('data-testid'),
              className: String(node.className || '').slice(0, 120),
              overflowY: style.overflowY,
              parentBox: { top: pr.top, bottom: pr.bottom, height: pr.height },
              elBox: { top: r.top, bottom: r.bottom, height: r.height },
            })
          }
        }
        node = node.parentElement
      }
      return { clipped: offenders.length > 0, offenders }
    }
    function dockMetrics() {
      const dock = document.querySelector('[data-testid="pending-approvals-dock"]')
      if (!dock) return null
      return {
        scrollTop: dock.scrollTop,
        clientHeight: dock.clientHeight,
        scrollHeight: dock.scrollHeight,
        canScroll: dock.scrollHeight > dock.clientHeight + 0.5,
      }
    }
    function probe() {
      const more = document.querySelector('[data-testid="approval-summary-more"]')
      const open = document.querySelector('[data-testid="open-pending-approvals"]')
      return {
        exists: { more: Boolean(more), open: Boolean(open) },
        dock: dockMetrics(),
        more: more
          ? {
              hit: hitAll(more),
              clip: clippedDetail(more),
              text: more.textContent?.replace(/\s+/g, ' ').trim(),
            }
          : null,
        open: open
          ? {
              hit: hitAll(open),
              clip: clippedDetail(open),
              text: open.textContent?.replace(/\s+/g, ' ').trim(),
            }
          : null,
      }
    }
    return { probe }
  })()
  return probe()
})

const beforeShot = path.join(OUT, 'C-390x667-more-row-BEFORE-scroll.png')
await page.screenshot({ path: beforeShot, fullPage: false })

// Scroll the dock scroller itself so the more row is fully inside the dock viewport.
const scrollResult = await page.evaluate(() => {
  const dock = document.querySelector('[data-testid="pending-approvals-dock"]')
  const more = document.querySelector('[data-testid="approval-summary-more"]')
  const open = document.querySelector('[data-testid="open-pending-approvals"]')
  if (!dock || !more || !open) {
    return { ok: false, reason: 'missing dock/more/open' }
  }
  const before = {
    scrollTop: dock.scrollTop,
    clientHeight: dock.clientHeight,
    scrollHeight: dock.scrollHeight,
  }
  // Scroll dock so more row bottom sits inside dock client area (not scrollIntoView on textarea/view).
  const maxTop = Math.max(0, dock.scrollHeight - dock.clientHeight)
  dock.scrollTop = maxTop
  // If still clipped relative to dock, nudge using more's offset within dock.
  const dockRect = dock.getBoundingClientRect()
  const moreRect = more.getBoundingClientRect()
  if (moreRect.bottom > dockRect.bottom - 1 || moreRect.top < dockRect.top + 1) {
    const delta = moreRect.bottom - dockRect.bottom + 4
    dock.scrollTop = Math.min(maxTop, Math.max(0, dock.scrollTop + delta))
  }
  const openRect = open.getBoundingClientRect()
  if (openRect.bottom > dockRect.bottom - 1) {
    dock.scrollTop = Math.min(maxTop, dock.scrollTop + (openRect.bottom - dockRect.bottom + 4))
  }
  const after = {
    scrollTop: dock.scrollTop,
    clientHeight: dock.clientHeight,
    scrollHeight: dock.scrollHeight,
  }
  return { ok: true, before, after, scrolledBy: after.scrollTop - before.scrollTop }
})

// Allow layout to settle after programmatic scroll
await page.waitForTimeout(100)

const after = await page.evaluate(() => {
  function hitAll(el) {
    const r = el.getBoundingClientRect()
    const pts = [
      [0.5, 0.5],
      [0.2, 0.5],
      [0.8, 0.5],
      [0.5, 0.2],
      [0.5, 0.8],
      [0.5, 0.92],
    ]
    const samples = pts.map(([fx, fy]) => {
      const x = r.left + r.width * fx
      const y = r.top + r.height * fy
      const top = document.elementFromPoint(x, y)
      const hit = Boolean(top && (top === el || el.contains(top)))
      return {
        x,
        y,
        hit,
        tag: top?.tagName || null,
        testid: top?.getAttribute?.('data-testid') || null,
      }
    })
    return {
      hittable: samples.every((s) => s.hit),
      samples,
      box: {
        top: r.top,
        bottom: r.bottom,
        left: r.left,
        right: r.right,
        height: r.height,
        width: r.width,
      },
    }
  }
  function clippedDetail(el) {
    const r = el.getBoundingClientRect()
    const offenders = []
    let node = el.parentElement
    while (node && node !== document.documentElement) {
      const style = getComputedStyle(node)
      const clips =
        ['auto', 'scroll', 'hidden'].includes(style.overflowY) ||
        ['auto', 'scroll', 'hidden'].includes(style.overflowX)
      if (clips) {
        const pr = node.getBoundingClientRect()
        const fully =
          r.top >= pr.top - 0.5 &&
          r.bottom <= pr.bottom + 0.5 &&
          r.left >= pr.left - 0.5 &&
          r.right <= pr.right + 0.5
        if (!fully) {
          offenders.push({
            testid: node.getAttribute('data-testid'),
            className: String(node.className || '').slice(0, 120),
            overflowY: style.overflowY,
            parentBox: { top: pr.top, bottom: pr.bottom, height: pr.height },
            elBox: { top: r.top, bottom: r.bottom, height: r.height },
          })
        }
      }
      node = node.parentElement
    }
    return { clipped: offenders.length > 0, offenders }
  }
  function dockMetrics() {
    const dock = document.querySelector('[data-testid="pending-approvals-dock"]')
    if (!dock) return null
    return {
      scrollTop: dock.scrollTop,
      clientHeight: dock.clientHeight,
      scrollHeight: dock.scrollHeight,
      canScroll: dock.scrollHeight > dock.clientHeight + 0.5,
    }
  }
  const more = document.querySelector('[data-testid="approval-summary-more"]')
  const open = document.querySelector('[data-testid="open-pending-approvals"]')
  return {
    exists: { more: Boolean(more), open: Boolean(open) },
    dock: dockMetrics(),
    more: more
      ? {
          hit: hitAll(more),
          clip: clippedDetail(more),
          text: more.textContent?.replace(/\s+/g, ' ').trim(),
        }
      : null,
    open: open
      ? {
          hit: hitAll(open),
          clip: clippedDetail(open),
          text: open.textContent?.replace(/\s+/g, ' ').trim(),
        }
      : null,
  }
})

const afterShot = path.join(OUT, 'C-390x667-more-row-AFTER-scroll.png')
await page.screenshot({ path: afterShot, fullPage: false })

const moreOk =
  after.exists.more &&
  after.more?.hit?.hittable === true &&
  after.more?.clip?.clipped === false
const openOk =
  after.exists.open &&
  after.open?.hit?.hittable === true &&
  after.open?.clip?.clipped === false

let routeCheck = { attempted: false }
if (openOk) {
  await page.getByTestId('open-pending-approvals').click()
  await page.waitForURL(/\/approvals/)
  await page.locator('[data-approval-id="appr_p1_ticket_B"]').waitFor({ state: 'visible', timeout: 10000 })
  const bVisible = await page.evaluate(() => {
    const card = document.querySelector('[data-approval-id="appr_p1_ticket_B"]')
    if (!card) return { present: false }
    const r = card.getBoundingClientRect()
    const title = card.querySelector('[data-testid="approval-full-task-title"]')?.textContent || ''
    const params = card.querySelector('[data-testid="approval-full-params"]')?.textContent || ''
    return {
      present: true,
      title: title.trim(),
      hasAssetB: params.includes('asset_p1_ops_B'),
      box: { top: r.top, bottom: r.bottom, height: r.height },
      inViewport: r.top < window.innerHeight && r.bottom > 0,
    }
  })
  // If B is below fold on the approvals list, scroll the page/card into view for evidence shot
  if (bVisible.present && !bVisible.inViewport) {
    await page.locator('[data-approval-id="appr_p1_ticket_B"]').scrollIntoViewIfNeeded()
  }
  const bAfterScroll = await page.evaluate(() => {
    const card = document.querySelector('[data-approval-id="appr_p1_ticket_B"]')
    if (!card) return { present: false }
    const r = card.getBoundingClientRect()
    const title = card.querySelector('[data-testid="approval-full-task-title"]')?.textContent || ''
    const params = card.querySelector('[data-testid="approval-full-params"]')?.textContent || ''
    return {
      present: true,
      title: title.trim(),
      hasAssetB: params.includes('asset_p1_ops_B'),
      box: { top: r.top, bottom: r.bottom, height: r.height },
      inViewport: r.top < window.innerHeight && r.bottom > 0,
    }
  })
  const routeShot = path.join(OUT, 'C-390x667-after-open-pending-ticket-B.png')
  await page.screenshot({ path: routeShot, fullPage: false })
  routeCheck = {
    attempted: true,
    url: page.url(),
    pathOk: /\/approvals\/?(\?|$)/.test(new URL(page.url()).pathname + new URL(page.url()).search) ||
      new URL(page.url()).pathname.endsWith('/approvals') ||
      new URL(page.url()).pathname === '/approvals',
    pathname: new URL(page.url()).pathname,
    ticketB: bAfterScroll,
    shot: routeShot,
    pass:
      (new URL(page.url()).pathname === '/approvals' || new URL(page.url()).pathname.endsWith('/approvals')) &&
      bAfterScroll.present &&
      bAfterScroll.hasAssetB &&
      bAfterScroll.title.includes('Ops health board'),
  }
} else {
  routeCheck = {
    attempted: false,
    reason: 'open-pending-approvals not hittable/unclipped after dock scroll — skip click',
    pass: false,
  }
}

const report = {
  platform: 'Chromium headless — NOT Electron / NOT physical phone',
  scenario: 'C-390x667 more-row reachability',
  selectors: {
    more: '[data-testid="approval-summary-more"]',
    open: '[data-testid="open-pending-approvals"]',
    dock: '[data-testid="pending-approvals-dock"]',
  },
  scrollResult,
  before,
  after,
  shots: {
    before: beforeShot,
    after: afterShot,
    route: routeCheck.shot || null,
  },
  moreReachable: moreOk,
  openReachable: openOk,
  routeCheck,
  layoutUnchangedAssumption: true,
  pass: moreOk && openOk && routeCheck.pass === true,
  note:
    'hasMore DOM existence is insufficient; this report requires 6-point elementFromPoint + clip=false for more and open after scrolling the dock scroller.',
}

fs.writeFileSync(path.join(OUT, 'c-more-row-report.json'), JSON.stringify(report, null, 2))
console.log(
  JSON.stringify(
    {
      pass: report.pass,
      moreReachable: moreOk,
      openReachable: openOk,
      routePass: routeCheck.pass,
      scroll: scrollResult,
      beforeDock: before.dock,
      afterDock: after.dock,
      beforeMoreClipped: before.more?.clip?.clipped,
      afterMoreClipped: after.more?.clip?.clipped,
      beforeOpenHittable: before.open?.hit?.hittable,
      afterOpenHittable: after.open?.hit?.hittable,
    },
    null,
    2,
  ),
)

await browser.close()
child.kill('SIGTERM')
process.exit(report.pass ? 0 : 2)
