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
4. **Install affordance + pending actions** — conversation column is `flex-1` inside `100dvh` shell
   (desktop included; no unbounded grow-below-fold). Pending approvals sit in a compact dock
   **above** the composer (outside the message scroller). Headless evidence uses `elementFromPoint`
   + clip checks (viewport bbox alone is **not** acceptance).

### Product follow-up (information sufficiency) — SUMMARY → EXACT FULL → CONFIRM

Prior dock visibility fix was accepted as visibility-only; Product rejected **information sufficiency**
of a compact card that hid title / safeParams / expiry while offering direct Approve.

**Required route (this tip):**

1. **Dock summary** — pins **one** pending summary only (+ remaining count + entry to pending list).
   Shows plain action, identifiable target (title · assetId · channel), status vocabulary, **View details**
   / **查看详情**, Deny may stay. **Never Approve** on the summary (desktop or narrow).
2. **View details** deep-links to `/approvals?id=<exactApprovalId>` (also accepts `?focus=`), focuses that
   ticket (ring + scroll). Full confirmation card shows task title/id, plain action, safeParams
   (asset/channel/task; secrets masked as `•••`), expiry, Deny + Approve. Ticket binding fail-closed;
   navigation does not auto-approve.
3. **Install body** — no `truncate` / text-overflow; full EN/ZH wrap:
   `Add Hamster to your home screen for full-screen use.` /
   `把 Hamster 加到主屏幕以使用全屏模式。`
4. Capture matrix script: `node scripts/p1-approval-summary-matrix.mjs` (fixture mock API only).

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

### Current tip — SUMMARY → CONFIRM matrix

Raw: `/opt/cursor/artifacts/p1-approval-summary-evidence/` (see `INDEX.md`).
Repo copy: `docs/evidence/p1-electron-pwa/approval-summary-2026-11-19/`.

| ID | Shot | Result |
| --- | --- | --- |
| A | desktop 1200×800 EN, two pending, composer | PASS — one summary, no Approve, View details + more-pending |
| B | 390×844 ZH, one pending + install + composer | PASS — full ZH install body |
| C | 390×667 EN, two pending + install + composer | PASS — hit-test after bounded scroll |
| D-en / D-zh | exact `appr_p1_ticket_A` full confirm | PASS — title, asset, channel, expiry, redacted token, Deny+Approve |
| interaction | View details → Approve A; B unchanged | PASS — also `noApproveDesktop` |

`matrix-report.json`, `prod-build-*.txt`, `unit-tests.tap.txt` (19 PASS) stored with the shots.
**Platform label:** Chromium headless — **NOT** Electron / **NOT** physical phone.

### Prior follow-up (preserved) — `/opt/cursor/artifacts/p1-followup-evidence/`

| Artifact | Result |
| --- | --- |
| bake / CORS / proxy / hitfix bbox logs | retained; see that dir `INDEX.md` |
| `p1-narrow-install-affordance-bbox.png` | prior visibility fix (superseded for Approve-in-dock route) |

### Inherited / unverified

- Fixture six PNGs from earlier free-CLI capture.
- Electron BrowserWindow reopen: still **FAILED** historically (dbus/GPU); **not re-looped**.
- Post-fix **real Electron** ConnectGate A→B window path: **UNVERIFIED** (do not treat Node/CORS
  reproduce logs as Electron connection success).

---

## 4. Remaining gaps

- Physical-device PWA install / keyboard / safe-area.
- Successful Electron window visual / reopen on a healthy display host.
- Real notification/dock hardware.
- ProductBot re-review — **stop without PR**.
