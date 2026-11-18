import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { freshnessLabel, getCopy, type Locale } from '@/i18n/messages'
import { api, type AssetDetail, type Freshness } from '@/lib/api'
import { formatTime } from '@/lib/utils'

/**
 * Persistent dashboard surface (Line B).
 * - Same route for library open and in-chat open: /assets/:assetId
 * - Refresh re-fetches saved bindings into stable slots; layout stays mounted.
 * - On failure, last successful snapshot remains visible with exact status copy.
 */
export function DashboardView({
  assetId,
  locale,
}: {
  assetId: string
  locale: Locale
}) {
  const t = getCopy(locale)
  const localeTag = locale === 'zh' ? 'zh-CN' : 'en-US'
  const [asset, setAsset] = useState<AssetDetail | null>(null)
  const [data, setData] = useState<AssetDetail['data'] | null>(null)
  const [freshness, setFreshness] = useState<Freshness>('fresh')
  const [lastSuccessAt, setLastSuccessAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  // Keep the page shell mounted across refreshes; only swap slot data.
  const mountedOnce = useRef(false)

  async function load() {
    setError(null)
    const detail = await api.getAsset(assetId)
    setAsset(detail)
    setData(detail.data)
    setFreshness(detail.freshness)
    setLastSuccessAt(detail.lastSuccessAt)
    setLoading(false)
    mountedOnce.current = true
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await load()
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId])

  async function refresh() {
    if (!asset) return
    setRefreshing(true)
    setError(null)
    try {
      const result = await api.refreshAsset(assetId)
      // Re-fetch the same asset document; do not remount or regenerate layout.
      const detail = await api.getAsset(assetId)
      setAsset(detail)
      if (result.ok) {
        setData(detail.data)
        setFreshness('fresh')
        setLastSuccessAt(detail.lastSuccessAt)
      } else {
        // Keep previous data in the original slots.
        setFreshness('refresh_failed')
        setError(result.error ?? 'refresh failed')
      }
    } catch (err) {
      setFreshness('refresh_failed')
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRefreshing(false)
    }
  }

  if (loading && !mountedOnce.current) {
    return <div className="p-4 text-sm text-[var(--color-muted-foreground)]">{t.loading}</div>
  }

  if (!asset || !data) {
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
    <div className="flex h-[calc(100vh-2rem)] flex-col gap-3">
      <header className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)]/90 p-4 backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-3">
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
          <div className="flex flex-col items-end gap-2">
            <Badge
              tone={
                freshness === 'refresh_failed' ? 'danger' : freshness === 'stale' ? 'warn' : 'info'
              }
            >
              {freshnessLabel(freshness, lastSuccessAt, locale, localeTag)}
            </Badge>
            <div className="text-xs text-[var(--color-muted-foreground)]">
              {formatTime(lastSuccessAt, localeTag)}
            </div>
            <Button size="sm" onClick={() => void refresh()} disabled={refreshing}>
              {freshness === 'refresh_failed' ? t.retry : t.refresh}
            </Button>
          </div>
        </div>
        <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">{t.layoutNote}</p>
        {error && freshness === 'refresh_failed' ? (
          <p className="mt-2 text-sm text-[var(--color-destructive)]">{error}</p>
        ) : null}
      </header>

      {/* Stable slots — never unmounted on refresh */}
      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
        <section data-slot="head" className="mb-4">
          <h2 className="text-lg font-semibold">Weekly metrics</h2>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Asset {asset.assetId} · source: {asset.source} · refresh re-fetches this query only
          </p>
        </section>

        <section data-slot="kpis" className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {data.kpis.map((kpi) => (
            <div
              key={kpi.label}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)]/40 p-3"
            >
              <div className="text-xs text-[var(--color-muted-foreground)]">{kpi.label}</div>
              <div className="mt-1 text-xl font-semibold tabular-nums">{kpi.value}</div>
              <div className="mt-1 text-xs text-[var(--color-muted-foreground)]">{kpi.delta}</div>
            </div>
          ))}
        </section>

        <section data-slot="grid" className="overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted-foreground)]">
                <th className="px-2 py-2 font-medium">Week</th>
                <th className="px-2 py-2 font-medium">Sessions</th>
                <th className="px-2 py-2 font-medium">Signups</th>
                <th className="px-2 py-2 font-medium">Conversion</th>
                <th className="px-2 py-2 font-medium">Exceptions</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.week} className="border-b border-[var(--color-border)]/70">
                  <td className="px-2 py-2 font-mono text-xs">{row.week}</td>
                  <td className="px-2 py-2 tabular-nums">{row.sessions}</td>
                  <td className="px-2 py-2 tabular-nums">{row.signups}</td>
                  <td className="px-2 py-2 tabular-nums">{row.conversion}</td>
                  <td className="px-2 py-2 tabular-nums">{row.exceptions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section data-slot="note" className="mt-4 text-xs text-[var(--color-muted-foreground)]">
          Hamster asset {asset.assetId} — layout v{asset.layoutVersion}. Refresh replaces data in
          place; it never regenerates this page.
        </section>
      </div>
    </div>
  )
}
