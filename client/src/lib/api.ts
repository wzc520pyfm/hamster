const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') || ''

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = { raw: text }
  }
  if (!res.ok) {
    const err = new Error(
      (body as { error?: string; detail?: string } | null)?.detail ||
        (body as { error?: string } | null)?.error ||
        `HTTP ${res.status}`,
    )
    ;(err as Error & { status?: number; body?: unknown }).status = res.status
    ;(err as Error & { status?: number; body?: unknown }).body = body
    throw err
  }
  return body as T
}

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'waiting_for_approval'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export type ControlStatus = 'received' | 'pending_apply' | 'applied'

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'invalidated'

export type Freshness = 'fresh' | 'stale' | 'refresh_failed'

export interface TaskEvent {
  seq: number
  kind: string
  message: string
  step: number | null
  total: number | null
  created_at: string
}

export interface TaskControl {
  control_seq: number
  type: 'steer' | 'cancel'
  payload: { message?: string }
  status: ControlStatus
  created_at: string
  applied_at: string | null
}

export interface Approval {
  id: string
  taskId: string
  taskTitle?: string
  action: string
  params: Record<string, unknown>
  status: ApprovalStatus
  expiresAt?: string
  expires_at?: string
  decidedAt?: string | null
  decided_at?: string | null
  decisionNote?: string | null
  decision_note?: string | null
  requestedAt?: string
  requested_at?: string
}

export interface TaskDetail {
  taskId: string
  conversationId: string
  runtimeSessionId: string | null
  assetId: string | null
  title: string
  status: TaskStatus
  controlSeq: number
  createdAt: string
  updatedAt: string
  cancelRequestedAt: string | null
  events: TaskEvent[]
  controls: TaskControl[]
  approvals: Approval[]
  failureReason?: string | null
}

export interface TimelineMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  meta: Record<string, unknown>
  createdAt: string
}

export interface Timeline {
  conversationId: string
  messages: TimelineMessage[]
  tasks: TaskDetail[]
  approvals: Approval[]
}

export interface AssetSummary {
  assetId: string
  taskId: string | null
  conversationId: string | null
  title: string
  source: string
  layoutVersion: number
  freshness: Freshness
  lastSuccessAt: string | null
  lastError: string | null
  publishedAt: string | null
  publishedChannel: string | null
  createdAt: string
}

export interface AssetDetail extends AssetSummary {
  openui: string
  bindings: Array<{ query: string; args?: Record<string, unknown> }>
  data: {
    kpis: Array<{ label: string; value: string; delta: string }>
    rows: Array<{
      week: string
      sessions: number
      signups: number
      conversion: string
      exceptions: number
    }>
  }
}

/**
 * True when the failure came from a fetch-level network error (no HTTP response was
 * received). The design-table wording for that disconnected state is `Can't reach this
 * Hamster` / `无法连接` (see i18n `connect`). HTTP error responses keep their status.
 */
export function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError
}

export const api = {
  health: () => request<{ status: string }>('/api/health'),
  currentConversation: () =>
    request<{ conversationId: string; title: string; createdAt: string }>(
      '/api/conversations/current',
    ),
  timeline: (conversationId: string) =>
    request<Timeline>(`/api/conversations/${encodeURIComponent(conversationId)}/timeline`),
  sendMessage: (conversationId: string, text: string) =>
    request<{ kind: string; reply?: string; task?: TaskDetail }>(
      `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
      { method: 'POST', body: JSON.stringify({ text }) },
    ),
  getTask: (taskId: string) => request<TaskDetail>(`/api/tasks/${encodeURIComponent(taskId)}`),
  steerTask: (taskId: string, message: string) =>
    request<{ taskId: string; controlSeq: number; receipt: ControlStatus }>(
      `/api/tasks/${encodeURIComponent(taskId)}/steer`,
      { method: 'POST', body: JSON.stringify({ message }) },
    ),
  cancelTask: (taskId: string) =>
    request<{ taskId: string; status: string; controlSeq: number }>(
      `/api/tasks/${encodeURIComponent(taskId)}/cancel`,
      { method: 'POST', body: JSON.stringify({}) },
    ),
  listAssets: () => request<AssetSummary[]>('/api/assets'),
  getAsset: (assetId: string) =>
    request<AssetDetail>(`/api/assets/${encodeURIComponent(assetId)}`),
  refreshAsset: (assetId: string) =>
    request<{ ok: boolean; error?: string; assetId: string }>(
      `/api/assets/${encodeURIComponent(assetId)}/refresh`,
      { method: 'POST', body: JSON.stringify({}) },
    ),
  listApprovals: (status?: string) =>
    request<Approval[]>(`/api/approvals${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  approve: (id: string) =>
    request<{ id: string; status: string }>(`/api/approvals/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
      body: JSON.stringify({ decidedBy: 'local-user' }),
    }),
  deny: (id: string) =>
    request<{ id: string; status: string }>(`/api/approvals/${encodeURIComponent(id)}/deny`, {
      method: 'POST',
      body: JSON.stringify({ decidedBy: 'local-user' }),
    }),
}
