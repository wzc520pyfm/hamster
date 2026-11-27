import { useState } from 'react'
import { getCopy, type Locale } from '@/i18n/messages'

/**
 * Long conversationId / taskId / runtimeSessionId / assetId stay available and copyable,
 * but are not shown on first glance. Default closed.
 */
export function ExpandableIdentifiers({
  locale,
  items,
  testId,
}: {
  locale: Locale
  items: Array<{ label: string; value: string }>
  testId?: string
}) {
  const t = getCopy(locale)
  const [open, setOpen] = useState(false)
  const usable = items.filter((item) => item.value)
  if (usable.length === 0) return null

  return (
    <div className="mt-1" data-testid={testId ?? 'expandable-identifiers'}>
      <button
        type="button"
        className="text-xs text-[var(--color-muted-foreground)] underline-offset-2 hover:underline"
        aria-expanded={open}
        data-testid="expandable-identifiers-toggle"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? t.hideIdentifiers : t.showIdentifiers}
      </button>
      {open ? (
        <ul className="mt-1.5 flex flex-col gap-1" data-testid="expandable-identifiers-list">
          {usable.map((item) => (
            <li
              key={`${item.label}:${item.value}`}
              className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-[var(--color-muted-foreground)]"
            >
              <span>
                {item.label}: {item.value}
              </span>
              <button
                type="button"
                className="rounded border border-[var(--color-border)] bg-white px-1.5 py-0.5 text-[10px] text-[var(--color-foreground)] hover:bg-[var(--color-muted)]"
                data-testid="copy-identifier"
                onClick={() => {
                  void navigator.clipboard?.writeText(item.value)
                }}
              >
                {t.copy}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
