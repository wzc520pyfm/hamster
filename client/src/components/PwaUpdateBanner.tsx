import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useLocale } from '@/i18n/LocaleContext'
import {
  applyHamsterPwaUpdate,
  getHamsterServiceWorkerRegistration,
  registerHamsterServiceWorker,
} from '@/lib/pwaUpdate'

/**
 * Quiet, in-flow banner when a new service worker is ready.
 * Reload is user-controlled — never forced; does not clear conversation data.
 */
export function PwaUpdateBanner() {
  const { t } = useLocale()
  const [updateReady, setUpdateReady] = useState(false)

  useEffect(() => {
    if (!import.meta.env.PROD) return
    return registerHamsterServiceWorker(({ updateReady: ready }) => {
      setUpdateReady(ready)
    })
  }, [])

  if (!updateReady) return null

  return (
    <div
      className="safe-area-bottom shrink-0 border-t border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2"
      data-testid="pwa-update-banner"
      role="status"
      aria-live="polite"
      aria-label={t.updateAvailable}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1 text-sm leading-snug">{t.updateAvailable}</div>
        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="pwa-update-dismiss"
            onClick={() => setUpdateReady(false)}
          >
            {t.dismissUpdate}
          </Button>
          <Button
            type="button"
            size="sm"
            data-testid="pwa-update-reload"
            onClick={() => {
              void getHamsterServiceWorkerRegistration().then((reg) => {
                applyHamsterPwaUpdate(reg)
              })
            }}
          >
            {t.reloadToUpdate}
          </Button>
        </div>
      </div>
    </div>
  )
}
