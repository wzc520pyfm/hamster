/**
 * Shell hierarchy pass — locked copy + structure contracts (no React mount).
 * Official EN/ZH strings must stay verbatim; approval dock must not expose Approve.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const src = (...parts) => path.join(root, 'src', ...parts)

function read(rel) {
  return fs.readFileSync(src(...rel.split('/')), 'utf8')
}

test('official EN/ZH task / control / approval / freshness copy stay locked', async () => {
  const {
    TASK_STATUS,
    CONTROL_STATUS,
    APPROVAL_STATUS,
    FRESHNESS,
    getCopy,
    approvalActionLabel,
  } = await import('./messages.ts')

  assert.equal(TASK_STATUS.queued.en, 'Queued')
  assert.equal(TASK_STATUS.queued.zh, '排队')
  assert.equal(TASK_STATUS.running.en, 'Running')
  assert.equal(TASK_STATUS.running.zh, '运行中')
  assert.equal(TASK_STATUS.waiting_for_approval.en, 'Waiting for approval')
  assert.equal(TASK_STATUS.waiting_for_approval.zh, '等待审批')
  assert.equal(TASK_STATUS.succeeded.en, 'Succeeded')
  assert.equal(TASK_STATUS.succeeded.zh, '已成功')
  assert.equal(TASK_STATUS.failed.en, 'Failed')
  assert.equal(TASK_STATUS.failed.zh, '已失败')
  assert.equal(TASK_STATUS.cancelled.en, 'Cancelled')
  assert.equal(TASK_STATUS.cancelled.zh, '已取消')

  assert.equal(CONTROL_STATUS.received.en, 'Received')
  assert.equal(CONTROL_STATUS.received.zh, '已收到')
  assert.equal(CONTROL_STATUS.pending_apply.en, 'Pending apply')
  assert.equal(CONTROL_STATUS.pending_apply.zh, '待应用')
  assert.equal(CONTROL_STATUS.applied.en, 'Applied')
  assert.equal(CONTROL_STATUS.applied.zh, '已应用')

  assert.equal(APPROVAL_STATUS.pending.en, 'Needs approval')
  assert.equal(APPROVAL_STATUS.pending.zh, '需要批准')
  assert.equal(APPROVAL_STATUS.approved.en, 'Approved for this action only')
  assert.equal(APPROVAL_STATUS.approved.zh, '仅批准此次动作')
  assert.equal(APPROVAL_STATUS.denied.en, 'Denied')
  assert.equal(APPROVAL_STATUS.denied.zh, '已拒绝')
  assert.equal(
    APPROVAL_STATUS.expired.en,
    'Expired — not approved, so it did not run',
  )
  assert.equal(APPROVAL_STATUS.expired.zh, '已过期，未获批准，动作未执行')
  assert.equal(APPROVAL_STATUS.invalidated.en, 'Invalidated — approve again')
  assert.equal(APPROVAL_STATUS.invalidated.zh, '已失效，请重新审批')

  assert.equal(FRESHNESS.stale.en, 'Stale — still showing last success')
  assert.equal(FRESHNESS.stale.zh, '仍显示上次成功结果')
  assert.equal(
    FRESHNESS.refreshFailed.en,
    'Refresh failed — still showing last success',
  )
  assert.equal(FRESHNESS.refreshFailed.zh, '刷新失败，仍保留上次成功结果')
  assert.match(FRESHNESS.lastSucceeded.en('noon'), /Last succeeded at noon/)
  assert.match(FRESHNESS.lastSucceeded.zh('中午'), /上次成功：中午/)

  const en = getCopy('en')
  const zh = getCopy('zh')
  assert.equal(en.send, 'Send')
  assert.equal(zh.send, '发送')
  assert.equal(en.deny, 'Deny')
  assert.equal(zh.deny, '拒绝')
  assert.equal(en.approveThisAction, 'Approve this action')
  assert.equal(zh.approveThisAction, '批准此次动作')
  assert.equal(en.viewDetails, 'View details')
  assert.equal(zh.viewDetails, '查看详情')
  assert.equal(en.checkProgress, 'Check progress')
  assert.equal(zh.checkProgress, '查看进度')
  assert.equal(en.cancel, 'Cancel this task')
  assert.equal(zh.cancel, '取消此任务')
  assert.equal(en.steer, 'Steer this task')
  assert.equal(zh.steer, '转向此任务')
  assert.equal(en.openDashboard, 'Open dashboard')
  assert.equal(zh.openDashboard, '打开 Dashboard')
  assert.equal(
    en.composerPlaceholder,
    'Message Hamster… Use “start task: …” to dispatch.',
  )
  assert.equal(
    zh.composerPlaceholder,
    '给 Hamster 发消息… 用 “start task: …” 派发任务。',
  )
  assert.equal(
    en.noMessages,
    'No messages yet. Dispatch a task or ask a question.',
  )
  assert.equal(zh.noMessages, '还没有消息。可以派发任务或直接提问。')
  assert.equal(en.preview, 'Private preview')
  assert.equal(zh.preview, 'Private preview')
  assert.equal(en.connectGateTitle, 'Connect to Hamster')
  assert.equal(zh.connectGateTitle, '连接Hamster')
  assert.equal(en.connectAddressLabel, 'Client origin')
  assert.equal(zh.connectAddressLabel, '客户端源地址')
  assert.equal(en.connecting, 'Connecting…')
  assert.equal(zh.connecting, '正在连接…')
  assert.equal(en.updatesCount(3), '3 updates')
  assert.equal(zh.updatesCount(3), '3 条更新')
  assert.equal(
    approvalActionLabel('create_or_start_isolated_desktop', null, 'en'),
    'Create or start the isolated desktop',
  )
  assert.equal(
    approvalActionLabel('create_or_start_isolated_desktop', null, 'zh'),
    '创建或启动隔离桌面',
  )

  // Forbidden PiBot-style permission copy must never appear.
  const messagesSrc = read('i18n/messages.ts')
  for (const banned of ['Allow this time', 'Always allow', 'Approve all', 'Full Access']) {
    assert.equal(messagesSrc.includes(banned), false, `banned copy present: ${banned}`)
  }
})

test('shell is full-bleed: no max-w-6xl / md:p-4 centering card stage', () => {
  const shell = read('components/Shell.tsx')
  assert.equal(shell.includes('max-w-6xl'), false)
  assert.equal(shell.includes('md:p-4'), false)
  assert.equal(shell.includes('md:gap-4'), false)
  assert.match(shell, /data-shell-fullbleed="true"/)
  assert.match(shell, /--shell-sidebar-width/)
  assert.match(shell, /border-r border-\[var\(--color-border\)\]/)
})

test('conversation messages are bubbles without visible USER/ASSISTANT labels', () => {
  const page = read('pages/ConversationPage.tsx')
  // Role may appear in data-role / aria-label wiring, but not as a visible text node.
  assert.equal(page.includes('>{message.role}<'), false)
  assert.equal(page.includes('uppercase tracking-wide'), false)
  assert.match(page, /data-testid="chat-bubble"/)
  assert.match(page, /aria-label=\{isUser \? t\.messageRoleUser : t\.messageRoleAssistant\}/)
  assert.match(page, /color-bubble-user/)
  assert.match(page, /color-bubble-assistant/)
  assert.match(page, /radius-composer/)
  assert.match(page, /data-testid="conversation-composer"/)
  assert.match(page, /ExpandableIdentifiers/)
  assert.match(page, /data-conversation-id/)
})

test('task cards collapse ids, keep failure + receipts visible, use N updates', () => {
  const card = read('components/TaskCard.tsx')
  assert.match(card, /data-testid="task-card"/)
  assert.match(card, /ExpandableIdentifiers/)
  assert.match(card, /data-testid="task-failure-reason"/)
  assert.match(card, /data-testid="task-control-receipt"/)
  assert.match(card, /t\.updatesCount/)
  assert.equal(card.includes('t.events'), false)
  assert.equal(/#{ev\.seq}/.test(card), false)
  assert.match(card, /t\.checkProgress/)
  assert.match(card, /t\.cancel/)
  assert.match(card, /t\.steer/)
  assert.match(card, /t\.openDashboard/)
})

test('approval dock has View details + Deny only; full card Deny then Approve', () => {
  const dock = read('components/PendingApprovalDock.tsx')
  const full = read('components/ApprovalCard.tsx')

  assert.match(dock, /data-testid="pending-approvals-dock"/)
  assert.match(dock, /max-h-\[min\(28vh,16rem\)\]/)
  assert.match(dock, /approval-view-details/)
  assert.match(dock, /approval-deny/)
  assert.equal(dock.includes('approval-approve'), false)
  assert.equal(dock.includes('approveThisAction'), false)
  assert.match(dock, /\/approvals\?id=/)

  assert.match(full, /data-testid="approval-full-action"/)
  assert.match(full, /data-testid="approval-full-params"/)
  assert.match(full, /data-testid="approval-full-expires"/)
  assert.match(full, /data-testid="approval-actions"/)
  assert.match(full, /data-testid="approval-deny"/)
  assert.match(full, /data-testid="approval-approve"/)
  assert.match(full, /ExpandableIdentifiers/)

  const actionsIdx = full.indexOf('data-testid="approval-actions"')
  const denyIdx = full.indexOf('data-testid="approval-deny"', actionsIdx)
  const approveIdx = full.indexOf('data-testid="approval-approve"', actionsIdx)
  assert.ok(actionsIdx > 0)
  assert.ok(denyIdx > actionsIdx)
  assert.ok(approveIdx > denyIdx)

  // Primary button stays steel; no PiBot blues / green-check affordances in this card.
  assert.equal(full.includes('#1084fe'), false)
  assert.equal(full.includes('#0c64c1'), false)
  assert.equal(full.includes('#9159fe'), false)
})

test('dashboard / assets / approvals pages share reading-column shell chrome', () => {
  const assets = read('pages/AssetsLibraryPage.tsx')
  const approvals = read('pages/ApprovalsPage.tsx')
  const dash = read('components/DashboardView.tsx')
  for (const src of [assets, approvals, dash]) {
    assert.match(src, /--reading-column/)
    assert.equal(src.includes('font-[family-name:var(--font-display)]'), false)
  }
  assert.match(dash, /freshnessLabel/)
  assert.match(dash, /ExpandableIdentifiers/)
})

test('tokens: steel palette, system font stack, Fraunces only as display token', () => {
  const css = read('index.css')
  assert.match(css, /--color-primary: #2c4f73/)
  assert.match(css, /--color-primary-foreground: #f7fbff/)
  assert.match(css, /--color-background: #f3f6f9/)
  assert.match(css, /--color-wash: #eef3f7/)
  assert.match(css, /--color-destructive: #8b3a3a/)
  assert.match(css, /-apple-system/)
  assert.match(css, /--font-display: "Fraunces"/)
  assert.match(css, /--radius-composer: 1\.5rem/)
  assert.match(css, /--bubble-max: 36rem/)
  assert.equal(css.includes('radial-gradient(1200px'), false)
})
