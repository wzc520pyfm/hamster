import { useCallback, useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Shell } from '@/components/Shell'
import { LocaleProvider, useLocale } from '@/i18n/LocaleContext'
import { api } from '@/lib/api'
import { ApprovalsPage } from '@/pages/ApprovalsPage'
import { AssetPage } from '@/pages/AssetPage'
import { AssetsLibraryPage } from '@/pages/AssetsLibraryPage'
import { ConversationPage } from '@/pages/ConversationPage'

function AppRoutes() {
  const { locale } = useLocale()
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [conversationTitle, setConversationTitle] = useState('')
  const [pendingApprovals, setPendingApprovals] = useState(0)

  const refreshPending = useCallback(async () => {
    try {
      const list = await api.listApprovals('pending')
      setPendingApprovals(list.length)
    } catch {
      // Shell badge is best-effort; conversation/approvals pages show errors.
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const conv = await api.currentConversation()
        if (cancelled) return
        setConversationId(conv.conversationId)
        setConversationTitle(conv.title)
        await refreshPending()
      } catch {
        // Keep shell usable; pages surface connectivity errors.
      }
    })()
    const timer = setInterval(() => {
      void refreshPending()
    }, 4000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [refreshPending])

  return (
    <Routes>
      <Route
        element={
          <Shell pendingApprovals={pendingApprovals} conversationTitle={conversationTitle} />
        }
      >
        <Route
          path="/"
          element={
            <ConversationPage
              locale={locale}
              conversationId={conversationId}
              onApprovalsChanged={() => void refreshPending()}
            />
          }
        />
        <Route path="/assets" element={<AssetsLibraryPage locale={locale} />} />
        <Route path="/assets/:assetId" element={<AssetPage locale={locale} />} />
        <Route
          path="/approvals"
          element={
            <ApprovalsPage locale={locale} onApprovalsChanged={() => void refreshPending()} />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <LocaleProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </LocaleProvider>
  )
}
