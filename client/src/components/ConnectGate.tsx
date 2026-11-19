import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { useLocale } from '@/i18n/LocaleContext'
import { controlBaseUrl, isElectronContainer } from '@/lib/hamsterEnv'

const LAST_GOOD_KEY = 'hamster.controlBase'

function normalizeOrigin(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
}

/**
 * Quiet connect gate for Electron windows that are not loaded same-origin with the
 * control plane. Address + Connect only; remembers the last successful address.
 * Not an onboarding carousel, not a settings center.
 */
function ConnectGateInner() {
  const { t } = useLocale()
  const [address, setAddress] = useState(() => {
    const last = typeof localStorage === 'undefined' ? null : localStorage.getItem(LAST_GOOD_KEY)
    const current = controlBaseUrl()
    return last || current || window.location.origin
  })
  const [error, setError] = useState(false)

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const value = address.trim()
    if (!value) {
      setError(true)
      return
    }
    const origin = normalizeOrigin(value)
    try {
      localStorage.setItem(LAST_GOOD_KEY, origin)
    } catch {
      // storage unavailable (private mode) — connect still proceeds
    }
    ;(window as Window & { __HAMSTER_CONTROL_BASE__?: string }).__HAMSTER_CONTROL_BASE__ = origin
    if (origin === window.location.origin) {
      // Same origin already: just re-evaluate against the freshly injected base.
      window.location.reload()
    } else {
      window.location.assign(origin)
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <form
        className="flex flex-col gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4"
        onSubmit={onSubmit}
      >
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold">
            {t.connect}
          </h1>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{t.connectAddressLabel}</p>
        </div>
        <input
          className="h-10 rounded-md border border-[var(--color-border)] bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="http://localhost:3000"
          aria-label={t.connectAddressLabel}
        />
        <Button type="submit">{t.connectAction}</Button>
        {error ? <p className="text-sm text-[var(--color-destructive)]">{t.connect}</p> : null}
      </form>
    </div>
  )
}

/** Gate mount point: Electron windows that are not same-origin with the control plane. */
export function ConnectGateMount() {
  const electron = isElectronContainer()
  const injected = (window as Window & { __HAMSTER_CONTROL_BASE__?: string }).__HAMSTER_CONTROL_BASE__
  const base = (injected || '').trim().replace(/\/+$/, '') || controlBaseUrl()
  if (!electron) return null
  if (window.location.origin === base) return null
  return <ConnectGateInner />
}
