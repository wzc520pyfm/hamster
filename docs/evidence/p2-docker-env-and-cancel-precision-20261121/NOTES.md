# Environment + cancel-precision checkpoint (2026-11-21)

Parent tip reviewed: `40738bab69fa3775a45eab12b3e8b422f3dcba4a` (closes prior 3 MUST FIX at **limited code checkpoint only** — not acceptance).

## Cancel / legacy frozen-identity — precise semantics

**Steer** (isolated, missing `eve_instance_id` / `eve_image_id`): HTTP **409** `{ error: "isolated_task_frozen_identity_missing" }`.

**Cancel** (isolated, missing frozen identity): does **not** uniformly return HTTP 409.
Observed / coded path in `api/index.js` `cancelTask`:

1. Task is cancelled **locally** first (`status = 'cancelled'`, control row applied).
2. Frozen-identity lookup failure is logged; identity stays null (no rebind to current managed).
3. Session cancel attempt throws; response still **200/JSON success for local cancel** with:
   - `status: "cancelled"`
   - `sessionCancel: "failed: isolated_task_frozen_identity_missing"` (or similar `failed: …`)
4. Worker session cancel is therefore **not delivered**; local cancel + audit still succeed.

Do **not** report “legacy cancel → 409”. Report: local cancel succeeds; `sessionCancel` records the frozen-identity failure string.

## Independent Docker probe (this cloud VM) — read-only

| Check | Result |
|-------|--------|
| `DOCKER_HOST` / `DOCKER_TLS_*` | **unset** |
| `docker` / `podman` / `nerdctl` binary | **absent** (`command not found`) |
| packages `docker.io` / `docker-ce` / `podman` | **not installed** |
| `/var/run/docker.sock` / `/run/docker.sock` | **absent** |
| `~/.docker/context` | **absent** |
| Local listener `:2375` | **present** (`0.0.0.0:2375 LISTEN`) |

**Deliberate non-action:** no `docker -H tcp://…:2375`, no `/_ping`, no API calls to that listener. Treat `:2375` as the **forbidden box/live Docker endpoint**, not an independent VM daemon.

**Conclusion:** this cloud VM does **not** have a truly independent Docker daemon usable for a dedicated worker/gateway experiment. Cannot build/run production worker image or natural approve→start→inspect chains on real containers here without using the box daemon (disallowed) or installing/starting a privileged daemon (disallowed).

## Minimal safe proposal (no live fallback)

1. **Preferred:** provision a **dedicated** Cloud Agent / CI environment that includes a **local** Docker Engine (unix socket only; `DOCKER_HOST` unset or `unix:///var/run/docker.sock`), with egress that does **not** expose/share the box `:2375`, and with policy forbidding `DOCKER_HOST=tcp://…:2375`.
2. On that environment, run a **named fixture** compose/project (`hamster-p2-fixture-<runId>`), unique network/ports/dataDir, unique container names — never `desktop` fixed live name; never down `-v` against shared stacks; never stop/rm foreign containers.
3. Natural chain only: create ticket → `POST /approve` → broker create/start → inspect managed identity → persist frozen task columns → NDJSON facts from **labeled local canned/fixture provider** → cancel. No SQL-seeded “approved” as natural proof. No paid model.
4. Until (1) exists: keep unit + ephemeral-PG + gateway-main fixture Eve evidence; **do not** code a detour that talks to box Docker.

## Boundaries

- No box live stack / desktop / faces 5–6.
- No PR / merge / publish / paid provider.
- Docker natural chain: **blocked on environment**, not on product code remaining from the prior 3 fixes.
