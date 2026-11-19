# Hamster P1 — Electron desktop client + installable PWA (operator doc)

**Branch:** `feat/p1-electron-pwa-20261119`
**Base SHA:** `ed8f1c6d901e75485f9d7296728df7ad35345740` (exact `main` HEAD when the slice started)

Provisional-name **private** exploration. Not a product launch. **Eve is not frozen.** This slice is
not an eve-freeze claim and not a live-model verification. It also is **not** a completed design-gate
pass; the operator (wzc520pyfm) decides any gate outcome after review.

This note covers only the two new surfaces of the slice: the **Electron main-computer window** and the
**installable standalone PWA**. Status words, button labels, and connection copy come from the design
table verbatim (see `/workspace/hamster-electron-pwa-direction-2026-11-19.md` and
`/workspace/hamster-p0-client-direction-2026-11-19.md`). No synonyms were used.

---

## 1. What was built in this slice (must-change items 1–7 + minimum demo screens)

| # | Must-change item | State on this branch |
| --- | --- | --- |
| 1 | Two surfaces reuse the existing product UI and status words | Done in code: same React client, same `messages.ts` design-table copy. Electron/PWA add only window/install/safe-area/background concerns. |
| 2 | Electron default window ~1200×800, sidebar side-by-side; below `md`/768 reuse shell Menu drawer; status words not truncated, Retry visible; window buttons don't cover brand/lang/Menu; minimal app menu only | Done in `electron/main.js` (1200×800 / min 820×560) + `Shell.tsx` (narrow top bar + drawer, badge on Menu toggle). |
| 3 | Close / quit / reload / PWA background must not become Cancel or auto-approve; reopen same IDs; window reload = reattach route, not Regenerate | Done in `electron/main.js` (`will-quit`, `window-all-closed`) + `App.tsx` routing (`Navigate to="/"` re-mounts current route only). |
| 4 | Pending approval visible when narrow/PWA Menu closed; same ticket when opened; Electron background → notification (if allowed) + dock/taskbar badge back to same ticket; no permission → badge + shell entry, fail closed | Done in `Shell.tsx` (badge on Menu toggle, menu closed), `electron/main.js` (activity IPC → notify + dock badge, notification click → focus approvals). |
| 5 | Disconnect uses `Can't reach this Hamster` / `无法连接` + Retry; Dashboard keeps last good layout (main line B); only refresh-failed adds Refresh failed + Retry | Done in `App.tsx`, `ConversationPage.tsx`, `DashboardView.tsx`, `ApprovalsPage.tsx` via `isNetworkError` (fetch-level TypeError) → `t.connect` + `t.retry`. |
| 6 | PWA installable standalone from self-hosted origin; safe area; keyboard; long Chinese copy wraps; Retry on first screen; cache never exposes restricted data after revocation; standalone Back to conversation reachable | Done via `client/public/manifest.webmanifest` (`display: standalone`, `start_url: "/"`, icons), `client/public/sw.js` (shell cache only, never `/api` / `/internal`), `client/index.css` safe-area + `ConversationPage.tsx` visualViewport handling, `InstallPrompt.tsx` (quiet, dismissible, never blocks), i18n long-copy. |
| 7 | Icons only temporary typographic marks, placeholder labeled, no paused logo | Done: `client/public/icons/icon-192.png`, `icon-512.png`, `electron/build/icon.png` (generated typographic marks, labeled placeholder in docs). Manifest icon types are `image/png`. |

Minimum demonstrable screens, as captured on this host (fixture path):

- Desktop-width conversation with pending approval + composer (`p1-desktop-conversation.png`).
- Narrow (390px) conversation, pending badge on closed Menu (`p1-narrow-menu-closed-badge.png`, `p1-narrow-conversation.png`).
- Chinese narrow conversation: `需要批准` + buttons `拒绝` / `批准此次动作` fully visible (`p1-zh-narrow-conversation.png`).
- Disconnect EN (`Can't reach this Hamster` + Retry) / ZH (`无法连接` + Retry) via real network abort (`p1-disconnect-en.png`, `p1-disconnect-zh.png`).

## 2. How to start Electron

Prerequisites on the host:

- Node 24+.
- Control plane reachable (self-hosted origin), e.g. `sudo docker compose up --build -d`
  (client published on `http://localhost:3000`, API on `http://localhost:8080`).
  Or the local equivalent: eve agent + api + client preview.
- A display server (X11/Wayland). On this headless host: `xvfb-run -a npx electron .`.

Steps:

```bash
git clone ... # or use this checkout
cd client && npm install && npm run build && npm run preview -- --port 3000   # serves :3000
cd ../electron && npm install && npx electron .
```

- `electron/main.js` defaults: `HAMSTER_CONTROL_ORIGIN` (default `http://localhost:3000`),
  `HAMSTER_CONTROL_BASE_URL` (default same). Window default `1200×800`, min `480×560`, sidebar visible
  side-by-side at default size; below the `md`/768 breakpoint the shell reuses the Menu drawer.
- Minimal native menu: Hamster / Edit / View / Window; product navigation stays in the app shell.
- Preload bridge: `window.hamster` (container + controlBaseUrl) injected by `electron/preload.js`; container
  identity must not come from `executeJavaScript` injection. Window shows on `ready-to-show` instead of
  `did-start-load`; `minWidth` is `480` (was `820`); `sandbox: true` with `contextBridge` surface.
- If the Electron window is not loaded same-origin with the control plane, the quiet ConnectGate
  (address + Connect) shows, rendered by `shouldShowConnectGate()`; it remembers only a health-checked
  successful address via `hamsterEnv.ts` bridge (`window.hamster`); the disconnect screen never stacks
  underneath it. Empty ConnectGate validation uses `t.error`, not disconnect copy.

Honest host result (2026-11-19): `npx electron --version` → `36.9.5`; main process launched under
Xvfb and stayed up through the window lifetime (no crash) with the client preview serving
`http://localhost:3000`.

## 3. How to install the PWA from the self-hosted origin

1. Serve the client from the self-hosted origin (Compose publishes the client on `:3000`; or
   `cd client && npm run build && npm run preview -- --port 3000`).
2. Open `http://<self-hosted-origin>/` in a supporting browser (Chrome/Edge/Android; iOS Safari uses
   “Add to Home Screen”).
3. Install: quiet, dismissible install affordance (`beforeinstallprompt` + `appinstalled`) that never
   blocks work; after install, opening from the home screen goes straight into the same main
   conversation (standalone, not a promo page).
4. Safe area: `viewport-fit=cover` + `env(safe-area-inset-*)` handled (`.safe-area-top` / `.safe-area-bottom`);
   standalone Back to conversation (`/`) always reachable and clear of the safe area.
5. Keyboard: visual-viewport shrink keeps composer + approval buttons usable when the virtual keyboard rises.

## 4. Evidence on this host

- Client: `npm run build` (`tsc -b && vite build`) **PASS**; `oxlint` clean (scoped check).
- Capture: `node scripts/capture-p1.mjs` (Playwright headless Chromium against the built client; API
  routes mocked for happy-path shots, real network abort for disconnect shots). **PASS** (exit 0).
  - Shots: `docs/evidence/p1-electron-pwa/*.png`.
  - Install checks (`install.ok`) **true**: manifest `display: standalone`, `start_url: "/"`, icons OK,
    service worker registered.
  - Disconnect: real network abort → design-table copy (`Can't reach this Hamster` / `无法连接`) with Retry
    visible on first screen.
- Electron: launch smoke check **done** on this host (Xvfb), version 36.9.5, no crash during run.
- Prior fixture evidence (unchanged): `docs/evidence/compose-20261119/`, `docs/evidence/ui-smoke/`,
  `docs/evidence/verify-p0-latest.txt`, `docs/p0-report.md`.

## 5. Honest remaining verification / host limits (not faked)

- **No physical phone** was used; install-to-home-screen on real hardware was **not** performed. Installability
  was verified programmatically in headless Chromium (manifest + SW + icons). Physical device install + real
  keyboard/safe-area behavior on device remain open.
- Electron window was **not** visually captured on this host (Xvfb launch smoke check only; no meaningful
  display screenshot produced).
- No live model was run; fixture / `mockModel` path only. No model results invented.
- `Stale — still showing last success` / `仍显示上次成功结果` was **not** produced or claimed (no product path
  sets it here; not faked).
- Chinese `排队` / `运行中` task-status labels: no new P1 evidence was gathered for those two task states in
  this slice; they remain as previously-recorded (unverified here, not newly claimed).

## 6. Remaining gaps (honest)

- Physical-device install + on-device keyboard/safe-area verification.
- Real-hardware background-approval notification / dock-badge behavior.
- Design-gate pass not claimed; operator review pending.

## 7. Repro commands (quick reference)

```bash
# control plane (fixture path)
sudo docker compose up --build -d

# client, then capture evidence
cd client && npm install && npm run build && npm run preview -- --port 3000
npx playwright install chromium   # once
node scripts/capture-p1.mjs

# electron
cd electron && npm install && npx electron .
```
