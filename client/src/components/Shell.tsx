import { NavLink, Outlet } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { getCopy, type Locale } from '@/i18n/messages'
import { cn } from '@/lib/utils'

const LOCALE_KEY = 'hamster.locale'

export function readStoredLocale(): Locale {
  const value = localStorage.getItem(LOCALE_KEY)
  return value === 'zh' ? 'zh' : 'en'
}

export function storeLocale(locale: Locale) {
  localStorage.setItem(LOCALE_KEY, locale)
}

export function Shell({
  locale,
  onLocaleChange,
  pendingApprovals,
  conversationTitle,
}: {
  locale: Locale
  onLocaleChange: (locale: Locale) => void
  pendingApprovals: number
  conversationTitle: string
}) {
  const t = getCopy(locale)

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'block rounded-md px-2.5 py-2 text-sm transition-colors',
      isActive
        ? 'bg-[var(--color-accent)] text-[var(--color-foreground)]'
        : 'text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]',
    )

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl gap-0 md:gap-4 md:p-4">
      <aside
        className="sticky top-0 flex h-screen w-[13.5rem] shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--sidebar)] px-3 py-4 backdrop-blur-md md:h-[calc(100vh-2rem)] md:rounded-xl md:border"
        style={{ animation: 'shell-in 420ms ease-out' }}
      >
        <div className="mb-6 px-1">
          <div className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight text-[var(--color-foreground)]">
            {t.brand}
          </div>
          <div className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">{t.preview}</div>
        </div>

        <nav className="flex flex-col gap-1">
          <NavLink to="/" end className={linkClass}>
            <div className="font-medium">{t.conversation}</div>
            <div className="truncate text-xs opacity-80">{conversationTitle || t.mainConversation}</div>
          </NavLink>
          <NavLink to="/assets" className={linkClass}>
            {t.dashboards}
          </NavLink>
          <NavLink to="/approvals" className={linkClass}>
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

        <div className="mt-auto flex items-center gap-1 border-t border-[var(--color-border)] pt-3">
          <Button
            type="button"
            size="sm"
            variant={locale === 'en' ? 'secondary' : 'ghost'}
            onClick={() => onLocaleChange('en')}
            aria-pressed={locale === 'en'}
          >
            EN
          </Button>
          <Button
            type="button"
            size="sm"
            variant={locale === 'zh' ? 'secondary' : 'ghost'}
            onClick={() => onLocaleChange('zh')}
            aria-pressed={locale === 'zh'}
          >
            中文
          </Button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-3 py-4 md:px-0 md:py-0">
        <Outlet />
      </main>

      <style>{`
        @keyframes shell-in {
          from { opacity: 0; transform: translateX(-6px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  )
}
