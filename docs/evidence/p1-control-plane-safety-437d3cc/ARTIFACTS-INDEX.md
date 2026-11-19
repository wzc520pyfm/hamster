# Evidence index — startup connect gate + control-plane safety

**Tested SHA:** see `testedSha.txt` / `control-plane-safety/environment-config.json`  
**Layer map:** `control-plane-safety/EVIDENCE-LAYERS.md`

## Visual / Electron gate (prior)

- `01-*.png` … `11-*.png` — gate/mount/disconnect matrix
- `12-fail-closed-approvals-en.png` / `12-fail-closed-approvals-zh.png` — **AFTER** single-banner Approvals disconnect (1183×761)
- `12a-approvals-pending-online.png` / `12b-approvals-after-reconnect.png` — Case9 online→offline→reconnect
- **`12-fail-closed-approvals.png` — OLD DUPLICATE-BANNER BASELINE (before fix). NOT an after shot.** Also copied under `before-failure/12-fail-closed-approvals-DUPLICATE-BANNER.png`.

## Control-plane safety

- `control-plane-safety/EVIDENCE-LAYERS.md` — r1/r2 steer fails vs r3 accept; expiry/cancel honesty; planted vs unplanted single-use
- `control-plane-safety/STATUS.txt` — prior r3 MEASURED summary (basic verify-p0 scope)
- `control-plane-safety/environment-config.json` — r3 isolated env (no secrets)
- `control-plane-safety/docker-probe.txt` / `runtime-probe-full.txt` — Docker unavailable
- `control-plane-safety/verify-p0*.txt` / `verify-p0-run-r3/` — accepted PASS=24/0/2NOTE
- `control-plane-safety/verify-p0-run/` + `verify-p0-run-r2/` — **HISTORICAL steer failures**, not accepted
- `control-plane-safety/singleuse-*` / `singleuse2-*` — **HISTORICAL planted-approved single-use** (incomplete for gate)
- **`control-plane-safety/unplanted-singleuse/`** — **GATE SUPPLEMENT** runnable script + run2 raw req/res/DB/timing + successful `api.stdout.log`
- `control-plane-safety/api.log` — **EADDRINUSE failure log; NOT successful startup** (see `unplanted-singleuse/api.stdout.log` / `api-startup-success.txt`)

## Other

- `OPERATOR-REPORT.md`, `result.json`, unit TAP, client build logs, E2E driver
- `prior-verified/` — earlier production E2E retained
