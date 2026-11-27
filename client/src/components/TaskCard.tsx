import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ExpandableIdentifiers } from '@/components/ExpandableIdentifiers'
import { ControlStatusLabel, TaskStatusLabel } from '@/components/StatusLabel'
import { Button } from '@/components/ui/button'
import { getCopy, type Locale } from '@/i18n/messages'
import type { TaskDetail } from '@/lib/api'
import { formatTime } from '@/lib/utils'

export function TaskCard({
  task,
  locale,
  onCheckProgress,
  onSteer,
  onCancel,
}: {
  task: TaskDetail
  locale: Locale
  onCheckProgress: (taskId: string) => void
  onSteer: (taskId: string, message: string) => Promise<void>
  onCancel: (taskId: string) => Promise<void>
}) {
  const t = getCopy(locale)
  const [steerText, setSteerText] = useState('')
  const [busy, setBusy] = useState(false)
  const [earlierOpen, setEarlierOpen] = useState(false)
  const terminal = ['succeeded', 'failed', 'cancelled'].includes(task.status)
  const latestControl = task.controls.at(-1)
  const failureReason =
    task.failureReason ||
    [...task.events].reverse().find((e) => e.kind === 'failure')?.message ||
    null

  // Default: latest one or two updates; earlier events behind locked “N updates” / “N 条更新”.
  const visibleCount = task.events.length <= 2 ? task.events.length : 2
  const recentEvents = task.events.slice(-visibleCount)
  const earlierEvents = task.events.slice(0, Math.max(0, task.events.length - visibleCount))

  return (
    <article
      className="w-full rounded-lg border border-[var(--color-border)] bg-white px-3.5 py-3 shadow-[0_1px_0_rgba(26,35,48,0.03)]"
      data-testid="task-card"
      style={{ animation: 'card-in 360ms ease-out' }}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-base font-semibold leading-snug text-[var(--color-foreground)]">
            {task.title}
          </h3>
          <ExpandableIdentifiers
            locale={locale}
            testId="task-identifiers"
            items={[
              { label: t.taskId, value: task.taskId },
              ...(task.runtimeSessionId
                ? [{ label: t.runtimeSessionId, value: task.runtimeSessionId }]
                : []),
            ]}
          />
        </div>
        <div className="flex flex-col items-end gap-1">
          <TaskStatusLabel status={task.status} locale={locale} />
        </div>
      </header>

      {task.status === 'failed' && failureReason ? (
        <div
          className="mt-3 rounded-md border border-[#e2c4c4] bg-[#f8ecec] px-2.5 py-2 text-sm text-[var(--color-destructive)]"
          data-testid="task-failure-reason"
        >
          <div className="text-xs font-medium text-[var(--color-muted-foreground)]">
            {t.failureReason}
          </div>
          <div className="mt-0.5 whitespace-normal">
            <span className="font-medium">{task.title}</span>
            <span> — {failureReason}</span>
          </div>
        </div>
      ) : null}

      {task.events.length > 0 ? (
        <div className="mt-3" data-testid="task-updates">
          <ol className="flex flex-col gap-1.5">
            {recentEvents.map((ev) => (
              <li
                key={ev.seq}
                className="rounded-md bg-[var(--color-muted)]/50 px-2.5 py-1.5 text-sm whitespace-normal"
                data-testid="task-update-recent"
              >
                {ev.message}
              </li>
            ))}
          </ol>
          {earlierEvents.length > 0 ? (
            <div className="mt-2">
              <button
                type="button"
                className="text-xs font-medium text-[var(--color-muted-foreground)] underline-offset-2 hover:underline"
                aria-expanded={earlierOpen}
                data-testid="task-updates-toggle"
                onClick={() => setEarlierOpen((v) => !v)}
              >
                {t.updatesCount(earlierEvents.length)}
              </button>
              {earlierOpen ? (
                <ol className="mt-1.5 flex flex-col gap-1.5" data-testid="task-updates-earlier">
                  {earlierEvents.map((ev) => (
                    <li
                      key={ev.seq}
                      className="rounded-md bg-[var(--color-muted)]/40 px-2.5 py-1.5 text-sm text-[var(--color-muted-foreground)] whitespace-normal"
                    >
                      {ev.message}
                    </li>
                  ))}
                </ol>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {latestControl ? (
        <div
          className="mt-3 flex flex-wrap items-center gap-2 text-sm"
          data-testid="task-control-receipt"
        >
          <span className="text-[var(--color-muted-foreground)]">{t.controlReceipt}</span>
          <ControlStatusLabel status={latestControl.status} locale={locale} />
          {latestControl.type === 'steer' && latestControl.payload?.message ? (
            <span className="text-[var(--color-muted-foreground)] whitespace-normal">
              — {latestControl.payload.message}
            </span>
          ) : null}
        </div>
      ) : null}

      {task.assetId ? (
        <div className="mt-3">
          <Button asChild variant="outline" size="sm">
            <Link to={`/assets/${task.assetId}`}>{t.openDashboard}</Link>
          </Button>
        </div>
      ) : null}

      <div className="mt-3 flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => onCheckProgress(task.taskId)}
          >
            {t.checkProgress}
          </Button>
          {!terminal ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await onCancel(task.taskId)
                } finally {
                  setBusy(false)
                }
              }}
            >
              {t.cancel}
            </Button>
          ) : null}
        </div>

        {!terminal ? (
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={async (e) => {
              e.preventDefault()
              const message = steerText.trim()
              if (!message) return
              setBusy(true)
              try {
                await onSteer(task.taskId, message)
                setSteerText('')
              } finally {
                setBusy(false)
              }
            }}
          >
            <input
              className="h-8 min-w-0 flex-1 rounded-md border border-[var(--color-border)] bg-white px-2.5 text-sm outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
              value={steerText}
              onChange={(e) => setSteerText(e.target.value)}
              placeholder={t.steerPrompt}
              aria-label={t.steerPrompt}
            />
            <Button type="submit" size="sm" disabled={busy || !steerText.trim()}>
              {t.steer}
            </Button>
          </form>
        ) : null}
      </div>

      <footer className="mt-2.5 text-xs text-[var(--color-muted-foreground)]">
        {formatTime(task.updatedAt, locale === 'zh' ? 'zh-CN' : 'en-US')}
      </footer>

      <style>{`
        @keyframes card-in {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </article>
  )
}
