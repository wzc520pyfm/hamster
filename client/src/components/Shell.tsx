import { useEffect, useId, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useLocale } from '@/i18n/LocaleContext'
import { InstallPrompt } from '@/components/InstallPrompt'
import { PwaUpdateBanner } from '@/components/PwaUpdateBanner'
import { isStandaloneDisplay } from '@/lib/hamsterEnv'
import { cn } from '@/lib/utils'

export function Shell({
  pendingApprovals,
  conversationTitle,
  connectionError = false,
  onRetryConnection,
}: {
  pendingApprovals: number
  conversationTitle: string
  /** Single shell-level disconnect notice — counted inside 100dvh; pages must not duplicate. */
  connectionError?: boolean
  onRetryConnection?: () => void
}) {
  const { locale, t, setLocale } = useLocale()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const panelId = useId()
  const standalone = isStandaloneDisplay()

  // Close the narrow drawer after navigation so the main column stays full-width.
  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname, location.search])

  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'block rounded-md px-2.5 py-2 text-sm transition-colors',
      isActive
        ? 'bg-[var(--color-accent)] text-[var(--color-foreground)]'
        : 'text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]',
    )

  const brandBlock = (
    <div className="mb-6 px-1">
      <div className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight text-[var(--color-foreground)]">
        {t.brand}
      </div>
      <div className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">{t.preview}</div>
    </div>
  )

  const links = (
    <nav className="flex flex-col gap-1">
      <NavLink to="/" end className={linkClass} onClick={() => setMenuOpen(false)}>
        <div className="font-medium">{t.conversation}</div>
        <div className="truncate text-xs opacity-80">{conversationTitle || t.mainConversation}</div>
      </NavLink>
      <NavLink to="/assets" className={linkClass} onClick={() => setMenuOpen(false)}>
        {t.dashboards}
      </NavLink>
      <NavLink to="/approvals" className={linkClass} onClick={() => setMenuOpen(false)}>
        <span className="inline-flex w-full items-center justify-between gap-2">
          <span>{t.approvals}</span>
          {pendingApprovals > 0 ? (
            <span className="rounded-md bg-[var(--color-muted)] px-1.5 py-0.5 text-xs tabular-nums">
              {pendingApprovals}
            </span>
          ) : null}
        </span>
      </NavLink>
    </nav>
  )

  const localeToggle = (
    <div
      className="mt-auto flex items-center gap-1 border-t border-[var(--color-border)] pt-3"
      role="group"
      aria-label="Language"
    >
      <button
        type="button"
        data-testid="locale-en"
        className={cn(
          'h-8 rounded-md px-2.5 text-xs font-medium transition-colors',
          locale === 'en'
            ? 'bg-[var(--color-accent)] text-[var(--color-foreground)]'
            : 'text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]',
        )}
        aria-pressed={locale === 'en'}
        onClick={() => setLocale('en')}
      >
        EN
      </button>
      <button
        type="button"
        data-testid="locale-zh"
        className={cn(
          'h-8 rounded-md px-2.5 text-xs font-medium transition-colors',
          locale === 'zh'
            ? 'bg-[var(--color-accent)] text-[var(--color-foreground)]'
            : 'text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]',
        )}
        aria-pressed={locale === 'zh'}
        onClick={() => setLocale('zh')}
      >
        中文
      </button>
    </div>
  )

  return (
    <div
      className="mx-auto flex h-[100dvh] max-h-[100dvh] min-h-0 max-w-6xl flex-col gap-0 md:p-4"
      data-shell-bounded="true"
    >
      {/* One connection-error layer only — shrink-0 inside 100dvh; remaining height for shell body. */}
      {connectionError ? (
        <div
          className="flex shrink-0 items-center justify-between gap-3 border-b border-[#e2c4c4] bg-[#f8ecec] px-4 py-2"
          data-testid="connection-banner"
          role="alert"
        >
          <p className="text-sm text-[var(--color-destructive)]">{t.connect}</p>
          <Button type="button" size="sm" variant="outline" onClick={() => onRetryConnection?.()}>
            {t.retry}
          </Button>
        </div>
      ) : null}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 md:flex-row md:gap-4">
      {/* Narrow top bar — brand + menu control; desktop keeps the sticky sidebar. */}
      <header className="safe-area-top sticky top-0 z-30 flex shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--sidebar)] px-3 py-3 backdrop-blur-md md:hidden">
        <div className="min-w-0">
          <div className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight">
            {t.brand}
          </div>
          <div className="text-[11px] text-[var(--color-muted-foreground)]">{t.preview}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <div className="flex items-center gap-0.5" role="group" aria-label="Language">
            <button
              type="button"
              data-testid="locale-en"
              className={cn(
                'h-8 rounded-md px-2 text-xs font-medium transition-colors',
                locale === 'en'
                  ? 'bg-[var(--color-accent)] text-[var(--color-foreground)]'
                  : 'text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]',
              )}
              aria-pressed={locale === 'en'}
              onClick={() => setLocale('en')}
            >
              EN
            </button>
            <button
              type="button"
              data-testid="locale-zh"
              className={cn(
                'h-8 rounded-md px-2 text-xs font-medium transition-colors',
                locale === 'zh'
                  ? 'bg-[var(--color-accent)] text-[var(--color-foreground)]'
                  : 'text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]',
              )}
              aria-pressed={locale === 'zh'}
              onClick={() => setLocale('zh')}
            >
              中文
            </button>
          </div>
          <button
            type="button"
            data-testid="shell-menu-toggle"
            className="inline-flex h-9 items-center rounded-md border border-[var(--color-border)] bg-white px-3 text-sm font-medium"
            aria-expanded={menuOpen}
            aria-controls={panelId}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? t.closeMenu : t.openMenu}
            {pendingApprovals > 0 ? (
              <span
                data-testid="shell-pending-badge"
                className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-md bg-[var(--color-primary)] px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-[var(--color-primary-foreground)]"
              >
                {pendingApprovals}
              </span>
            ) : null}
          </button>
        </div>
      </header>

      {/* Desktop sidebar — min-h-0 + flex-1 so locale stays reachable within remaining height. */}
      <aside
        className="hidden min-h-0 w-[13.5rem] shrink-0 flex-col rounded-xl border border-[var(--color-border)] bg-[var(--sidebar)] px-3 py-4 backdrop-blur-md md:flex"
        style={{ animation: 'shell-in 420ms ease-out' }}
        data-testid="shell-sidebar"
      >
        {brandBlock}
        {links}
        {localeToggle}
      </aside>

      {/* Narrow drawer overlay — nav only; locale stays on the top bar. */}
      {menuOpen ? (
        <div className="fixed inset-0 z-40 md:hidden" role="presentation">
          <button
            type="button"
            className="absolute inset-0 bg-[rgba(26,35,48,0.35)]"
            aria-label={t.closeMenu}
            onClick={() => setMenuOpen(false)}
          />
          <aside
            id={panelId}
            className="absolute inset-y-0 left-0 flex w-[min(18rem,88vw)] flex-col border-r border-[var(--color-border)] bg-[var(--color-card)] px-3 py-4 shadow-[4px_0_24px_rgba(26,35,48,0.12)]"
            style={{ animation: 'shell-in 280ms ease-out' }}
          >
            {brandBlock}
            {links}
          </aside>
        </div>
      ) : null}

      <main className="flex min-h-0 min-w-0 flex-1 flex-col px-3 py-4 md:px-0 md:py-0">
        {standalone && location.pathname !== '/' ? (
          <div className="shrink-0 pb-2">
            <Button asChild variant="ghost" size="sm">
              <Link to="/">{t.backToConversation}</Link>
            </Button>
          </div>
        ) : null}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          <Outlet />
        </div>
        {/* In-flow update + install: shrink-0 below the flex-1 conversation column (not fixed overlay). */}
        <PwaUpdateBanner />
        <InstallPrompt />
      </main>
      </div>

      <style>{`
        @keyframes shell-in {
          from { opacity: 0; transform: translateX(-6px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  )
}
