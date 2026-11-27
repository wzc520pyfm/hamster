import { useEffect, useId, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { PwaUpdateBanner } from '@/components/PwaUpdateBanner'
import { InstallPrompt } from '@/components/InstallPrompt'
import { useLocale } from '@/i18n/LocaleContext'
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
      'block rounded-md px-2.5 py-1.5 text-sm transition-colors',
      isActive
        ? 'bg-[var(--color-muted)] text-[var(--color-foreground)]'
        : 'text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]/70 hover:text-[var(--color-foreground)]',
    )

  // Control-plane default title is the literal EN string; map it to locked locale copy.
  const conversationSubtitle =
    !conversationTitle.trim() || conversationTitle === 'Main conversation'
      ? t.mainConversation
      : conversationTitle

  const brandBlock = (
    <div className="mb-5 px-1">
      <div className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight text-[var(--color-foreground)]">
        {t.brand}
      </div>
      <div className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">{t.preview}</div>
    </div>
  )

  const links = (
    <nav className="flex flex-col gap-0.5">
      <NavLink to="/" end className={linkClass} onClick={() => setMenuOpen(false)}>
        <div className="font-medium">{t.conversation}</div>
        <div className="truncate text-xs opacity-80" data-testid="shell-conversation-subtitle">
          {conversationSubtitle}
        </div>
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
            ? 'bg-[var(--color-muted)] text-[var(--color-foreground)]'
            : 'text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]/70',
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
            ? 'bg-[var(--color-muted)] text-[var(--color-foreground)]'
            : 'text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]/70',
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
      className="flex h-[100dvh] max-h-[100dvh] min-h-0 w-full flex-col gap-0"
      data-shell-bounded="true"
      data-shell-fullbleed="true"
    >
      {/* One connection-error layer only — shrink-0 inside 100dvh; remaining height for shell body. */}
      {connectionError ? (
        <div
          className="flex shrink-0 items-center justify-between gap-3 border-b border-[#e2c4c4] bg-[#f8ecec] px-4 py-2"
          data-testid="connection-banner"
          role="alert"
        >
          <p className="text-sm text-[var(--color-destructive)] whitespace-normal">{t.connect}</p>
          <Button type="button" size="sm" variant="outline" onClick={() => onRetryConnection?.()}>
            {t.retry}
          </Button>
        </div>
      ) : null}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 md:flex-row">
        {/* Narrow top bar — brand + menu control; desktop keeps the sticky sidebar. */}
        <header className="safe-area-top sticky top-0 z-30 flex shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--sidebar)] px-3 py-2.5 md:hidden">
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
                    ? 'bg-[var(--color-muted)] text-[var(--color-foreground)]'
                    : 'text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]/70',
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
                    ? 'bg-[var(--color-muted)] text-[var(--color-foreground)]'
                    : 'text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]/70',
                )}
                aria-pressed={locale === 'zh'}
                onClick={() => setLocale('zh')}
              >
                中文
              </button>
            </div>
            {/* Open control stays on the top bar; Close menu lives inside the drawer so
                the official label is never clipped by the panel (EN "Close menu"). */}
            {!menuOpen ? (
              <button
                type="button"
                data-testid="shell-menu-toggle"
                className="inline-flex h-9 items-center rounded-md border border-[var(--color-border)] bg-white px-3 text-sm font-medium"
                aria-expanded={false}
                aria-controls={panelId}
                onClick={() => setMenuOpen(true)}
              >
                {t.openMenu}
                {pendingApprovals > 0 ? (
                  <span
                    data-testid="shell-pending-badge"
                    className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-md bg-[var(--color-primary)] px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-[var(--color-primary-foreground)]"
                  >
                    {pendingApprovals}
                  </span>
                ) : null}
              </button>
            ) : null}
          </div>
        </header>

        {/* Desktop sidebar — edge-to-edge, hairline split; locale stays inside the window. */}
        <aside
          className="hidden min-h-0 w-[var(--shell-sidebar-width)] shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--sidebar)] px-3 py-3 md:flex"
          style={{ animation: 'shell-in 420ms ease-out' }}
          data-testid="shell-sidebar"
        >
          {brandBlock}
          {links}
          {localeToggle}
        </aside>

        {/* Narrow drawer overlay — nav + Close menu inside the panel; locale stays on the top bar. */}
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
              className="absolute inset-y-0 left-0 flex w-[min(18rem,88vw)] flex-col border-r border-[var(--color-border)] bg-[var(--color-wash)] px-3 py-4 shadow-[4px_0_24px_rgba(26,35,48,0.12)]"
              style={{ animation: 'shell-in 280ms ease-out' }}
              data-testid="shell-drawer"
            >
              <div className="mb-5 flex items-start justify-between gap-2">
                <div className="min-w-0 px-1">
                  <div className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight text-[var(--color-foreground)]">
                    {t.brand}
                  </div>
                  <div className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">
                    {t.preview}
                  </div>
                </div>
                <button
                  type="button"
                  data-testid="shell-menu-toggle"
                  className="inline-flex h-9 shrink-0 items-center rounded-md border border-[var(--color-border)] bg-white px-3 text-sm font-medium whitespace-nowrap"
                  aria-expanded={true}
                  aria-controls={panelId}
                  onClick={() => setMenuOpen(false)}
                >
                  {t.closeMenu}
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
              {links}
            </aside>
          </div>
        ) : null}

        <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--color-chat-ground)]">
          {standalone && location.pathname !== '/' ? (
            <div className="shrink-0 px-3 pt-2 md:px-4">
              <Button asChild variant="ghost" size="sm">
                <Link to="/">{t.backToConversation}</Link>
              </Button>
            </div>
          ) : null}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
            <Outlet />
            {/* In-flow update banner — user-controlled Reload; never forced. */}
            <PwaUpdateBanner />
          </div>
          {/* In-flow install affordance (standalone PWA only; never a fixed overlay). */}
          {standalone ? <InstallPrompt /> : null}
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
