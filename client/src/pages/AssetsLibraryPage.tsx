import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ExpandableIdentifiers } from '@/components/ExpandableIdentifiers'
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
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-[var(--color-border)] px-3 py-2.5 md:px-4">
        <div className="mx-auto w-full max-w-[var(--reading-column)]">
          <h1 className="text-lg font-semibold tracking-tight text-[var(--color-foreground)]">
            {t.dashboards}
          </h1>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[var(--reading-column)] flex-col gap-3 px-3 py-3 md:px-4">
        {error ? (
          <p className="text-sm text-[var(--color-destructive)] whitespace-normal">{error}</p>
        ) : null}

        {assets.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)] whitespace-normal">
            {t.noDashboards}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {assets.map((asset) => (
              <li
                key={asset.assetId}
                className="rounded-lg border border-[var(--color-border)] bg-white px-3.5 py-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      to={`/assets/${asset.assetId}`}
                      className="font-medium hover:underline"
                    >
                      {asset.title}
                    </Link>
                    <div className="mt-1 text-xs text-[var(--color-muted-foreground)] whitespace-normal">
                      {t.source}: {asset.source}
                    </div>
                    <ExpandableIdentifiers
                      locale={locale}
                      items={[{ label: t.assetId, value: asset.assetId }]}
                    />
                  </div>
                  <Badge
                    tone={
                      asset.freshness === 'refresh_failed'
                        ? 'danger'
                        : asset.freshness === 'stale'
                          ? 'warn'
                          : 'info'
                    }
                    className="max-w-full whitespace-normal text-left leading-snug"
                  >
                    {freshnessLabel(asset.freshness, asset.lastSuccessAt, locale, localeTag)}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
