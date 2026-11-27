export type Locale = 'en' | 'zh'

export const TASK_STATUS = {
  queued: { en: 'Queued', zh: '排队' },
  running: { en: 'Running', zh: '运行中' },
  waiting_for_approval: { en: 'Waiting for approval', zh: '等待审批' },
  succeeded: { en: 'Succeeded', zh: '已成功' },
  failed: { en: 'Failed', zh: '已失败' },
  cancelled: { en: 'Cancelled', zh: '已取消' },
} as const

export const CONTROL_STATUS = {
  received: { en: 'Received', zh: '已收到' },
  pending_apply: { en: 'Pending apply', zh: '待应用' },
  applied: { en: 'Applied', zh: '已应用' },
} as const

export const APPROVAL_STATUS = {
  pending: { en: 'Needs approval', zh: '需要批准' },
  approved: { en: 'Approved for this action only', zh: '仅批准此次动作' },
  denied: { en: 'Denied', zh: '已拒绝' },
  expired: {
    en: 'Expired — not approved, so it did not run',
    zh: '已过期，未获批准，动作未执行',
  },
  invalidated: { en: 'Invalidated — approve again', zh: '已失效，请重新审批' },
} as const

export const FRESHNESS = {
  lastSucceeded: {
    en: (time: string) => `Last succeeded at ${time}`,
    zh: (time: string) => `上次成功：${time}`,
  },
  stale: {
    en: 'Stale — still showing last success',
    zh: '仍显示上次成功结果',
  },
  refreshFailed: {
    en: 'Refresh failed — still showing last success',
    zh: '刷新失败，仍保留上次成功结果',
  },
} as const

const copy = {
  en: {
    brand: 'Hamster',
    preview: 'Private preview',
    conversation: 'Conversation',
    dashboards: 'Dashboards',
    approvals: 'Approvals',
    pendingCount: (n: number) => `${n} pending`,
    mainConversation: 'Main conversation',
    composerPlaceholder: 'Message Hamster… Use “start task: …” to dispatch.',
    send: 'Send',
    checkProgress: 'Check progress',
    steer: 'Steer this task',
    cancel: 'Cancel this task',
    steerPrompt: 'Steer instruction for this task',
    openDashboard: 'Open dashboard',
    noMessages: 'No messages yet. Dispatch a task or ask a question.',
    noDashboards: 'No dashboards yet.',
    noApprovals: 'No approvals in this view.',
    deny: 'Deny',
    approveThisAction: 'Approve this action',
    refresh: 'Refresh',
    retry: 'Retry',
    source: 'Source',
    assetId: 'assetId',
    taskId: 'taskId',
    runtimeSessionId: 'runtimeSessionId',
    controlReceipt: 'Control receipt',
    events: 'Persisted events',
    updatesCount: (n: number) => `${n} updates`,
    expires: 'Expires',
    action: 'Action',
    params: 'Key params',
    backToConversation: 'Back to conversation',
    layoutNote: 'Layout stays mounted. Refresh re-fetches saved bindings only.',
    loading: 'Loading…',
    connecting: 'Connecting…',
    error: 'Something went wrong',
    failureReason: 'Failure reason',
    openMenu: 'Menu',
    closeMenu: 'Close menu',
    updateAvailable: 'A new version of Hamster is available.',
    reloadToUpdate: 'Reload',
    dismissUpdate: 'Not now',
    updateRetryNeeded:
      'Update did not finish. Your current page was kept. You can try Reload again.',
    updateRetryAction: 'Try Reload again',
    connect: "Can't reach this Hamster",
    connectGateTitle: 'Connect to Hamster',
    connectAction: 'Connect',
    connectAddressLabel: 'Client origin',
    installTitle: 'Install Hamster',
    installBody: 'Add Hamster to your home screen for full-screen use.',
    installAction: 'Install',
    dismissInstall: 'Dismiss',
    viewDetails: 'View details',
    morePending: (n: number) => (n === 1 ? '1 more pending' : `${n} more pending`),
    openPendingApprovals: 'Open pending approvals',
    approvalTarget: 'Target',
    showIdentifiers: 'Show identifiers',
    hideIdentifiers: 'Hide identifiers',
    copy: 'Copy',
    messageRoleUser: 'User',
    messageRoleAssistant: 'Assistant',
  },
  zh: {
    brand: 'Hamster',
    preview: 'Private preview',
    conversation: '对话',
    dashboards: 'Dashboard 库',
    approvals: '待审批',
    pendingCount: (n: number) => `${n} 待处理`,
    mainConversation: '主对话',
    composerPlaceholder: '给 Hamster 发消息… 用 “start task: …” 派发任务。',
    send: '发送',
    checkProgress: '查看进度',
    steer: '转向此任务',
    cancel: '取消此任务',
    steerPrompt: '对此任务的转向指令',
    openDashboard: '打开 Dashboard',
    noMessages: '还没有消息。可以派发任务或直接提问。',
    noDashboards: '还没有 Dashboard。',
    noApprovals: '此视图没有审批项。',
    deny: '拒绝',
    approveThisAction: '批准此次动作',
    refresh: '刷新',
    retry: '重试',
    source: '数据来源',
    assetId: 'assetId',
    taskId: 'taskId',
    runtimeSessionId: 'runtimeSessionId',
    controlReceipt: '控制回执',
    events: '持久事件',
    updatesCount: (n: number) => `${n} 条更新`,
    expires: '有效期至',
    action: '动作',
    params: '关键参数',
    backToConversation: '返回对话',
    layoutNote: '布局保持挂载。刷新只按已保存绑定取数。',
    loading: '加载中…',
    connecting: '正在连接…',
    error: '出错了',
    failureReason: '失败原因',
    openMenu: '菜单',
    closeMenu: '关闭菜单',
    updateAvailable: 'Hamster 有新版本可用。',
    reloadToUpdate: '重新加载',
    dismissUpdate: '暂不',
    updateRetryNeeded: '更新未完成。当前页面已保留，可以再次尝试重新加载。',
    updateRetryAction: '再次重新加载',
    connect: '无法连接',
    connectGateTitle: '连接Hamster',
    connectAction: '连接',
    connectAddressLabel: '客户端源地址',
    installTitle: '安装 Hamster',
    installBody: '把 Hamster 加到主屏幕以使用全屏模式。',
    installAction: '安装',
    dismissInstall: '关闭',
    viewDetails: '查看详情',
    morePending: (n: number) => `还有 ${n} 项待审批`,
    openPendingApprovals: '打开待审批',
    approvalTarget: '目标',
    showIdentifiers: '显示标识',
    hideIdentifiers: '隐藏标识',
    copy: '复制',
    messageRoleUser: '用户',
    messageRoleAssistant: '助手',
  },
} as const

export type Copy = {
  [K in keyof typeof copy.en]: (typeof copy.en)[K]
}

export function getCopy(locale: Locale): Copy {
  return copy[locale] as Copy
}

export function taskStatusLabel(status: keyof typeof TASK_STATUS, locale: Locale) {
  return TASK_STATUS[status][locale]
}

export function controlStatusLabel(status: keyof typeof CONTROL_STATUS, locale: Locale) {
  return CONTROL_STATUS[status][locale]
}

export function approvalStatusLabel(status: keyof typeof APPROVAL_STATUS, locale: Locale) {
  return APPROVAL_STATUS[status][locale]
}

/**
 * Design-table closed-state decision copy for an approval ticket, in the
 * active locale. Exact pairs only (no synonyms):
 * - Approved for this action only / 仅批准此次动作
 * - Denied / 已拒绝
 * - Expired — not approved, so it did not run / 已过期，未获批准，动作未执行
 * - Invalidated — approve again / 已失效，请重新审批
 * Returns null for pending / unknown states (no decision sentence yet).
 */
export function approvalDecisionCopy(
  status: keyof typeof APPROVAL_STATUS,
  locale: Locale,
): string | null {
  switch (status) {
    case 'approved':
      return APPROVAL_STATUS.approved[locale]
    case 'denied':
      return APPROVAL_STATUS.denied[locale]
    case 'expired':
      return APPROVAL_STATUS.expired[locale]
    case 'invalidated':
      return APPROVAL_STATUS.invalidated[locale]
    default:
      return null
  }
}

export function freshnessLabel(
  freshness: 'fresh' | 'stale' | 'refresh_failed',
  lastSuccessAt: string | null,
  locale: Locale,
  localeTag: string,
) {
  const time = lastSuccessAt
    ? new Intl.DateTimeFormat(localeTag, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(lastSuccessAt),
      )
    : '—'
  if (freshness === 'refresh_failed') return FRESHNESS.refreshFailed[locale]
  if (freshness === 'stale') return FRESHNESS.stale[locale]
  return FRESHNESS.lastSucceeded[locale](time)
}

/** Plain-language approval titles — never show raw tool ids as the card title. */
export function approvalActionLabel(
  action: string,
  params: Record<string, unknown> | null | undefined,
  locale: Locale,
): string {
  const channel =
    typeof params?.channel === 'string' && params.channel.trim() ? params.channel.trim() : null
  switch (action) {
    case 'publish_dashboard':
      return locale === 'zh'
        ? channel
          ? `将此 Dashboard 发布到${channel}`
          : '发布此 Dashboard'
        : channel
          ? `Publish this dashboard to ${channel}`
          : 'Publish this dashboard'
    case 'save_dashboard_page':
      return locale === 'zh' ? '保存 Dashboard 页面' : 'Save the dashboard page'
    case 'create_or_start_isolated_desktop':
    case 'start_isolated_desktop':
      return locale === 'zh'
        ? '创建或启动隔离桌面'
        : 'Create or start the isolated desktop'
    case 'unknown_action':
    case '':
    case undefined:
      return locale === 'zh' ? '未知动作（需要批准）' : 'An unknown action (needs approval)'
    default:
      // Unknown tool id: say so in plain words, do not echo the identifier as the title.
      return locale === 'zh' ? '未知动作（需要批准）' : 'An unknown action (needs approval)'
  }
}
