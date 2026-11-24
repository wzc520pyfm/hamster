import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { useLocale } from '@/i18n/LocaleContext'
import {
  controlBaseUrl,
  isElectronContainer,
  LAST_GOOD_CONTROL_BASE_KEY,
} from '@/lib/hamsterEnv'
import { normalizeHamsterOrigin, validateHamsterClientApiOrigin } from '@/lib/hamsterOrigin'

/**
 * True when the SPA quiet connect gate should mount.
 * Electron bootstrap is the local trusted file:// gate from main (electron/gate.html) —
 * never an in-SPA overlay that would block the usable-mount handshake after navigate.
 * PWA/browser never show this gate.
 */
export function shouldShowConnectGate(): boolean {
  if (!isElectronContainer()) return false
  return false
}

/**
 * Quiet connect gate (SPA fallback). Address + Connect/Retry; last verified origin only.
 * Electron primary path is electron/gate.html + main requestConnect.
 */
function ConnectGateInner() {
  const { t } = useLocale()
  const [address, setAddress] = useState(() => {
    const last =
      typeof localStorage === 'undefined' ? null : localStorage.getItem(LAST_GOOD_CONTROL_BASE_KEY)
    const current = controlBaseUrl()
    return last || current || ''
  })
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failedOnce, setFailedOnce] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    const value = address.trim()
    if (!value) {
      setError(true)
      setFailedOnce(true)
      return
    }
    setError(false)
    setBusy(true)

    const normalized = normalizeHamsterOrigin(value)
    if (!normalized.ok) {
      setError(true)
      setFailedOnce(true)
      setBusy(false)
      return
    }

    if (typeof window.hamster?.requestConnect === 'function') {
      try {
        const result = await window.hamster.requestConnect(normalized.origin)
        if (!result?.ok) {
          setError(true)
          setFailedOnce(true)
          setBusy(false)
          return
        }
        try {
          localStorage.setItem(LAST_GOOD_CONTROL_BASE_KEY, result.origin || normalized.origin)
        } catch {
          // private mode
        }
        // Navigation should leave this document; if not, surface failure.
        await new Promise((r) => setTimeout(r, 400))
        setError(true)
        setFailedOnce(true)
        setBusy(false)
        return
      } catch {
        setError(true)
        setFailedOnce(true)
        setBusy(false)
        return
      }
    }

    const validated = await validateHamsterClientApiOrigin(normalized.origin)
    if (!validated.ok) {
      setError(true)
      setFailedOnce(true)
      setBusy(false)
      return
    }
    const origin = validated.origin
    try {
      localStorage.setItem(LAST_GOOD_CONTROL_BASE_KEY, origin)
    } catch {
      // ignore
    }
    ;(window as Window & { __HAMSTER_CONTROL_BASE__?: string }).__HAMSTER_CONTROL_BASE__ = origin
    if (origin === window.location.origin) {
      window.location.reload()
    } else {
      window.location.assign(origin)
    }
    setBusy(false)
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
          <label className="mt-1 block text-sm text-[var(--color-muted-foreground)]" htmlFor="connect-gate-address">
            {t.connectAddressLabel}
          </label>
        </div>
        <input
          id="connect-gate-address"
          className="h-10 rounded-md border border-[var(--color-border)] bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="http://localhost:3000"
          aria-label={t.connectAddressLabel}
          data-testid="connect-gate-address"
          disabled={busy}
          readOnly={busy}
        />
        <Button type="submit" data-testid="connect-gate-submit" disabled={busy} className="h-10">
          {failedOnce ? t.retry : t.connectAction}
        </Button>
        {busy ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">{t.loading}</p>
        ) : null}
        {error ? (
          <p className="text-sm text-[var(--color-destructive)]" data-testid="connect-gate-error">
            {t.connect}
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
