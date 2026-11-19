#!/usr/bin/env node
/**
 * Narrow viewport evidence with REAL visibility checks (not viewport-bbox alone).
 * Fails when Approve/Deny are overflow-clipped or occluded (elementFromPoint miss).
 * Not a physical-device claim.
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
const OUT = process.env.P1_EVIDENCE_DIR || path.join(ROOT, 'docs/evidence/p1-electron-pwa')
const PORT = Number(process.env.P1_BBOX_PORT || 13003)

fs.mkdirSync(OUT, { recursive: true })

const child = spawn(process.execPath, [path.join(ROOT, 'client', 'server.mjs')], {
  env: {
    ...process.env,
    PORT: String(PORT),
    API_UPSTREAM: 'http://127.0.0.1:9',
    DIST_DIR: DIST,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

await new Promise((r) => setTimeout(r, 500))

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })

await page.route('**/api/**', async (route) => {
  const url = new URL(route.request().url())
  if (url.pathname === '/api/health') return route.fulfill({ json: { status: 'ok' } })
  if (url.pathname === '/api/conversations/current') {
    return route.fulfill({
      json: {
        conversationId: 'conv_p1_bbox',
        title: 'Weekly metrics',
        createdAt: '2026-11-19T09:00:00.000Z',
      },
    })
  }
  if (url.pathname.endsWith('/timeline')) {
    return route.fulfill({
      json: {
        conversationId: 'conv_p1_bbox',
        messages: [
          {
            id: 'm1',
            role: 'user',
            content: 'start task: Weekly metrics dashboard',
            meta: { taskId: 'task_p1_bbox' },
            createdAt: '2026-11-19T10:00:00.000Z',
          },
        ],
        tasks: [
          {
            taskId: 'task_p1_bbox',
            conversationId: 'conv_p1_bbox',
            runtimeSessionId: 'rt_p1_bbox',
            assetId: null,
            title: 'Weekly metrics dashboard',
            status: 'waiting_for_approval',
            controlSeq: 0,
            createdAt: '2026-11-19T10:00:00.000Z',
            updatedAt: '2026-11-19T10:05:00.000Z',
            cancelRequestedAt: null,
            events: [],
            controls: [],
            approvals: [
              {
                id: 'appr_p1_bbox',
                taskId: 'task_p1_bbox',
                taskTitle: 'Weekly metrics dashboard',
                action: 'publish_dashboard',
                params: {},
                status: 'pending',
              },
            ],
          },
        ],
        approvals: [
          {
            id: 'appr_p1_bbox',
            taskId: 'task_p1_bbox',
            taskTitle: 'Weekly metrics dashboard',
            action: 'publish_dashboard',
            params: {},
            status: 'pending',
          },
        ],
      },
    })
  }
  if (url.pathname === '/api/approvals') {
    return route.fulfill({
      json: [
        {
          id: 'appr_p1_bbox',
          taskId: 'task_p1_bbox',
          taskTitle: 'Weekly metrics dashboard',
          action: 'publish_dashboard',
          params: {},
          status: 'pending',
        },
      ],
    })
  }
  return route.fulfill({ status: 404, json: { error: 'mocked' } })
})

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' })
await page.getByText('Needs approval', { exact: true }).first().waitFor({ state: 'visible', timeout: 20000 })

await page.evaluate(() => {
  const evt = new Event('beforeinstallprompt', { cancelable: true })
  Object.defineProperty(evt, 'prompt', { value: async () => {} })
  window.dispatchEvent(evt)
})
await page.getByTestId('install-prompt').waitFor({ state: 'visible', timeout: 5000 })
await page.getByTestId('approval-approve').waitFor({ state: 'attached', timeout: 5000 })

/** Do NOT scroll the page to “fix” visibility — initial frame only. */
const report = await page.evaluate(() => {
  function boxOf(el) {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, width: r.width }
  }

  function clippedByAncestor(el) {
    const r = el.getBoundingClientRect()
    let node = el.parentElement
    while (node && node !== document.documentElement) {
      const style = window.getComputedStyle(node)
      const oy = style.overflowY
      const ox = style.overflowX
      const clips =
        oy === 'auto' || oy === 'scroll' || oy === 'hidden' || ox === 'auto' || ox === 'scroll' || ox === 'hidden'
      if (clips) {
        const pr = node.getBoundingClientRect()
        const visibly =
          r.bottom > pr.top + 0.5 &&
          r.top < pr.bottom - 0.5 &&
          r.right > pr.left + 0.5 &&
          r.left < pr.right - 0.5
        const fullyInside =
          r.top >= pr.top - 0.5 &&
          r.bottom <= pr.bottom + 0.5 &&
          r.left >= pr.left - 0.5 &&
          r.right <= pr.right + 0.5
        if (!visibly || !fullyInside) {
          return {
            clipped: true,
            ancestor: node.className || node.tagName,
            fullyInside,
            visiblyOverlaps: visibly,
            el: boxOf(el),
            parent: boxOf(node),
          }
        }
      }
      node = node.parentElement
    }
    return { clipped: false }
  }

  function hitTest(el, label) {
    const r = el.getBoundingClientRect()
    // Include near-bottom samples — partial occlusion often still hits center-only checks.
    const points = [
      [r.left + r.width * 0.5, r.top + r.height * 0.5],
      [r.left + r.width * 0.2, r.top + r.height * 0.5],
      [r.left + r.width * 0.8, r.top + r.height * 0.5],
      [r.left + r.width * 0.5, r.top + r.height * 0.2],
      [r.left + r.width * 0.5, r.top + r.height * 0.8],
      [r.left + r.width * 0.5, r.top + r.height * 0.92],
    ]
    const samples = points.map(([x, y]) => {
      const top = document.elementFromPoint(x, y)
      const hit = Boolean(top && (top === el || el.contains(top)))
      return {
        x,
        y,
        hit,
        topTag: top ? top.tagName : null,
        topTestId: top && top.getAttribute ? top.getAttribute('data-testid') : null,
        topText: top && top.textContent ? String(top.textContent).trim().slice(0, 40) : null,
      }
    })
    const hitCount = samples.filter((s) => s.hit).length
    return {
      label,
      box: boxOf(el),
      clip: clippedByAncestor(el),
      samples,
      hitCount,
      hittable: hitCount === samples.length,
    }
  }

  const viewportH = window.innerHeight
  const install = document.querySelector('[data-testid="install-prompt"]')
  const composer = document.querySelector('textarea')
  const approve = document.querySelector('[data-testid="approval-approve"]')
  const deny = document.querySelector('[data-testid="approval-deny"]')
  const dock = document.querySelector('[data-testid="pending-approvals-dock"]')

  const inViewport = (el) => {
    if (!el) return false
    const r = el.getBoundingClientRect()
    return r.top >= 0 && r.bottom <= viewportH + 0.5 && r.height > 0
  }

  // Legacy false-positive metric (bbox-in-viewport only) — reported for comparison, NOT acceptance.
  const legacyBboxOnly =
    inViewport(install) && inViewport(composer) && inViewport(approve) && inViewport(deny)

  const installHit = install ? hitTest(install, 'install') : null
  const composerHit = composer ? hitTest(composer, 'composer') : null
  const approveHit = approve ? hitTest(approve, 'approve') : null
  const denyHit = deny ? hitTest(deny, 'deny') : null

  const composerTop = composer ? composer.getBoundingClientRect().top : null
  const approveBottom = approve ? approve.getBoundingClientRect().bottom : null
  const denyBottom = deny ? deny.getBoundingClientRect().bottom : null
  const clearOfComposer =
    composerTop != null &&
    approveBottom != null &&
    denyBottom != null &&
    approveBottom <= composerTop - 2 &&
    denyBottom <= composerTop - 2

  const pass =
    Boolean(dock) &&
    Boolean(approveHit?.hittable) &&
    Boolean(denyHit?.hittable) &&
    Boolean(composerHit?.hittable) &&
    Boolean(installHit?.hittable) &&
    !approveHit?.clip?.clipped &&
    !denyHit?.clip?.clipped &&
    clearOfComposer

  return {
    viewportH,
    dockPresent: Boolean(dock),
    clearOfComposer,
    composerTop,
    approveBottom,
    denyBottom,
    legacyBboxOnlyFalsePositiveMetric: legacyBboxOnly,
    install: installHit,
    composer: composerHit,
    approve: approveHit,
    deny: denyHit,
    pass,
    note: 'Headless Chromium 390x844 — not physical. pass = full elementFromPoint + no clip + above composer.',
  }
})

const shot = path.join(OUT, 'p1-narrow-install-affordance-bbox.png')
await page.screenshot({ path: shot, fullPage: false })
report.shot = shot

const jsonPath = path.join(OUT, 'p1-narrow-install-affordance-bbox.json')
fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))

await browser.close()
child.kill('SIGTERM')
process.exit(report.pass ? 0 : 1)
