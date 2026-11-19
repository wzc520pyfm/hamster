import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ApprovalCard } from '@/components/ApprovalCard'
import { Button } from '@/components/ui/button'
import { getCopy, type Locale } from '@/i18n/messages'
import { api, isNetworkError, type Approval } from '@/lib/api'

export function ApprovalsPage({
  locale,
  onApprovalsChanged,
}: {
  locale: Locale
  onApprovalsChanged: () => void
}) {
  const t = getCopy(locale)
  const [searchParams] = useSearchParams()
  const focusId = (searchParams.get('id') || searchParams.get('focus') || '').trim()
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [error, setError] = useState<string | null>(null)
  const [connectionError, setConnectionError] = useState(false)
  const focusedRef = useRef<HTMLDivElement | null>(null)

  const refresh = useCallback(async () => {
    const list = await api.listApprovals()
    setApprovals(list)
  }, [])

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
    }, 3000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [refresh])

  // Deep-link: scroll/focus the exact ticket — do not leave the operator hunting the list.
  useEffect(() => {
    if (!focusId || approvals.length === 0) return
    const el = document.querySelector(`[data-approval-id="${CSS.escape(focusId)}"]`)
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      focusedRef.current = el as HTMLDivElement
    }
  }, [focusId, approvals])

  return (
    <div className="flex flex-col gap-3">
      <header className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)]/90 px-4 py-3 backdrop-blur">
        <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold">
          {t.approvals}
        </h1>
      </header>

      {connectionError ? (
        <div className="rounded-md border border-[#e2c4c4] bg-[#f8ecec] px-3 py-2 text-sm text-[var(--color-destructive)]">
          {t.connect}
          <div className="mt-2">
            <Button type="button" size="sm" variant="outline" onClick={() => void retryConnection()}>
              {t.retry}
            </Button>
          </div>
        </div>
      ) : error ? (
        <p className="text-sm text-[var(--color-destructive)]">{error}</p>
      ) : null}

      {approvals.length === 0 ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">{t.noApprovals}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {approvals.map((a) => (
            <ApprovalCard
              key={a.id}
              approval={a}
              locale={locale}
              focused={Boolean(focusId) && a.id === focusId}
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
