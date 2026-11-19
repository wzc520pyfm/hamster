#!/usr/bin/env node
/**
 * Narrow viewport evidence: install affordance visible + pending approval + composer
 * with bounding boxes. Not a physical-device claim.
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
    API_UPSTREAM: 'http://127.0.0.1:9', // unused — API mocked in page
    DIST_DIR: DIST,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

await new Promise((r) => setTimeout(r, 400))

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

// Force install affordance the same way a browser would (cancelable beforeinstallprompt).
await page.evaluate(() => {
  const evt = new Event('beforeinstallprompt', { cancelable: true })
  Object.defineProperty(evt, 'prompt', { value: async () => {} })
  window.dispatchEvent(evt)
})
await page.getByTestId('install-prompt').waitFor({ state: 'visible', timeout: 5000 })

const boxes = await page.evaluate(() => {
  const pick = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { sel, top: r.top, bottom: r.bottom, height: r.height, width: r.width }
  }
  const viewportH = window.innerHeight
  const install = pick('[data-testid="install-prompt"]')
  const composer = pick('textarea')
  const approve = Array.from(document.querySelectorAll('button')).find((b) =>
    /Approve this action|批准此次动作/.test(b.textContent || ''),
  )
  const approveBox = approve
    ? (() => {
        const r = approve.getBoundingClientRect()
        return { sel: 'approve-button', top: r.top, bottom: r.bottom, height: r.height, width: r.width }
      })()
    : null
  const all = [install, composer, approveBox].filter(Boolean)
  const fullyVisible = all.every((b) => b.top >= 0 && b.bottom <= viewportH + 0.5)
  return { viewportH, install, composer, approveBox, fullyVisible }
})

const shot = path.join(OUT, 'p1-narrow-install-affordance-bbox.png')
await page.screenshot({ path: shot, fullPage: false })

const report = {
  shot,
  boxes,
  note: 'Headless Chromium 390x844 — not a physical device. Install prompt forced via beforeinstallprompt.',
}
fs.writeFileSync(path.join(OUT, 'p1-narrow-install-affordance-bbox.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))

await browser.close()
child.kill('SIGTERM')
process.exit(boxes.fullyVisible ? 0 : 1)
