import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

function AppWithServiceWorker() {
  useEffect(() => {
    if (import.meta.env.PROD && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        // Offline shell is best-effort; the app still runs online.
        console.warn('Hamster service worker registration failed', err)
      })
    }
  }, [])

  return <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppWithServiceWorker />
  </StrictMode>,
)
