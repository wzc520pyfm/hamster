import { useCallback, useEffect, useState } from 'react'
import { ApprovalCard } from '@/components/ApprovalCard'
import { getCopy, type Locale } from '@/i18n/messages'
import { api, type Approval } from '@/lib/api'

export function ApprovalsPage({
  locale,
  onApprovalsChanged,
}: {
  locale: Locale
  onApprovalsChanged: () => void
}) {
  const t = getCopy(locale)
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const list = await api.listApprovals()
    setApprovals(list)
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await refresh()
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    const timer = setInterval(() => {
      void refresh().catch(() => undefined)
    }, 3000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [refresh])

  return (
    <div className="flex flex-col gap-3">
      <header className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)]/90 px-4 py-3 backdrop-blur">
        <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold">
          {t.approvals}
        </h1>
      </header>

      {error ? <p className="text-sm text-[var(--color-destructive)]">{error}</p> : null}

      {approvals.length === 0 ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">{t.noApprovals}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {approvals.map((a) => (
            <ApprovalCard
              key={a.id}
              approval={a}
              locale={locale}
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
      )}
    </div>
  )
}
