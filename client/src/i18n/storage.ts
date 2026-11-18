import type { Locale } from '@/i18n/messages'

const LOCALE_KEY = 'hamster.locale'

export function readStoredLocale(): Locale {
  const value = localStorage.getItem(LOCALE_KEY)
  return value === 'zh' ? 'zh' : 'en'
}

export function storeLocale(locale: Locale) {
  localStorage.setItem(LOCALE_KEY, locale)
}
