import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ExpandableIdentifiers } from '@/components/ExpandableIdentifiers'
import { PendingApprovalDock } from '@/components/PendingApprovalDock'
import { TaskCard } from '@/components/TaskCard'
import { Button } from '@/components/ui/button'
import { getCopy, type Locale } from '@/i18n/messages'
import { api, isNetworkError, type Timeline, type TimelineMessage } from '@/lib/api'
import { cn } from '@/lib/utils'

export function ConversationPage({
  locale,
  conversationId,
  onApprovalsChanged,
  onNetworkError,
  connectionError = false,
}: {
  locale: Locale
  conversationId: string | null
  onApprovalsChanged: () => void
  onNetworkError?: () => void
  connectionError?: boolean
}) {
  const t = getCopy(locale)
  const [timeline, setTimeline] = useState<Timeline | null>(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [kbHeight, setKbHeight] = useState<number | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  const refresh = useCallback(async () => {
    if (!conversationId) return
    const next = await api.timeline(conversationId)
    setTimeline(next)
  }, [conversationId])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await refresh()
      } catch (err) {
        if (!cancelled) {
          if (isNetworkError(err)) onNetworkError?.()
          else setError(err instanceof Error ? err.message : String(err))
        }
      }
    })()
    const timer = setInterval(() => {
      void refresh().catch((err) => {
        if (isNetworkError(err)) onNetworkError?.()
      })
    }, 2500)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [refresh, onNetworkError])

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
      if (isNetworkError(err)) onNetworkError?.()
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
      className="flex min-h-0 flex-1 flex-col"
      style={kbHeight ? { height: `${kbHeight}px`, maxHeight: `${kbHeight}px` } : undefined}
      data-testid="conversation-column"
      data-conversation-id={conversationId ?? undefined}
    >
      <header className="shrink-0 border-b border-[var(--color-border)] px-3 py-2.5 md:px-4">
        <div className="mx-auto w-full max-w-[var(--reading-column)]">
          <h1 className="text-lg font-semibold tracking-tight text-[var(--color-foreground)]">
            {t.mainConversation}
          </h1>
          {conversationId ? (
            <ExpandableIdentifiers
              locale={locale}
              testId="conversation-identifiers"
              items={[{ label: 'conversationId', value: conversationId }]}
            />
          ) : null}
        </div>
      </header>

      <div
        className="min-h-0 flex-1 overflow-y-auto px-3 py-3 md:px-4"
        onScroll={(e) => {
          const el = e.currentTarget
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
      >
        <div className="mx-auto flex w-full max-w-[var(--reading-column)] flex-col gap-2.5">
          {!timeline || (timeline.messages.length === 0 && timeline.tasks.length === 0) ? (
            <p className="text-sm text-[var(--color-muted-foreground)] whitespace-normal">
              {t.noMessages}
            </p>
          ) : (
            renderTimeline(timeline.messages, taskById, locale, {
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
            })
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-chat-ground)] px-3 pt-2 md:px-4">
        <div className="mx-auto flex w-full max-w-[var(--reading-column)] flex-col gap-2">
          {/* One summary only — SUMMARY → full ticket on /approvals?id=… → CONFIRM. No Approve here. */}
          <PendingApprovalDock
            pending={pendingApprovals}
            locale={locale}
            onDeny={async (id) => {
              // Fail-closed when control channel unavailable — do not deny offline.
              if (connectionError) return
              await api.deny(id)
              await refresh()
              onApprovalsChanged()
            }}
          />

          {error && !connectionError ? (
            <div className="rounded-md border border-[#e2c4c4] bg-[#f8ecec] px-3 py-2 text-sm text-[var(--color-destructive)] whitespace-normal">
              {error}
            </div>
          ) : null}

          <form
            className="safe-area-bottom shrink-0 pb-3"
            data-testid="conversation-composer"
            onSubmit={(e) => {
              e.preventDefault()
              void send(text)
            }}
          >
            <div className="flex items-end gap-2 rounded-[var(--radius-composer)] border border-[var(--color-border)] bg-white/90 px-3 py-2 shadow-[0_1px_0_rgba(26,35,48,0.03)]">
              {/* Textarea so the full design-table placeholder can wrap on narrow widths. */}
              <textarea
                className="min-h-[2.75rem] min-w-0 flex-1 resize-none border-0 bg-transparent px-0.5 py-1.5 text-sm leading-snug outline-none focus:ring-0 sm:min-h-10"
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
              <Button
                type="submit"
                size="sm"
                className="mb-0.5 shrink-0 rounded-full"
                disabled={!conversationId || sending || !text.trim()}
                aria-label={t.send}
              >
                {t.send}
              </Button>
            </div>
          </form>
        </div>
      </div>
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
  const t = getCopy(locale)
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

    const isUser = message.role === 'user'
    nodes.push(
      <div
        key={message.id}
        role="article"
        data-testid="chat-bubble"
        data-role={message.role}
        aria-label={isUser ? t.messageRoleUser : t.messageRoleAssistant}
        className={cn(
          'max-w-[var(--bubble-max)] rounded-[var(--radius-bubble)] px-3.5 py-2 text-sm leading-relaxed',
          isUser
            ? 'ml-auto bg-[var(--color-bubble-user)] text-[var(--color-bubble-user-fg)]'
            : 'mr-auto bg-[var(--color-bubble-assistant)] text-[var(--color-bubble-assistant-fg)]',
        )}
      >
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
