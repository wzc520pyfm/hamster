# Handoff notes — server.mjs entry candidate (20261121c)

## Actual remote refs (authoritative via git; not FREEZE self-ref)

- Base `main`: `583285679d618fa58abd2d2a537c078fbb4d66a2`
- Parent tip before this append commit: `cae4daf4b324169a67715cca2c95a8a3830da8b8` (`cae4daf…` review baseline)
- New tip: see **external** `CANDIDATE_TIP.txt` / `git rev-parse origin/cursor/p1-server-mjs-entry-182b` after push
  (do not embed tip of the commit that only edits FREEZE)

## Historical vs current materials

| Path | Status |
|---|---|
| `docs/evidence/p1-server-mjs-entry-candidate-20261121/RESULT.md` | **Historical snapshot** frozen around evidence commit `18059c8` / materials era — preserve |
| `…/commits.txt`, `files-vs-main.txt`, `diffstat-vs-main.txt` | **Historical** at materials commit — preserve; not re-snapshotted here |
| `…/logs/persist-through-pwa-retry-run.txt` + `run2.txt` | **ONE run** (identical SHA-256 `015fde2858e54518…`) — not two runs |
| `docs/evidence/p1-persist-through-pwa-retry-20261121/*.json` | **Executed positive** combined browser run — preserved |
| This directory `p1-server-mjs-entry-handoff-20261121c/` | **Final handoff** for 3 narrow fixes + directed Node tests |

## Combined-run boundaries (executed positive; no browser re-run this round)

- ENGINEERING_INJECTION: notify-only (not natural late-activation delay)
- Explicit `reg.update()` — not automatic SW discovery alone
- Eve ACK_STUB_NO_INFERENCE — no paid inference
- No phone/mobile; no Docker image CMD claim
- Proxy full stress / stream errors: untested

## This append (directed Node only)

1. `.env.example` empty `VITE_API_BASE_URL` + cross-origin override docs; config regression
2. Soft-pass removed; `requireControllerChangeObserved` + negative Node test
3. `assertLiveEphemeralOrThrow` before business SQL + negative zero-business-query test

## Checks this round

See `logs/harness-guards-test.txt` (7/7) and `logs/safejoin-recheck.txt` (1/1).
No big browser re-run. No Docker. No PR.
