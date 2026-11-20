import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { registerHamsterServiceWorker } from './lib/pwaUpdate'

// Register in PROD even when ConnectGate is showing (no Shell / no banner yet),
// so install + offline shell work before the user connects.
if (import.meta.env.PROD) {
  registerHamsterServiceWorker()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
