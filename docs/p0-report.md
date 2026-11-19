# Hamster P0 evidence report (updated 2026-11-19)

Provisional-name **private** exploration. Not a product launch. **Eve is not frozen.** This report deliberately does **not** treat script tallies as a product gate pass. ProductBot decides freeze / P0 pass after review.

**Branch:** `feat/p0-selfhost-verify-20261119` (PR against `main`; do not merge from this note alone)

**Engine under test:** `eve@1.0.2` self-hosted. Worker path used eve’s deterministic **`mockModel` fixture** because `HAMSTER_MODEL_ID` was empty and no provider credentials were present. Hermes was **not** started. No live-model results were invented.

---

## How the stack was run (this revision)

| Path | Status |
| --- | --- |
| Full `sudo docker compose up --build -d` on this host | **Done.** Images built; `db` + `agent` + `api` + `client` containers started; published ports `5432` / `8081` / `8080` / `3000`. |
| Compose networking caveat on this host | Fresh Docker install used **nft** rules while **iptables-legacy FORWARD** defaulted to `DROP` with `bridge-nf-call-iptables=1`, so API→DB stayed in `SYN_SENT` until legacy FORWARD accepted the Compose bridge. After that fix, API listened and `/api/health` returned `{"status":"ok"}`. |
| Contract script against Compose | **PASS=24 FAIL=0 NOTE=1** — `scripts/verify-p0.sh` with `DB_CMD="sudo docker compose exec -T db psql -U hamster -d hamster"`. |
| Live provider model | **Not run.** `HAMSTER_MODEL_ID` unset → fixture path only (NOTE=1). |

Acceptance remains: Compose *or equivalent* without Vercel / hosted eve / OpenUI commercial Dashboard or Gateway. This revision used **real Compose**, not only the prior local equivalent.

Artifacts: `docs/evidence/compose-20261119/` (compose build log excerpt, verify transcript, JSON fixtures) and refreshed `docs/evidence/verify-p0-latest.txt`.

---

## What passed on the real Compose path

Re-checked end-to-end with the Compose API + fixture agent (not a mocked HTTP layer):

1. Health, conversation / task / `runtimeSessionId` separation, ordinary follow-up non-interference.
2. Progress answered from control-plane persisted events (not a model estimate).
3. Steer `pending_apply` → `applied`; asset created with OpenUI React Lang 1.0 (`Query` + registered components).
4. Successful refresh keeps identical `openui` / `layoutVersion`; **forced** named-query outage → `freshness=refresh_failed`, openui unchanged, last success retained.
5. Pending approval; omit-approval publish → fail-closed; unknown actions denied.
6. Real expiry sweeper → status `expired` + exact `Expired — not approved, so it did not run`; expired ticket cannot authorize publish.
7. Cancel sets task cancelled, sibling survives, cancelled task denied new tools, unused pending → `invalidated` with exact `Invalidated — approve again`.
8. No obvious real secret material committed.

**Still fixture-bound for the worker tool sequence:** the agent that produced the asset/approval under test was eve `mockModel`, not a live key.

---

## UI / locale (secondary, same PR)

Closed-state approval footers now use `approvalDecisionCopy()` so the footer follows the **active locale** design-table strings (same wording as the badge), instead of the English-stored `decision_note`. Pending has no decision sentence. Exact pairs only; no synonym rewrites.

| State | EN | ZH | Evidence |
| --- | --- | --- | --- |
| Approved | Approved for this action only | 仅批准此次动作 | `docs/evidence/ui-smoke/approval-approved-this-action-only.webp`, `zh-approval-approved-this-action-only.webp` |
| Denied | Denied | 已拒绝 | `approval-denied.webp`, `zh-approval-denied.webp` |
| Expired | Expired — not approved, so it did not run | 已过期，未获批准，动作未执行 | `approval-expired.webp`, `zh-approval-expired.webp` |
| Invalidated | Invalidated — approve again | 已失效，请重新审批 | `approval-invalidated.webp`, `zh-approval-invalidated.webp` |

Per-card recaptures on the Compose client (2026-11-19). See `docs/evidence/ui-smoke/NOTES.md`.

**Not recaptured / not claimed**

- Dashboard freshness **Stale — still showing last success** / **仍显示上次成功结果** — no product path sets `freshness=stale`. Not faked.
- ZH **排队** / **运行中** — ephemeral; not re-held honestly this pass.

---

## Model keys missing — runnable skeleton + hard-cut

**Current runnable skeleton (no keys):** leave `HAMSTER_MODEL_ID` empty. `agent/agent/agent.ts` selects `mockModel({… scriptedRespond …})`. That path is what Compose + `verify-p0.sh` exercised. It must not be described as a live-model pass.

**Exact hard-cut to a live model (when credentials exist):**

1. Put provider credentials in the environment the **agent** process/container can read (never commit them; keep `.env` gitignored).
2. Set `HAMSTER_MODEL_ID` to a real provider model id (see `.env.example` / README).
3. `sudo docker compose up --build -d agent` (or rebuild the whole stack).
4. Confirm agent logs show the configured model id, **not** `hamster-scripted` / fixture provider.
5. Re-run `./scripts/verify-p0.sh` (with Compose `DB_CMD` if applicable). Treat failures as failures; do **not** invent model completions or paste fixture evidence as live-model evidence.
6. Until step 5 is green on a live model, keep the fixture NOTE and do not announce an eve freeze or P0 product pass.

---

## Still not claimed

- Eve hard constraints are **not** a product pass. Eve is **not** frozen.
- Prior `19/0` product-pass framing remains **withdrawn**.
- No Hermes. No Vercel deploy. No npm publish. Repo stays **private**.
- This is **not** a full product E2E / design-gate pass.

---

## Out of scope

Cloud computers, isolated desktops, BYO remotes, voice, channels, webhooks, team workspaces, multi-bot, schedule, bounded browser, memory correction, required Electron, native mobile, Memory Hub, Hermes, public launch, npm publish, logo work.

## Next step

Keep the repo private and the PR open for ProductBot review. Fixture Compose green + locale footer fix are progress toward a gate, not a launch.
