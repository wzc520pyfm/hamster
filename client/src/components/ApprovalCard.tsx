import { useState } from 'react'
import { ApprovalStatusLabel } from '@/components/StatusLabel'
import { Button } from '@/components/ui/button'
import { approvalActionLabel, approvalDecisionCopy, getCopy, type Locale } from '@/i18n/messages'
import { approvalRunTargetLabel } from '@/lib/runTarget'
import type { Approval } from '@/lib/api'
import { formatTime } from '@/lib/utils'

/** Redact secret-ish param values; keep assetId/channel/task identifiers visible. */
export function safeParams(params: Record<string, unknown> | null | undefined) {
  const entries = Object.entries(params ?? {}).filter(([, value]) => value !== undefined)
  return entries.map(([key, value]) => {
    const lower = key.toLowerCase()
    const secretish =
      lower.includes('secret') ||
      lower.includes('password') ||
      lower.includes('token') ||
      (lower.includes('key') && lower !== 'assetid')
    return {
      key,
      value: secretish ? '•••' : typeof value === 'string' ? value : JSON.stringify(value),
    }
  })
}

/**
 * Full confirmation card (Approvals page / focused ticket).
 * SUMMARY dock never uses Approve — only this card does, after View details.
 */
export function ApprovalCard({
  approval,
  locale,
  onApprove,
  onDeny,
  focused = false,
  actionsDisabled = false,
}: {
  approval: Approval
  locale: Locale
  onApprove: (id: string) => Promise<void>
  onDeny: (id: string) => Promise<void>
  focused?: boolean
  /** Fail-closed when control/approval channel unavailable. */
  actionsDisabled?: boolean
}) {
  const t = getCopy(locale)
  const [busy, setBusy] = useState(false)
  const pending = approval.status === 'pending'
  const expiresAt = approval.expiresAt ?? approval.expires_at ?? null
  const note = approval.decisionNote ?? approval.decision_note ?? null
  const decisionCopy = approvalDecisionCopy(approval.status, locale)
  const footer = decisionCopy ?? note
  const params = safeParams(approval.params)
  const title = approvalActionLabel(approval.action, approval.params, locale)

  return (
    <article
      id={`approval-${approval.id}`}
      data-testid="approval-card"
      data-approval-id={approval.id}
      data-focused={focused ? 'true' : 'false'}
      className={`rounded-lg border bg-[var(--color-card)] p-4 ${
        focused
          ? 'border-[var(--color-ring)] ring-2 ring-[var(--color-ring)]'
          : 'border-[var(--color-border)]'
      }`}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold" data-testid="approval-full-action">
            {title}
          </h3>
          <div className="mt-1 font-mono text-[11px] text-[var(--color-muted-foreground)]">
            {t.taskId}: {approval.taskId}
          </div>
          {approval.taskTitle ? (
            <div className="text-sm text-[var(--color-muted-foreground)]" data-testid="approval-full-task-title">
              {approval.taskTitle}
            </div>
          ) : null}
        </div>
        <ApprovalStatusLabel status={approval.status} locale={locale} />
      </header>

      <div
        className="mt-2 text-sm"
        data-testid="approval-run-on"
      >
        <span className="text-[var(--color-muted-foreground)]">{t.runOn}: </span>
        <span data-testid="approval-run-on-value">{approvalRunTargetLabel(approval, locale)}</span>
      </div>

      <dl className="mt-3 flex flex-col gap-2 text-sm">
        {params.length > 0 ? (
          <div>
            <dt className="text-xs text-[var(--color-muted-foreground)]">{t.params}</dt>
            <dd
              className="mt-1 rounded-md bg-[var(--color-muted)]/60 px-2.5 py-2 font-mono text-xs whitespace-normal"
              data-testid="approval-full-params"
            >
              {params.map((p) => (
                <div key={p.key} data-param-key={p.key}>
                  {p.key}: {p.value}
                </div>
              ))}
            </dd>
          </div>
        ) : null}
        {expiresAt ? (
          <div>
            <dt className="text-xs text-[var(--color-muted-foreground)]">{t.expires}</dt>
            <dd data-testid="approval-full-expires">
              {formatTime(expiresAt, locale === 'zh' ? 'zh-CN' : 'en-US')}
            </dd>
          </div>
        ) : null}
        {footer ? <div className="text-[var(--color-muted-foreground)]">{footer}</div> : null}
      </dl>

      {pending ? (
        <div className="mt-4 flex flex-wrap gap-2" data-testid="approval-actions">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || actionsDisabled}
            data-testid="approval-deny"
            onClick={async () => {
              if (actionsDisabled) return
              setBusy(true)
              try {
                await onDeny(approval.id)
              } finally {
                setBusy(false)
              }
            }}
          >
            {t.deny}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy || actionsDisabled}
            data-testid="approval-approve"
            onClick={async () => {
              if (actionsDisabled) return
              setBusy(true)
              try {
                await onApprove(approval.id)
              } finally {
                setBusy(false)
              }
            }}
          >
            {t.approveThisAction}
          </Button>
        </div>
      ) : null}
    </article>
  )
}
