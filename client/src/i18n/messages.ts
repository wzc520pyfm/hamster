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
    expires: 'Expires',
    action: 'Action',
    params: 'Key params',
    backToConversation: 'Back to conversation',
    layoutNote: 'Layout stays mounted. Refresh re-fetches saved bindings only.',
    loading: 'Loading…',
    error: 'Something went wrong',
    needsReview: 'Needs review after process gap',
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
    expires: '有效期至',
    action: '动作',
    params: '关键参数',
    backToConversation: '返回对话',
    layoutNote: '布局保持挂载。刷新只按已保存绑定取数。',
    loading: '加载中…',
    error: '出错了',
    needsReview: '进程中断后需复核',
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
