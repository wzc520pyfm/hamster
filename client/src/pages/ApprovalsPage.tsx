import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ApprovalCard } from '@/components/ApprovalCard'
import { getCopy, type Locale } from '@/i18n/messages'
import { api, isNetworkError, type Approval } from '@/lib/api'

export function ApprovalsPage({
  locale,
  onApprovalsChanged,
  onNetworkError,
  connectionError = false,
}: {
  locale: Locale
  onApprovalsChanged: () => void
  onNetworkError?: () => void
  /** Shell owns the single Can't reach banner; used here only to fail-close actions. */
  connectionError?: boolean
}) {
  const t = getCopy(locale)
  const [searchParams] = useSearchParams()
  const focusId = (searchParams.get('id') || searchParams.get('focus') || '').trim()
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [error, setError] = useState<string | null>(null)
  const focusedRef = useRef<HTMLDivElement | null>(null)

  const refresh = useCallback(async () => {
    const list = await api.listApprovals()
    setApprovals(list)
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await refresh()
        if (!cancelled) setError(null)
      } catch (err) {
        if (!cancelled) {
          if (isNetworkError(err)) onNetworkError?.()
          else setError(err instanceof Error ? err.message : String(err))
        }
      }
    })()
    const timer = setInterval(() => {
      void refresh().catch((err) => {
        // Keep last-loaded tickets visible; report disconnect to shell only.
        if (isNetworkError(err)) onNetworkError?.()
      })
    }, 3000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [refresh, onNetworkError])

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
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-[var(--color-border)] px-3 py-2.5 md:px-4">
        <div className="mx-auto w-full max-w-[var(--reading-column)]">
          <h1 className="text-lg font-semibold tracking-tight text-[var(--color-foreground)]">
            {t.approvals}
          </h1>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[var(--reading-column)] flex-col gap-3 px-3 py-3 md:px-4">
        {error && !connectionError ? (
          <p className="text-sm text-[var(--color-destructive)] whitespace-normal">{error}</p>
        ) : null}

        {approvals.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)] whitespace-normal">
            {t.noApprovals}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {approvals.map((a) => (
              <ApprovalCard
                key={a.id}
                approval={a}
                locale={locale}
                focused={Boolean(focusId) && a.id === focusId}
                actionsDisabled={connectionError}
                onApprove={async (id) => {
                  // Fail-closed: unavailable control channel must not execute or look granted.
                  if (connectionError) return
                  await api.approve(id)
                  await refresh()
                  onApprovalsChanged()
                }}
                onDeny={async (id) => {
                  if (connectionError) return
                  await api.deny(id)
                  await refresh()
                  onApprovalsChanged()
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
