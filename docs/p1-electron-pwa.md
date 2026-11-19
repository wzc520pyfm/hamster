# Hamster P1 — Electron desktop client + installable PWA (operator doc)

**Branch:** `feat/p1-electron-pwa-20261119`
**Base SHA:** `ed8f1c6d901e75485f9d7296728df7ad35345740` (exact `main` HEAD when the slice started)

Provisional-name **private** exploration. Not a product launch. **Eve is not frozen.** This slice is
not an eve-freeze claim and not a live-model verification. It also is **not** a completed design-gate
pass; the operator (wzc520pyfm) decides any gate outcome after review. **Code + docs fixes do not mean
the product is accepted.**

Same product UI and the same `conversationId` / `taskId` / `runtimeSessionId` / `assetId` / approval
IDs across Web, Electron, and PWA. In-app approval cards remain the only approval channel; without a
reachable card the action **fail-closed**. Notifications and badges only return the operator to that
card. Close / quit / reload / background never Cancel or auto-approve.

---

## 1. Must-change items 1–7 (state on this branch)

| # | Item | State |
| --- | --- | --- |
| 1 | Same UI + status words | Same React client / `messages.ts` design-table copy |
| 2 | Electron ~1200×800, `minWidth: 480`, Menu drawer below `md` | `electron/main.js` + `Shell.tsx` |
| 3 | Close/quit/reload/background ≠ Cancel/approve; restore route/IDs | Session restore in Electron (`sessionStore.cjs`); control plane owns tasks |
| 4 | Pending badge + background return; fail closed | Menu badge + `setBadgeCount`; focus clears badge but **keeps count**; blur restores badge |
| 5 | Disconnect `Can't reach this Hamster` / `无法连接` + Retry | Disconnect screen only; ConnectGate uses separate `connectGateTitle` |
| 6 | PWA standalone from self-hosted origin | Manifest + SW; production client proxies `/api` same-origin; install affordance **in-flow** (not fixed overlay) |
| 7 | Placeholder icons | Typographic marks; manifest `image/png` |

### Reviewer follow-up fixes (after docs handoff `f7c9ea0`)

Independently confirmed, then fixed:

1. **ConnectGate title** — `connectGateTitle`: EN `Connect to Hamster` / ZH `连接 Hamster` (not disconnect copy).
2. **Same-origin API** — production build bakes empty `VITE_API_BASE_URL`; `client/server.mjs` reverse-proxies `/api` (+ `/internal`) to `API_UPSTREAM`. Phones on `http://LAN:3000` call `http://LAN:3000/api/...`, not `localhost:8080`. `api.ts` / `DashboardView` resolve API base at runtime via `resolveApiBase` (relative when page === control origin).
3. **ConnectGate validation** — requires Hamster **client+API** on the same origin: `/api/health` JSON `{status:'ok'}` with `redirect: 'manual'`, plus `manifest.webmanifest` (`display: standalone`, `start_url: '/'`, name Hamster). Rejects credentials in URL, non-http(s) schemes, arbitrary 200 sites, API-only origins, and health/manifest redirects. Private LAN http(s) allowed.
4. **Electron trust** — `will-navigate` / `will-redirect` / `setWindowOpenHandler` allowlist trusted origins; IPC sender frame URL checked; preload bridge only on windows we create; ConnectGate uses `requestConnect` so main re-validates before trust+navigate. No unsafe renderer identity for Electron privilege (`isElectronContainer` uses preload bridge only).
5. **Route restore** — last trusted in-app path (`/`, `/assets`, `/assets/:id`, `/approvals`) persisted in userData session; startup `loadURL` restores it. Renderer also `reportRoute`s. No task/asset fork: IDs remain control-plane IDs.
6. **Install prompt** — in-flow under main column (not `fixed` overlay covering composer/approvals).

---

## 2. How to start Electron

```bash
# Preferred: Compose (client image runs server.mjs with API_UPSTREAM=http://api:8080)
sudo docker compose up --build -d
# Client origin: http://<host>:3000  (LAN IP works for phones)

# Or local production-like client (after API is up on :8080)
cd client && npm install && VITE_API_BASE_URL= npm run build
API_UPSTREAM=http://127.0.0.1:8080 npm run start:prod   # 0.0.0.0:3000 + /api proxy

cd ../electron && npm install
HAMSTER_CONTROL_ORIGIN=http://127.0.0.1:3000 npx electron .
```

- Default window 1200×800, **`minWidth: 480`**. Minimal menu: Hamster / Edit / View / Window.
- ConnectGate title is `connectGateTitle`; remembers only a validated Hamster client+API origin.
- Reopen restores the last validated in-app route on a trusted origin (not always `/`).

Dev-only alternative: `npm run preview` still proxies `/api` via Vite. Prefer `start:prod` / Compose for production-build evidence.

---

## 3. How to install the PWA from the self-hosted origin

1. Serve the **production** client with `/api` proxy (Compose or `npm run start:prod`).
2. On a phone, open `http://<LAN-or-host>:3000/` (not a desktop-only localhost bake).
3. Install via the quiet, dismissible in-flow affordance; home-screen open enters the same main conversation (standalone).
4. Same IDs as desktop/Web; approvals fail closed without a reachable card.

Physical-device install was **not** performed on this host.

---

## 4. Evidence

### Inherited (free-CLI / earlier OpenCode host — not re-owned)

- Fixture PNGs in `docs/evidence/p1-electron-pwa/` (Playwright mocks + real abort disconnect).
- Earlier `install.ok` capture under tightened rules (standalone + `/` + icon 200/`image/png` + SW registered).

### This Cloud Auto fix pass

| Check | Result |
| --- | --- |
| `VITE_API_BASE_URL= npm run build` | **PASS** |
| `node --test shared/hamsterOrigin.test.mjs electron/sessionStore.test.cjs` | **PASS** (14) |
| `node scripts/p1-prod-proxy-verify.mjs` | **PASS** — non-localhost `http://172.30.0.2:13000/api/health` via client proxy; reject API-only + arbitrary site |
| Electron display reopen smoke | **FAILED** (bounded): dbus address parse errors, GPU process exit, `ERR_FAILED` on loadURL; substitute = `sessionStore` unit tests |
| Physical device / live model / design gate / eve freeze | **Not claimed** |

Regression coverage includes: valid origin, invalid 200, API-only, redirect, credentials/scheme, API base same-origin relative, route restore, navigation allowlist, IPC sender trust, badge count retained across focus/blur, ConnectGate title ≠ disconnect copy, install prompt not fixed overlay.

---

## 5. Remaining gaps (honest)

- Physical-device PWA install + keyboard/safe-area on real hardware.
- Successful Electron **window** visual / full BrowserWindow reopen on a host without dbus/GPU failures.
- Real notification / dock hardware behaviour.
- Operator + DesignBot review; **product not accepted**.

## 6. Quick repro

```bash
cd client && VITE_API_BASE_URL= npm run build
node ../scripts/p1-prod-proxy-verify.mjs
node --test ../shared/hamsterOrigin.test.mjs ../electron/sessionStore.test.cjs
```
