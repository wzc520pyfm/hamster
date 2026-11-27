import { Link } from 'react-router-dom'
import { ApprovalStatusLabel } from '@/components/StatusLabel'
import { Button } from '@/components/ui/button'
import { approvalActionLabel, getCopy, type Locale } from '@/i18n/messages'
import type { Approval } from '@/lib/api'

/**
 * Conversation dock: ONE pending summary only.
 * SUMMARY → EXACT FULL APPROVAL → CONFIRM. Never exposes Approve here (desktop or mobile).
 * Deny may stay; View details deep-links to /approvals?id=<exact>.
 */
export function PendingApprovalDock({
  pending,
  locale,
  onDeny,
}: {
  pending: Approval[]
  locale: Locale
  onDeny: (id: string) => Promise<void>
}) {
  const t = getCopy(locale)
  if (pending.length === 0) return null

  const primary = pending[0]!
  const remaining = pending.length - 1
  const action = approvalActionLabel(primary.action, primary.params, locale)
  const assetId =
    typeof primary.params?.assetId === 'string' && primary.params.assetId.trim()
      ? primary.params.assetId.trim()
      : null
  const channel =
    typeof primary.params?.channel === 'string' && primary.params.channel.trim()
      ? primary.params.channel.trim()
      : null
  const humanTarget = primary.taskTitle?.trim() || null
  const targetBits = [humanTarget, assetId ? `${t.assetId}: ${assetId}` : null, channel || null].filter(
    Boolean,
  )

  const detailTo = `/approvals?id=${encodeURIComponent(primary.id)}`

  return (
    <div
      className="flex max-h-[min(28vh,16rem)] shrink-0 flex-col gap-2 overflow-y-auto"
      data-testid="pending-approvals-dock"
      data-pending-count={pending.length}
    >
      <article
        className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-2.5"
        data-testid="approval-summary"
        data-approval-id={primary.id}
      >
        <header className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold leading-snug" data-testid="approval-summary-action">
              {action}
            </h3>
            {targetBits.length > 0 ? (
              <div
                className="mt-1 text-xs leading-snug text-[var(--color-muted-foreground)] whitespace-normal"
                data-testid="approval-summary-target"
              >
                <span className="font-medium text-[var(--color-foreground)]">{t.approvalTarget}: </span>
                {targetBits.join(' · ')}
              </div>
            ) : null}
          </div>
          <ApprovalStatusLabel status={primary.status} locale={locale} />
        </header>

        <div className="mt-2 flex flex-wrap gap-2" data-testid="approval-summary-actions">
          <Button type="button" size="sm" variant="outline" asChild data-testid="approval-view-details">
            <Link to={detailTo}>{t.viewDetails}</Link>
          </Button>
          {primary.status === 'pending' ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="approval-deny"
              onClick={() => void onDeny(primary.id)}
            >
              {t.deny}
            </Button>
          ) : null}
          {/* Intentionally no Approve on the summary — confirmation only on the full ticket. */}
        </div>
      </article>

      {remaining > 0 ? (
        <div
          className="flex flex-wrap items-center justify-between gap-2 px-0.5 text-xs text-[var(--color-muted-foreground)]"
          data-testid="approval-summary-more"
        >
          <span>{t.morePending(remaining)}</span>
          <Button type="button" size="sm" variant="ghost" asChild data-testid="open-pending-approvals">
            <Link to="/approvals">{t.openPendingApprovals}</Link>
          </Button>
        </div>
      ) : null}
    </div>
  )
}
