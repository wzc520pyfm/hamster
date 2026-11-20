# Annotation — harness soft-pass (historical JSON preserved)

**Do not overwrite** `persist-through-pwa-retry-20261121.json` (executed positive run).

## Historical positive record (one run)

- Artifact / evidence JSON: `actualControllerChangeObserved: true` on step
  `activation_observed_unaided_no_harness_skip_waiting` — **valid positive observation**
  for that executed browser run.
- `logs/persist-through-pwa-retry-run.txt` and `run2.txt` (if both present in materials)
  are the **same single run** (identical content hash) — count as **ONE** run, not two.

## Harness defect (source, fixed later)

Prior harness source used:

```js
(injectionLate?.actualControllerChangeObserved === true || true)
```

That expression is **always true** and is **not** a robust regression gate.
The historical JSON still correctly recorded `observed: true` for the real run;
the soft-pass meant a future missing observation could still `ok: true`.

## Fix (this candidate append; no big browser re-run)

- `requireControllerChangeObserved()` hard-requires `actualControllerChangeObserved === true`
- Directed Node negative test proves missing observation fails
- `assertLiveEphemeralOrThrow` throws on identity mismatch **before** business SQL
- Directed Node negative: mismatched datadir/marker → **zero** business queries

## Boundaries of the historical combined run (unchanged claims)

- ENGINEERING_INJECTION: **notification suppress only** — not natural late activation delay
- Eve: ACK_STUB_NO_INFERENCE — no paid inference
- Explicit `reg.update()` — not automatic SW discovery alone
- No phone/mobile, no Docker image CMD claim
- Proxy full stress / stream errors: **untested**
