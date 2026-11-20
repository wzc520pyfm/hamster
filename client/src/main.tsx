import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { registerHamsterServiceWorker } from './lib/pwaUpdate'

// Register in PROD so install + offline shell + update detection work without a reload.
if (import.meta.env.PROD) {
  registerHamsterServiceWorker()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
