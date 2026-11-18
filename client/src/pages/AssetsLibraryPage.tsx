import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { freshnessLabel, getCopy, type Locale } from '@/i18n/messages'
import { api, type AssetSummary } from '@/lib/api'

export function AssetsLibraryPage({ locale }: { locale: Locale }) {
  const t = getCopy(locale)
  const localeTag = locale === 'zh' ? 'zh-CN' : 'en-US'
  const [assets, setAssets] = useState<AssetSummary[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const list = await api.listAssets()
        if (!cancelled) setAssets(list)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="flex flex-col gap-3">
      <header className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)]/90 px-4 py-3 backdrop-blur">
        <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold">
          {t.dashboards}
        </h1>
      </header>

      {error ? <p className="text-sm text-[var(--color-destructive)]">{error}</p> : null}

      {assets.length === 0 ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">{t.noDashboards}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {assets.map((asset) => (
            <li key={asset.assetId}>
              <Link
                to={`/assets/${asset.assetId}`}
                className="block rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3 transition-colors hover:bg-[var(--color-muted)]/40"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">{asset.title}</div>
                    <div className="mt-1 font-mono text-[11px] text-[var(--color-muted-foreground)]">
                      {t.assetId}: {asset.assetId}
                    </div>
                    <div className="text-xs text-[var(--color-muted-foreground)]">
                      {t.source}: {asset.source}
                    </div>
                  </div>
                  <Badge
                    tone={
                      asset.freshness === 'refresh_failed'
                        ? 'danger'
                        : asset.freshness === 'stale'
                          ? 'warn'
                          : 'info'
                    }
                  >
                    {freshnessLabel(asset.freshness, asset.lastSuccessAt, locale, localeTag)}
                  </Badge>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
