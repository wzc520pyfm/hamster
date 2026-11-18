import { useState } from 'react'
import { ApprovalStatusLabel } from '@/components/StatusLabel'
import { Button } from '@/components/ui/button'
import { getCopy, type Locale } from '@/i18n/messages'
import type { Approval } from '@/lib/api'
import { formatTime } from '@/lib/utils'

function safeParams(params: Record<string, unknown>) {
  const entries = Object.entries(params ?? {})
  return entries.map(([key, value]) => {
    const lower = key.toLowerCase()
    const secretish =
      lower.includes('secret') ||
      lower.includes('password') ||
      lower.includes('token') ||
      lower.includes('key')
    return {
      key,
      value: secretish ? '•••' : typeof value === 'string' ? value : JSON.stringify(value),
    }
  })
}

export function ApprovalCard({
  approval,
  locale,
  onApprove,
  onDeny,
}: {
  approval: Approval
  locale: Locale
  onApprove: (id: string) => Promise<void>
  onDeny: (id: string) => Promise<void>
}) {
  const t = getCopy(locale)
  const [busy, setBusy] = useState(false)
  const pending = approval.status === 'pending'
  const expiresAt = approval.expiresAt ?? approval.expires_at ?? null
  const note = approval.decisionNote ?? approval.decision_note ?? null

  return (
    <article className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">{approval.action}</h3>
          <div className="mt-1 font-mono text-[11px] text-[var(--color-muted-foreground)]">
            {t.taskId}: {approval.taskId}
          </div>
          {approval.taskTitle ? (
            <div className="text-sm text-[var(--color-muted-foreground)]">{approval.taskTitle}</div>
          ) : null}
        </div>
        <ApprovalStatusLabel status={approval.status} locale={locale} />
      </header>

      <dl className="mt-3 flex flex-col gap-2 text-sm">
        <div>
          <dt className="text-xs text-[var(--color-muted-foreground)]">{t.params}</dt>
          <dd className="mt-1 rounded-md bg-[var(--color-muted)]/60 px-2.5 py-2 font-mono text-xs">
            {safeParams(approval.params).map((p) => (
              <div key={p.key}>
                {p.key}: {p.value}
              </div>
            ))}
          </dd>
        </div>
        {expiresAt ? (
          <div>
            <dt className="text-xs text-[var(--color-muted-foreground)]">{t.expires}</dt>
            <dd>{formatTime(expiresAt, locale === 'zh' ? 'zh-CN' : 'en-US')}</dd>
          </div>
        ) : null}
        {note ? <div className="text-[var(--color-muted-foreground)]">{note}</div> : null}
      </dl>

      {pending ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={async () => {
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
            disabled={busy}
            onClick={async () => {
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
