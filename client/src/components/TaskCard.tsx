import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ControlStatusLabel, TaskStatusLabel } from '@/components/StatusLabel'
import { Button } from '@/components/ui/button'
import { getCopy, type Locale } from '@/i18n/messages'
import {
  taskRunState,
  taskRunTargetLabel,
  showUnstartedIsolatedActions,
  type TaskRunState,
} from '@/lib/runTarget'
import type { TaskDetail } from '@/lib/api'
import { formatTime } from '@/lib/utils'

export function TaskCard({
  task,
  locale,
  onCheckProgress,
  onSteer,
  onCancel,
  onRetry,
  onUseControlPlane,
}: {
  task: TaskDetail
  locale: Locale
  onCheckProgress: (taskId: string) => void
  onSteer: (taskId: string, message: string) => Promise<void>
  onCancel: (taskId: string) => Promise<void>
  /** Re-attempt the task's execution target (high-risk create/start re-issued as a ticket). */
  onRetry?: (taskId: string) => Promise<void>
  /** Explicitly move an unstarted task back to the control plane. Not Steer/Cancel. */
  onUseControlPlane?: (taskId: string) => Promise<void>
}) {
  const t = getCopy(locale)
  const [steerText, setSteerText] = useState('')
  const [busy, setBusy] = useState(false)
  const terminal = ['succeeded', 'failed', 'cancelled'].includes(task.status)
  const runState: TaskRunState = taskRunState(task)
  const latestControl = task.controls.at(-1)
  const failureReason =
    task.failureReason ||
    [...task.events].reverse().find((e) => e.kind === 'failure')?.message ||
    null

  return (
    <article
      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 shadow-[0_1px_0_rgba(26,35,48,0.04)]"
      style={{ animation: 'card-in 360ms ease-out' }}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-base font-semibold leading-snug">{task.title}</h3>
          <div className="mt-1 font-mono text-[11px] text-[var(--color-muted-foreground)]">
            {t.taskId}: {task.taskId}
          </div>
          {task.runtimeSessionId ? (
            <div className="font-mono text-[11px] text-[var(--color-muted-foreground)]">
              {t.runtimeSessionId}: {task.runtimeSessionId}
            </div>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-1">
          <TaskStatusLabel status={task.status} locale={locale} />
        </div>
      </header>

      <div
        className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
        data-testid="task-run-on"
      >
        <span className="text-[var(--color-muted-foreground)]">{t.runOn}:</span>
        <span className="font-medium" data-testid="task-run-on-label">
          {taskRunTargetLabel(task, locale)}
        </span>
        <span className="font-mono text-[11px] text-[var(--color-muted-foreground)]">{task.targetId}</span>
      </div>

      {runState === 'start_failed' ? (
        <div
          className="mt-2 rounded-md border border-[#e2d3b3] bg-[#f8f1e4] px-2.5 py-2 text-sm text-[#6b5428]"
          data-testid="task-isolated-start-failed"
        >
          <div className="font-medium">{t.isolatedDesktopStartFailed}</div>
        </div>
      ) : null}

      {showUnstartedIsolatedActions(runState, task.status) ? (
        <div className="mt-2 flex flex-wrap gap-2" data-testid="task-unstarted-actions">
          {onRetry ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await onRetry(task.taskId)
                } finally {
                  setBusy(false)
                }
              }}
              data-testid="task-isolated-retry"
            >
              {t.retry}
            </Button>
          ) : null}
          {onUseControlPlane ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await onUseControlPlane(task.taskId)
                } finally {
                  setBusy(false)
                }
              }}
              data-testid="task-use-control-plane"
            >
              {t.useControlPlaneInstead}
            </Button>
          ) : null}
        </div>
      ) : null}

      {runState === 'stopped' ? (
        <div
          className="mt-2 rounded-md border border-[#e2c4c4] bg-[#f8ecec] px-2.5 py-2 text-sm text-[var(--color-destructive)]"
          data-testid="task-isolated-stopped"
        >
          {t.isolatedDesktopStopped}
        </div>
      ) : null}

      {task.status === 'failed' && failureReason ? (
        <div className="mt-3 rounded-md border border-[#e2c4c4] bg-[#f8ecec] px-2.5 py-2 text-sm text-[var(--color-destructive)]">
          <div className="text-xs font-medium text-[var(--color-muted-foreground)]">
            {t.failureReason}
          </div>
          <div className="mt-0.5">
            <span className="font-medium">{task.title}</span>
            <span> — {failureReason}</span>
          </div>
        </div>
      ) : null}

      {task.events.length > 0 ? (
        <div className="mt-3">
          <div className="mb-1 text-xs font-medium text-[var(--color-muted-foreground)]">
            {t.events}
          </div>
          <ol className="flex flex-col gap-1.5">
            {task.events.map((ev) => (
              <li
                key={ev.seq}
                className="rounded-md bg-[var(--color-muted)]/60 px-2.5 py-1.5 text-sm"
              >
                <span className="font-mono text-[11px] text-[var(--color-muted-foreground)]">
                  #{ev.seq}
                  {ev.step != null && ev.total != null ? ` · ${ev.step}/${ev.total}` : ''}
                  {ev.kind === 'failure' ? ' · failure' : ''}
                </span>
                <div>{ev.message}</div>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {latestControl ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-[var(--color-muted-foreground)]">{t.controlReceipt}</span>
          <ControlStatusLabel status={latestControl.status} locale={locale} />
          <span className="font-mono text-[11px] text-[var(--color-muted-foreground)]">
            controlSeq={latestControl.control_seq} · {latestControl.type}
          </span>
          {latestControl.type === 'steer' && latestControl.payload?.message ? (
            <span className="text-[var(--color-muted-foreground)]">
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

      <div className="mt-4 flex flex-col gap-2">
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

      <footer className="mt-3 text-xs text-[var(--color-muted-foreground)]">
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
