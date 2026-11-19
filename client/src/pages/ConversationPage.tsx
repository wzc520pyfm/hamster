import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ApprovalCard } from '@/components/ApprovalCard'
import { TaskCard } from '@/components/TaskCard'
import { Button } from '@/components/ui/button'
import { getCopy, type Locale } from '@/i18n/messages'
import { api, isNetworkError, type Timeline, type TimelineMessage } from '@/lib/api'

export function ConversationPage({
  locale,
  conversationId,
  onApprovalsChanged,
}: {
  locale: Locale
  conversationId: string | null
  onApprovalsChanged: () => void
}) {
  const t = getCopy(locale)
  const [timeline, setTimeline] = useState<Timeline | null>(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connectionError, setConnectionError] = useState(false)
  const [kbHeight, setKbHeight] = useState<number | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  const refresh = useCallback(async () => {
    if (!conversationId) return
    const next = await api.timeline(conversationId)
    setTimeline(next)
  }, [conversationId])

  const retryConnection = useCallback(async () => {
    setConnectionError(false)
    await refresh()
  }, [refresh])

  useEffect(() => {
    let cancelled = false
    setConnectionError(false)
    ;(async () => {
      try {
        await refresh()
      } catch (err) {
        if (!cancelled) {
          if (isNetworkError(err)) setConnectionError(true)
          else setError(err instanceof Error ? err.message : String(err))
        }
      }
    })()
    const timer = setInterval(() => {
      void refresh().catch((err) => {
        if (isNetworkError(err)) setConnectionError(true)
      })
    }, 2500)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [refresh])

  // Keyboard rise (mobile virtual keyboard): shrink the composer column to the live
  // visual viewport so the composer and approval buttons stay usable.
  useEffect(() => {
    const vv = window.visualViewport ?? null
    if (!vv) return
    const update = () => {
      const height = vv.height
      setKbHeight(height > 0 && height < window.innerHeight - 1 ? Math.round(height) : null)
    }
    update()
    vv.addEventListener('resize', update)
    return () => vv.removeEventListener('resize', update)
  }, [])

  useEffect(() => {
    // Only auto-stick within the message list. Pending approvals live outside this scroller
    // (above the composer) so scrollIntoView must not drag Approve/Deny under the composer.
    if (stickToBottom.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [timeline?.messages.length, timeline?.tasks.length])

  const taskById = useMemo(() => {
    const map = new Map<string, Timeline['tasks'][number]>()
    for (const task of timeline?.tasks ?? []) map.set(task.taskId, task)
    return map
  }, [timeline])

  const pendingApprovals = (timeline?.approvals ?? []).filter((a) => a.status === 'pending')
  // Closed approvals still appear in the timeline/history path via TaskCard state; active
  // pending tickets are pinned above the composer so Deny / Approve stay reachable.

  async function send(raw: string) {
    if (!conversationId) return
    const value = raw.trim()
    if (!value) return
    setSending(true)
    setError(null)
    try {
      await api.sendMessage(conversationId, value)
      setText('')
      await refresh()
      onApprovalsChanged()
    } catch (err) {
      if (isNetworkError(err)) setConnectionError(true)
      else setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSending(false)
    }
  }

  return (
    // Narrow shell has a sticky top bar; keep the composer in the first viewport.
    // Keyboard-open state (mobile visual viewport) shrinks this column so the composer
    // and approval buttons stay usable instead of being pushed off-screen.
    <div
      className="flex min-h-0 flex-1 flex-col gap-3"
      style={kbHeight ? { height: `${kbHeight}px`, maxHeight: `${kbHeight}px` } : undefined}
      data-testid="conversation-column"
    >
      <header className="shrink-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)]/90 px-4 py-3 backdrop-blur">
        <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold">
          {t.mainConversation}
        </h1>
        {conversationId ? (
          <div className="mt-0.5 font-mono text-[11px] text-[var(--color-muted-foreground)]">
            conversationId: {conversationId}
          </div>
        ) : null}
      </header>

      <div
        className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-card)]/80 p-4"
        onScroll={(e) => {
          const el = e.currentTarget
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
      >
        {!timeline || (timeline.messages.length === 0 && timeline.tasks.length === 0) ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">{t.noMessages}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {renderTimeline(timeline.messages, taskById, locale, {
              onCheckProgress: (taskId) => void send(`progress ${taskId}`),
              onSteer: async (taskId, message) => {
                await api.steerTask(taskId, message)
                await refresh()
              },
              onCancel: async (taskId) => {
                await api.cancelTask(taskId)
                await refresh()
                onApprovalsChanged()
              },
            })}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Pending tickets stay outside the message scroller so Approve/Deny are not
          overflow-clipped or covered by the composer / install affordance. */}
      {pendingApprovals.length > 0 ? (
        <div
          className="flex shrink-0 flex-col gap-2"
          data-testid="pending-approvals-dock"
        >
          {pendingApprovals.map((a) => (
            <ApprovalCard
              key={a.id}
              approval={a}
              locale={locale}
              compact
              onApprove={async (id) => {
                await api.approve(id)
                await refresh()
                onApprovalsChanged()
              }}
              onDeny={async (id) => {
                await api.deny(id)
                await refresh()
                onApprovalsChanged()
              }}
            />
          ))}
        </div>
      ) : null}

      {connectionError ? (
        <div className="shrink-0 rounded-md border border-[#e2c4c4] bg-[#f8ecec] px-3 py-2 text-sm text-[var(--color-destructive)]">
          {t.connect}
          <div className="mt-2">
            <Button type="button" size="sm" variant="outline" onClick={() => void retryConnection()}>
              {t.retry}
            </Button>
          </div>
        </div>
      ) : error ? (
        <div className="rounded-md border border-[#e2c4c4] bg-[#f8ecec] px-3 py-2 text-sm text-[var(--color-destructive)]">
          {error}
        </div>
      ) : null}

      <form
        className="safe-area-bottom shrink-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3"
        onSubmit={(e) => {
          e.preventDefault()
          void send(text)
        }}
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          {/* Textarea so the full design-table placeholder can wrap on narrow widths. */}
          <textarea
            className="min-h-[2.75rem] min-w-0 flex-1 resize-none rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm leading-snug outline-none focus:ring-2 focus:ring-[var(--color-ring)] sm:min-h-10 sm:py-2.5"
            rows={pendingApprovals.length > 0 ? 2 : 3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t.composerPlaceholder}
            aria-label={t.composerPlaceholder}
            disabled={!conversationId || sending}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send(text)
              }
            }}
          />
          <Button type="submit" disabled={!conversationId || sending || !text.trim()}>
            {t.send}
          </Button>
        </div>
      </form>
    </div>
  )
}

function renderTimeline(
  messages: TimelineMessage[],
  taskById: Map<string, NonNullable<Timeline['tasks']>[number]>,
  locale: Locale,
  handlers: {
    onCheckProgress: (taskId: string) => void
    onSteer: (taskId: string, message: string) => Promise<void>
    onCancel: (taskId: string) => Promise<void>
  },
) {
  const seenTasks = new Set<string>()
  const nodes: ReactNode[] = []

  for (const message of messages) {
    const meta = message.meta ?? {}
    const taskId = typeof meta.taskId === 'string' ? meta.taskId : null
    if (meta.kind === 'task-created' && taskId && taskById.has(taskId) && !seenTasks.has(taskId)) {
      seenTasks.add(taskId)
      const task = taskById.get(taskId)!
      nodes.push(
        <TaskCard
          key={`task-${task.taskId}`}
          task={task}
          locale={locale}
          onCheckProgress={handlers.onCheckProgress}
          onSteer={handlers.onSteer}
          onCancel={handlers.onCancel}
        />,
      )
      continue
    }

    nodes.push(
      <div
        key={message.id}
        className={
          message.role === 'user'
            ? 'ml-8 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm'
            : 'mr-8 rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm'
        }
      >
        <div className="mb-1 text-[11px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
          {message.role}
        </div>
        <div className="whitespace-pre-wrap break-words">
          {displayMessageContent(message, taskById)}
        </div>
      </div>,
    )
  }

  // Tasks that exist but were not linked from a task-created message still show once.
  for (const task of taskById.values()) {
    if (seenTasks.has(task.taskId)) continue
    nodes.push(
      <TaskCard
        key={`task-${task.taskId}`}
        task={task}
        locale={locale}
        onCheckProgress={handlers.onCheckProgress}
        onSteer={handlers.onSteer}
        onCancel={handlers.onCancel}
      />,
    )
  }

  return nodes
}

/** Never show a bare “Task halted” line that can be misread against a still-Running card. */
function displayMessageContent(
  message: TimelineMessage,
  taskById: Map<string, Timeline['tasks'][number]>,
) {
  const content = message.content
  if (!/^Task halted:/i.test(content)) return content
  const taskId = typeof message.meta?.taskId === 'string' ? message.meta.taskId : null
  const task = taskId ? taskById.get(taskId) : null
  if (task) {
    return `Failed: “${task.title}” (${task.taskId}) — see that task’s card for the failure reason.`
  }
  return content.replace(/^Task halted:/i, 'Failed:')
}
