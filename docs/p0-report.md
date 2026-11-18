# Hamster P0 evidence report

Provisional-name private exploration. Not a product launch. Not a claim that eve is frozen beyond what this report records.

**Base continued from:** commit `1a5501df061bef36308f956a29103764ff4f9aa5` (tree `07e9ca6669571c8360adaafc1e21b68519301671`).

**Engine under test:** `eve@1.0.2` (self-hosted `eve build` / `eve start`). Hermes was **not** evaluated in parallel and was not needed after eve hard-constraint verification.

**How tested (primary):** local single-host stack — Postgres 16 + API on `:8080` + eve agent on `:8081` + React client preview on `:3000`. Script: `scripts/verify-p0.sh`. Artifacts under `/tmp/hamster-p0-evidence/` on the verification host. Compose images also `docker compose build` successfully (`db`/`agent`/`api`/`client`).

---

## Hard constraints

### 1. Pure self-host — **PASS**

| Check | Result | Evidence |
| --- | --- | --- |
| Compose (or equivalent) starts control plane, React client, required DB | PASS | `docker-compose.yml` defines `db`, `agent`, `api`, `client`. `docker compose build` built all app images. Local equivalent loop: Postgres + `node index.js` + `eve start` + Vite preview — `/api/health` → `{"status":"ok"}`, eve `/eve/v1/health` → ready, client HTTP 200. |
| Loop without Vercel / hosted eve / OpenUI commercial services | PASS | API uses self-hosted Postgres + self-hosted eve HTTP. Dashboards render from persisted OpenUI React Lang 1.0 text + named queries; no OpenUI Gateway. |
| Secrets only via env; placeholders overridable; no real secrets committed | PASS | `.env.example` and Compose defaults keep `changeme` / `super-secret-change-me` / `dev-*-secret`. Grep for common real-secret patterns: clean. |
| Missing model keys → runnable skeleton + exact env steps | PASS | Default agent uses `mockModel` fixture. README documents `HAMSTER_MODEL_ID` + provider credentials. No invented live model results. |

### 2. React web client — three demo surfaces — **PASS**

| Surface | Route / placement | Notes |
| --- | --- | --- |
| Line A — same-main-conversation task control | `/` | Task cards in timeline; composer always available; EN \| 中文 shell switch. |
| Line B — persistent Dashboard | `/assets/:assetId` (library at `/assets`) | Same route for library and in-chat open. |
| Approvals | In-conversation cards + `/approvals` | Shell pending count. Exact EN/ZH status words from the direction doc. |

UI: restrained light theme (shadcn-style primitives), Fraunces + Source Sans 3, no mascot, no marketing hero, no competitor-default green, no Full Access toggle, no “please open a new thread”.

### 3. Line A — independent worker + receipts — **PASS**

| Check | Result | Evidence |
| --- | --- | --- |
| Separate `conversationId`, `taskId`, `runtimeSessionId`, `assetId` | PASS | verify-p0: distinct ids recorded in `conversation.json` / `task-created.json` / `asset.json`. |
| Ordinary follow-up does not cancel/steer worker | PASS | Follow-up message left task `running`. Chat uses conversation session; tasks use product-created **independent root** eve sessions (`eve.createSession` per task), not parent/child close coupling. |
| Progress from persisted events only | PASS | `progress` answered from `task_events`; fixture model does not estimate percentages. |
| Steer/Cancel on specific Task card; Cancel copy is task-scoped | PASS | Client: `Cancel this task` / `Steer this task`. API cancel invalidates unused approvals, cancels that session only. |
| Control receipts: Received → Pending apply → Applied | PASS | Mid-flight steer returned `pending_apply`; later control row `applied` after `acknowledge_control`. “Queued successfully” is not used as Applied. |
| Cancel does not auto-rollback; does not harm siblings / main chat | PASS | Sibling task remained `running` after cancel of task1; unused approval invalidated. |

### 4. Line B / OpenUI React Lang 1.0 — **PASS**

| Check | Result | Evidence |
| --- | --- | --- |
| Stable `assetId`; library + chat same document | PASS | Single `assets` row; route `/assets/:assetId` only. |
| Refresh re-fetches bindings into stable slots; no model redo; no relayout | PASS | `POST /api/assets/:id/refresh` then GET: identical `openui` document, same `layoutVersion`. Client `DashboardView` keeps slot tree mounted. |
| Refresh failure keeps last success + exact copy | PASS | Forced named-query failure → API `freshness=refresh_failed`, `lastSuccessAt` preserved, `data` still present. Client shows `Refresh failed — still showing last success` / `Stale — still showing last success` with Retry. |
| OpenUI description/render only; server validate + persist; no commercial Dashboard dependency | PASS | Document built/validated in control plane; client renders registered slots from persisted snapshot. |
| No separate “persistent UI asset runtime” repo | PASS | All in this repo. |

### 5. Approvals / leases — **PASS**

| Check | Result | Evidence |
| --- | --- | --- |
| High-risk default: this action only | PASS | `publish_dashboard` uses eve `always()` **and** control-plane ticket consume-once with params hash. UI: `Approve this action` / `Deny`. No Always allow / Approve all / Full access. |
| Fail closed: no channel / expiry / ignore | PASS | Sweeper expires pending tickets; decision note exact string `Expired — not approved, so it did not run` (verified on `appr_expiry_demo`). Policy denies publish without matching approved ticket (`no_valid_ticket`) — covers eve omit-approval = must not run. |
| Steer / cancel / change invalidates tickets | PASS | Cancel invalidated 1 unused approval in verify-p0; steer path updates outstanding pending to `invalidated`. |
| Not toast-only; not auto-approved look | PASS | Persistent approval cards in conversation + Approvals nav. |

### Suggested (not sole fail) — process restart / cross-version

| Item | Status |
| --- | --- |
| Process restart resumes or `needs_review` without duplicating assets | **Partial / documented:** API re-attaches eve followers on boot; `save_dashboard_page` is idempotent per task (`assets` lookup by `task_id`). Task `needsReview` flag surfaces when non-terminal tasks go quiet >15m. Full chaos restart of eve Workflow world across versions was not exhaustively proven in this pass. |
| Cross-eve-version session restore limits | **Documented as framework limit:** eve session restore across major eve upgrades may not be guaranteed; product holds ids in Postgres and can mark `needs_review` rather than inventing progress. |

---

## Eve verdict

**Eve hard constraints: PASS** for this P0 private exploration, with evidence above. Hermes was not started.

Not claimed: production readiness, public launch, frozen eve forever, or commercial hosted-path parity.

## Next step

1. Keep the repo private; iterate UX polish only as needed.
2. Optional: longer soak test of API/agent restart mid-approval.
3. Only if a future hard constraint fails on eve in this repo: timebox the **same** constraints on Hermes here — do not run both engines in parallel from a cold start.

## Out of P0 (explicitly not built)

Cloud computers, same-host isolated desktop containers, BYO remote computers, voice, chat channels, inbound webhook, team/group workspaces, multi-bot, schedule, bounded browser, memory correction, required Electron, native iOS/Android, Memory Hub, new memory project.
