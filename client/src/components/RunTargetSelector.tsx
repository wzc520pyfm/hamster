import { Button } from '@/components/ui/button'
import { getCopy, type Locale } from '@/i18n/messages'
import {
  RUN_TARGET_CONTROL_PLANE,
  RUN_TARGET_ISOLATED_DESKTOP,
  canDispatchToIsolated,
} from '@/lib/runTarget'

/**
 * Per-task execution target selector (composer field "Run on" / "执行位置").
 * Only two options exist in this slice: the default Control plane / 控制面 and the
 * optional Isolated desktop / 隔离桌面. The host machine is never offered.
 * Selecting Isolated desktop is NOT approval and never starts the container.
 * not_started ≠ unavailable: only unavailable shows the unavailable sentence + Retry.
 */
export function RunTargetSelector({
  value,
  onChange,
  isolatedState = 'unavailable',
  locale,
  onRetry,
}: {
  value: string
  onChange: (targetId: string) => void
  /** Probe state: ok | not_started | unavailable (must-fix 4). */
  isolatedState?: string
  locale: Locale
  onRetry?: () => void
}) {
  const t = getCopy(locale)
  const selectedIsolated = value === RUN_TARGET_ISOLATED_DESKTOP
  const showUnavailable = selectedIsolated && isolatedState === 'unavailable'
  const showDescription = selectedIsolated && canDispatchToIsolated(isolatedState)

  return (
    <div className="flex flex-col gap-2" data-testid="run-target-selector">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <label htmlFor="run-target-select" className="text-sm text-[var(--color-muted-foreground)]">
          {t.runOn}
        </label>
        <select
          id="run-target-select"
          className="h-9 rounded-md border border-[var(--color-border)] bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          data-testid="run-target-select"
          aria-label={t.runOn}
        >
          <option value={RUN_TARGET_CONTROL_PLANE}>{t.controlPlane} · {t.controlPlaneDefault}</option>
          <option value={RUN_TARGET_ISOLATED_DESKTOP}>{t.isolatedDesktop}</option>
        </select>
      </div>
      {showUnavailable ? (
        <div
          className="flex flex-wrap items-center gap-2"
          data-testid="run-target-unavailable"
        >
          <span className="text-sm text-[var(--color-muted-foreground)]">{t.isolatedDesktopUnavailable}</span>
          {onRetry ? (
            <Button type="button" size="sm" variant="outline" onClick={() => onRetry()} data-testid="run-target-retry">
              {t.retry}
            </Button>
          ) : null}
        </div>
      ) : null}
      {showDescription ? (
        <p
          className="text-xs leading-snug text-[var(--color-muted-foreground)]"
          data-testid="run-target-description"
        >
          {t.isolatedDesktopDescription}
        </p>
      ) : null}
    </div>
  )
}
