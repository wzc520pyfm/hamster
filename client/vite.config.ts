import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { stampDistServiceWorker } from './src/lib/pwaBuildStamp.mjs'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

/** Stamp sw.js with a deploy id derived from hashed assets so bundle-only deploys update SW. */
function hamsterPwaBuildStampPlugin(): Plugin {
  return {
    name: 'hamster-pwa-build-stamp',
    apply: 'build',
    closeBundle() {
      const distDir = path.resolve(rootDir, 'dist')
      const buildId = stampDistServiceWorker(distDir)
      if (buildId) {
        console.log(`[hamster-pwa-build-stamp] ${buildId}`)
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), hamsterPwaBuildStampPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    proxy: {
      // Same-origin control plane for local dev/preview: the browser calls /api on the
      // same origin the client is served from, so same-origin assumptions hold.
      '/api': { target: 'http://127.0.0.1:8080', changeOrigin: true },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8080', changeOrigin: true },
    },
  },
})
