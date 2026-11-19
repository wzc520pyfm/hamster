# Hamster P1 — Electron desktop client + installable PWA (operator doc)

**Branch:** `feat/p1-electron-pwa-20261119`
**Base SHA:** `ed8f1c6d901e75485f9d7296728df7ad35345740` (exact `main` HEAD when the slice started)

Provisional-name **private** exploration. Not a product launch. **Eve is not frozen.** Not a
live-model verification. **Not a design-gate pass. Product not accepted.**

Same product UI and the same `conversationId` / `taskId` / `runtimeSessionId` / `assetId` / approval
IDs across Web, Electron, and PWA. Approvals are in-app cards only (**fail-closed**). Close / quit /
reload / background never Cancel or auto-approve.

---

## 1. Must-change items (summary)

| # | Item | State |
| --- | --- | --- |
| 1–7 | UI reuse, `minWidth: 480`, restore semantics, badge, disconnect copy, PWA standalone, placeholder icons | Implemented; see prior commits + this follow-up |

### Follow-up after Product review block (post-`49fb1fe`)

Independently reproduced, then fixed (small patch):

1. **`.env.example` / README Compose bake** — example had `VITE_API_BASE_URL=http://localhost:8080`;
   `cp .env.example .env` + compose `${VITE_API_BASE_URL:-}` would bake phone loopback.
   **Fix:** example empty; Compose **hard-codes** `VITE_API_BASE_URL: ""` (does not inherit host `.env`).
2. **ConnectGate A→B CORS** — renderer `fetch`-validated B from A against production `server.mjs`
   (no ACAO) → browser CORS block before `requestConnect`.
   **Fix:** Electron path only normalizes locally; **main** owns validate + navigate (sender-checked).
   No permissive CORS added to privileged endpoints.
3. **Security tidy** — `hamster:session-origin` sync IPC requires trusted sender; `setWindowOpenHandler`
   default-deny; `/internal` not proxied; `safeJoinDist` uses root+sep boundary; shared vs electron
   origin helpers covered by consistency tests.
4. **Install affordance** — conversation column is `flex-1` inside `100dvh` shell so in-flow install
   bar does not push composer/approvals off the first screen (headless 390×844 bbox evidence).

---

## 2. How to start Electron / PWA

```bash
cp .env.example .env          # VITE_API_BASE_URL must stay empty
sudo docker compose up --build -d   # forces empty client bake + /api proxy

# Or local production-like:
cd client && npm install && VITE_API_BASE_URL= npm run build
API_UPSTREAM=http://127.0.0.1:8080 npm run start:prod

cd ../electron && npm install
HAMSTER_CONTROL_ORIGIN=http://127.0.0.1:3000 npx electron .
```

PWA: open `http://<LAN-IP>:3000` on a phone (same-origin `/api`). Physical install **not** claimed here.

ConnectGate title: `Connect to Hamster` / `连接 Hamster`. Disconnect remains
`Can't reach this Hamster` / `无法连接` + Retry.

---

## 3. Evidence (provenance)

### Current-tip (this follow-up) — raw files under `/opt/cursor/artifacts/p1-followup-evidence/`

| Artifact | Result |
| --- | --- |
| `bake-with-env-example-*.txt` (pre-fix reproduce) | CONFIRMED loopback bake |
| `prod-build-stdout.txt` / `stderr` | PASS empty bake |
| `unit-tests.tap.txt` | PASS (19 tests) |
| `readme-compose-bake-regression.txt` | PASS |
| `cross-origin-gate-cors.log` | CONFIRMED renderer CORS block vs production server |
| `nonlocalhost-proxy-verify.json` | PASS |
| `p1-narrow-install-affordance-bbox.png` + `.json` | PASS fullyVisible (headless; **not** physical) |

Also copied bbox shot into `docs/evidence/p1-electron-pwa/`.

### Inherited (not re-owned as Electron/physical)

- Fixture six PNGs from earlier free-CLI capture.
- Electron BrowserWindow reopen: still **FAILED** historically (dbus/GPU); **not re-looped**;
  `sessionStore` unit tests are **not** a BrowserWindow reopen PASS.

---

## 4. Remaining gaps

- Physical-device PWA install / keyboard / safe-area.
- Successful Electron window visual / reopen on a healthy display host.
- Real notification/dock hardware.
- ProductBot re-review — **stop without PR**.
