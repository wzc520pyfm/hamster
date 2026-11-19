import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useLocale } from '@/i18n/LocaleContext'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  dismiss?: () => void
}

/**
 * Quiet, dismissible install affordance for the standalone-capable PWA.
 * Never blocks work; only appears when the browser fired `beforeinstallprompt`.
 */
export function InstallPrompt() {
  const { t } = useLocale()
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault()
      setEvent(e as BeforeInstallPromptEvent)
    }
    const onInstalled = () => {
      setEvent(null)
      setDismissed(true)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (dismissed || !event) return null

  function install() {
    const evt = event
    if (!evt) return
    void evt.prompt().then(() => {
      setEvent(null)
      setDismissed(true)
    })
  }

  return (
    <div
      className="safe-area-bottom fixed bottom-0 left-0 right-0 z-40 border-t border-[var(--color-border)] bg-[var(--color-card)]/95 px-3 py-2 backdrop-blur"
      data-testid="install-prompt"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium">{t.installTitle}</div>
          <div className="truncate text-xs text-[var(--color-muted-foreground)]">{t.installBody}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button type="button" size="sm" onClick={() => void install()}>
            {t.installAction}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={t.dismissInstall}
            onClick={() => {
              setEvent(null)
              setDismissed(true)
            }}
          >
            ✕
          </Button>
        </div>
      </div>
    </div>
  )
}
