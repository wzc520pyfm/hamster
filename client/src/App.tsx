import { useCallback, useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Shell } from '@/components/Shell'
import { ConnectGateMount, shouldShowConnectGate } from '@/components/ConnectGate'
import { LocaleProvider, useLocale } from '@/i18n/LocaleContext'
import { api, isNetworkError } from '@/lib/api'
import { getCopy } from '@/i18n/messages'
import { ApprovalsPage } from '@/pages/ApprovalsPage'
import { AssetPage } from '@/pages/AssetPage'
import { AssetsLibraryPage } from '@/pages/AssetsLibraryPage'
import { ConversationPage } from '@/pages/ConversationPage'

function ElectronRouteReporter() {
  const location = useLocation()
  useEffect(() => {
    window.hamster?.reportRoute?.({
      pathname: location.pathname,
      search: location.search,
      hash: location.hash,
    })
  }, [location.pathname, location.search, location.hash])
  return null
}

function AppRoutes() {
  const { locale } = useLocale()
  const t = getCopy(locale)
  const navigate = useNavigate()
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [conversationTitle, setConversationTitle] = useState('')
  const [pendingApprovals, setPendingApprovals] = useState(0)
  const [connectionError, setConnectionError] = useState(false)
  const connectGateShowing = shouldShowConnectGate()

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
        // Usable interactive mount handshake for Electron main (trusted sender).
        window.hamster?.reportClientMounted?.()
        try {
          localStorage.setItem('hamster.controlBase', window.location.origin)
        } catch {
          // private mode
        }
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
    // Same-source reconnect only — do not cancel/approve/deny or leave the route.
    setConnectionError(false)
    try {
      const conv = await api.currentConversation()
      setConversationId(conv.conversationId)
      setConversationTitle(conv.title)
      window.hamster?.reportClientMounted?.()
      await refreshPending()
    } catch (err) {
      if (isNetworkError(err)) setConnectionError(true)
    }
  }, [refreshPending])

  const sendApprovalActivity = useCallback((count: number) => {
    window.hamster?.sendApprovalActivity(count)
  }, [])

  useEffect(() => {
    sendApprovalActivity(pendingApprovals)
  }, [pendingApprovals, sendApprovalActivity])

  useEffect(() => {
    const off = window.hamster?.onOpenApprovals(() => {
      navigate('/approvals')
    })
    return () => off?.()
  }, [navigate])

  if (connectGateShowing) {
    // SPA fallback gate (Electron normally uses local file:// gate from main).
    return <ConnectGateMount />
  }

  return (
    <>
      <ElectronRouteReporter />
      {/* Temp network loss: keep Routes/UI; banner only — never replace whole shell. */}
      {connectionError ? (
        <div
          className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-[#e2c4c4] bg-[#f8ecec] px-4 py-2"
          data-testid="connection-banner"
          role="alert"
        >
          <p className="text-sm text-[var(--color-destructive)]">{t.connect}</p>
          <Button type="button" size="sm" variant="outline" onClick={() => void retryConnection()}>
            {t.retry}
          </Button>
        </div>
      ) : null}
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
