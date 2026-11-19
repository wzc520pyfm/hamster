# Hamster P1 — Electron desktop client + installable PWA (operator doc)

**Branch:** `feat/p1-electron-pwa-20261119`
**Base SHA:** `ed8f1c6d901e75485f9d7296728df7ad35345740` (exact `main` HEAD when the slice started)

Provisional-name **private** exploration. Not a product launch. **Eve is not frozen.** This slice is
not an eve-freeze claim and not a live-model verification. It also is **not** a completed design-gate
pass; the operator (wzc520pyfm) decides any gate outcome after review. **Seven must-fixes landed in
code does not mean the product is accepted.**

This note covers only the two new surfaces of the slice: the **Electron main-computer window** and the
**installable standalone PWA**. Status words, button labels, and connection copy come from the design
table verbatim (see `/workspace/hamster-electron-pwa-direction-2026-11-19.md` and
`/workspace/hamster-p0-client-direction-2026-11-19.md`). No synonyms were used.

Same product UI and the same `conversationId` / `taskId` / `runtimeSessionId` / `assetId` across Web,
Electron, and PWA. In-app approval cards remain the only approval channel; without a reachable card
the action **fail-closed** (no silent Full Access). Notifications and badges only return the operator
to that card.

---

## 1. What was built in this slice (must-change items 1–7 + minimum demo screens)

| # | Must-change item | State on this branch |
| --- | --- | --- |
| 1 | Two surfaces reuse the existing product UI and status words | Done in code: same React client, same `messages.ts` design-table copy. Electron/PWA add only window/install/safe-area/background concerns. |
| 2 | Electron default window ~1200×800, sidebar side-by-side; below `md`/768 reuse shell Menu drawer; status words not truncated, Retry visible; window buttons don't cover brand/lang/Menu; minimal app menu only | Done in `electron/main.js` (default 1200×800, **`minWidth: 480`** so the window can shrink below `md`/768) + `Shell.tsx` (narrow top bar + drawer, badge on Menu toggle). Minimal menu: Hamster / Edit / View / Window. |
| 3 | Close / quit / reload / PWA background must not become Cancel or auto-approve; reopen same IDs; window reload = reattach route, not Regenerate | Done in `electron/main.js` (`will-quit`, `window-all-closed`) + `App.tsx` routing (`Navigate to="/"` re-mounts current route only). Live reopen-same-IDs on a real window **not** executed. |
| 4 | Pending approval visible when narrow/PWA Menu closed; same ticket when opened; Electron background → notification (if allowed) + dock/taskbar badge back to same ticket; no permission → badge + shell entry, fail closed | Done in `Shell.tsx` (badge on Menu toggle, menu closed), `electron/main.js` (activity IPC → notify + `app.dock.setBadge` + `app.setBadgeCount`, notification click → focus approvals). Real notification/dock hardware path **not** executed. |
| 5 | Disconnect uses `Can't reach this Hamster` / `无法连接` + Retry; Dashboard keeps last good layout (main line B); only refresh-failed adds Refresh failed + Retry | Done in `App.tsx`, `ConversationPage.tsx`, `DashboardView.tsx`, `ApprovalsPage.tsx` via `isNetworkError` (fetch-level TypeError) → `t.connect` + `t.retry`. Disconnect screen does **not** show the control-plane address label. |
| 6 | PWA installable standalone from self-hosted origin; safe area; keyboard; long Chinese copy wraps; Retry on first screen; cache never exposes restricted data after revocation; standalone Back to conversation reachable | Done via `client/public/manifest.webmanifest` (`display: standalone`, `start_url: "/"`, icons `type: image/png`), `client/public/sw.js` (shell cache only, never `/api` / `/internal`), `client/index.css` safe-area + `ConversationPage.tsx` visualViewport handling, `InstallPrompt.tsx` (quiet, dismissible, never blocks), i18n long-copy. Physical-device install **not** executed. |
| 7 | Icons only temporary typographic marks, placeholder labeled, no paused logo | Done: `client/public/icons/icon-192.png`, `icon-512.png`, `electron/build/icon.png` (generated typographic marks, labeled placeholder in docs). Manifest icon types are `image/png`. |

### Must-fixes landed after the first operator stretch (code commits)

1. `preload` (not `preloadPath`); `sandbox: true`; `contextIsolation: true`; `nodeIntegration: false` — `90db226`.
2. Window shows on BrowserWindow `ready-to-show`; container/`controlBaseUrl` via `electron/preload.js` → `window.hamster` (no `executeJavaScript` injection for identity) — `90db226` + `fbab807`.
3. `minWidth: 480` (was `820`) so the shell can use the existing `md`/768 Menu drawer — `90db226`.
4. Disconnect copy exact: `Can't reach this Hamster` / `无法连接` + `Retry` / `重试` only on that screen — `fbab807`.
5. ConnectGate: persists only a last **health-tested** successful URL (`/api/health`); when showing, renders alone (no disconnect / routes underneath); empty-field validation uses `t.error`, not disconnect copy — `fbab807`.
6. Manifest icon MIME `image/png`; `scripts/capture-p1.mjs` `install.ok` tightened (see §4) — `fbab807`.
7. Taskbar/dock badge: `app.setBadgeCount` in addition to `app.dock.setBadge` — `90db226`.

Minimum demonstrable screens (fixture-path PNGs under `docs/evidence/p1-electron-pwa/`):

- Desktop-width conversation with pending approval + composer (`p1-desktop-conversation.png`).
- Narrow (390px) conversation, pending badge on closed Menu (`p1-narrow-menu-closed-badge.png`, `p1-narrow-conversation.png`).
- Chinese narrow conversation: `需要批准` + buttons `拒绝` / `批准此次动作` fully visible (`p1-zh-narrow-conversation.png`).
- Disconnect EN (`Can't reach this Hamster` + Retry) / ZH (`无法连接` + Retry) via real network abort (`p1-disconnect-en.png`, `p1-disconnect-zh.png`).

**Screenshot provenance:** these PNGs were produced during the earlier free-CLI / OpenCode host run
(recaptured on disconnect-copy fix in `fbab807`). They are **inherited evidence**, not re-captured in
the Cursor Auto docs handoff. Honest labels stay: fixture / mocked API for happy-path frames; real
network abort for disconnect frames. No Electron window visual exists.

---

## 2. How to start Electron

Prerequisites on the host:

- Node 24+.
- Control plane reachable (self-hosted origin), e.g. `sudo docker compose up --build -d`
  (client published on `http://localhost:3000`, API on `http://localhost:8080`).
  Or the local equivalent: eve agent + api + client preview.
- A display server (X11/Wayland). Headless hosts often use `xvfb-run -a npx electron .` — see §5 for
  honest Xvfb screenshot failure on this slice; do not treat Xvfb launch as a visual acceptance.

Steps:

```bash
git clone ... # or use this checkout
cd client && npm install && npm run build && npm run preview -- --port 3000   # serves :3000
cd ../electron && npm install && npx electron .
```

- `electron/main.js` defaults: `HAMSTER_CONTROL_ORIGIN` (default `http://localhost:3000`),
  `HAMSTER_CONTROL_BASE_URL` (default same). Window default `1200×800`, **`minWidth: 480`**
  (code inspection of `BrowserWindow`; sufficient to shrink below `md`/768). Do not document a
  product-verified minHeight claim beyond what the BrowserWindow options literally set in code.
- Minimal native menu: Hamster / Edit / View / Window; product navigation stays in the app shell.
- Preload bridge: `window.hamster` (container + controlBaseUrl) from `electron/preload.js`; container
  identity must not come from `executeJavaScript` injection. Window shows on `ready-to-show`;
  `sandbox: true` with `contextBridge` surface.
- If the Electron window is not loaded same-origin with the control plane, the quiet ConnectGate
  (address + Connect) shows via `shouldShowConnectGate()` and renders alone. It remembers only a
  health-checked successful address (`localStorage` key `hamster.controlBase` after `/api/health`
  succeeds). PWA never needs this gate.

---

## 3. How to install the PWA from the self-hosted origin

1. Serve the client from the self-hosted origin (Compose publishes the client on `:3000`; or
   `cd client && npm run build && npm run preview -- --port 3000`).
2. Open `http://<self-hosted-origin>/` in a supporting browser (Chrome/Edge/Android; iOS Safari uses
   “Add to Home Screen”).
3. Install: quiet, dismissible install affordance (`beforeinstallprompt` + `appinstalled`) that never
   blocks work; after install, opening from the home screen goes straight into the same main
   conversation (standalone, not a promo page). Same IDs as the desktop/Web client.
4. Safe area: `viewport-fit=cover` + `env(safe-area-inset-*)` handled (`.safe-area-top` / `.safe-area-bottom`);
   standalone Back to conversation (`/`) always reachable and clear of the safe area.
5. Keyboard: visual-viewport shrink keeps composer + approval buttons usable when the virtual keyboard rises.

Physical home-screen install on a real phone was **not** performed on this host.

---

## 4. Evidence — inherited vs this docs handoff

### Inherited (earlier free-CLI / OpenCode host; not re-owned by Cursor Auto unless re-run)

- Client: `npm run build` (`tsc -b && vite build`) **PASS** on that host; `oxlint` clean (scoped check).
- Capture: `node scripts/capture-p1.mjs` (Playwright headless Chromium against the built client; API
  routes mocked for happy-path shots, real network abort for disconnect shots). **PASS** (exit 0).
  - Shots: `docs/evidence/p1-electron-pwa/*.png` (preserved; honest fixture provenance).
  - **`install.ok === true` only when all of the following hold** (see `scripts/capture-p1.mjs`):
    - manifest `display === 'standalone'`
    - manifest `start_url === '/'`
    - each icon URL returns **HTTP 200** and its manifest `type` is **`image/png`**
    - service worker for `/sw.js` is **registered**
  - Disconnect: real network abort → design-table copy (`Can't reach this Hamster` / `无法连接`) with Retry
    visible on first screen.
- Electron: earlier host reported `npx electron --version` → `36.9.5` and a launch smoke attempt under
  Xvfb. That is **not** a successful Electron visual.

### This Cursor Auto docs handoff

- Independently re-inspected: `electron/main.js` (`preload`, `ready-to-show`, `minWidth: 480`,
  `sandbox: true`, `app.setBadgeCount`), `ConnectGate.tsx` / `hamsterEnv.ts`,
  `manifest.webmanifest` (`image/png`), and `scripts/capture-p1.mjs` `install.ok` conditions above.
- Client `npm run build` re-run on this Cursor Auto VM: **PASS** (`tsc -b && vite build`).
- **No** new fixture capture, **no** physical-device test, **no** live-model test, **no** design-gate
  pass, **no** eve freeze.

### Electron visual attempts — FAILED (do not invent a window shot)

Actual Xvfb Electron screenshot attempts on the must-fix host **failed** (dbus / GPU issues and
load timeouts / **EXIT 124**). There is **no successful Electron visual**. Do not treat launch smoke
or a blank/timeout Xvfb frame as product evidence. No screenshot recreation was required for this
docs handoff.

Prior fixture evidence (unchanged): `docs/evidence/compose-20261119/`, `docs/evidence/ui-smoke/`,
`docs/evidence/verify-p0-latest.txt`, `docs/p0-report.md`.

---

## 5. Honest remaining verification / host limits (not faked)

- **No physical phone** — install-to-home-screen and on-device keyboard / safe-area behavior remain open.
- **No successful Electron window visual** — Xvfb screenshot attempts failed (dbus/GPU, timeouts/EXIT124).
- Real-hardware notification / dock-badge return path not executed.
- Live reopen-after-close / reload → same IDs on a real window not executed (code-level only).
- No live model; fixture / `mockModel` path only. No model results invented.
- `Stale — still showing last success` / `仍显示上次成功结果` was **not** produced or claimed.
- Chinese `排队` / `运行中` task-status labels: no new P1 evidence; not newly claimed.
- **Design gate not passed. Product not accepted. Eve not frozen.**

## 6. Remaining gaps (honest)

- Physical-device install + on-device keyboard/safe-area verification.
- Successful Electron window visual (after preload/`ready-to-show` fixes) on a host that can show one.
- Real-hardware background-approval notification / dock-badge behavior.
- Live reopen-same-IDs check on a real window.
- Operator product review + DesignBot page review; design-gate decision remains with the operator.

## 7. Repro commands (quick reference)

```bash
# control plane (fixture path)
sudo docker compose up --build -d

# client, then (optional) capture evidence
cd client && npm install && npm run build && npm run preview -- --port 3000
npx playwright install chromium   # once
node scripts/capture-p1.mjs

# electron
cd electron && npm install && npx electron .
```
