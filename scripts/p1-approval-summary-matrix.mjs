#!/usr/bin/env node
/**
 * Approval SUMMARY → DETAIL → CONFIRM evidence matrix + interaction regression.
 * Chromium headless only — NOT real Electron / physical phone.
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
const OUT = process.env.P1_EVIDENCE_DIR || '/opt/cursor/artifacts/p1-approval-summary-evidence'
const PORT = Number(process.env.P1_MATRIX_PORT || 13010)
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

const state = {
  approvals: [APPR_A, APPR_B],
  approveCalls: [],
  denyCalls: [],
}

const child = spawn(process.execPath, [path.join(ROOT, 'client', 'server.mjs')], {
  env: { ...process.env, PORT: String(PORT), API_UPSTREAM: 'http://127.0.0.1:9', DIST_DIR: DIST },
  stdio: ['ignore', 'pipe', 'pipe'],
})
await new Promise((r) => setTimeout(r, 500))

const browser = await chromium.launch({ headless: true })

async function withPage(viewport, locale, approvals, fn) {
  state.approvals = approvals
  const page = await browser.newPage({ viewport })
  await page.addInitScript((loc) => {
    try {
      localStorage.setItem('hamster.locale', loc)
    } catch {}
  }, locale)

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
    if (url.pathname.endsWith('/timeline')) {
      return route.fulfill({ json: timelineFor(state.approvals) })
    }
    if (url.pathname === '/api/approvals' && method === 'GET') {
      return route.fulfill({ json: state.approvals })
    }
    const approveMatch = url.pathname.match(/^\/api\/approvals\/([^/]+)\/approve$/)
    if (approveMatch && method === 'POST') {
      const id = decodeURIComponent(approveMatch[1])
      state.approveCalls.push(id)
      state.approvals = state.approvals.map((a) =>
        a.id === id ? { ...a, status: 'approved', decidedAt: new Date().toISOString() } : a,
      )
      return route.fulfill({ json: { id, status: 'approved' } })
    }
    const denyMatch = url.pathname.match(/^\/api\/approvals\/([^/]+)\/deny$/)
    if (denyMatch && method === 'POST') {
      const id = decodeURIComponent(denyMatch[1])
      state.denyCalls.push(id)
      state.approvals = state.approvals.map((a) =>
        a.id === id ? { ...a, status: 'denied', decidedAt: new Date().toISOString() } : a,
      )
      return route.fulfill({ json: { id, status: 'denied' } })
    }
    return route.fulfill({ status: 404, json: { error: 'mocked' } })
  })

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' })
  if (locale === 'zh') {
    await page.getByTestId('locale-zh').first().click()
    await page.waitForTimeout(200)
  }
  const result = await fn(page)
  await page.close()
  return result
}

function hitHelpers() {
  return {
    boxOf(el) {
      const r = el.getBoundingClientRect()
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, width: r.width }
    },
    clipped(el) {
      const r = el.getBoundingClientRect()
      let node = el.parentElement
      while (node && node !== document.documentElement) {
        const style = getComputedStyle(node)
        const clips = ['auto', 'scroll', 'hidden'].includes(style.overflowY) || ['auto', 'scroll', 'hidden'].includes(style.overflowX)
        if (clips) {
          const pr = node.getBoundingClientRect()
          const fully =
            r.top >= pr.top - 0.5 &&
            r.bottom <= pr.bottom + 0.5 &&
            r.left >= pr.left - 0.5 &&
            r.right <= pr.right + 0.5
          if (!fully) return { clipped: true, ancestor: node.className || node.tagName }
        }
        node = node.parentElement
      }
      return { clipped: false }
    },
    hitAll(el) {
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
        return { x, y, hit, text: top?.textContent?.trim()?.slice(0, 32) || null }
      })
      return { samples, hittable: samples.every((s) => s.hit), box: { top: r.top, bottom: r.bottom, height: r.height } }
    },
    noEllipsis(el) {
      const text = (el?.textContent || '').replace(/\s+/g, ' ').trim()
      return { text, hasEllipsisChar: text.includes('…') || text.includes('...'), complete: Boolean(text) && !text.includes('…') }
    },
  }
}

async function forceInstall(page) {
  await page.evaluate(() => {
    const evt = new Event('beforeinstallprompt', { cancelable: true })
    Object.defineProperty(evt, 'prompt', { value: async () => {} })
    window.dispatchEvent(evt)
  })
  await page.getByTestId('install-prompt').waitFor({ state: 'visible', timeout: 5000 })
}

async function conversationChecks(page, { expectInstall, expectMore }) {
  await page.getByTestId('pending-approvals-dock').waitFor({ state: 'visible', timeout: 15000 })
  if (expectInstall) await forceInstall(page)
  // Bounded short-screen scrollers: bring detail entry + composer into the visual viewport before hit-tests.
  await page.getByTestId('approval-view-details').scrollIntoViewIfNeeded()
  await page.locator('textarea').scrollIntoViewIfNeeded()

  return page.evaluate(
    ({ expectInstall, expectMore, helpersSrc }) => {
      // helpers inlined via string eval avoided — duplicate minimal checks
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
          return { x, y, hit }
        })
        return { hittable: samples.every((s) => s.hit), samples, box: { top: r.top, bottom: r.bottom } }
      }
      function clipped(el) {
        const r = el.getBoundingClientRect()
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
            if (!fully) return true
          }
          node = node.parentElement
        }
        return false
      }

      const summary = document.querySelector('[data-testid="approval-summary"]')
      const view = document.querySelector('[data-testid="approval-view-details"]')
      const approveInSummary = document.querySelector(
        '[data-testid="approval-summary"] [data-testid="approval-approve"]',
      )
      const composer = document.querySelector('textarea')
      const install = document.querySelector('[data-testid="install-prompt"]')
      const installBody = document.querySelector('[data-testid="install-body"]')
      const more = document.querySelector('[data-testid="approval-summary-more"]')
      const action = document.querySelector('[data-testid="approval-summary-action"]')
      const target = document.querySelector('[data-testid="approval-summary-target"]')

      const viewHit = view ? hitAll(view) : null
      const composerHit = composer ? hitAll(composer) : null
      const installHit = install ? hitAll(install) : null

      const installText = installBody?.textContent?.replace(/\s+/g, ' ').trim() || ''
      const actionText = action?.textContent?.trim() || ''
      const targetText = target?.textContent?.replace(/\s+/g, ' ').trim() || ''

      const clear =
        view &&
        composer &&
        view.getBoundingClientRect().bottom <= composer.getBoundingClientRect().top - 1

      return {
        summaryCount: document.querySelectorAll('[data-testid="approval-summary"]').length,
        hasApproveInSummary: Boolean(approveInSummary),
        hasViewDetails: Boolean(view),
        hasMore: Boolean(more),
        expectMore,
        expectInstall,
        actionText,
        targetText,
        actionHasEllipsis: /…|\.\.\./.test(actionText),
        targetHasEllipsis: /…|\.\.\./.test(targetText),
        installText,
        installHasEllipsis: /…|\.\.\./.test(installText),
        installCompleteEn: !expectInstall || installText === 'Add Hamster to your home screen for full-screen use.',
        installCompleteZh: !expectInstall || installText === '把 Hamster 加到主屏幕以使用全屏模式。' || localeIsZh(),
        viewHit,
        composerHit,
        installHit: expectInstall ? installHit : { skipped: true },
        viewClipped: view ? clipped(view) : true,
        composerClipped: composer ? clipped(composer) : true,
        clearAboveComposer: clear,
        pass:
          document.querySelectorAll('[data-testid="approval-summary"]').length === 1 &&
          !approveInSummary &&
          Boolean(view) &&
          Boolean(composer) &&
          viewHit?.hittable &&
          composerHit?.hittable &&
          !clipped(view) &&
          clear &&
          !/…|\.\.\./.test(actionText) &&
          !/…|\.\.\./.test(targetText) &&
          (!expectInstall || (installHit?.hittable && !/…|\.\.\./.test(installText))) &&
          (expectMore ? Boolean(more) : !more),
      }

      function localeIsZh() {
        return document.documentElement.lang === 'zh' || Boolean(document.querySelector('[data-testid="locale-zh"][aria-pressed="true"]'))
      }
    },
    { expectInstall, expectMore },
  )
}

const report = { shots: [], interaction: null, platform: 'Chromium headless — NOT Electron / NOT physical phone' }

// A: desktop 1200x800 EN two pending, composer (install optional off)
{
  const checks = await withPage({ width: 1200, height: 800 }, 'en', [APPR_A, APPR_B], async (page) => {
    const c = await conversationChecks(page, { expectInstall: false, expectMore: true })
    const shot = path.join(OUT, 'A-desktop-1200x800-en-two-pending.png')
    await page.screenshot({ path: shot, fullPage: false })
    return { checks: c, shot }
  })
  report.shots.push({ id: 'A', ...checks })
}

// B: 390x844 ZH one pending + install + composer
{
  const checks = await withPage({ width: 390, height: 844 }, 'zh', [APPR_A], async (page) => {
    const c = await conversationChecks(page, { expectInstall: true, expectMore: false })
    // ZH install body exact
    const body = await page.getByTestId('install-body').innerText()
    c.installTextExact = body.replace(/\s+/g, ' ').trim()
    c.installCompleteZh = c.installTextExact === '把 Hamster 加到主屏幕以使用全屏模式。'
    c.pass = c.pass && c.installCompleteZh
    const shot = path.join(OUT, 'B-narrow-390x844-zh-one-pending-install.png')
    await page.screenshot({ path: shot, fullPage: false })
    return { checks: c, shot }
  })
  report.shots.push({ id: 'B', ...checks })
}

// C: 390x667 EN two pending + install + composer — more-row must be dock-scroll reachable (not DOM-only)
{
  const checks = await withPage({ width: 390, height: 667 }, 'en', [APPR_A, APPR_B], async (page) => {
    const c = await conversationChecks(page, { expectInstall: true, expectMore: true })
    const body = await page.getByTestId('install-body').innerText()
    c.installTextExact = body.replace(/\s+/g, ' ').trim()
    c.installCompleteEn = c.installTextExact === 'Add Hamster to your home screen for full-screen use.'

    // Dedicated more-row reachability: scroll the dock scroller itself (not unrelated scrollIntoView).
    const moreReach = await page.evaluate(() => {
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
          return { hit: Boolean(top && (top === el || el.contains(top))) }
        })
        return { hittable: samples.every((s) => s.hit), samples }
      }
      function clipped(el) {
        const r = el.getBoundingClientRect()
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
            if (!fully) return true
          }
          node = node.parentElement
        }
        return false
      }
      const dock = document.querySelector('[data-testid="pending-approvals-dock"]')
      const more = document.querySelector('[data-testid="approval-summary-more"]')
      const open = document.querySelector('[data-testid="open-pending-approvals"]')
      const before = dock
        ? { scrollTop: dock.scrollTop, clientHeight: dock.clientHeight, scrollHeight: dock.scrollHeight }
        : null
      if (dock) dock.scrollTop = Math.max(0, dock.scrollHeight - dock.clientHeight)
      const after = dock
        ? { scrollTop: dock.scrollTop, clientHeight: dock.clientHeight, scrollHeight: dock.scrollHeight }
        : null
      return {
        before,
        after,
        more: more ? { hittable: hitAll(more).hittable, clipped: clipped(more) } : null,
        open: open ? { hittable: hitAll(open).hittable, clipped: clipped(open) } : null,
      }
    })
    c.moreRowReachability = moreReach
    c.moreRowReachable =
      moreReach.more?.hittable === true &&
      moreReach.more?.clipped === false &&
      moreReach.open?.hittable === true &&
      moreReach.open?.clipped === false
    c.pass = c.pass && c.installCompleteEn && c.moreRowReachable
    const shot = path.join(OUT, 'C-narrow-390x667-en-two-pending-install.png')
    await page.screenshot({ path: shot, fullPage: false })
    return { checks: c, shot }
  })
  report.shots.push({ id: 'C', ...checks })
}

// D: full confirmation EN + ZH for same publish_dashboard ticket A
async function fullCardShot(locale, name) {
  return withPage({ width: 390, height: 844 }, locale, [APPR_A, APPR_B], async (page) => {
    await page.goto(`http://127.0.0.1:${PORT}/approvals?id=${encodeURIComponent(APPR_A.id)}`, {
      waitUntil: 'networkidle',
    })
    if (locale === 'zh') {
      await page.getByTestId('locale-zh').first().click()
      await page.waitForTimeout(200)
    }
    await page.locator(`[data-approval-id="${APPR_A.id}"]`).waitFor({ state: 'visible' })
    const detail = await page.evaluate((id) => {
      const card = document.querySelector(`[data-approval-id="${id}"]`)
      const params = card?.querySelector('[data-testid="approval-full-params"]')?.innerText || ''
      const expires = card?.querySelector('[data-testid="approval-full-expires"]')?.innerText || ''
      const title = card?.querySelector('[data-testid="approval-full-task-title"]')?.innerText || ''
      const action = card?.querySelector('[data-testid="approval-full-action"]')?.innerText || ''
      const approve = card?.querySelector('[data-testid="approval-approve"]')
      const deny = card?.querySelector('[data-testid="approval-deny"]')
      return {
        focused: card?.getAttribute('data-focused') === 'true',
        action,
        title,
        params,
        expires,
        hasApprove: Boolean(approve),
        hasDeny: Boolean(deny),
        hasAsset: params.includes('asset_p1_metrics_A'),
        hasChannel: params.includes('shared workspace'),
        tokenRedacted: params.includes('apiToken: •••') || params.includes('apiToken:•••'),
        noRawToken: !params.includes('sk-should-redact'),
        noEllipsis: !/[…]/.test(action + title + params + expires),
      }
    }, APPR_A.id)
    detail.pass =
      detail.focused &&
      detail.hasApprove &&
      detail.hasDeny &&
      detail.hasAsset &&
      detail.hasChannel &&
      detail.tokenRedacted &&
      detail.noRawToken &&
      Boolean(detail.title) &&
      (locale === 'zh'
        ? detail.action.includes('Dashboard') || detail.action.includes('发布')
        : detail.title.includes('Weekly') && detail.action.toLowerCase().includes('publish')) &&
      detail.noEllipsis
    const shot = path.join(OUT, name)
    await page.screenshot({ path: shot, fullPage: false })
    return { checks: detail, shot }
  })
}
report.shots.push({ id: 'D-en', ...(await fullCardShot('en', 'D-full-confirm-en-ticket-A.png')) })
report.shots.push({ id: 'D-zh', ...(await fullCardShot('zh', 'D-full-confirm-zh-ticket-A.png')) })

// Interaction: desktop+mobile summary has no Approve; View details opens A; Approve A; B unchanged
state.approveCalls = []
state.denyCalls = []
state.approvals = [structuredClone(APPR_A), structuredClone(APPR_B)]
{
  async function mockApi(page) {
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url())
      const method = route.request().method()
      if (url.pathname === '/api/health') return route.fulfill({ json: { status: 'ok' } })
      if (url.pathname === '/api/conversations/current') {
        return route.fulfill({
          json: { conversationId: 'conv_p1_matrix', title: 'Weekly metrics', createdAt: '2026-11-19T09:00:00.000Z' },
        })
      }
      if (url.pathname.endsWith('/timeline')) return route.fulfill({ json: timelineFor(state.approvals) })
      if (url.pathname === '/api/approvals' && method === 'GET') return route.fulfill({ json: state.approvals })
      const approveMatch = url.pathname.match(/^\/api\/approvals\/([^/]+)\/approve$/)
      if (approveMatch && method === 'POST') {
        const id = decodeURIComponent(approveMatch[1])
        state.approveCalls.push({ id, body: route.request().postData() })
        state.approvals = state.approvals.map((a) => (a.id === id ? { ...a, status: 'approved' } : a))
        return route.fulfill({ json: { id, status: 'approved' } })
      }
      return route.fulfill({ status: 404, json: { error: 'mocked' } })
    })
  }

  // Desktop: prove summary never exposes Approve
  const desk = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  await desk.addInitScript(() => localStorage.setItem('hamster.locale', 'en'))
  await mockApi(desk)
  await desk.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' })
  const noApproveDesktop =
    (await desk.locator('[data-testid="approval-summary"] [data-testid="approval-approve"]').count()) === 0 &&
    (await desk.locator('[data-testid="pending-approvals-dock"] [data-testid="approval-approve"]').count()) === 0
  await desk.close()

  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.addInitScript(() => localStorage.setItem('hamster.locale', 'en'))
  await mockApi(page)
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' })
  const noApproveOnSummary =
    (await page.locator('[data-testid="approval-summary"] [data-testid="approval-approve"]').count()) === 0
  await page.getByTestId('approval-view-details').click()
  await page.waitForURL(/\/approvals\?id=appr_p1_ticket_A/)
  await page.locator('[data-approval-id="appr_p1_ticket_A"][data-focused="true"]').waitFor()
  const fieldsOk = await page.evaluate(() => {
    const card = document.querySelector('[data-approval-id="appr_p1_ticket_A"]')
    const params = card?.querySelector('[data-testid="approval-full-params"]')?.innerText || ''
    const title = card?.querySelector('[data-testid="approval-full-task-title"]')?.innerText || ''
    const expires = card?.querySelector('[data-testid="approval-full-expires"]')?.innerText || ''
    return {
      asset: params.includes('asset_p1_metrics_A'),
      channel: params.includes('shared workspace'),
      redacted: params.includes('•••') && !params.includes('sk-should-redact'),
      title: title.includes('Weekly metrics dashboard'),
      expires: Boolean(expires),
    }
  })
  await page.locator('[data-approval-id="appr_p1_ticket_A"] [data-testid="approval-approve"]').click()
  await page.waitForTimeout(300)
  const bStillPending = state.approvals.find((a) => a.id === APPR_B.id)?.status === 'pending'
  const aApproved = state.approvals.find((a) => a.id === APPR_A.id)?.status === 'approved'
  report.interaction = {
    noApproveDesktop,
    noApproveOnSummary,
    navigatedExactId: true,
    fieldsOk,
    approveCalls: state.approveCalls,
    aApproved,
    bStillPending,
    pass:
      noApproveDesktop &&
      noApproveOnSummary &&
      fieldsOk.asset &&
      fieldsOk.channel &&
      fieldsOk.redacted &&
      fieldsOk.title &&
      fieldsOk.expires &&
      state.approveCalls.length === 1 &&
      state.approveCalls[0].id === APPR_A.id &&
      aApproved &&
      bStillPending,
  }
  await page.screenshot({ path: path.join(OUT, 'interaction-after-approve-A.png'), fullPage: false })
  await page.close()
}

await browser.close()
child.kill('SIGTERM')

report.pass = report.shots.every((s) => s.checks?.pass) && report.interaction?.pass
fs.writeFileSync(path.join(OUT, 'matrix-report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ pass: report.pass, interaction: report.interaction, shots: report.shots.map((s) => ({ id: s.id, pass: s.checks?.pass, shot: s.shot })) }, null, 2))
process.exit(report.pass ? 0 : 1)
