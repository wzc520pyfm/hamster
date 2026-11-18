# Hamster P0 evidence report (updated)

Provisional-name **private** exploration. Not a product launch. **Eve is not frozen.** This report deliberately does **not** treat a prior `19/0` script tally as a product gate pass.

**Branch / PR:** `cursor/p0-react-client-hard-constraints-6139` → https://github.com/wzc520pyfm/hamster/pull/1  

**Engine under test:** `eve@1.0.2` self-hosted with the **scripted `mockModel` fixture** unless `HAMSTER_MODEL_ID` and provider credentials are set. Hermes was **not** started.

---

## How the stack was run

| Path | Status |
| --- | --- |
| `docker compose build` (api + client after OpenUI change; agent image previously built) | Done on the verification host |
| Full `docker compose up --build` end-to-end loop on this host | **Not claimed** — the contract tests used a local equivalent loop while those ports were occupied |
| Equivalent local single-host loop | **Used for contract evidence:** Postgres 16 + `api` `:8080` + `eve start` `:8081` + Vite preview `:3000` |

Acceptance remains: Compose *or equivalent* must complete without Vercel / hosted eve / OpenUI commercial Dashboard or Gateway.

---

## Newly proven in this revision

### 1) OpenUI React Lang 1.0 — **implemented (was missing)**

| Check | Evidence |
| --- | --- |
| Dependency | `client/package.json` → `@openuidev/react-lang` |
| Persist real OpenUI Lang | `api/src/assets.js` emits `$rev`, `Query("metrics_weekly", { rev: $rev }, defaults)`, registered `Stack` / `CardHeader` / `KpiGrid` / `MetricsTable` / `Note` / `RevSync` |
| Server-validate then persist | `api/src/openuiValidate.js` via `@openuidev/lang-core` `createParser`; invalid docs refused |
| Official Renderer | `DashboardView.tsx` → `<Renderer response={asset.openui} library={hamsterOpenUiLibrary} toolProvider={…} />` |
| Same asset / same route | `/assets/:assetId` for library and in-chat |
| Constrained refresh | `$rev` bump through `RevSync` **without remounting** Renderer; `openui_document` unchanged |
| Failure keeps last success | Forced named-query outage → `freshness=refresh_failed`, identical openui, retained data + `lastSuccessAt`; UI copy `Refresh failed — still showing last success` |
| No competing runtime repo / no commercial Gateway | This private repo only |

### 2) Strengthened `scripts/verify-p0.sh` — **hard fails when contract fails**

Latest local equivalent run: **PASS=24 FAIL=0 NOTE=1** (the NOTE is the fixture-path disclaimer). Artifacts under `docs/evidence/`.

Now asserts (among retained Line A / policy checks):

1. **Forced refresh failure** (rename `metrics_weekly`, `POST /refresh`, restore) — `ok=false`, `freshness=refresh_failed`, unchanged openui, retained data.
2. **Real approval expiry** — insert expired pending ticket, sweeper → status `expired` + exact `Expired — not approved, so it did not run`, policy still denies publish.
3. **Cancel invalidation** — requires `invalidatedApprovals > 0` when unused pending tickets existed (no more `inv >= 0` always-pass).

### 3) UI surfaces — **partially exercised**

| Surface | Result | How |
| --- | --- | --- |
| Conversation shell | Observed | Browser smoke at `http://localhost:3000/` — Hamster / Private preview / composer / Task card statuses |
| Dashboard library + `/assets/:assetId` | Observed | OpenUI-rendered KPIs + table; library list freshness included exact `Refresh failed — still showing last success`; Refresh kept layout |
| Approvals | Observed | Cards with exact `Expired — not approved, so it did not run` and `Invalidated — approve again` (no live pending card in that dataset) |
| EN \| 中文 | **Pass (Playwright)** | `scripts/ui-smoke-locale.mjs` — nav `对话` / `Dashboard 库` / `待审批`, header `主对话`, then back to EN. Earlier computer-use click coordinates falsely reported fail; deterministic Playwright proves the toggle. |

Screenshots (browser smoke): `docs/evidence/ui-smoke/`.

This is **not** a full product E2E suite (no pending Approve/Deny click-path in the smoke dataset).

---

## Still fixture-limited / not claimed

- Worker path that created the asset/approval under contract tests used eve **`mockModel`**, not a live provider key.
- Full `docker compose up --build` loop not re-recorded on this host this revision (Compose **build** yes; local equivalent loop used for runtime checks).
- **Eve hard constraints are not announced as a product pass.** Eve is **not frozen.**
- Prior `19/0` product-pass framing is **withdrawn**.

---

## Policy layer (unchanged intent, re-checked)

- High-risk `publish_dashboard` requires consume-once approved ticket with matching params hash.
- Unknown actions denied; cancelled tasks denied new tool calls.
- Eve omit-approval still cannot run high-risk work: no ticket ⇒ `no_valid_ticket`.

---

## Out of scope

Cloud computers, isolated desktops, BYO remotes, voice, channels, webhooks, team workspaces, multi-bot, schedule, bounded browser, memory correction, required Electron, native mobile, Memory Hub, Hermes, public launch, npm publish.

## Next step

Keep the repo private and this PR open. Treat fixture-path contract green + OpenUI Renderer wiring as progress toward a gate, not a launch. Do not start Hermes unless eve fails an honest hard constraint.
