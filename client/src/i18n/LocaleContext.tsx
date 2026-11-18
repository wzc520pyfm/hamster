import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { getCopy, type Copy, type Locale } from '@/i18n/messages'
import { readStoredLocale, storeLocale } from '@/i18n/storage'

interface LocaleContextValue {
  locale: Locale
  t: Copy
  setLocale: (locale: Locale) => void
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => readStoredLocale())
  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      t: getCopy(locale),
      setLocale: (next) => {
        storeLocale(next)
        setLocaleState(next)
      },
    }),
    [locale],
  )
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useLocale() {
  const ctx = useContext(LocaleContext)
  if (!ctx) throw new Error('useLocale requires LocaleProvider')
  return ctx
}
