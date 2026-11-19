import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Renderer, type OpenUIError } from '@openuidev/react-lang'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { freshnessLabel, getCopy, type Locale } from '@/i18n/messages'
import { api, isNetworkError, type AssetDetail, type Freshness } from '@/lib/api'
import { controlBaseUrl } from '@/lib/hamsterEnv'
import { formatTime } from '@/lib/utils'
import { hamsterOpenUiLibrary, RefreshTokenContext } from '@/openui/library'
import { resolveApiBase } from '@/lib/hamsterOrigin'

function dashboardApiBase(): string {
  return resolveApiBase({
    pageOrigin: window.location.origin,
    controlBase: controlBaseUrl(),
    viteApiBase: (import.meta.env.VITE_API_BASE_URL as string | undefined) || '',
  })
}

/**
 * Persistent dashboard surface (Line B).
 * - Same route for library open and in-chat open: /assets/:assetId
 * - Renders the persisted OpenUI React Lang 1.0 document via @openuidev/react-lang
 * - Refresh bumps $rev only (rebinds Query data); does not regenerate or remount layout
 * - On failure, last successful / default snapshot stays visible with exact status copy
 */
export function DashboardView({
  assetId,
  locale,
  onNetworkError,
}: {
  assetId: string
  locale: Locale
  onNetworkError?: () => void
}) {
  const t = getCopy(locale)
  const localeTag = locale === 'zh' ? 'zh-CN' : 'en-US'
  const [asset, setAsset] = useState<AssetDetail | null>(null)
  const [freshness, setFreshness] = useState<Freshness>('fresh')
  const [lastSuccessAt, setLastSuccessAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)
  const openuiRef = useRef<string | null>(null)
  const mountedOnce = useRef(false)

  async function loadMeta() {
    setError(null)
    const detail = await api.getAsset(assetId)
    setAsset(detail)
    openuiRef.current = detail.openui
    setFreshness(detail.freshness)
    setLastSuccessAt(detail.lastSuccessAt)
    setLoading(false)
    mountedOnce.current = true
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await loadMeta()
      } catch (err) {
        if (!cancelled) {
          if (isNetworkError(err)) {
            onNetworkError?.()
          } else {
            setError(err instanceof Error ? err.message : String(err))
          }
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId])

  const toolProvider = useMemo(
    () => ({
      metrics_weekly: async (args: Record<string, unknown>) => {
        void args
        const res = await fetch(
          `${dashboardApiBase()}/api/assets/${encodeURIComponent(assetId)}/query/metrics_weekly`,
        )
        if (!res.ok) {
          const body = await res.text()
          let message = `HTTP ${res.status}`
          try {
            message = (JSON.parse(body) as { error?: string }).error ?? message
          } catch {
            // keep status text
          }
          throw new Error(message)
        }
        return res.json()
      },
    }),
    [assetId],
  )

  const onOpenUiError = useCallback((errors: OpenUIError[]) => {
    const hard = errors.filter((e) => e.severity !== 'warning')
    if (hard.length === 0) return
    const queryFail = hard.find((e) => e.source === 'query' || e.code?.startsWith('tool-'))
    if (queryFail) {
      setFreshness('refresh_failed')
      setError(queryFail.message)
    }
  }, [])

  async function refresh() {
    if (!asset) return
    setRefreshing(true)
    setError(null)
    const openuiBefore = openuiRef.current
    try {
      // Product freshness bookkeeping (does not rewrite openui_document).
      const result = await api.refreshAsset(assetId)
      const detail = await api.getAsset(assetId)
      if (openuiBefore && detail.openui !== openuiBefore) {
        throw new Error('refresh mutated openui document — refused')
      }
      setAsset(detail)
      openuiRef.current = detail.openui
      // Bump $rev inside the mounted Renderer so Query rebinds data in place.
      setRefreshToken((n) => n + 1)
      if (result.ok) {
        setFreshness('fresh')
        setLastSuccessAt(detail.lastSuccessAt)
      } else {
        setFreshness('refresh_failed')
        setError(result.error ?? 'refresh failed')
      }
    } catch (err) {
      if (isNetworkError(err)) {
        // Connection lost: keep last successful snapshot; shell owns the single Can't reach banner.
        onNetworkError?.()
        return
      }
      setFreshness('refresh_failed')
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRefreshing(false)
    }
  }

  if (loading && !mountedOnce.current) {
    return <div className="p-4 text-sm text-[var(--color-muted-foreground)]">{t.loading}</div>
  }

  if (!asset || !asset.openui) {
    return (
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
        <p className="text-sm">{t.error}</p>
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{error}</p>
        <Button className="mt-3" size="sm" variant="outline" asChild>
          <Link to="/">{t.backToConversation}</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <header className="shrink-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)]/90 p-4 backdrop-blur">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="mb-2">
              <Button asChild size="sm" variant="ghost">
                <Link to="/">{t.backToConversation}</Link>
              </Button>
            </div>
            <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight">
              {asset.title}
            </h1>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-[var(--color-muted-foreground)]">
              <span>
                {t.assetId}: {asset.assetId}
              </span>
              <span>
                {t.source}: {asset.source}
              </span>
              <span>layout v{asset.layoutVersion}</span>
            </div>
          </div>
          {/* Full-width on narrow so freshness copy + Retry stay in the first viewport. */}
          <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:max-w-[min(100%,22rem)] sm:items-end">
            <Badge
              tone={
                freshness === 'refresh_failed' ? 'danger' : freshness === 'stale' ? 'warn' : 'info'
              }
              className="max-w-full whitespace-normal text-left leading-snug sm:text-right"
            >
              {freshnessLabel(freshness, lastSuccessAt, locale, localeTag)}
            </Badge>
            <div className="text-xs text-[var(--color-muted-foreground)] whitespace-normal">
              {formatTime(lastSuccessAt, localeTag)}
            </div>
            <Button
              size="sm"
              className="w-fit"
              onClick={() => void refresh()}
              disabled={refreshing}
            >
              {freshness === 'refresh_failed' ? t.retry : t.refresh}
            </Button>
          </div>
        </div>
        <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">{t.layoutNote}</p>
        {error && freshness === 'refresh_failed' ? (
          <p className="mt-2 text-sm text-[var(--color-destructive)]">{error}</p>
        ) : null}
      </header>

      {/* Stable OpenUI Renderer — never keyed by refreshToken (would remount layout). */}
      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
        <RefreshTokenContext.Provider value={refreshToken}>
          <Renderer
            response={asset.openui}
            library={hamsterOpenUiLibrary}
            isStreaming={false}
            toolProvider={toolProvider}
            onError={onOpenUiError}
            queryLoader={
              <span className="text-xs text-[var(--color-muted-foreground)]">{t.loading}</span>
            }
          />
        </RefreshTokenContext.Provider>
      </div>
    </div>
  )
}
