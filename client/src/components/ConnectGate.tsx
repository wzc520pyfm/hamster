import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { useLocale } from '@/i18n/LocaleContext'
import {
  controlBaseUrl,
  isElectronContainer,
  isSameOriginControlBase,
  LAST_GOOD_CONTROL_BASE_KEY,
} from '@/lib/hamsterEnv'
import { normalizeHamsterOrigin, validateHamsterClientApiOrigin } from '@/lib/hamsterOrigin'

/**
 * True when the Electron window should show the quiet connect gate (not same-origin with the
 * control plane). PWA never shows this gate; the browser only sees it when explicitly asked.
 */
export function shouldShowConnectGate(): boolean {
  if (!isElectronContainer()) return false
  if (isSameOriginControlBase()) return false
  return true
}

/**
 * Quiet connect gate for Electron windows that are not loaded same-origin with the control plane.
 * Address + Connect only; remembers the last *verified-successful* Hamster client+API origin.
 * Not an onboarding carousel, not a settings center.
 */
function ConnectGateInner() {
  const { t } = useLocale()
  const [address, setAddress] = useState(() => {
    const last =
      typeof localStorage === 'undefined' ? null : localStorage.getItem(LAST_GOOD_CONTROL_BASE_KEY)
    const current = controlBaseUrl()
    return last || current || window.location.origin
  })
  const [error, setError] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const value = address.trim()
    if (!value) {
      // Empty-field validation uses a non-disconnect state, not the disconnect sentence.
      setError(true)
      return
    }
    setError(false)

    const normalized = normalizeHamsterOrigin(value)
    if (!normalized.ok) {
      setError(true)
      return
    }

    const validated = await validateHamsterClientApiOrigin(normalized.origin)
    if (!validated.ok) {
      setError(true)
      return
    }
    const origin = validated.origin

    try {
      localStorage.setItem(LAST_GOOD_CONTROL_BASE_KEY, origin)
    } catch {
      // storage unavailable (private mode) — connect still proceeds
    }
    ;(window as Window & { __HAMSTER_CONTROL_BASE__?: string }).__HAMSTER_CONTROL_BASE__ = origin

    // Electron: ask main to trust + navigate so will-navigate allowlist and session restore stay in sync.
    if (typeof window.hamster?.requestConnect === 'function') {
      try {
        const result = await window.hamster.requestConnect(origin)
        if (!result?.ok) {
          setError(true)
          return
        }
        return
      } catch {
        setError(true)
        return
      }
    }

    if (origin === window.location.origin) {
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
        data-testid="connect-gate"
      >
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold">
            {t.connectGateTitle}
          </h1>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{t.connectAddressLabel}</p>
        </div>
        <input
          className="h-10 rounded-md border border-[var(--color-border)] bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="http://192.168.1.10:3000"
          aria-label={t.connectAddressLabel}
          data-testid="connect-gate-address"
        />
        <Button type="submit" data-testid="connect-gate-submit">
          {t.connectAction}
        </Button>
        {error ? (
          <p className="text-sm text-[var(--color-destructive)]" data-testid="connect-gate-error">
            {t.error}
          </p>
        ) : null}
      </form>
    </div>
  )
}

/** Gate mount point: Electron windows that are not same-origin with the control plane. */
export function ConnectGateMount() {
  if (!shouldShowConnectGate()) return null
  return <ConnectGateInner />
}
