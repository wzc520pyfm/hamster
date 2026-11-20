import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

// Service worker registration + update UX live in PwaUpdateBanner (PROD only).
// Do not register here — a second register() would race the update listener.

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
