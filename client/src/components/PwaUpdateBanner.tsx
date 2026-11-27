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
 * If controllerchange times out, the page is preserved and Retry is offered.
 */
export function PwaUpdateBanner() {
  const { t } = useLocale()
  const [updateReady, setUpdateReady] = useState(false)
  const [retryNeeded, setRetryNeeded] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!import.meta.env.PROD) return
    return registerHamsterServiceWorker(({ updateReady: ready }) => {
      if (ready) {
        setUpdateReady(true)
      }
    })
  }, [])

  if (!updateReady && !retryNeeded) return null

  const onReload = () => {
    if (busy) return
    setBusy(true)
    void getHamsterServiceWorkerRegistration()
      .then(async (reg) => {
        const result = await applyHamsterPwaUpdate(reg)
        if (!result.reloaded) {
          // Timeout / no waiting: keep this document; show understandable retry.
          setRetryNeeded(true)
          setUpdateReady(true)
        }
      })
      .finally(() => {
        setBusy(false)
      })
  }

  return (
    <div
      className="safe-area-bottom shrink-0 border-t border-[var(--color-border)] bg-[var(--color-wash)] px-3 py-2"
      data-testid="pwa-update-banner"
      role="status"
      aria-live="polite"
      aria-label={retryNeeded ? t.updateRetryNeeded : t.updateAvailable}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1 text-sm leading-snug whitespace-normal">
          {retryNeeded ? t.updateRetryNeeded : t.updateAvailable}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="pwa-update-dismiss"
            disabled={busy}
            onClick={() => {
              setUpdateReady(false)
              setRetryNeeded(false)
            }}
          >
            {t.dismissUpdate}
          </Button>
          <Button
            type="button"
            size="sm"
            data-testid="pwa-update-reload"
            disabled={busy}
            onClick={onReload}
          >
            {retryNeeded ? t.updateRetryAction : t.reloadToUpdate}
          </Button>
        </div>
      </div>
    </div>
  )
}
