import { useCallback, useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Shell } from '@/components/Shell'
import { ConnectGateMount } from '@/components/ConnectGate'
import { LocaleProvider, useLocale } from '@/i18n/LocaleContext'
import { api, isNetworkError } from '@/lib/api'
import { getCopy } from '@/i18n/messages'
import { ApprovalsPage } from '@/pages/ApprovalsPage'
import { AssetPage } from '@/pages/AssetPage'
import { AssetsLibraryPage } from '@/pages/AssetsLibraryPage'
import { ConversationPage } from '@/pages/ConversationPage'

function AppRoutes() {
  const { locale } = useLocale()
  const t = getCopy(locale)
  const navigate = useNavigate()
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [conversationTitle, setConversationTitle] = useState('')
  const [pendingApprovals, setPendingApprovals] = useState(0)
  const [connectionError, setConnectionError] = useState(false)

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
        setConnectionError(false)
        await refreshPending()
      } catch (err) {
        if (cancelled) return
        if (isNetworkError(err)) setConnectionError(true)
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

  const retryConnection = useCallback(async () => {
    setConnectionError(false)
    try {
      const conv = await api.currentConversation()
      setConversationId(conv.conversationId)
      setConversationTitle(conv.title)
    } catch (err) {
      if (isNetworkError(err)) setConnectionError(true)
    }
  }, [])

  const sendApprovalActivity = useCallback((count: number) => {
    window.hamster?.sendApprovalActivity(count)
  }, [])

  // Electron main process: push pending-approval activity (window not focused => notify + badge).
  useEffect(() => {
    sendApprovalActivity(pendingApprovals)
  }, [pendingApprovals, sendApprovalActivity])

  // Deep link back from an approval notification: return to the same ticket.
  useEffect(() => {
    const off = window.hamster?.onOpenApprovals(() => {
      navigate('/approvals')
    })
    return () => off?.()
  }, [navigate])

  return (
    <>
      <ConnectGateMount />
      {connectionError ? (
        <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-4">
          <div className="flex flex-col gap-3 rounded-xl border border-[#e2c4c4] bg-[#f8ecec] p-4">
            <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold text-[var(--color-destructive)]">
              {t.connect}
            </h1>
            <p className="text-sm text-[var(--color-muted-foreground)]">{t.connectAddressLabel}</p>
            <Button onClick={() => void retryConnection()}>{t.retry}</Button>
          </div>
        </div>
      ) : (
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
      )}
    </>
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
