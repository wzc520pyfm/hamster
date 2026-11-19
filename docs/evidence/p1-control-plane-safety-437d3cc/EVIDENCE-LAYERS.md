# Control-plane safety evidence layers (accurate labels)

**Code under test:** `437d3cca32558fe42e9d4389080811fefae89a2b`  
**Docs branch tip at start of this supplement:** `2efad7612d343532a3527f3101237975ecef0bd8`

## Runtime probe

- Docker/Compose: **UNVERIFIED / UNAVAILABLE** — see `docker-probe.txt`, `runtime-probe-full.txt` (no docker/podman/nerdctl/docker.sock).
- Viable route used: noDocker local PostgreSQL 16 + Node 24 API + eve@1.0.2 with empty `HAMSTER_MODEL_ID` (mockModel worker).

## verify-p0 runs

| Layer | Path / DB | Verdict | Label |
|-------|-----------|---------|-------|
| r1 | `verify-p0-run/` (steer-era attempt) | steer/setup failures | **HISTORICAL FAIL / steer** — not the accepted regression |
| r2 | `verify-p0-run-r2/` | steer/setup failures | **HISTORICAL FAIL / steer** — not the accepted regression |
| r3 | `verify-p0-run-r3/` + DB `hamster_p1_cp_437d3cc_r3` ports 54083/34549 | PASS=24 FAIL=0 NOTE=2 | **ACCEPTED basic scope** — real API+DB, not Electron fixture |

### Honesty notes inside r3 / verify-p0 (do not over-claim)

- **Expiry authorize denial:** verify-p0 plants an already-expired pending row whose `params_hash` is the literal demo string `expiry-demo-hash`, **not** the canonical hash of the ticket params. That proves expired status cannot authorize under that planted hash; it does **NOT** independently verify natural worker-issued expiry → consumption denial on a matching params_hash. Do not claim natural worker expiry consumption as verified.
- **Cancel invalidation:** cancel path invalidates **unused pending** tickets (including a planted pending used in the script for the second-task case). Labeled as planted-pending invalidation where planted; real pending_before count is also observed on the live task.
- **NOTE=2:** mockModel disclaimer + planted-invalidation note from the script itself.

## Single-use / params_hash supplements

| Layer | Path | Verdict | Label |
|-------|------|---------|-------|
| Planted single-use (prior) | `singleuse-result.json`, `singleuse-*.json`, `singleuse2-*`, `singleuse-stdout.txt` | authorize single-use on **planted approved** ticket `appr_plant_su_*` | **INCOMPLETE for safety gate** — worker did issue a real pending, but consumption proof used a planted approved ticket to dodge the post-approve race. Keep as history; do not close the gate on it. |
| Unplanted chain (this turn) | `unplanted-singleuse/` + `run2/` | pass=true | **GATE SUPPLEMENT** — worker-issued pending → real approve → wrong deny (still unconsumed) → exact allow same ticketId → exact deny. Runnable script included. |

## API stdout labeling

- `unplanted-singleuse/api.stdout.log` — **successful** listen on :54100 for this supplement.
- `control-plane-safety/api.log` — later **EADDRINUSE** collision attempt; **MUST NOT** be labeled successful startup.

## Visual INDEX note (unchanged requirement)

- `12-fail-closed-approvals.png` — **OLD duplicate-banner baseline (NOT after)**. After shots: `-en` / `-zh`.
